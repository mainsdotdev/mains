import { WorkspaceSidebar } from "@/features/workspace/components/workspace-sidebar";

export const PANEL_COMPONENTS: Record<string, React.ComponentType> = {
  workspace: WorkspaceSidebar,
  claude: WorkspaceSidebar,
};

export const DEFAULT_PANEL_COMPONENT = WorkspaceSidebar;
