import { useActiveSpace } from "./use-active-space";
import { getModeConfig, type ModeConfigDescriptor } from "@/lib/mode-config";

/**
 * The active space's mode descriptor — the per-experience sibling of
 * `useSpaceProviderVariant`. Components read capability flags off it
 * (showGitActions, showTerminal, ...) instead of branching on the mode id.
 */
export function useModeConfig(): ModeConfigDescriptor {
  const { activeSpace } = useActiveSpace();
  return getModeConfig(activeSpace?.mode);
}
