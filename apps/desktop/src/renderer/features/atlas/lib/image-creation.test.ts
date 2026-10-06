import { describe, expect, it } from "vitest";
import type { SkillInfo } from "@/lib/redux/api/providersApi";
import { findImageGenSkill, imageGenContext, isImageGenAvailable } from "./image-creation";

describe("Image Gen skill discovery", () => {
  it.each(["imagegen", "image-gen", "image_generation"])("recognizes %s without requiring plugin metadata", (name) => {
    const skill: SkillInfo = { name, path: "/skills/imagegen/SKILL.md", scope: "user" };
    expect(findImageGenSkill([{ name: "unrelated" }, skill])).toBe(skill);
    expect(isImageGenAvailable(skill)).toBe(true);
  });

  it("prefers an available skill over a disabled or non-invokable match", () => {
    const disabled: SkillInfo = { name: "imagegen", enabled: false };
    const hidden: SkillInfo = { name: "imagegen", userInvokable: false };
    const available: SkillInfo = { name: "create-images", displayName: "Image Gen", enabled: true };
    expect(findImageGenSkill([disabled, hidden, available])).toBe(available);
    expect(isImageGenAvailable(disabled)).toBe(false);
    expect(isImageGenAvailable(hidden)).toBe(false);
  });

  it("preserves a native skill's real file identity and display metadata", () => {
    const skill: SkillInfo = { name: "imagegen", path: "/codex/skills/.system/imagegen/SKILL.md", scope: "system",
      displayName: "Image Gen", description: "Generate images", shortDescription: "Images",
      iconSmall: "/icons/imagegen.svg", iconLarge: "/icons/imagegen-large.svg", brandColor: "accent" };
    expect(imageGenContext(skill)).toEqual({ kind: "skill", name: skill.name, path: skill.path, scope: "system",
      mentionPath: undefined, displayName: skill.displayName, description: skill.description,
      shortDescription: skill.shortDescription, iconSmall: skill.iconSmall, iconLarge: skill.iconLarge, brandColor: skill.brandColor });
  });

  it("retains mention metadata when provided by the canonical skills list", () => {
    const skill: SkillInfo = { name: "imagegen", scope: "plugin", mentionPath: "plugin://imagegen@custom" };
    expect(imageGenContext(skill)).toMatchObject({ mentionPath: skill.mentionPath, scope: skill.scope });
    expect(findImageGenSkill([])).toBeUndefined();
    expect(isImageGenAvailable(undefined)).toBe(false);
  });
});
