import { describe, expect, it } from "vitest";
import { resolveServiceTier, serviceTierOptions } from "./resolve-service-tier";

describe("Codex model speed selection", () => {
  it("offers only advertised tiers alongside an explicit Standard choice", () => {
    const fast = serviceTierOptions([{ id: "fast", name: "Fast" }]);
    expect(fast.map((tier) => tier.id)).toEqual(["default", "fast"]);
    expect(resolveServiceTier("ultrafast", fast)).toBe("default");
    const tiers = serviceTierOptions([{ id: "ultrafast", name: "ultrafast", description: "Higher usage" },
      { id: "future-speed", name: "Future speed" }]);
    expect(tiers[1]).toEqual({ id: "ultrafast", name: "Ultrafast", description: "Higher usage" });
    expect(resolveServiceTier("future-speed", tiers)).toBe("future-speed");
  });

  it("recognizes legacy Fast settings without guessing another model's tiers", () => {
    expect(resolveServiceTier("priority", serviceTierOptions([{ id: "fast", name: "Fast" }]))).toBe("fast");
    expect(resolveServiceTier("priority", serviceTierOptions([{ id: "priority", name: "Fast" }]))).toBe("priority");
    expect(resolveServiceTier("ultrafast", serviceTierOptions())).toBe("default");
    expect(resolveServiceTier("", serviceTierOptions())).toBe("default");
  });
});
