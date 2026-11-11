import type { SkillSummary } from "@mains/contracts/runs";
import type { SkillInfo } from "../../../shared/adapter.types";

// A discovery response can contain both full-size versions of every plugin's
// artwork. Phones need a small composer icon, not that desktop asset bundle.
const ICON_BYTES = 32 * 1024;
const CATALOG_ARTWORK_BYTES = 256 * 1024;

/** Keep context identities and descriptions; only the paired-device view is compact. */
export function skillsForPairedDevice(skills: readonly SkillInfo[]): SkillSummary[] {
  let remainingArtwork = CATALOG_ARTWORK_BYTES;
  return skills.map((skill) => {
    const result: SkillSummary = { name: skill.name };
    for (const key of ["displayName", "description", "shortDescription", "argumentHint", "path", "brandColor"] as const) {
      const value = skill[key];
      if (typeof value === "string") result[key] = value;
    }
    const scope = skill.scope || skill.source;
    if (scope) result.scope = scope;
    if (typeof skill.userInvokable === "boolean") result.userInvokable = skill.userInvokable;
    for (const icon of [skill.iconSmall, skill.iconLarge]) {
      if (typeof icon !== "string" || !icon) continue;
      const bytes = Buffer.byteLength(icon);
      if (bytes > ICON_BYTES || bytes > remainingArtwork) continue;
      // One copy only. If neither version fits, clients use their default icon.
      result.iconSmall = icon;
      remainingArtwork -= bytes;
      break;
    }
    return result;
  });
}
