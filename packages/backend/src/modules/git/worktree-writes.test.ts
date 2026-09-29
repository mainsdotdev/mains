import { describe, it, expect } from "vitest";
import { APP_WRITER, toWorktreePath, worktreeWrites } from "./worktree-writes";

// The ledger is module state; every test takes a worktree of its own.
let worktreeCounter = 0;
const freshWorktree = () => `/repo-${++worktreeCounter}`;

describe("worktreeWrites", () => {
  it("sees no peer when a run has the worktree to itself", () => {
    const wt = freshWorktree();
    worktreeWrites.open(wt, "a", 100);
    worktreeWrites.record(wt, "a", { paths: ["x.ts"], unnamed: true }, 150);

    expect(worktreeWrites.peersSince(wt, "a", 100)).toEqual({
      concurrent: false,
      paths: new Set(),
      unnamed: false,
    });
  });

  it("reports another live run and what it wrote since the turn began", () => {
    const wt = freshWorktree();
    worktreeWrites.open(wt, "a", 100);
    worktreeWrites.open(wt, "b", 110);
    worktreeWrites.record(wt, "b", { paths: ["before.ts"], unnamed: false }, 120);
    worktreeWrites.record(wt, "b", { paths: ["during.ts"], unnamed: true }, 210);

    expect(worktreeWrites.peersSince(wt, "a", 200)).toEqual({
      concurrent: true,
      paths: new Set(["during.ts"]),
      unnamed: true,
    });
  });

  it("still counts a peer that finished during the turn", () => {
    const wt = freshWorktree();
    worktreeWrites.open(wt, "a", 100);
    worktreeWrites.open(wt, "b", 110);
    worktreeWrites.record(wt, "b", { paths: ["b.ts"], unnamed: false }, 220);
    worktreeWrites.close(wt, "b", 230);

    const seen = worktreeWrites.peersSince(wt, "a", 200);
    expect(seen.concurrent).toBe(true);
    expect(seen.paths).toEqual(new Set(["b.ts"]));
  });

  it("ignores a peer that finished before the turn began", () => {
    const wt = freshWorktree();
    worktreeWrites.open(wt, "a", 100);
    worktreeWrites.open(wt, "b", 110);
    worktreeWrites.close(wt, "b", 150);

    expect(worktreeWrites.peersSince(wt, "a", 200).concurrent).toBe(false);
  });

  it("counts the app's own write inside the turn as someone else's", () => {
    const wt = freshWorktree();
    worktreeWrites.open(wt, "a", 100);
    worktreeWrites.record(wt, APP_WRITER, { paths: ["pulled.ts"], unnamed: false }, 90);
    worktreeWrites.record(wt, APP_WRITER, { paths: ["saved.ts"], unnamed: false }, 250);

    expect(worktreeWrites.peersSince(wt, "a", 200)).toEqual({
      concurrent: true,
      paths: new Set(["saved.ts"]),
      unnamed: false,
    });
  });

  it("records nothing where no session is live", () => {
    const wt = freshWorktree();
    worktreeWrites.record(wt, APP_WRITER, { paths: ["x.ts"], unnamed: false }, 100);
    worktreeWrites.open(wt, "a", 50);
    expect(worktreeWrites.peersSince(wt, "a", 0).concurrent).toBe(false);
  });

  it("forgets a worktree once no session is live in it", () => {
    const wt = freshWorktree();
    worktreeWrites.open(wt, "a", 100);
    worktreeWrites.open(wt, "b", 110);
    worktreeWrites.record(wt, "b", { paths: ["b.ts"], unnamed: false }, 120);
    worktreeWrites.close(wt, "b", 130);
    worktreeWrites.close(wt, "a", 140);

    // A new session in the same worktree starts from a clean slate.
    worktreeWrites.open(wt, "c", 50);
    expect(worktreeWrites.peersSince(wt, "c", 0)).toEqual({
      concurrent: false,
      paths: new Set(),
      unnamed: false,
    });
  });
});

describe("toWorktreePath", () => {
  const atRoot = { topLevel: "/private/tmp/repo", prefix: "" };
  const inSubdir = { topLevel: "/private/tmp/repo", prefix: "apps/desktop/" };

  it("resolves absolute paths through the cwd's own spelling", () => {
    expect(toWorktreePath(atRoot, "/tmp/repo", "/tmp/repo/src/a.ts")).toBe("src/a.ts");
  });

  it("resolves absolute paths spelled the way git resolves the root", () => {
    expect(toWorktreePath(atRoot, "/tmp/repo", "/private/tmp/repo/src/a.ts")).toBe(
      "src/a.ts",
    );
  });

  it("resolves relative paths from a cwd inside the worktree", () => {
    expect(toWorktreePath(inSubdir, "/tmp/repo/apps/desktop", "src/a.ts")).toBe(
      "apps/desktop/src/a.ts",
    );
    expect(
      toWorktreePath(inSubdir, "/tmp/repo/apps/desktop", "../../packages/x.ts"),
    ).toBe("packages/x.ts");
  });

  it("drops paths outside the worktree", () => {
    expect(toWorktreePath(atRoot, "/tmp/repo", "/etc/hosts")).toBeNull();
    expect(toWorktreePath(atRoot, "/tmp/repo", "../elsewhere.ts")).toBeNull();
  });
});
