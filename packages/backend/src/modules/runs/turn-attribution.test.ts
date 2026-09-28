import { describe, it, expect } from "vitest";
import type { PeerWrites, TreeDiffFile } from "../git";
import { attributeTurnFiles, type TurnWrites } from "./turn-attribution";

function file(filePath: string, extra: Partial<TreeDiffFile> = {}): TreeDiffFile {
  return {
    path: filePath,
    status: "modified",
    additions: 1,
    deletions: 1,
    binary: false,
    ...extra,
  };
}

const own = (paths: string[], unnamed = false): TurnWrites => ({
  paths: new Set(paths),
  unnamed,
});
const peers = (paths: string[], unnamed = false): PeerWrites => ({
  concurrent: true,
  paths: new Set(paths),
  unnamed,
});

describe("attributeTurnFiles", () => {
  it("keeps the files this run's tools named and drops a peer's", () => {
    const kept = attributeTurnFiles(
      [file("mine.ts"), file("theirs.ts")],
      own(["mine.ts"]),
      peers(["theirs.ts"]),
    );
    expect(kept.map((f) => f.path)).toEqual(["mine.ts"]);
    expect(kept[0].shared).toBeUndefined();
  });

  it("drops everything from a turn that wrote nothing itself", () => {
    // The reported case: a review turn that only read, next to a run editing.
    expect(
      attributeTurnFiles([file("a.ts"), file("b.ts")], own([]), peers(["a.ts"])),
    ).toEqual([]);
  });

  it("keeps a file nobody named only when this turn ran a shell", () => {
    const files = [file("generated.ts")];
    expect(attributeTurnFiles(files, own([], true), peers([]))).toHaveLength(1);
    expect(attributeTurnFiles(files, own([]), peers([]))).toEqual([]);
  });

  it("marks a file shared when a peer may have written it too", () => {
    const [named] = attributeTurnFiles([file("both.ts")], own(["both.ts"]), peers(["both.ts"]));
    expect(named.shared).toBe(true);

    // Both ran shells: whose change an unnamed file is can't be told.
    const [unnamed] = attributeTurnFiles([file("gen.ts")], own([], true), peers([], true));
    expect(unnamed.shared).toBe(true);
  });

  it("matches a move by either of its paths", () => {
    const moved = file("new.ts", { status: "renamed", oldPath: "old.ts" });
    expect(attributeTurnFiles([moved], own(["old.ts"]), peers([]))).toEqual([moved]);
  });
});
