import {
  ChevronDown,
  CircleDot,
  Home,
  Mains,
  New,
  Plugin,
  Plus,
  ProjectFolder,
  RightPanelOpen,
  Search,
  Settings,
  SidebarClose,
  Task,
} from "@/components/ui/icons";
import type { ThemeAppearance } from "@/lib/app-themes";
import { getProviderVariant, type ProviderVariant } from "@/lib/provider-variants";

interface ThemePreviewProps {
  appearance: ThemeAppearance;
  variant: ProviderVariant | null;
}

/** A static app shell: previewing a theme never mounts live workspace hooks. */
export function ThemePreview({ appearance, variant }: ThemePreviewProps) {
  const provider = variant ? getProviderVariant(variant) : null;
  const ProviderIcon = provider?.icon ?? Mains;

  return (
    <div
      className="onboarding-app-preview "
      role="img"
      aria-label={`${appearance} theme preview`}
    >
      <div className="onboarding-preview-shell" aria-hidden="true">
        <div className="onboarding-preview-rail">
          <span className="onboarding-preview-rail-item" data-active>
            <Home />
          </span>
          <span className="onboarding-preview-rail-item"><Search /></span>
          <span className="onboarding-preview-rail-item"><Plugin /></span>
          <span className="onboarding-preview-rail-item"><Task /></span>
          <span className="onboarding-preview-rail-spacer" />
          <span className="onboarding-preview-rail-item">
            <ProviderIcon className={provider?.accentClassName} />
          </span>
          <span className="onboarding-preview-rail-item"><Settings /></span>
        </div>

        <div className="onboarding-preview-sidebar">
          <div className="onboarding-preview-space">
            <span>Mains</span><span>Code</span>
          </div>
          <div className="onboarding-preview-new">
            <New /><span>New chat</span><kbd>⌘ N</kbd>
          </div>
          <div className="onboarding-preview-section">
            <span>Projects</span><Plus />
          </div>
          <div className="onboarding-preview-project">
            <ProjectFolder /><span>My project</span>
          </div>
          <div className="onboarding-preview-chat glass-outline" data-active>
            <CircleDot /><span>A new idea</span>
          </div>
          <div className="onboarding-preview-chat">
            <CircleDot /><span>Explore an idea</span>
          </div>
          <div className="onboarding-preview-sidebar-footer">
            <span className="onboarding-preview-status" />Local
          </div>
        </div>

        <div className="onboarding-preview-content">
          <div className="onboarding-preview-header">
            <SidebarClose /><span>A new idea</span><RightPanelOpen />
          </div>
          <div className="onboarding-preview-empty">
            <Mains /><span>What will you build today?</span>
          </div>
          <div className="onboarding-preview-composer glass-outline">
            <span className="onboarding-preview-placeholder">Describe a task or ask anything…</span>
            <div className="onboarding-preview-toolbar">
              <Plus />
              <span className="onboarding-preview-model">
                <ProviderIcon className={provider?.accentClassName} />
                <span>{provider?.label ?? "Choose a model"}</span>
              </span>
              <span className="onboarding-preview-send glass-outline -rotate-180"><ChevronDown /></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
