import { WorkspaceProviderPage } from "@/features/workspace/components/workspace-provider-page";
import { useSpaceProviderVariant } from "@/hooks/use-space-provider-variant";
import { useActiveSpace } from "@/hooks/use-active-space";

/**
 * Unified agent workspace route — hosts every provider. Which provider it
 * drives comes from the active space (`space.providerId`). Provider or mode
 * changes remount the page via `key`, so run UI state cannot leak into a
 * different experience.
 *
 * Renders nothing until the space queries resolve: provider resolution is
 * async, and mounting with the claude fallback would fire wrong-provider
 * queries and immediately remount once the real space arrives.
 */
export default function CodePage() {
  const { activeSpace, isLoaded } = useActiveSpace();
  const provider = useSpaceProviderVariant();

  if (!isLoaded || !activeSpace) return null;

  return (
    <WorkspaceProviderPage
      key={`${provider.providerId}:${activeSpace.mode}`}
      providerId={provider.providerId}
      variant={provider.variant}
    />
  );
}
