import { useMemo } from "react";
import { useActiveSpace } from "./use-active-space";
import { getModeConfig, type ModeSidebarConfig } from "@/lib/mode-config";

export type SidebarConfig = ModeSidebarConfig;

export function useSidebarConfig(): SidebarConfig {
  const { activeSpace } = useActiveSpace();
  const mode = activeSpace?.mode;
  return useMemo(() => getModeConfig(mode).sidebar, [mode]);
}
