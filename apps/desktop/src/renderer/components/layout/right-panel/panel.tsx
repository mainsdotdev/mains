import { PANEL_COMPONENTS, DEFAULT_PANEL_COMPONENT } from "./panel-components";
import { ResizeHandle } from "@/components/layout/resize-handle";
import { useAppSelector, useAppDispatch } from "@/lib/redux/hooks";
import { setRightPanelWidth } from "@/lib/redux/slices/appSettingsSlice";
import { setLayoutWidthVar } from "@/hooks/use-layout-width-vars";
import { useIsMobile } from "@/lib/platform";
import {
  PANEL_WIDTH_VAR,
  PANEL_WIDTH_MIN,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_DEFAULT,
} from "@/lib/layout";

interface PanelProps {
  isVisible: boolean;
  isAnimatedIn: boolean;
  width: string;
  component: string;
}

export function Panel({ isVisible, isAnimatedIn, width, component }: PanelProps) {
  const PanelContent = PANEL_COMPONENTS[component] || DEFAULT_PANEL_COMPONENT;
  const dispatch = useAppDispatch();
  const rightPanelWidth = useAppSelector((s) => s.appSettings.rightPanelWidth);
  const isMobile = useIsMobile();

  if (!isVisible) return null;

  return (
    <div
      className={`block fixed top-0 bottom-0 right-0 overflow-hidden transition-[transform,opacity] duration-150 ease-out z-(--z-overlay) will-change-transform ${
        isMobile ? "bg-primary dark:bg-primary-950 shadow-2xl" : "bg-transparent"
      }`}
      style={{
        // Full-width overlay on mobile; resizable column on desktop.
        width: isMobile ? "100vw" : width,
        transform: isAnimatedIn ? "translate3d(0,0,0)" : "translate3d(100%,0,0)",
        opacity: isAnimatedIn ? 1 : 0,
      }}
      role="complementary"
      aria-label="Right panel"
    >
      <ResizeHandle
        edge="left"
        value={rightPanelWidth}
        min={PANEL_WIDTH_MIN}
        max={PANEL_WIDTH_MAX}
        computeWidth={(clientX) => window.innerWidth - clientX}
        onPreview={(w) => setLayoutWidthVar(PANEL_WIDTH_VAR, w)}
        onCommit={(w) => dispatch(setRightPanelWidth(w))}
        onReset={() => dispatch(setRightPanelWidth(PANEL_WIDTH_DEFAULT))}
        ariaLabel="Resize panel"
      />
      <PanelContent />
    </div>
  );
}
