import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Text } from "@/components/ui";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useLocalVisualizationUrl } from "@/hooks/use-local-visualization-url";
import { requestVisualizationFollowUp } from "@/features/workspace/lib/visualization-bridge";

const STATE_PREFIX = "mains:visualization-state:v1:";
const MAX_STATE_BYTES = 16 * 1024;
const MIN_FRAME_HEIGHT = 180;
const MAX_FRAME_HEIGHT = 10_000;
const WIDE_FRAME_MAX_WIDTH = 1024;

export function getWideVisualizationLayout(
  baseWidth: number,
  viewportWidth: number,
): { width: number; marginLeft: number } {
  const availableWidth = Math.max(baseWidth, viewportWidth);
  const width = Math.min(WIDE_FRAME_MAX_WIDTH, availableWidth);
  return {
    width,
    marginLeft: (baseWidth - width) / 2,
  };
}

type VisualizationHostMessage =
  | { type: "height"; height: unknown }
  | { type: "state"; state: unknown }
  | { type: "open-external"; url: unknown }
  | { type: "follow-up"; prompt: unknown; title?: unknown };

function readStoredState(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || new TextEncoder().encode(raw).byteLength > MAX_STATE_BYTES) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistState(key: string, state: unknown): void {
  try {
    const raw = JSON.stringify(state);
    if (new TextEncoder().encode(raw).byteLength > MAX_STATE_BYTES) return;
    localStorage.setItem(key, raw);
  } catch {
    // Widget state is best-effort. Cyclic or unavailable storage stays local
    // to the running iframe without breaking the visualization itself.
  }
}

function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function VisualizationArtifact({
  absPath,
  title,
  mode,
}: {
  absPath: string;
  title?: string;
  mode?: "wide";
}) {
  const url = useLocalVisualizationUrl(absPath);
  const { darkMode } = useDarkMode();
  const theme = darkMode ? "dark" : "light";
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const stateKey = useMemo(() => `${STATE_PREFIX}${absPath}`, [absPath]);
  const [height, setHeight] = useState(mode === "wide" ? 560 : 420);
  const [wideLayout, setWideLayout] = useState<{
    width: number;
    marginLeft: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (mode !== "wide") return;
    const container = containerRef.current;
    const parent = container?.parentElement;
    const scrollViewport = container?.closest<HTMLElement>(
      '[class~="overflow-y-auto"]',
    );
    if (!container || !parent || !scrollViewport) return;

    const measure = () => {
      const next = getWideVisualizationLayout(
        parent.clientWidth,
        scrollViewport.clientWidth,
      );
      setWideLayout((current) =>
        current?.width === next.width &&
        current.marginLeft === next.marginLeft
          ? current
          : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    observer.observe(scrollViewport);
    return () => observer.disconnect();
  }, [mode]);

  const disconnect = useCallback(() => {
    portRef.current?.close();
    portRef.current = null;
  }, []);

  const connect = useCallback(() => {
    disconnect();
    const target = iframeRef.current?.contentWindow;
    if (!target) return;

    const channel = new MessageChannel();
    portRef.current = channel.port1;
    channel.port1.onmessage = (event: MessageEvent<VisualizationHostMessage>) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;

      if (message.type === "height") {
        const next = Number(message.height);
        if (!Number.isFinite(next)) return;
        setHeight(
          Math.min(
            MAX_FRAME_HEIGHT,
            Math.max(MIN_FRAME_HEIGHT, Math.ceil(next)),
          ),
        );
        return;
      }

      if (message.type === "state") {
        persistState(stateKey, message.state);
        return;
      }

      if (message.type === "open-external") {
        const externalUrl = safeExternalUrl(message.url);
        if (externalUrl) void window.api.shell.openExternal(externalUrl);
        return;
      }

      if (message.type === "follow-up") {
        if (typeof message.prompt !== "string") return;
        const prompt = message.prompt.trim().slice(0, 20_000);
        if (!prompt) return;
        const title = typeof message.title === "string"
          ? message.title.trim().slice(0, 250)
          : "";
        requestVisualizationFollowUp({
          prompt,
          ...(title ? { title } : {}),
        });
      }
    };
    channel.port1.start();
    target.postMessage(
      {
        type: "mains-visualization-init",
        theme,
        widgetState: readStoredState(stateKey),
      },
      "*",
      [channel.port2],
    );
  }, [disconnect, stateKey, theme]);

  useEffect(() => disconnect, [disconnect, url]);

  useEffect(() => {
    portRef.current?.postMessage({ type: "host-update", theme });
  }, [theme]);

  if (!url) {
    return (
      <div className="flex min-h-45 w-full items-center justify-center rounded-2xl border border-primary-200/70 bg-primary-50/40 dark:border-primary-800/70 dark:bg-primary-950/25">
        <Text as="span" size="xs" tone="subtle">
          Loading visualization…
        </Text>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full mb-9 mt-6 overflow-hidden "
      data-visualization-mode={mode ?? "normal"}
      style={mode === "wide" ? wideLayout ?? undefined : undefined}
    >
      <iframe
        ref={iframeRef}
        src={url}
        title={title || `Interactive visualization: ${absPath.split("/").pop() ?? "visualization"}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        onLoad={connect}
        className="block w-full border-0 bg-transparent"
        style={{ height, colorScheme: "normal" }}
      />
    </div>
  );
}
