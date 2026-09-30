import type { BrowserChatMode } from "@/hooks/use-browser-panel";
import { browserChatSize } from "../components/browser-chat-overlay";
import type { BrowserChatWindowState } from "../../../../shared/browser-chat-window";

type BrowserStageRect = Pick<DOMRectReadOnly, "y" | "right" | "height">;

export function browserChatWindowGeometry(
  stage: BrowserStageRect,
  mode: BrowserChatMode,
  composerHeight = 48,
): Omit<BrowserChatWindowState, "visible"> {
  // The browser panel animates its left edge on expansion. Keep the native
  // child pinned to the fixed right edge so its renderer does not resize and
  // reflow the floating chat on every transition frame.
  const bounds = {
    x: 0,
    y: Math.round(stage.y),
    width: Math.max(1, Math.round(stage.right)),
    height: Math.max(1, Math.round(stage.height)),
  };
  const size = browserChatSize(mode, bounds, composerHeight);
  return {
    bounds,
    card: {
      x: bounds.width - 16 - size.width,
      y: bounds.y + bounds.height - 16 - size.height,
      width: size.width,
      height: size.height,
    },
  };
}
