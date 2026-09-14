import { useEffect, useRef, useMemo, useState } from "react";
import { appApi, appEvents } from "@/lib/transport";
import { Terminal, ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useDarkMode } from "@/hooks/use-dark-mode";

const baseThemeColors = {
  dark: {
    foreground: "#cecdc3",
    cursor: "#cecdc3",
    selectionBackground: "#403e3c",
    black: "#0c0c0c",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#cecdc3",
    brightBlack: "#575653",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
  light: {
    foreground: "#1c1917",
    cursor: "#1c1917",
    selectionBackground: "#d6d3d1",
    black: "#1c1917",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#ca8a04",
    blue: "#2563eb",
    magenta: "#9333ea",
    cyan: "#0891b2",
    white: "#f5f5f4",
    brightBlack: "#78716c",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#eab308",
    brightBlue: "#3b82f6",
    brightMagenta: "#a855f7",
    brightCyan: "#06b6d4",
    brightWhite: "#ffffff",
  },
};



const getTheme = (variant: string | undefined, isDark: boolean): ITheme => {
  const backgrounds = isDark ? "#0c0c0c" : "#ffffff"
  const colors = isDark ? baseThemeColors.dark : baseThemeColors.light;
  return {
    background: backgrounds,
    ...colors,
  };
};

interface XtermTerminalProps {
  id: string;
  /** Undefined asks the backend to start the PTY in its own home directory. */
  rootPath?: string;
  variant?: string;
  pendingCommand?: string | null;
  onPendingCommandSent?: () => void;
}

export function XtermTerminal({
  id,
  rootPath,
  variant,
  pendingCommand,
  onPendingCommandSent,
}: XtermTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const { darkMode } = useDarkMode();
  const [ptyReady, setPtyReady] = useState(false);

  const theme = useMemo(() => getTheme(variant, darkMode), [variant, darkMode]);

  // Update terminal theme when dark mode or variant changes
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = theme;
    }
  }, [theme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "ui-monospace, monospace",
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
