export type BrowserDeviceResizeEdge = "left" | "right" | "bottom";

export interface BrowserDeviceFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  effectiveScale: number;
}

const SIDE_GUTTER = 18;
const VERTICAL_GUTTER = 22;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function browserDeviceFrame(
  stageWidth: number,
  stageHeight: number,
  deviceWidth: number,
  deviceHeight: number,
  requestedScale: number,
): BrowserDeviceFrame {
  const availableWidth = Math.max(1, stageWidth - SIDE_GUTTER * 2);
  const availableHeight = Math.max(1, stageHeight - VERTICAL_GUTTER * 2);
  const effectiveScale = Math.max(
    0.1,
    Math.min(
      requestedScale,
      availableWidth / deviceWidth,
      availableHeight / deviceHeight,
    ),
  );
  const width = Math.max(1, Math.round(deviceWidth * effectiveScale));
  const height = Math.max(1, Math.round(deviceHeight * effectiveScale));

  return {
    left: Math.round((stageWidth - width) / 2),
    top: Math.round((stageHeight - height) / 2),
    width,
    height,
    effectiveScale,
  };
}

export function resizedBrowserDeviceDimensions(
  edge: BrowserDeviceResizeEdge,
  start: { width: number; height: number },
  delta: { x: number; y: number },
  effectiveScale: number,
): { width: number; height: number } {
  const safeScale = Math.max(0.1, effectiveScale);
  const widthDelta =
    edge === "left"
      ? -delta.x / safeScale
      : edge === "right"
        ? delta.x / safeScale
        : 0;
  const heightDelta = edge === "bottom" ? delta.y / safeScale : 0;

  return {
    width: Math.round(clamp(start.width + widthDelta, 200, 2_560)),
    height: Math.round(clamp(start.height + heightDelta, 300, 2_560)),
  };
}
