import type { ModelServiceTier } from "@mains/contracts/run-settings";

/** Standard is explicit so a saved provider default cannot re-enable a tier. */
export function serviceTierOptions(tiers: ModelServiceTier[] = []): ModelServiceTier[] {
  const options = new Map<string, ModelServiceTier>([["default", { id: "default", name: "Standard" }]]);
  const names: Record<string, string> = { fast: "Fast", priority: "Fast", ultrafast: "Ultrafast" };
  for (const tier of tiers) {
    if (!tier.id || (tier.id === "priority" && tiers.some((candidate) => candidate.id === "fast"))) continue;
    if (tier.id === "default") {
      options.set("default", { ...tier, name: tier.name || "Standard" });
      continue;
    }
    options.set(tier.id, { ...tier, name: tier.name && tier.name !== tier.id ? tier.name : names[tier.id] ?? tier.id });
  }
  return [...options.values()];
}

export function resolveServiceTier(value: string | undefined, options: ModelServiceTier[]): string {
  if (!value || value === "default") return "default";
  // Older installs persisted the upstream request value for Codex Fast.
  const canonical = value === "priority" && options.some((tier) => tier.id === "fast") ? "fast" : value;
  return options.some((tier) => tier.id === canonical) ? canonical : "default";
}
