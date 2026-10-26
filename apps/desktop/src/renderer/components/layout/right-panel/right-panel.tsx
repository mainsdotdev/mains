import { useLayoutConfig } from "@/hooks/use-layout-config";
import { usePanelAnimation } from "@/hooks/use-panel-animation";
import { Panel } from "./panel";

interface RightPanelProps {
  isOpen: boolean;
  width?: string;
}

/**
 * The right panel body alone. App.tsx renders the preview and right-panel
 * toggles separately so modes that hide this panel retain the preview toggle.
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
