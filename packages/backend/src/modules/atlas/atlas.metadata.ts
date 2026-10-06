import type { AtlasMetadata, AtlasMetadataPatch } from "@mains/contracts/atlas";

export function metadataPatch(value: unknown): AtlasMetadataPatch | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Page metadata");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "icon" && key !== "coverFileId"))
    throw new Error("Unsupported Page metadata field");
  const patch: AtlasMetadataPatch = {};
  if (input.icon !== undefined) {
    const icon = input.icon;
    if (icon !== null && (typeof icon !== "string" || icon.length > 128 || /\p{Cc}/u.test(icon)
      || !(/^(?:emoji:.+|icon:[a-z][a-z0-9-]*(?:\|[a-z]+)?)$/u.test(icon))))
      throw new Error("Invalid Page icon");
    patch.icon = icon as string | null;
  }
  if (input.coverFileId !== undefined) {
    const id = input.coverFileId;
    if (id !== null && (typeof id !== "string" || !id.trim() || id.length > 128 || /\p{Cc}/u.test(id)))
      throw new Error("Invalid Page cover");
    patch.coverFileId = typeof id === "string" ? id.trim() : null;
  }
  return patch;
}

export function readMetadata(json: string | null): AtlasMetadata | null {
  return json ? JSON.parse(json) as AtlasMetadata : null;
}

export function mergeMetadata(json: string | null, patch: AtlasMetadataPatch | null): string | null {
  if (patch === null) return null;
  const next = { ...readMetadata(json) };
  for (const key of ["icon", "coverFileId"] as const) {
    if (patch[key] === null) delete next[key];
    else if (patch[key] !== undefined) next[key] = patch[key];
  }
  return Object.keys(next).length ? JSON.stringify(next) : null;
}
