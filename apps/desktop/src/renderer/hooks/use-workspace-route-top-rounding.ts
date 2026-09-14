import { useMainHeader } from "@/hooks/use-main-header";
import { useAppSelector } from "@/lib/redux/hooks";

/** Workspace route root: align top-left with MainContent when first tab is active and sidebar is expanded. */
export function useWorkspaceRouteTopRounding(): string {
  const { firstTabActive } = useMainHeader();
  const sidebarCollapsed = useAppSelector((s) => s.appSettings.sidebarCollapsed);
  if (firstTabActive && !sidebarCollapsed) {
    return "rounded-tl-none rounded-tr-2xl";
  }
  return "rounded-t-2xl";
}
