import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { Button, Modal, Text } from "@/components/ui";
import { Close, Download, Plus, Minus } from "@/components/ui/icons";

interface ImagePreviewModalProps {
  name: string;
  src: string;
  onClose: () => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.25;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export function ImagePreviewModal({ name, src, onClose }: ImagePreviewModalProps) {
  const titleId = useId();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{
    pointerX: number;
    pointerY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const canPan = scale > 1;

  // Reset the view whenever a different image is opened in the same modal.
  // Adjusting state during render (rather than in an effect) is React's
  // recommended pattern for resetting on a prop change and avoids a flash of
  // the previous zoom before the effect runs.
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  const zoomIn = useCallback(
    () => setScale((prev) => clampScale(prev + ZOOM_STEP)),
    [],
  );
  const zoomOut = useCallback(
    () =>
      setScale((prev) => {
        const next = clampScale(prev - ZOOM_STEP);
        if (next <= 1) setOffset({ x: 0, y: 0 });
        return next;
      }),
    [],
  );
  const resetZoom = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Keyboard zoom shortcuts (Escape close is handled by Modal).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [zoomIn, zoomOut, resetZoom]);

  // Wheel-to-zoom. Attached natively (non-passive) so preventDefault can stop
  // the trackpad pinch from zooming the whole app.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((prev) => {
        const next = clampScale(prev * Math.exp(-e.deltaY * 0.002));
        if (next <= 1) setOffset({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!canPan) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOrigin.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current;
    if (!origin) return;
    setOffset({
      x: origin.offsetX + (e.clientX - origin.pointerX),
      y: origin.offsetY + (e.clientY - origin.pointerY),
    });
  };

  const endDrag = () => {
    dragOrigin.current = null;
    setDragging(false);
  };

  const handleDownload = useCallback(async () => {
    const filename = name || "image";
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback for sources fetch can't read: let the browser handle the href.
      const a = document.createElement("a");
      a.href = src;
      a.download = filename;
      a.click();
    }
  }, [src, name]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      backdrop="media"
      aria-labelledby={titleId}
      className="w-fit min-w-80 max-w-[92vw]"
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-primary-200 dark:border-primary-800  shrink-0">
        <Text
          as="span"
          id={titleId}
          size="xs"
          tone="subtle"
          className="font-mono truncate"
        >
          {name}
        </Text>
        <div className="flex items-center gap-1 ml-3 shrink-0 glass-surface p-1 rounded-full">
          <Button
            onClick={handleDownload}
            aria-label="Download image"
            tooltip="Download"
            className="p-1 rounded-full hover:bg-primary-200 dark:hover:bg-primary-800 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-primary-500" />
          </Button>
          <Button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-full hover:bg-primary-200 dark:hover:bg-primary-800 transition-colors cursor-pointer"
          >
            <Close className="w-3.5 h-3.5 text-primary-500" />
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 bg-primary-100 dark:bg-primary-900 flex items-center justify-center p-2 overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          src={src}
          alt={name}
          draggable={false}
          className="max-h-[80vh] max-w-full object-contain rounded select-none"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: dragging ? "none" : "transform 120ms ease-out",
            cursor: canPan ? (dragging ? "grabbing" : "grab") : "default",
          }}
        />
        <div className="absolute bottom-3 glass-surface left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-full px-1.5 py-1 shadow-lg">
          <Button
            onClick={zoomOut}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
            className="p-1.5 rounded-full text-primary-200 hover:bg-primary-100/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Minus className="w-3.5 h-3.5" />
          </Button>
          <Button
            onClick={resetZoom}
            aria-label="Reset zoom"
            title="Reset zoom"
            className="min-w-12 px-1 text-xs font-medium tabular-nums text-primary-100 hover:text-primary cursor-pointer"
          >
            {Math.round(scale * 100)}%
          </Button>
          <Button
            onClick={zoomIn}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
            className="p-1.5 rounded-full text-primary-200 hover:bg-primary-100/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </Modal>
  );
}
