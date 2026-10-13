import type { ProviderTurnLineage } from "@mains/contracts/realtime";

export function resolveProviderTurnLineage(lineage?: ProviderTurnLineage): ProviderTurnLineage {
  const parentTurnId = typeof lineage?.parentTurnId === "string" ? lineage.parentTurnId : undefined;
  const rootTurnId = typeof lineage?.rootTurnId === "string" && lineage.rootTurnId ? lineage.rootTurnId : parentTurnId;
  return { ...(parentTurnId ? { parentTurnId } : {}), ...(rootTurnId ? { rootTurnId } : {}) };
}

/** Provider ids must stay distinct from Mains' numeric run_turns ids. */
export function providerTurnLineageMetadata(lineage?: ProviderTurnLineage) {
  const resolved = resolveProviderTurnLineage(lineage);
  return {
    ...(resolved.parentTurnId ? { providerParentTurnId: resolved.parentTurnId } : {}),
    ...(resolved.rootTurnId ? { providerRootTurnId: resolved.rootTurnId } : {}),
  };
}
