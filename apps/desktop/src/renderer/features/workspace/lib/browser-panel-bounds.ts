export interface BrowserViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function browserPanelBounds(rect: BrowserViewportRect) {
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}
