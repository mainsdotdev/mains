import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────
// git module tests — real temporary repos, no simple-git mock.
//
// The interface is the test surface: semantics-bearing methods (three-dot
// branch diff, auto-upstream push, worktree import, snapshot synthesis) are
// exercised against actual git behavior. Pure pass-through methods get no
// dedicated tests. See CONTEXT.md "git test surface".
// ─────────────────────────────────────────────────────────────

// Every test here shells out to the real git binary (often several times per
// test: init, commit, clone, fetch, push). Under full-suite load those spawns
// queue behind other workers and the default 5s runner timeout turns into
// flaky failures — in isolation the file passes comfortably. The bump is a
// kill-switch for hung processes, not a performance target.
vi.setConfig({ testTimeout: 30_000 });

// gitService reads app.getPath("userData") for the worktrees dir and
// app.getPath("desktop") for initRepo's default parent; point both at the
// test sandbox.
const paths = vi.hoisted(() => ({ base: "" }));
vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(paths.base, name),
  },
}));

import { gitService } from "./git.service";
import {
  hashContent,
  buildPerFileDiffHashes,
  parsePerFileDiffStats,
} from "./git-snapshot";

let sandbox: string;

/** Run git in a repo (isolated from the user's global/system config). */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

let repoCounter = 0;

/** Fresh repo on `main` with a committed README and a local identity. */
function makeRepo(): string {
  const repo = path.join(sandbox, `repo-${++repoCounter}`);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "test@mains.local");
  git(repo, "config", "user.name", "Mains Test");
  fs.writeFileSync(path.join(repo, "README.md"), "# test\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "init");
  return repo;
}

function write(repo: string, file: string, content: string): void {
  fs.writeFileSync(path.join(repo, file), content);
}

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "mains-git-test-"));
  paths.base = sandbox;
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// captureDiffSnapshot
// ─────────────────────────────────────────────────────────────

