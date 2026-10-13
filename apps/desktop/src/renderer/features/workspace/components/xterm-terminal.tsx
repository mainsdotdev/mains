import { useEffect, useRef, useMemo, useState, useSyncExternalStore } from "react";
import { getTransport, onTransportChange } from "@/lib/transport";
import { CHANNELS } from "@mains/contracts/channels";
import type { TerminalDataEvent, TerminalExitEvent, TerminalSnapshot } from "@mains/contracts/terminal";
import { Button, Text } from "@/components/ui";
import { createTerminalReplay } from "../lib/terminal-replay";
import { Terminal, ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useThemeTokens } from "@/hooks/use-theme-tokens";
import { isHexColor, mixOklab } from "@/lib/color";

/**
 * ANSI hues stay fixed per mode: they carry meaning (red is an error, green a
 * pass), and the one-dark / Tailwind sets read on any theme's background. The
 * neutrals come from the theme scale instead — see `terminalTheme`.
 */
const ANSI_HUES = {
  dark: {
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
  },
  light: {
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#ca8a04",
    blue: "#2563eb",
    magenta: "#9333ea",
    cyan: "#0891b2",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#eab308",
    brightBlue: "#3b82f6",
    brightMagenta: "#a855f7",
    brightCyan: "#06b6d4",
  },
};

const SCALE_TOKENS = [
  "--color-primary",
  "--color-primary-100",
  "--color-primary-200",
  "--color-primary-600",
  "--color-primary-700",
  "--color-primary-800",
  "--color-primary-900",
  "--color-primary-950",
] as const;

type ScaleValues = Record<(typeof SCALE_TOKENS)[number], string>;

const FONT_TOKENS = ["--font-mono"] as const;

/**
 * The terminal's neutrals are steps of the theme scale, picked to match the
 * surface it sits on (`bg-primary` / `dark:bg-primary-950`) and the grays it
 * used before themes (each within a shade of its old literal).
 */
function terminalTheme(scale: ScaleValues, isDark: boolean): ITheme {
  if (!isDark) {
    return {
      background: scale["--color-primary"],
      foreground: scale["--color-primary-900"],
      cursor: scale["--color-primary-900"],
      selectionBackground: scale["--color-primary-200"],
      black: scale["--color-primary-900"],
      white: scale["--color-primary-100"],
      brightBlack: scale["--color-primary-600"],
      brightWhite: scale["--color-primary"],
      ...ANSI_HUES.light,
    };
  }
  // Halfway between the hover step and the one above it; `mixOklab` needs
  // hex, which the scale always is once the stylesheet has loaded.
  const [hover, above] = [scale["--color-primary-800"], scale["--color-primary-700"]];
  return {
    background: scale["--color-primary-950"],
    foreground: scale["--color-primary-200"],
    cursor: scale["--color-primary-200"],
    selectionBackground:
      isHexColor(hover) && isHexColor(above) ? mixOklab(hover, above, 0.5) : above,
    black: scale["--color-primary-950"],
    white: scale["--color-primary-200"],
    brightBlack: scale["--color-primary-700"],
    brightWhite: scale["--color-primary"],
    ...ANSI_HUES.dark,
  };
}

interface XtermTerminalProps {
  id: string;
  /** Workspace PTYs outlive their views; login PTYs remain temporary. */
  persistent?: boolean;
  /** Undefined asks the backend to start the PTY in its own home directory. */
  rootPath?: string;
  pendingCommand?: string | null;
  onPendingCommandSent?: () => void;
}

