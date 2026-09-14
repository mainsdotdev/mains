import { describe, expect, it } from "vitest";
import { parseFileDiffSegment, parsePerFileStats } from "./parse-diff";

const MODIFIED = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
`;

const ADDED = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`;

const DELETED = `diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const x = 1;
-export const y = 2;
`;

const RENAMED = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 92%
rename from src/old-name.ts
rename to src/new-name.ts
index 5555555..6666666 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,2 +1,2 @@
-const a = 1;
+const a = 2;
`;

/** The synthetic hunk `captureDiffSnapshot` writes for an untracked file. */
const UNTRACKED = `diff --git a/notes.md b/notes.md
new file mode 100644
--- /dev/null
+++ b/notes.md
@@ -0,0 +1,1 @@
+hello
`;

/** The stub it writes for an untracked file too large to inline. */
const UNTRACKED_STUB = `diff --git a/blob.bin b/blob.bin
new file
Binary or large file (900000 bytes)
`;

describe("parsePerFileStats", () => {
  it("counts insertions and deletions per file", () => {
    const stats = parsePerFileStats(MODIFIED);
    expect(stats["src/app.ts"]).toEqual({ ins: 1, del: 1, status: "modified" });
  });

  it("marks new files as added", () => {
    expect(parsePerFileStats(ADDED)["src/new.ts"]).toEqual({
      ins: 2,
      del: 0,
      status: "added",
    });
  });

  it("marks removed files as deleted", () => {
    expect(parsePerFileStats(DELETED)["src/gone.ts"]).toEqual({
      ins: 0,
      del: 2,
      status: "deleted",
    });
  });

  it("indexes a rename under both paths and keeps the old one", () => {
    const stats = parsePerFileStats(RENAMED);
    const expected = {
      ins: 1,
      del: 1,
      status: "renamed",
      oldPath: "src/old-name.ts",
    };
    // `--name-only` reports the new path, but callers holding the old one
    // (findings, stale selections) must still resolve.
    expect(stats["src/new-name.ts"]).toEqual(expected);
    expect(stats["src/old-name.ts"]).toEqual(expected);
  });

  it("treats synthetic untracked hunks as added when no untracked list is given", () => {
    expect(parsePerFileStats(UNTRACKED)["notes.md"].status).toBe("added");
    expect(parsePerFileStats(UNTRACKED_STUB)["blob.bin"]).toEqual({
      ins: 0,
      del: 0,
      status: "added",
    });
  });

  it("splits added into untracked when the snapshot's list says so", () => {
    // Same diff text either way — only the untracked list tells A from U.
    const blob = [ADDED, UNTRACKED].join("");
    const stats = parsePerFileStats(blob, ["notes.md"]);
    expect(stats["src/new.ts"].status).toBe("added");
    expect(stats["notes.md"]).toEqual({ ins: 1, del: 0, status: "untracked" });
  });

  it("leaves non-added statuses alone even if the path is listed untracked", () => {
    // Defensive: a stale list must never turn a deletion into a "U".
    expect(parsePerFileStats(DELETED, ["src/gone.ts"])["src/gone.ts"].status).toBe(
      "deleted",
    );
  });

  it("parses a multi-file blob", () => {
    const stats = parsePerFileStats(
      [MODIFIED, ADDED, DELETED, RENAMED].join(""),
    );
    expect(stats["src/app.ts"].status).toBe("modified");
    expect(stats["src/new.ts"].status).toBe("added");
    expect(stats["src/gone.ts"].status).toBe("deleted");
    expect(stats["src/new-name.ts"].status).toBe("renamed");
  });

  it("does not split on a `diff --git` line inside a patch body", () => {
    const patchOfPatch = `diff --git a/fixture.patch b/fixture.patch
index 7777777..8888888 100644
--- a/fixture.patch
+++ b/fixture.patch
@@ -1,1 +1,1 @@
-diff --git a/x b/x
+diff --git a/y b/y
`;
    const stats = parsePerFileStats(patchOfPatch);
    expect(Object.keys(stats)).toEqual(["fixture.patch"]);
    expect(stats["fixture.patch"]).toEqual({ ins: 1, del: 1, status: "modified" });
  });
});

describe("parseFileDiffSegment", () => {
  it("slices one file out of a multi-file blob", () => {
    const segment = parseFileDiffSegment(
      "src/new.ts",
      [MODIFIED, ADDED, DELETED].join(""),
    );
    expect(segment.startsWith("diff --git a/src/new.ts b/src/new.ts")).toBe(true);
    expect(segment).not.toContain("src/gone.ts");
  });

  it("returns an empty string for a path that isn't in the diff", () => {
    expect(parseFileDiffSegment("src/missing.ts", MODIFIED)).toBe("");
  });
});
