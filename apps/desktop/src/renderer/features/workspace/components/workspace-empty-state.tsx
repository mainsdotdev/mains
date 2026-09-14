import { lazy, Suspense, useState } from "react";
import type { Workspace } from "../types";
import { useWorkspaceVariant } from "@/hooks/use-workspace-variant";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useUpdateSpaceMutation } from "@/lib/redux/api";
import { solidColors, themeConfigToSwatchIndex } from "@/lib/space-themes";
import type { WorkspaceVariant } from "@/lib/provider-variants";
import { ParticleLogoCanvas } from "./particle-logo-canvas";
import { Mains } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { SpaceThemePicker } from "./space-theme-picker";

const ClaudeSettings = lazy(() => import("@/features/settings/components/claude"));
const CodexSettings = lazy(() => import("@/features/settings/components/codex"));
const CopilotSettings = lazy(() => import("@/features/settings/components/copilot"));
const CursorSettings = lazy(() => import("@/features/settings/components/cursor"));

function ProviderSettings({ variant }: { variant: WorkspaceVariant }) {
  switch (variant) {
    case "claude":
      return <ClaudeSettings />;
    case "codex":
      return <CodexSettings />;
    case "copilot":
      return <CopilotSettings />;
    case "cursor":
      return <CursorSettings />;
    default:
      return null;
  }
}

export type WorkspaceEmptyPresentation = "logo" | "headline";

interface WorkspaceEmptyStateProps {
  workspace: Workspace | null;
  /** `headline` matches a centered empty prompt (title + input below). Default keeps the animated logo. */
  presentation?: WorkspaceEmptyPresentation;
  isCustomizing?: boolean;
  onToggleCustomize?: () => void;
}

export function WorkspaceEmptyState({
  presentation = "logo",
  isCustomizing = false,
  onToggleCustomize,
}: WorkspaceEmptyStateProps) {
  const variant = useWorkspaceVariant();
  const { activeSpace } = useActiveSpace();
  const [updateSpace] = useUpdateSpaceMutation();

  const { colorIndex } = themeConfigToSwatchIndex(activeSpace?.themeConfig || null);

  const [trackedSpaceId, setTrackedSpaceId] = useState<string | undefined>(
    activeSpace?.id,
  );
  const [hasOpenedCustomizer, setHasOpenedCustomizer] = useState(isCustomizing);
  if (isCustomizing && !hasOpenedCustomizer) setHasOpenedCustomizer(true);

  if (activeSpace?.id !== trackedSpaceId) {
    setTrackedSpaceId(activeSpace?.id);
  }

  const handleSelectTheme = (index: number) => {
    if (!activeSpace) return;
    const pair = solidColors[index] || solidColors[0];
    const themeConfig = JSON.stringify({
      lightBackground: pair.light.value,
      darkBackground: pair.dark.value,
    });
    updateSpace({ id: activeSpace.id, payload: { themeConfig } });
  };

  if (presentation === "headline") {
    const customizerEase = "cubic-bezier(0.22, 1, 0.36, 1)";
    const customizerDuration = "650ms";

    return (
      <div className="flex flex-col items-center py-2 text-center shrink-0 w-full max-w-210">
        <Button
          tooltip="Customize space"
          variant="bare"
          onClick={onToggleCustomize}
          aria-label={
            isCustomizing ? "Hide space customizer" : "Customize space"
          }
          aria-pressed={isCustomizing}
        >
          <Mains
            className="h-16 w-auto shrink-0 text-primary-200 dark:text-primary-800 hover:text-primary-300 dark:hover:text-primary-700 hover:scale-102 transition-all duration-300"
            aria-hidden
          />
        </Button>

        <div
          className="grid w-full transition-[grid-template-rows] will-change-[grid-template-rows]"
          style={{
            gridTemplateRows: isCustomizing ? "1fr" : "0fr",
            transitionDuration: customizerDuration,
            transitionTimingFunction: customizerEase,
          }}
        >
          <div className="overflow-hidden">
            {activeSpace ? (
              <div
                aria-hidden={!isCustomizing}
                className={`flex flex-col items-stretch py-4 text-left transition-[opacity,transform,filter] transform-gpu ${
                  isCustomizing
                    ? "opacity-100 translate-y-0 blur-0"
                    : "opacity-0 -translate-y-2 blur-sm pointer-events-none"
                }`}
                style={{
                  transitionDuration: customizerDuration,
                  transitionTimingFunction: customizerEase,
                }}
              >
                <div className="flex justify-center pb-8">
                  <SpaceThemePicker
                    selectedColorIndex={colorIndex}
                    onSelectColor={handleSelectTheme}
                  />
                </div>

                {hasOpenedCustomizer ? (
                  <Suspense fallback={null}>
                    <ProviderSettings variant={variant} />
                  </Suspense>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
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
