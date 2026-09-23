import { createHash } from "crypto";
import * as fs from "fs";
import type { RunArtifactResponse } from "./runs.dto";

// A transcript read should not spend unbounded time hashing an agent-written file.
const MAX_HASHABLE_IMAGE_BYTES = 64 * 1024 * 1024;

async function hashImageFile(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_HASHABLE_IMAGE_BYTES) {
      return null;
    }
    const hash = createHash("sha256");
    for await (const chunk of fs.createReadStream(filePath)) {
      hash.update(chunk);
    }
    return `sha256:${hash.digest("hex")}`;
  } catch {
    // Older transcripts can outlive the files they once displayed.
    return null;
  }
}

/** Add byte identity at the read boundary, including for older persisted image artifacts. */
export async function withImageContentHashes(
  artifacts: RunArtifactResponse[],
): Promise<RunArtifactResponse[]> {
  if (!artifacts.some((artifact) => artifact.kind === "image" && !artifact.contentHash)) {
    return artifacts;
  }
  return Promise.all(artifacts.map(async (artifact) => {
    if (artifact.kind !== "image" || artifact.contentHash) return artifact;
    const filePath = artifact.path ?? artifact.metadata?.path;
    if (typeof filePath !== "string") return artifact;
    const contentHash = await hashImageFile(filePath);
    return contentHash ? { ...artifact, contentHash } : artifact;
  }));
}
