import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { Button, Modal } from "@/components/ui";
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

const floatingButtonClass =
  "flex size-9 items-center justify-center rounded-full bg-black/55 text-white/80 backdrop-blur-md hover:bg-black/75 hover:text-white";

const zoomButtonClass =
  "p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/15 disabled:opacity-40";

export function ImagePreviewModal({ name, src, onClose }: ImagePreviewModalProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  // Modal focuses its first focusable on open; that would be Download, whose
  // tooltip opens on focus. Close has no tooltip, so it takes initial focus.
  const closeButtonRef = useRef<HTMLButtonElement>(null);
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

  // Wheel-to-zoom anywhere on the stage. Attached natively (non-passive) so
  // preventDefault can stop the trackpad pinch from zooming the whole app.
  useEffect(() => {
    const el = stageRef.current;
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

  const onPointerDown = (e: PointerEvent<HTMLImageElement>) => {
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

  const onPointerMove = (e: PointerEvent<HTMLImageElement>) => {
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

  // The stage covers the Modal backdrop, so it takes over click-outside-to-close.
  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
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
      surface="bare"
      aria-label={name || "Image preview"}
      initialFocusRef={closeButtonRef}
      className="h-full w-full max-h-none"
    >
      <div
        ref={stageRef}
        className="relative flex h-full w-full items-center justify-center"
        onClick={onStageClick}
      >
        <img
          src={src}
          alt={name}
          draggable={false}
          className="block max-h-[70vh] max-w-[70vw] object-contain rounded-lg shadow-2xl select-none"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: dragging ? "none" : "transform 120ms ease-out",
            cursor: canPan ? (dragging ? "grabbing" : "grab") : "default",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />

        <div className="absolute right-0 top-0 z-10 flex items-center gap-2">
          <Button
            onClick={handleDownload}
            aria-label="Download image"
            tooltip="Download"
            tooltipPosition="bottom"
            className={floatingButtonClass}
          >
            <Download className="size-4" />
          </Button>
          <Button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close"
            className={floatingButtonClass}
          >
            <Close className="size-4" />
          </Button>
        </div>

        <div className="absolute bottom-0 left-1/2 z-10 -translate-x-1/2 flex items-center gap-0.5 rounded-full bg-black/55 p-1 backdrop-blur-md">
          <Button
            onClick={zoomOut}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
            className={zoomButtonClass}
          >
            <Minus className="w-3.5 h-3.5" />
          </Button>
          <Button
            onClick={resetZoom}
            aria-label="Reset zoom"
            title="Reset zoom"
            className="min-w-12 px-1 text-xs font-medium tabular-nums text-white/85 hover:text-white"
          >
            {Math.round(scale * 100)}%
          </Button>
          <Button
            onClick={zoomIn}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
            className={zoomButtonClass}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </Modal>
  );
}
