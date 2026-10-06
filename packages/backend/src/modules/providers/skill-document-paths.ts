import { promises as fs } from "node:fs";
import path from "node:path";

// Provider discovery is the authority for global skill documents. Remember
// exact resolved files, never their parent directories or renderer-supplied paths.
const discoveredDocuments = new Map<string, Set<string>>();

export async function rememberSkillDocuments(
  providerId: string,
  workspacePath: string | undefined,
  skills: readonly { path?: string }[],
): Promise<void> {
  const candidates = skills.flatMap((skill) =>
    skill.path && path.basename(skill.path).toLowerCase() === "skill.md" ? [skill.path] : [],
  );
  const resolved = await Promise.allSettled(candidates.map((filePath) => fs.realpath(filePath)));
  discoveredDocuments.set(
    JSON.stringify([providerId, workspacePath ?? null]),
    new Set(resolved.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])),
  );
}

export function isDiscoveredSkillDocument(realPath: string): boolean {
  for (const documents of discoveredDocuments.values()) {
    if (documents.has(realPath)) return true;
  }
  return false;
}
