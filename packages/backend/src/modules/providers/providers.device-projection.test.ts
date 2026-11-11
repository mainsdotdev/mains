import { describe, expect, it } from "vitest";
import { skillsForPairedDevice } from "./providers.device-projection";

describe("paired-device skill catalogue", () => {
  it("keeps a usable small icon once and preserves source scope and exact context identity", () => {
    const small = "data:image/png;base64,c21hbGw=";
    const source = { name: "review:skill", path: "/repo/é/Review/SKILL.md", description: "Full description", shortDescription: "Short description",
      source: "project" as const, userInvokable: false, argumentHint: "[file]", iconSmall: small, iconLarge: small,
      displayName: "Review", brandColor: "#123456", defaultPrompt: "Desktop suggestion", modelInvocable: true };
    expect(skillsForPairedDevice([source])).toEqual([{ name: source.name, path: source.path, description: source.description,
      shortDescription: source.shortDescription, userInvokable: false, scope: "project", argumentHint: "[file]",
      displayName: "Review", brandColor: "#123456", iconSmall: small }]);
    expect(source.iconLarge).toBe(small);
    expect(source.defaultPrompt).toBe("Desktop suggestion");
  });

  it("uses the other artwork candidate when the first is too large", () => {
    const small = "https://example.com/small.png";
    expect(skillsForPairedDevice([{ name: "plugin", scope: "plugin", iconSmall: "x".repeat(100_000), iconLarge: small }]))
      .toEqual([{ name: "plugin", scope: "plugin", iconSmall: small }]);
  });

  it("bounds aggregate artwork without dropping any catalogue rows", () => {
    const icon = "data:image/png;base64," + "A".repeat(24_000);
    const source = Array.from({ length: 80 }, (_, index) => ({ name: `plugin-${index}`, description: `Description ${index}`, iconSmall: icon, iconLarge: icon }));
    const result = skillsForPairedDevice(source);
    expect(result.map(({ name }) => name)).toEqual(source.map(({ name }) => name));
    expect(result.some(({ iconSmall }) => !!iconSmall)).toBe(true);
    expect(result.some(({ iconSmall }) => !iconSmall)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(300 * 1024);
    expect(result.every(({ iconLarge }) => iconLarge === undefined)).toBe(true);
  });
});
