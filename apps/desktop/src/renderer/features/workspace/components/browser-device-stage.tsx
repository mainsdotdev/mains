import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { BrowserDeviceEmulationViewModel } from "./browser-tab-strip";
import {
  browserDeviceFrame,
  type BrowserDeviceResizeEdge,
  resizedBrowserDeviceDimensions,
} from "../lib/browser-device-frame";

interface BrowserDeviceStageProps {
  device: BrowserDeviceEmulationViewModel | null;
  viewportRef: RefObject<HTMLDivElement | null>;
  onResize: (device: BrowserDeviceEmulationViewModel) => void;
  onFrameChange?: () => void;
  children: ReactNode;
}

function GripLines({ orientation }: { orientation: "horizontal" | "vertical" }) {
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center gap-0.75 text-primary-500/80 dark:text-primary-400/80 ${
        orientation === "horizontal" ? "flex-row" : "flex-col"
      }`}
    >
      <span
        className={
          orientation === "horizontal"
            ? "h-5 w-px rounded-full bg-current"
            : "h-px w-7 rounded-full bg-current"
        }
      />
      <span
        className={
          orientation === "horizontal"
            ? "h-5 w-px rounded-full bg-current"
            : "h-px w-7 rounded-full bg-current"
        }
      />
    </span>
  );
}

export function BrowserDeviceStage({
  device,
  viewportRef,
  onResize,
  onFrameChange,
  children,
}: BrowserDeviceStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      setStageSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    },
    [],
  );

  const enabled = Boolean(device?.enabled);
  const frame = enabled && device
    ? browserDeviceFrame(
        stageSize.width,
        stageSize.height,
        device.width,
        device.height,
        device.scale,
      )
    : {
        left: 0,
        top: 0,
        width: stageSize.width,
        height: stageSize.height,
        effectiveScale: 1,
      };

  useLayoutEffect(() => {
    onFrameChange?.();
  }, [frame.height, frame.left, frame.top, frame.width, onFrameChange]);

  const resizeByKeyboard = (
    edge: BrowserDeviceResizeEdge,
    delta: { x: number; y: number },
  ) => {
    if (!device) return;
    const next = resizedBrowserDeviceDimensions(
      edge,
      device,
      delta,
      frame.effectiveScale,
    );
    onResize({ ...device, ...next, presetId: "responsive" });
  };

  const startResize = (
    edge: BrowserDeviceResizeEdge,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!device) return;
    event.preventDefault();
    const start = {
      x: event.clientX,
      y: event.clientY,
      width: device.width,
      height: device.height,
    };
    const cursor = edge === "bottom" ? "ns-resize" : "ew-resize";
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";

    const move = (moveEvent: PointerEvent) => {
      const next = resizedBrowserDeviceDimensions(
        edge,
        start,
        {
          x: moveEvent.clientX - start.x,
          y: moveEvent.clientY - start.y,
        },
        frame.effectiveScale,
      );
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        onResize({ ...device, ...next, presetId: "responsive" });
      });
    };

    const end = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const handleKeyDown = (
    edge: BrowserDeviceResizeEdge,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    const step = event.shiftKey ? 50 : 10;
    if (edge === "left" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      resizeByKeyboard(edge, {
        x: event.key === "ArrowLeft" ? -step : step,
        y: 0,
      });
    } else if (
      edge === "right" &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      resizeByKeyboard(edge, {
        x: event.key === "ArrowLeft" ? -step : step,
        y: 0,
      });
    } else if (
      edge === "bottom" &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      resizeByKeyboard(edge, {
        x: 0,
        y: event.key === "ArrowUp" ? -step : step,
      });
    }
  };

  return (
    <div
      ref={stageRef}
      className={`relative mb-px flex-1 overflow-hidden transition-colors ${
        enabled
          ? "bg-primary-200/70 dark:bg-primary-800/55"
          : "bg-transparent"
      }`}
    >
      <div
        className={`pointer-events-none absolute ${
          enabled
            ? "rounded-[11px] glass-outline glass-outline-soft"
            : "rounded-none"
        }`}
        style={{
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
        }}
      >
        <div
          ref={viewportRef}
          className="absolute inset-0"
        />
        <div
          className={`pointer-events-none absolute overflow-hidden ${
            enabled ? "inset-0 rounded-[10px]" : "inset-0"
          }`}
        >
          {children}
        </div>

        {enabled && (
          <>
            <button
              type="button"
              aria-label="Resize viewport from left"
              onPointerDown={(event) => startResize("left", event)}
              onKeyDown={(event) => handleKeyDown("left", event)}
              className="pointer-events-auto absolute -left-4 top-0 flex h-full w-3 cursor-ew-resize items-center justify-center rounded-md outline-none hover:bg-primary-950/5 focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-primary/10"
            >
              <GripLines orientation="horizontal" />
            </button>
            <button
              type="button"
              aria-label="Resize viewport from right"
              onPointerDown={(event) => startResize("right", event)}
              onKeyDown={(event) => handleKeyDown("right", event)}
              className="pointer-events-auto absolute -right-4 top-0 flex h-full w-3 cursor-ew-resize items-center justify-center rounded-md outline-none hover:bg-primary-950/5 focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-primary/10"
            >
              <GripLines orientation="horizontal" />
            </button>
            <button
              type="button"
              aria-label="Resize viewport from bottom"
              onPointerDown={(event) => startResize("bottom", event)}
              onKeyDown={(event) => handleKeyDown("bottom", event)}
              className="pointer-events-auto absolute -bottom-5 left-0 flex h-4 w-full cursor-ns-resize items-center justify-center rounded-md outline-none hover:bg-primary-950/5 focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-primary/10"
            >
              <GripLines orientation="vertical" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