export function XtermTerminal({
  id,
  persistent = false,
  rootPath,
  pendingCommand,
  onPendingCommandSent,
}: XtermTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const transport = useSyncExternalStore(onTransportChange, getTransport);
  const { darkMode } = useDarkMode();
  const [ptyReady, setPtyReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);

  const scale = useThemeTokens(SCALE_TOKENS);
  const theme = useMemo(() => terminalTheme(scale, darkMode), [scale, darkMode]);
  // The code font from Settings › Appearance; xterm measures glyphs itself,
  // so it takes the resolved stack rather than a var().
  const fontFamily =
    useThemeTokens(FONT_TOKENS)["--font-mono"] || "ui-monospace, monospace";

  // Update the terminal theme when the mode or the app theme changes
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = theme;
    }
  }, [theme]);

  // A new font changes the cell size: refit the grid to the pane and tell the
  // PTY, as the resize observer below does for a pane resize.
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.fontFamily === fontFamily) return;
    term.options.fontFamily = fontFamily;
    fitAddonRef.current?.fit();
    const dims = fitAddonRef.current?.proposeDimensions();
    if (dims) void transport.invoke(CHANNELS.terminal.resize, [id, dims.cols, dims.rows]).catch(() => {});
  }, [fontFamily, id, transport]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily,
      theme,
      allowProposedApi: true,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.open(container);

    let disposed = false;
    let generation = 0;
    let frame = 0;
    let ready = false;
    let observedExit: number | null = null;
    const replay = createTerminalReplay((data) => { if (!disposed && data) term.write(data); });
    setPtyReady(false);
    setError(null);
    setExitCode(null);

    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || !container.clientWidth || !container.clientHeight) return;
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && ready) void transport.invoke(CHANNELS.terminal.resize, [id, dims.cols, dims.rows]).catch(() => {});
      });
    };
    const connect = async () => {
      const attempt = ++generation;
      ready = false;
      observedExit = null;
      setPtyReady(false);
      replay.begin();
      try {
        const result = await transport.invoke(persistent ? CHANNELS.terminal.attach : CHANNELS.terminal.create,
          persistent ? [id] : [{ id, cwd: rootPath }]);
        if (disposed || attempt !== generation) return;
        if (!result.success) throw new Error(result.error);
        const snapshot = result.data as TerminalSnapshot | undefined;
        if (!snapshot || snapshot.session?.id !== id || typeof snapshot.data !== "string" || !Number.isSafeInteger(snapshot.sequence)) {
          throw new Error("Could not connect to terminal. Restart Mains and try again.");
        }
        term.reset();
        replay.restore(snapshot);
        ready = observedExit === null && snapshot.session.status === "running";
        setPtyReady(ready);
        setExitCode(observedExit ?? snapshot.session.exitCode);
        setError(null);
        fit();
      } catch (err) {
        if (!disposed && attempt === generation) setError(err instanceof Error ? err.message : "Could not connect to terminal.");
      }
    };

    // PTY output → xterm
    const removeDataListener = transport.subscribe(CHANNELS.terminal.data,
      (value) => {
        const payload = value as TerminalDataEvent;
        if (!disposed && payload.id === id) replay.push(payload);
      },
    );
    const removeExitListener = transport.subscribe(CHANNELS.terminal.exit, (value) => {
      const payload = value as TerminalExitEvent;
      if (disposed || payload.id !== id) return;
      ready = false;
      observedExit = payload.exitCode;
      setPtyReady(false);
      setExitCode(payload.exitCode);
    });

    // xterm input → PTY
    const onDataDisposable = term.onData((data) => {
      if (ready) void transport.invoke(CHANNELS.terminal.write, [id, data]).catch(() => {});
    });

    // Auto-fit on resize
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(container);
    const removeStatus = transport.onStatusChange((status) => {
      if (status === "connected") void connect();
      else { generation += 1; ready = false; setPtyReady(false); }
    });
    void connect();
    fit();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      removeDataListener();
      removeExitListener();
      removeStatus();
      term.dispose();
      // Hiding, changing tabs/workspaces, and renderer reloads only detach a
      // managed view. Stop actions and backend shutdown own PTY destruction.
      if (!persistent) void transport.invoke(CHANNELS.terminal.destroy, [id]).catch(() => {});
      termRef.current = null;
      fitAddonRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rootPath, persistent, transport, retry]);

  // Write any queued one-shot command once the PTY exists. The shell buffers
  // input arriving before its prompt, so a write right after create is safe.
  useEffect(() => {
    if (!ptyReady || !pendingCommand) return;
    let cancelled = false;
    void transport.invoke(CHANNELS.terminal.write, [id, `${pendingCommand}\r`]).then((result) => {
      if (!cancelled && result.success) onPendingCommandSent?.();
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ptyReady, pendingCommand, id, onPendingCommandSent, transport]);

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      {error && <div role="alert" className="flex shrink-0 items-center gap-2 px-1 py-1"><Text size="s" tone="danger">{error}</Text><Button variant="bare" className="text-s text-accent" onClick={() => setRetry((value) => value + 1)}>Retry</Button></div>}
      {exitCode !== null && <Text size="s" tone="faint" className="px-1 py-1">Process exited ({exitCode})</Text>}
      <div ref={containerRef} className="min-h-0 w-full flex-1" style={{ padding: "6px 4px" }} />
    </div>
  );
}