describe("captureDiffSnapshot", () => {
  it("returns an empty snapshot for a clean tree", async () => {
    const repo = makeRepo();
    const head = await gitService.getHeadSha(repo);

    const snap = await gitService.captureDiffSnapshot(repo, head);

    expect(snap.baseRef).toBe(head);
    expect(snap.diffText).toBe("");
    expect(snap.files).toEqual([]);
    expect(snap.untrackedFiles).toEqual([]);
    expect(snap.shortstat).toBe("");
  });

  it("captures tracked modifications with shortstat", async () => {
    const repo = makeRepo();
    const head = await gitService.getHeadSha(repo);
    write(repo, "README.md", "# changed\n");

    const snap = await gitService.captureDiffSnapshot(repo, head);

    expect(snap.diffText).toContain("-# test");
    expect(snap.diffText).toContain("+# changed");
    expect(snap.files).toEqual(["README.md"]);
    expect(snap.untrackedFiles).toEqual([]);
    expect(snap.shortstat).toContain("1 file changed");
  });

  it("inlines small untracked files as synthetic hunks and merges the shortstat", async () => {
    const repo = makeRepo();
    const head = await gitService.getHeadSha(repo);
    write(repo, "new.txt", "hello\nworld\n");

    const snap = await gitService.captureDiffSnapshot(repo, head);

    expect(snap.diffText).toContain("diff --git a/new.txt b/new.txt");
    expect(snap.diffText).toContain("new file mode 100644");
    expect(snap.diffText).toContain("+hello");
    expect(snap.files).toContain("new.txt");
    expect(snap.untrackedFiles).toEqual(["new.txt"]);
    // git's shortstat omits untracked files; the snapshot merges them in — and
    // git itself is the oracle for the count, since staging the same file is
    // what the numbers claim to predict. Splitting on "\n" used to add one.
    git(repo, "add", "new.txt");
    expect(snap.shortstat).toBe(
      git(repo, "diff", "--cached", "--shortstat", head),
    );
    expect(parsePerFileDiffStats(snap.diffText).get("new.txt")).toEqual({
      additions: 2,
      deletions: 0,
      isNew: true,
    });
  });

  it("stubs an empty untracked file rather than counting a phantom line", async () => {
    const repo = makeRepo();
    const head = await gitService.getHeadSha(repo);
    write(repo, "empty.txt", "");

    const snap = await gitService.captureDiffSnapshot(repo, head);

    expect(snap.diffText).toContain("(empty file)");
    expect(snap.shortstat).not.toMatch(/insertion/);
    expect(parsePerFileDiffStats(snap.diffText).get("empty.txt")).toEqual({
      additions: 0,
      deletions: 0,
      isNew: true,
    });
  });

  it("stubs large untracked files instead of inlining them", async () => {
    const repo = makeRepo();
    const head = await gitService.getHeadSha(repo);
    write(repo, "big.bin", "x".repeat(300 * 1024));

    const snap = await gitService.captureDiffSnapshot(repo, head);

    expect(snap.diffText).toContain("Binary or large file");
    expect(snap.diffText).not.toContain("+xxx");
    expect(snap.untrackedFiles).toEqual(["big.bin"]);
  });

  // Read as UTF-8, an image's 0x0A bytes become "lines": a small .webp landed
  // in the panel as "+334" and inflated the workspace total with it. Size was
  // the only gate, so anything under 256KB was counted line by line.
  it("stubs small untracked binary files instead of counting their bytes as lines", async () => {
    const repo = makeRepo();
    const head = await gitService.getHeadSha(repo);
    fs.writeFileSync(
      path.join(repo, "cover.webp"),
      Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x0a, 0x0a, 0x00, 0x0a]),
    );

    const snap = await gitService.captureDiffSnapshot(repo, head);

    expect(snap.diffText).toContain("Binary or large file");
    expect(snap.untrackedFiles).toEqual(["cover.webp"]);
    expect(snap.shortstat).not.toMatch(/insertion/);
    expect(parsePerFileDiffStats(snap.diffText).get("cover.webp")).toEqual({
      additions: 0,
      deletions: 0,
      isNew: true,
    });
  });

  // Escaped names made the file list unreadable, and the synthetic-hunk builder
  // stat'ed the quoted string — so an untracked non-ASCII file rendered as
  // "(could not read file)" rather than its contents.
  it("reports non-ASCII paths verbatim and still inlines their content", async () => {
    const repo = makeRepo();
    const head = await gitService.getHeadSha(repo);
    fs.mkdirSync(path.join(repo, "raporlar"));
    write(repo, "raporlar/özet.md", "merhaba\n");

    const snap = await gitService.captureDiffSnapshot(repo, head);

    expect(snap.untrackedFiles).toContain("raporlar/özet.md");
    expect(snap.files).toContain("raporlar/özet.md");
    expect(snap.diffText).toContain("+merhaba");
    expect(snap.diffText).not.toContain("\\303\\266");
    expect(snap.diffText).not.toContain("could not read file");
  });

  it("throws on an unknown baseRef instead of degrading to an empty diff (all-or-throw)", async () => {
    const repo = makeRepo();
    write(repo, "README.md", "# dirty\n");

    await expect(
      gitService.captureDiffSnapshot(repo, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
    ).rejects.toThrow();
  });

  it("throws when the path is not a git repo", async () => {
    const dir = path.join(sandbox, "not-a-repo");
    fs.mkdirSync(dir, { recursive: true });

    await expect(gitService.captureDiffSnapshot(dir, "HEAD")).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// importLocalRepo / importLocalRepoDirect
// ─────────────────────────────────────────────────────────────

describe("importLocalRepo", () => {
  it("creates a branch + worktree under the project's worktrees dir", async () => {
    const repo = makeRepo();

    const result = await gitService.importLocalRepo(repo, {
      projectName: "myproj",
    });

    expect(result.baseBranch).toBe("main");
    expect(result.branchName).toBe(result.worktreeName);
    expect(result.worktreePath).toBe(
      path.join(sandbox, "userData", "worktrees", "myproj", result.worktreeName),
    );
    expect(fs.existsSync(path.join(result.worktreePath, "README.md"))).toBe(true);
    // The import branch exists in the source repo.
    expect(git(repo, "branch", "--list", result.branchName)).toContain(
      result.branchName,
    );
    expect(result.originUrl).toBeNull();
  });

  it("honors a custom branch name", async () => {
    const repo = makeRepo();

    const result = await gitService.importLocalRepo(repo, {
      projectName: "myproj",
      branchName: "my-branch",
    });

    expect(result.branchName).toBe("my-branch");
    expect(result.worktreeName).toBe("my-branch");
  });

  it("creates the worktree branch from the explicit base, not the source checkout", async () => {
    const repo = makeRepo();
    git(repo, "checkout", "-b", "source-feature");
    write(repo, "feature-only.txt", "feature\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feature-only");

    const result = await gitService.importLocalRepo(repo, {
      projectName: "myproj",
      branchName: "from-main",
      baseBranch: "main",
    });

    expect(result.baseBranch).toBe("main");
    expect(fs.existsSync(path.join(result.worktreePath, "feature-only.txt"))).toBe(
      false,
    );
  });

  it("throws for a non-repo path", async () => {
    const dir = path.join(sandbox, "plain-dir");
    fs.mkdirSync(dir, { recursive: true });

    await expect(
      gitService.importLocalRepo(dir, { projectName: "p" }),
    ).rejects.toThrow(
      "Not a git repository",
    );
  });
});

describe("importLocalRepoDirect", () => {
  it("returns the active branch and origin metadata without creating a worktree", async () => {
    const repo = makeRepo();
    git(repo, "remote", "add", "origin", "https://github.com/foo/bar.git");

    const result = await gitService.importLocalRepoDirect(repo);

    expect(result.branchName).toBe("main");
    expect(result.baseBranch).toBe("main");
    expect(result.sourcePath).toBe(repo);
    expect(result.originUrl).toBe("https://github.com/foo/bar.git");
  });

  it("keeps the live checkout separate from the repository default branch", async () => {
    const repo = makeRepo();
    git(repo, "remote", "add", "origin", "https://github.com/foo/bar.git");
    git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    git(repo, "checkout", "-b", "feature/live");

    const result = await gitService.importLocalRepoDirect(repo);

    expect(result.branchName).toBe("feature/live");
    expect(result.baseBranch).toBe("main");
  });
});

// ─────────────────────────────────────────────────────────────
// initRepo / cloneRepo
// ─────────────────────────────────────────────────────────────

describe("initRepo", () => {
  it("creates a fresh repo on main with an initial commit", async () => {
    const parent = path.join(sandbox, "init-parent");
    fs.mkdirSync(parent, { recursive: true });

    const result = await gitService.initRepo("fresh", parent);

    expect(result.rootPath).toBe(path.join(parent, "fresh"));
    expect(result.defaultBranch).toBe("main");
    expect(await gitService.getCurrentBranch(result.rootPath)).toBe("main");
    expect(git(result.rootPath, "log", "--oneline")).toContain("Initial commit");
  });

  it("throws when the folder already exists", async () => {
    const parent = path.join(sandbox, "init-parent-2");
    fs.mkdirSync(path.join(parent, "taken"), { recursive: true });

    await expect(gitService.initRepo("taken", parent)).rejects.toThrow(
      "Folder already exists",
    );
  });
});

describe("cloneRepo — URL hardening", () => {
  it("rejects option-injection and non-transport URLs", async () => {
    await expect(
      gitService.cloneRepo("-oProxyCommand=evil", sandbox),
    ).rejects.toThrow("Invalid repository URL");
    await expect(
      gitService.cloneRepo("file:///etc/passwd", sandbox),
    ).rejects.toThrow(/repository URLs are supported/);
    await expect(
      gitService.cloneRepo("/local/path", sandbox),
    ).rejects.toThrow(/repository URLs are supported/);
    await expect(
      gitService.cloneRepo("ext::sh -c whoami", sandbox),
    ).rejects.toThrow(/repository URLs are supported/);
  });
});

// ─────────────────────────────────────────────────────────────
// push — auto-upstream
// ─────────────────────────────────────────────────────────────

describe("push", () => {
  it("sets the upstream automatically when the branch has none", async () => {
    const origin = path.join(sandbox, "origin.git");
    fs.mkdirSync(origin);
    git(origin, "init", "--bare", "-b", "main");
    const repo = makeRepo();
    git(repo, "remote", "add", "origin", origin);

    const result = await gitService.push(repo);

    expect(result).toEqual({ branch: "main", remote: "origin" });
    // Upstream tracking is now configured…
    expect(git(repo, "rev-parse", "--abbrev-ref", "main@{upstream}")).toBe(
      "origin/main",
    );
    // …so a second push (new commit) succeeds without --set-upstream.
    write(repo, "b.txt", "b\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "second");
    await expect(gitService.push(repo)).resolves.toEqual({
      branch: "main",
      remote: "origin",
    });
  });

  it("throws when there is no remote", async () => {
    const repo = makeRepo();
    await expect(gitService.push(repo)).rejects.toThrow();
  });
});

describe("pullFastForward", () => {
  /** A repo tracking a bare origin, plus a second clone to push from. */
  function makeTrackingPair(): { repo: string; other: string } {
    const origin = path.join(sandbox, `origin-${++repoCounter}.git`);
    fs.mkdirSync(origin);
    git(origin, "init", "--bare", "-b", "main");
    const repo = makeRepo();
    git(repo, "remote", "add", "origin", origin);
    git(repo, "push", "-u", "origin", "main");

    const other = path.join(sandbox, `other-${repoCounter}`);
    git(sandbox, "clone", origin, other);
    git(other, "config", "user.email", "other@mains.local");
    git(other, "config", "user.name", "Other");
    return { repo, other };
  }

  it("reports nothing received when the branch is already current", async () => {
    const { repo } = makeTrackingPair();
    const head = git(repo, "rev-parse", "HEAD");

    const result = await gitService.pullFastForward(repo);

    expect(result).toEqual({ received: 0, head });
  });

  it("counts the commits it fast-forwarded in", async () => {
    const { repo, other } = makeTrackingPair();
    write(other, "remote-1.txt", "1\n");
    git(other, "add", ".");
    git(other, "commit", "-m", "remote one");
    write(other, "remote-2.txt", "2\n");
    git(other, "add", ".");
    git(other, "commit", "-m", "remote two");
    git(other, "push", "origin", "main");

    const result = await gitService.pullFastForward(repo);

    expect(result.received).toBe(2);
    expect(fs.existsSync(path.join(repo, "remote-2.txt"))).toBe(true);
  });

  // The whole reason for --ff-only: a refusal leaves the repo untouched
  // instead of mid-merge with a conflicted tree no UI here can resolve.
  it("refuses a diverged branch without changing anything", async () => {
    const { repo, other } = makeTrackingPair();
    write(other, "theirs.txt", "theirs\n");
    git(other, "add", ".");
    git(other, "commit", "-m", "theirs");
    git(other, "push", "origin", "main");
    write(repo, "mine.txt", "mine\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "mine");
    const head = git(repo, "rev-parse", "HEAD");

    await expect(gitService.pullFastForward(repo)).rejects.toThrow();

    expect(git(repo, "rev-parse", "HEAD")).toBe(head);
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(fs.existsSync(path.join(repo, "theirs.txt"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// getBranchDiff / getBranchLog — base..HEAD semantics
// ─────────────────────────────────────────────────────────────

describe("getBranchDiff", () => {
  it("three-dot diff contains only the branch's own changes", async () => {
    const repo = makeRepo();
    // Branch work: change a.txt on feat.
    git(repo, "checkout", "-b", "feat");
    write(repo, "a.txt", "feat change\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat: a");
    // Base moves on independently: b.txt lands on main after divergence.
    git(repo, "checkout", "main");
    write(repo, "b.txt", "main change\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "main: b");
    git(repo, "checkout", "feat");

    const diff = await gitService.getBranchDiff(repo, "main");

    expect(diff).toContain("a.txt");
    // Two-dot would show main's b.txt as a deletion; three-dot must not.
    expect(diff).not.toContain("b.txt");
  });
});

describe("getBranchLog", () => {
  it("lists only commits unique to the branch", async () => {
    const repo = makeRepo();
    git(repo, "checkout", "-b", "feat");
    write(repo, "a.txt", "1\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat commit");

    const log = await gitService.getBranchLog(repo, "main");

    expect(log).toEqual(["feat commit"]);
  });
});

// ─────────────────────────────────────────────────────────────
// discardPaths / renameBranch
// ─────────────────────────────────────────────────────────────

describe("discardPaths", () => {
  it("restores a committed file and leaves the others alone", async () => {
    const repo = makeRepo();
    write(repo, "README.md", "# dirty\n");
    write(repo, "untouched.txt", "keep me\n");

    await gitService.discardPaths(repo, ["README.md"]);

    expect(fs.readFileSync(path.join(repo, "README.md"), "utf-8")).toBe(
      "# test\n",
    );
    expect(fs.existsSync(path.join(repo, "untouched.txt"))).toBe(true);
  });

  // A file created since the last commit has no committed state to go back to,
  // so discarding it means removing it — from the index as well as the disk.
  it("deletes a file HEAD never had, staged or not", async () => {
    const repo = makeRepo();
    write(repo, "untracked.txt", "new\n");
    write(repo, "staged.txt", "new\n");
    git(repo, "add", "staged.txt");

    await gitService.discardPaths(repo, ["untracked.txt", "staged.txt"]);

    expect(fs.existsSync(path.join(repo, "untracked.txt"))).toBe(false);
    expect(fs.existsSync(path.join(repo, "staged.txt"))).toBe(false);
    expect((await gitService.getStatus(repo)).isClean).toBe(true);
  });

  it("handles a mix of both in one call", async () => {
    const repo = makeRepo();
    write(repo, "README.md", "# dirty\n");
    write(repo, "extra.txt", "new\n");

    await gitService.discardPaths(repo, ["README.md", "extra.txt"]);

    expect((await gitService.getStatus(repo)).isClean).toBe(true);
  });

  // git quotes and octal-escapes non-ASCII paths unless core.quotePath is off,
  // so "is this file in HEAD?" answered `"belgeler/\303\266zet.md"` while the
  // renderer asked about `belgeler/özet.md`. The mismatch read a committed file
  // as one HEAD never had — and discarding that means deleting it.
  it("restores a committed file whose name is non-ASCII", async () => {
    const repo = makeRepo();
    const file = "belgeler/özet.md";
    fs.mkdirSync(path.join(repo, "belgeler"));
    write(repo, file, "orijinal\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "add özet");
    write(repo, file, "değişti\n");

    await gitService.discardPaths(repo, [file]);

    expect(fs.existsSync(path.join(repo, file))).toBe(true);
    expect(fs.readFileSync(path.join(repo, file), "utf-8")).toBe("orijinal\n");
    expect((await gitService.getStatus(repo)).isClean).toBe(true);
  });

  it("still deletes a non-ASCII file HEAD never had", async () => {
    const repo = makeRepo();
    write(repo, "yeni-şey.txt", "new\n");

    await gitService.discardPaths(repo, ["yeni-şey.txt"]);

    expect(fs.existsSync(path.join(repo, "yeni-şey.txt"))).toBe(false);
    expect((await gitService.getStatus(repo)).isClean).toBe(true);
  });

  it("is a no-op for an empty list", async () => {
    const repo = makeRepo();
    write(repo, "README.md", "# dirty\n");

    await gitService.discardPaths(repo, []);

    expect(fs.readFileSync(path.join(repo, "README.md"), "utf-8")).toBe(
      "# dirty\n",
    );
  });

  // These paths delete files, and they arrive over IPC.
  it.each(["../outside.txt", "/etc/hosts", "--force", "a/../../b"])(
    "refuses to touch %s",
    async (badPath) => {
      const repo = makeRepo();
      await expect(gitService.discardPaths(repo, [badPath])).rejects.toThrow(
        "Invalid repository path",
      );
    },
  );

  it("refuses the whole batch when one path is unsafe", async () => {
    const repo = makeRepo();
    write(repo, "README.md", "# dirty\n");

    await expect(
      gitService.discardPaths(repo, ["README.md", "../escape.txt"]),
    ).rejects.toThrow("Invalid repository path");
    // The safe path in the batch must not have been applied either.
    expect(fs.readFileSync(path.join(repo, "README.md"), "utf-8")).toBe(
      "# dirty\n",
    );
  });
});

describe("checkoutBranch", () => {
  it("moves the checkout to an existing branch", async () => {
    const repo = makeRepo();
    git(repo, "branch", "feature");

    await gitService.checkoutBranch(repo, "feature");

    expect(await gitService.getCurrentBranch(repo)).toBe("feature");
  });

  // Uncommitted work that doesn't collide comes along — the panel warns about
  // this rather than stashing behind the user's back.
  it("carries uncommitted changes to the new branch", async () => {
    const repo = makeRepo();
    git(repo, "branch", "feature");
    write(repo, "scratch.txt", "wip\n");

    await gitService.checkoutBranch(repo, "feature");

    expect(fs.readFileSync(path.join(repo, "scratch.txt"), "utf-8")).toBe("wip\n");
  });

  // git's own refusal is the error the user needs to see, so it propagates.
  it("rejects when the working tree would be overwritten", async () => {
    const repo = makeRepo();
    git(repo, "checkout", "-b", "feature");
    write(repo, "conflict.txt", "from feature\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feature file");
    git(repo, "checkout", "main");
    write(repo, "conflict.txt", "uncommitted\n");

    await expect(gitService.checkoutBranch(repo, "feature")).rejects.toThrow();
    expect(await gitService.getCurrentBranch(repo)).toBe("main");
  });

  it("rejects a branch name that would parse as a git option", async () => {
    const repo = makeRepo();
    await expect(gitService.checkoutBranch(repo, "--orphan")).rejects.toThrow(
      "Invalid git ref",
    );
  });

  it("rejects an unknown branch", async () => {
    const repo = makeRepo();
    await expect(gitService.checkoutBranch(repo, "nope")).rejects.toThrow();
  });
});

describe("createBranch", () => {
  // The panel promises the work in progress travels with you. It does so for
  // free: the commit doesn't move, only the name pointing at it.
  it("lands on a new branch at the same commit, tree untouched", async () => {
    const repo = makeRepo();
    write(repo, "README.md", "# edited\n");
    write(repo, "scratch.txt", "wip\n");
    const headBefore = git(repo, "rev-parse", "HEAD");

    await gitService.createBranch(repo, "feature/carry");

    expect(await gitService.getCurrentBranch(repo)).toBe("feature/carry");
    expect(git(repo, "rev-parse", "HEAD")).toBe(headBefore);
    expect(fs.readFileSync(path.join(repo, "README.md"), "utf-8")).toBe(
      "# edited\n",
    );
    expect(fs.readFileSync(path.join(repo, "scratch.txt"), "utf-8")).toBe(
      "wip\n",
    );
  });

  it("rejects a name already taken, leaving the checkout where it was", async () => {
    const repo = makeRepo();
    git(repo, "branch", "taken");

    await expect(gitService.createBranch(repo, "taken")).rejects.toThrow();
    expect(await gitService.getCurrentBranch(repo)).toBe("main");
  });

  it("rejects a branch name that would parse as a git option", async () => {
    const repo = makeRepo();
    await expect(gitService.createBranch(repo, "--orphan")).rejects.toThrow(
      "Invalid git ref",
    );
  });
});

describe("renameBranch", () => {
  it("renames the branch", async () => {
    const repo = makeRepo();

    await gitService.renameBranch(repo, "main", "trunk");

    expect(await gitService.getCurrentBranch(repo)).toBe("trunk");
  });
});

// ─────────────────────────────────────────────────────────────
// stage → staged diff → commit round-trip
// ─────────────────────────────────────────────────────────────

describe("stageFiles / getStagedDiff / commit", () => {
  it("stages everything, exposes the index diff, and commits it", async () => {
    const repo = makeRepo();
    write(repo, "c.txt", "content\n");

    await gitService.stageFiles(repo);
    const staged = await gitService.getStagedDiff(repo);
    expect(staged).toContain("c.txt");

    const result = await gitService.commit(repo, "add c");
    expect(result.hash).toBeTruthy();
    expect((await gitService.getStatus(repo)).isClean).toBe(true);
    expect(git(repo, "log", "-1", "--pretty=%s")).toBe("add c");
  });
});

// ─────────────────────────────────────────────────────────────
// getBranches — raw names (deduping is the caller's concern)
// ─────────────────────────────────────────────────────────────

describe("getBranches", () => {
  it("lists local branches with the current one", async () => {
    const repo = makeRepo();
    git(repo, "branch", "extra");

    const result = await gitService.getBranches(repo);

    expect(result.current).toBe("main");
    expect(result.all).toContain("main");
    expect(result.all).toContain("extra");
  });
});

// ─────────────────────────────────────────────────────────────
// Pure diff-text helpers
// ─────────────────────────────────────────────────────────────

describe("buildPerFileDiffHashes", () => {
  const chunk = (name: string, body: string) =>
    `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n${body}\n`;

  it("maps each file to a hash of its own chunk", () => {
    const diff = chunk("a.ts", "+x") + chunk("b.ts", "+y");
    const hashes = buildPerFileDiffHashes(diff);

    expect([...hashes.keys()]).toEqual(["a.ts", "b.ts"]);
    expect(hashes.get("a.ts")).toBe(hashContent(chunk("a.ts", "+x")));
    expect(hashes.get("a.ts")).not.toBe(hashes.get("b.ts"));
  });

  it("returns an empty map for empty input", () => {
    expect(buildPerFileDiffHashes("").size).toBe(0);
  });
});

describe("parsePerFileDiffStats", () => {
  const chunk = (name: string, body: string) =>
    `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n${body}\n`;

  it("counts added and removed lines per file", () => {
    const diff =
      chunk("a.ts", "+one\n+two\n-gone") + chunk("b.ts", "-only\n-removals");

    const stats = parsePerFileDiffStats(diff);

    expect(stats.get("a.ts")).toEqual({ additions: 2, deletions: 1, isNew: false });
    expect(stats.get("b.ts")).toEqual({ additions: 0, deletions: 2, isNew: false });
  });

  // The `+++`/`---` file headers start with the same characters as content
  // lines; counting them would inflate every file by one each way.
  it("ignores the file headers", () => {
    expect(parsePerFileDiffStats(chunk("a.ts", "+x"))).toEqual(
      new Map([["a.ts", { additions: 1, deletions: 0, isNew: false }]]),
    );
  });

  it("indexes a rename under both paths", () => {
    const diff = `diff --git a/old.ts b/new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n+x\n`;

    const stats = parsePerFileDiffStats(diff);

    expect(stats.get("new.ts")).toEqual({
      additions: 1,
      deletions: 0,
      isNew: false,
    });
    expect(stats.get("old.ts")).toEqual(stats.get("new.ts"));
  });

  it("reports a file with no line changes as zero rather than omitting it", () => {
    const stats = parsePerFileDiffStats(
      `diff --git a/big.bin b/big.bin\nnew file\nBinary or large file (900000 bytes)`,
    );

    expect(stats.get("big.bin")).toEqual({
      additions: 0,
      deletions: 0,
      isNew: true,
    });
  });

  // Discarding a file that HEAD never had deletes it, so the flag that marks
  // one has to survive the round trip from a real snapshot.
  it("flags files that did not exist at the base ref", async () => {
    const repo = makeRepo();
    write(repo, "README.md", "# edited\n");
    write(repo, "fresh.ts", "export const x = 1;\n");
    write(repo, "staged.ts", "export const y = 2;\n");
    git(repo, "add", "staged.ts");
    const head = git(repo, "rev-parse", "HEAD");

    const snapshot = await gitService.captureDiffSnapshot(repo, head);
    const stats = parsePerFileDiffStats(snapshot.diffText);

    expect(stats.get("fresh.ts")?.isNew).toBe(true);
    expect(stats.get("staged.ts")?.isNew).toBe(true);
    expect(stats.get("README.md")?.isNew).toBe(false);
  });

  it("returns an empty map for empty input", () => {
    expect(parsePerFileDiffStats("").size).toBe(0);
  });
});

describe("listNonIgnoredFiles", () => {
  it("lists tracked and untracked files but not gitignored ones", async () => {
    const repo = makeRepo();
    write(repo, ".gitignore", "ignored.txt\nbuild/\n");
    write(repo, "ignored.txt", "x");
    fs.mkdirSync(path.join(repo, "build"));
    write(repo, "build/out.js", "x");
    fs.mkdirSync(path.join(repo, "src"));
    write(repo, "src/app.ts", "x");
    // Nested .gitignore rules must apply too.
    write(repo, "src/.gitignore", "local.ts\n");
    write(repo, "src/local.ts", "x");

    const files = await gitService.listNonIgnoredFiles(repo);
    expect(files).toContain("README.md");
    expect(files).toContain("src/app.ts");
    expect(files).toContain(".gitignore");
    expect(files).not.toContain("ignored.txt");
    expect(files).not.toContain("build/out.js");
    expect(files).not.toContain("src/local.ts");
  });

  it("omits tracked files deleted from the working tree", async () => {
    const repo = makeRepo();
    fs.rmSync(path.join(repo, "README.md"));

    const files = await gitService.listNonIgnoredFiles(repo);
    expect(files).not.toContain("README.md");
  });
});
