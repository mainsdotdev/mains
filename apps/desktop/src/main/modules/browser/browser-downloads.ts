import * as path from "node:path";

const FALLBACK_DOWNLOAD_NAME = "download";
const MAX_COLLISION_ATTEMPTS = 10_000;

/**
 * Chromium supplies a filename, not a trusted filesystem path. Keep only its
 * final segment and strip control characters before placing it in Downloads.
 */
export function safeDownloadFileName(proposedName: string): string {
  const baseName = path.basename(proposedName.replace(/\\/g, "/"));
  const safeName = Array.from(baseName)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim();
  return safeName && safeName !== "." && safeName !== ".."
    ? safeName
    : FALLBACK_DOWNLOAD_NAME;
}

/**
 * Return a Chrome-style non-colliding destination (`file (1).ext`, …).
 * `isUnavailable` covers both existing files and paths reserved by downloads
 * that have started but have not reached disk yet.
 */
export function nextDownloadPath(
  directory: string,
  proposedName: string,
  isUnavailable: (candidate: string) => boolean,
): string {
  const safeName = safeDownloadFileName(proposedName);
  const parsed = path.parse(safeName);
  const firstCandidate = path.join(directory, safeName);
  if (!isUnavailable(firstCandidate)) return firstCandidate;

  for (let index = 1; index < MAX_COLLISION_ATTEMPTS; index += 1) {
    const candidate = path.join(
      directory,
      `${parsed.name} (${index})${parsed.ext}`,
    );
    if (!isUnavailable(candidate)) return candidate;
  }

  return path.join(
    directory,
    `${parsed.name}-${Date.now()}${parsed.ext}`,
  );
}

export function isPathInsideDirectory(
  directory: string,
  candidate: string,
): boolean {
  const base = path.resolve(directory);
  const target = path.resolve(candidate);
  return target.startsWith(`${base}${path.sep}`);
}
