import type { Workspace } from "../types";
import { useWorkspaceVariant } from "@/hooks/use-workspace-variant";
import { ParticleLogoCanvas } from "./particle-logo-canvas";
import { Mains } from "@/components/ui/icons";

export type WorkspaceEmptyPresentation = "logo" | "headline";

interface WorkspaceEmptyStateProps {
  workspace: Workspace | null;
  /** `headline` matches a centered empty prompt (title + input below). Default keeps the animated logo. */
  presentation?: WorkspaceEmptyPresentation;
}

export function WorkspaceEmptyState({
  presentation = "logo",
}: WorkspaceEmptyStateProps) {
  const variant = useWorkspaceVariant();

  if (presentation === "headline") {
    return (
      <div className="flex flex-col items-center py-2 text-center shrink-0 w-full max-w-210">
        <Mains
          className="h-16 w-auto shrink-0 text-primary-200 dark:text-primary-800"
          aria-hidden
        />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center justify-center h-full pb-6">
      <ParticleLogoCanvas
        className="w-125 h-70"
        variant={variant}
        text=""
      />
    </div>
  );
}
