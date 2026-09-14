import { useMemo } from "react";
import { useActiveSpace } from "./use-active-space";
import { getModeConfig } from "@/lib/mode-config";

interface LayoutConfig {
  rightPanelComponent: string;
}

export function useLayoutConfig(): LayoutConfig {
  const { activeSpace } = useActiveSpace();
  const mode = activeSpace?.mode;
  return useMemo(
    () => ({ rightPanelComponent: getModeConfig(mode).rightPanel.component }),
    [mode],
  );
}
