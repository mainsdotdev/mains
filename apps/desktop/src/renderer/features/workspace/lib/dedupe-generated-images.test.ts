import { describe, expect, it } from "vitest";
import type { RunArtifact, RunEvent } from "../types";
import { dedupeGeneratedImageCopies } from "./dedupe-generated-images";
import { mapArtifactToEvent } from "./run-event-mappers";

function event(id: string, kind: string, path?: string, hash?: string): RunEvent {
  return {
    id,
    type: "artifact",
    content: "",
    timestamp: new Date(),
    metadata: { kind, ...(path ? { path } : {}), ...(hash ? { imageContentHash: hash } : {}) },
  };
}

describe("dedupeGeneratedImageCopies", () => {
  const generated = "/Users/me/.codex/generated_images/session/exec.png";
  const saved = "/Users/me/Library/Application Support/mains/runs/1/work/earth.png";

  it("shows the saved copy once when it has the generated image's bytes", () => {
    const persistedImage = (id: number, imagePath: string) => mapArtifactToEvent({
      id,
      runId: "run-1",
      kind: "image",
      content: "",
      contentHash: "sha256:same",
      metadata: JSON.stringify({ kind: "image", path: imagePath }),
      createdAt: new Date(),
    } as RunArtifact);
    const events = [
      event("prompt", "user-prompt"),
      persistedImage(28, generated),
      event("reply", "report"),
      persistedImage(30, saved),
    ];

    expect(dedupeGeneratedImageCopies(events).map((item) => item.id)).toEqual([
      "prompt", "reply", "artifact-30",
    ]);
  });

  it("keeps distinct outputs and the same image shown again in another turn", () => {
    const events = [
      event("prompt-1", "user-prompt"),
      event("generated", "image", generated, "sha256:same"),
      event("different", "image", saved, "sha256:other"),
      event("prompt-2", "user-prompt"),
      event("again", "image", saved, "sha256:same"),
    ];

    expect(dedupeGeneratedImageCopies(events)).toBe(events);
  });

  it("keeps a generated image until its saved copy exists", () => {
    const events = [event("generated", "image", generated, "sha256:same")];
    expect(dedupeGeneratedImageCopies(events)).toBe(events);
  });
});
