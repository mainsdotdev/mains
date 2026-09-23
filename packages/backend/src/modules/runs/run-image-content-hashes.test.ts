import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { withImageContentHashes } from "./run-image-content-hashes";
import type { RunArtifactResponse } from "./runs.dto";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function imageArtifact(id: number, imagePath: string): RunArtifactResponse {
  return {
    id,
    runId: "run-1",
    kind: "image",
    path: null,
    content: "",
    blobData: null,
    entityId: null,
    contentHash: null,
    metadata: { kind: "image", path: imagePath },
    createdAt: new Date(),
  };
}

describe("withImageContentHashes", () => {
  it("identifies a generated image and its renamed saved copy by bytes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-image-hash-"));
    tempDirs.push(dir);
    const generated = path.join(dir, "generated.png");
    const saved = path.join(dir, "earth-ceramic-mosaic.png");
    const other = path.join(dir, "other.png");
    fs.writeFileSync(generated, "same image bytes");
    fs.copyFileSync(generated, saved);
    fs.writeFileSync(other, "different image bytes");

    const artifacts = await withImageContentHashes([
      imageArtifact(1, generated),
      imageArtifact(2, saved),
      imageArtifact(3, other),
    ]);

    expect(artifacts[0].contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(artifacts[1].contentHash).toBe(artifacts[0].contentHash);
    expect(artifacts[2].contentHash).not.toBe(artifacts[0].contentHash);
  });

  it("leaves a missing image available without a hash", async () => {
    const artifact = imageArtifact(1, "/missing/mains-image.png");
    expect(await withImageContentHashes([artifact])).toEqual([artifact]);
  });
});
