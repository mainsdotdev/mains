import { useRouteType } from "./use-route-type";
import { useSpaceProviderVariant } from "./use-space-provider-variant";
import type { WorkspaceVariant } from "@/lib/provider-variants";

/**
 * Returns the active workspace variant ("claude" / "copilot" / "codex" / "cursor"),
 * or "default" on non-workspace routes. The variant comes from the active
 * space's provider (see `useSpaceProviderVariant`), not from the pathname —
 * `/code` hosts every provider.
 */
export function useWorkspaceVariant(): WorkspaceVariant {
  const routeType = useRouteType();
  const descriptor = useSpaceProviderVariant();
  return routeType === "code" ? descriptor.variant : "default";
}
