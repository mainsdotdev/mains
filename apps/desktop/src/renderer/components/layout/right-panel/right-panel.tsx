import { useLayoutConfig } from "@/hooks/use-layout-config";
import { usePanelAnimation } from "@/hooks/use-panel-animation";
import { Panel } from "./panel";

interface RightPanelProps {
  isOpen: boolean;
  width?: string;
}

/**
 * The right panel body alone. The toggle cluster (browser / terminal /
 * panel buttons) is rendered by App.tsx so it survives in modes that hide
 * this panel entirely (chat/work keep only the browser button).
 */
export default function RightPanel({ isOpen, width = "0rem" }: RightPanelProps) {
  const { isVisible, isAnimatedIn } = usePanelAnimation(isOpen);
  const { rightPanelComponent } = useLayoutConfig();

  return (
    <Panel
      isVisible={isVisible}
      isAnimatedIn={isAnimatedIn}
      width={width}
      component={rightPanelComponent}
    />
  );
}
