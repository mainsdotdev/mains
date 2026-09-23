import { useEffect, useRef, useMemo, useState } from "react";
import { appApi, appEvents } from "@/lib/transport";
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
  /** Undefined asks the backend to start the PTY in its own home directory. */
  rootPath?: string;
  pendingCommand?: string | null;
  onPendingCommandSent?: () => void;
}

export function XtermTerminal({
  id,
  rootPath,
  pendingCommand,
  onPendingCommandSent,
}: XtermTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const { darkMode } = useDarkMode();
  const [ptyReady, setPtyReady] = useState(false);

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
    if (dims) appApi.terminal.resize(id, dims.cols, dims.rows);
  }, [fontFamily, id]);

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

    // Slight delay to let the container settle before fitting
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // Create the PTY backend. Readiness is tracked so queued one-shot commands
    // aren't written into a PTY that doesn't exist yet.
    let disposed = false;
    setPtyReady(false);
    void Promise.resolve(appApi.terminal.create({ id, cwd: rootPath })).then(
      () => {
        if (!disposed) setPtyReady(true);
      },
    );

    // PTY output → xterm
    const removeDataListener = appEvents.terminal.onData(
      (payload: { id: string; data: string }) => {
        if (payload.id === id) {
          term.write(payload.data);
        }
      },
    );

    // xterm input → PTY
    const onDataDisposable = term.onData((data) => {
      appApi.terminal.write(id, data);
    });

    // Auto-fit on resize
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
          const dims = fitAddonRef.current.proposeDimensions();
          if (dims) {
            appApi.terminal.resize(id, dims.cols, dims.rows);
          }
        }
      });
    });
    resizeObserver.observe(container);

    cleanupRef.current = () => {
      disposed = true;
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      removeDataListener();
      term.dispose();
      appApi.terminal.destroy(id);
    };

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      termRef.current = null;
      fitAddonRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rootPath]);

  // Write any queued one-shot command once the PTY exists. The shell buffers
  // input arriving before its prompt, so a write right after create is safe.
  useEffect(() => {
    if (!ptyReady || !pendingCommand) return;
    appApi.terminal.write(id, `${pendingCommand}\r`);
    onPendingCommandSent?.();
  }, [ptyReady, pendingCommand, id, onPendingCommandSent]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-30"
      style={{ padding: "6px 4px" }}
    />
  );
}
