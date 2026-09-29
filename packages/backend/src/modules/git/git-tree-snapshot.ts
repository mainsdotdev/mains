import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { openGit } from "./git-snapshot";

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────
// Working-tree snapshots — the plumbing behind turn changes.
//
// A snapshot is a git tree object holding the working tree as it stands
// (tracked + untracked, .gitignore honoured), written through a throwaway
// index so HEAD, the user's index, and the files themselves are never touched.
// Two snapshots diff into exactly what changed between two moments, whoever
// made the change — an edit tool, a shell command, a codegen step. Nothing
// references the trees afterwards; git's own gc collects them. See CONTEXT.md
// "turn changes".
// ─────────────────────────────────────────────────────────────

/**
 * Past this many untracked files a snapshot would be hashing a dependency or
 * build directory someone forgot to ignore into the repo's object database.
 */
const MAX_SNAPSHOT_UNTRACKED_FILES = 5_000;
/** The same guard by size. */
const MAX_SNAPSHOT_UNTRACKED_BYTES = 100 * 1024 * 1024;

export type TreeDiffStatus = "added" | "modified" | "deleted" | "renamed";

export interface TreeDiffFile {
  path: string;
  /** Path before the move — set only when `status` is "renamed". */
  oldPath?: string;
  status: TreeDiffStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface TreeDiff {
  /** `git apply`-able patch, binary hunks included. */
  diffText: string;
  files: TreeDiffFile[];
  additions: number;
  deletions: number;
  /** Kept for persisted-record compatibility; newly captured patches are complete. */
  truncated: boolean;
}

/**
 * Fixed diff flags: user config must not reshape a patch that gets parsed and
 * later re-applied. `diff.noprefix` / `diff.mnemonicPrefix` would break the
 * a/ b/ prefixes `git apply` expects, an external diff or textconv would
 * replace the content, and colour would corrupt it.
 */
const DIFF_FLAGS = [
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "-M",
];

async function repoTopLevel(rootPath: string): Promise<string> {
  return (await openGit(rootPath).revparse(["--show-toplevel"])).trim();
}

export interface WorktreeLocation {
  /** The worktree's root — what every snapshot and tree diff path is relative to. */
  topLevel: string;
  /** Where `rootPath` sits inside it: "" at the root, else "sub/dir/". */
  prefix: string;
}

/** Which worktree `rootPath` belongs to, and where in it. */
export async function locateWorktree(rootPath: string): Promise<WorktreeLocation> {
  const [topLevel, prefix = ""] = (
    await openGit(rootPath).raw(["rev-parse", "--show-toplevel", "--show-prefix"])
  ).split("\n");
  return { topLevel: topLevel.trim(), prefix: prefix.trim() };
}

function splitNul(raw: string): string[] {
  const tokens = raw.split("\0");
  if (tokens[tokens.length - 1] === "") tokens.pop();
  return tokens;
}

async function assertUntrackedWithinLimits(topLevel: string): Promise<void> {
  const raw = await openGit(topLevel).raw([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const untracked = splitNul(raw);
  if (untracked.length > MAX_SNAPSHOT_UNTRACKED_FILES) {
    throw new Error(
      `Too many untracked files to snapshot (${untracked.length})`,
    );
  }
  let bytes = 0;
  for (const file of untracked) {
    try {
      bytes += fs.lstatSync(path.join(topLevel, file)).size;
    } catch {
      // Vanished between the listing and the stat — nothing to hash.
    }
    if (bytes > MAX_SNAPSHOT_UNTRACKED_BYTES) {
      throw new Error("Untracked files are too large to snapshot");
    }
  }
}

/**
 * Run git against a scratch index. Not through simple-git: pointing git at
 * another index takes `GIT_INDEX_FILE`, and simple-git refuses a custom
 * environment that also carries variables it deems unsafe (`GIT_EDITOR`,
 * `GIT_ASKPASS`, …) — which the inherited environment routinely does.
 */
async function gitWithIndex(
  cwd: string,
  indexFile: string,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_INDEX_FILE: indexFile },
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/** Run `fn` with a scratch directory that is always removed afterwards. */
async function withScratchDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-git-"));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Write the working tree into the object database and return its tree sha.
 *
 * The real index is copied first rather than starting empty: its stat cache
 * lets `git add` skip re-hashing every unchanged file, which is what keeps a
 * snapshot of a large repo fast. Throws past the untracked-file guard.
 */
export async function snapshotWorkingTree(rootPath: string): Promise<string> {
  const topLevel = await repoTopLevel(rootPath);
  await assertUntrackedWithinLimits(topLevel);
  const indexPath = path.resolve(
    topLevel,
    (await openGit(topLevel).raw(["rev-parse", "--git-path", "index"])).trim(),
  );

  return withScratchDir(async (dir) => {
    const scratchIndex = path.join(dir, "index");
    // A repo that has never staged anything has no index file yet.
    if (fs.existsSync(indexPath)) {
      fs.copyFileSync(indexPath, scratchIndex);
      // Keep the index's own mtime. Git trusts a cached stat unless the index
      // was written no later than the file changed, and judges that by the
      // index file's mtime — a fresh copy's "now" would pass off a same-size
      // edit made in the same second as the index as unchanged.
      const { atime, mtime } = fs.statSync(indexPath);
      fs.utimesSync(scratchIndex, atime, mtime);
    }
    await gitWithIndex(topLevel, scratchIndex, ["add", "--all", "--", "."]);
    return (await gitWithIndex(topLevel, scratchIndex, ["write-tree"])).trim();
  });
}

function toStatus(code: string): TreeDiffStatus {
  switch (code[0]) {
    case "A":
    case "C":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}

/**
 * Everything that changed between two tree objects — or, given `paths`
 * (relative to the worktree root), only what changed at those paths. Include
 * both sides of a move, or it diffs as a lone add or delete.
 */
export async function diffTrees(
  rootPath: string,
  fromTree: string,
  toTree: string,
  paths?: string[],
): Promise<TreeDiff> {
  // A bare `--` would mean "every path", the opposite of what was asked.
  if (paths?.length === 0) {
    return { diffText: "", files: [], additions: 0, deletions: 0, truncated: false };
  }
  const git = openGit(await repoTopLevel(rootPath));
  // Literal pathspecs: a file named `*.ts` or `:x` must match only itself.
  const pathspec = paths ? ["--", ...paths.map((p) => `:(literal)${p}`)] : [];
  const [patch, nameStatus, numstat] = await Promise.all([
    git.raw([...DIFF_FLAGS, "--binary", fromTree, toTree, ...pathspec]),
    git.raw([...DIFF_FLAGS, "--name-status", "-z", fromTree, toTree, ...pathspec]),
    git.raw([...DIFF_FLAGS, "--numstat", "-z", fromTree, toTree, ...pathspec]),
  ]);

  // --numstat -z: "add\tdel\tpath\0", or for a move "add\tdel\t\0old\0new\0".
  // Binaries report "-\t-".
  const counts = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  const numTokens = splitNul(numstat);
  for (let i = 0; i < numTokens.length; i++) {
    const [add, del, inlinePath] = numTokens[i].split("\t");
    // A move leaves the inline path empty; its new path is the second of the
    // two tokens that follow.
    const filePath = inlinePath ? inlinePath : numTokens[(i += 2)];
    const binary = add === "-" || del === "-";
    counts.set(filePath, {
      additions: binary ? 0 : Number(add),
      deletions: binary ? 0 : Number(del),
      binary,
    });
  }

  // --name-status -z: "M\0path\0", or for a move/copy "R100\0old\0new\0".
  const files: TreeDiffFile[] = [];
  const statusTokens = splitNul(nameStatus);
  for (let i = 0; i < statusTokens.length; i++) {
    const code = statusTokens[i];
    const twoPaths = code.startsWith("R") || code.startsWith("C");
    const firstPath = statusTokens[++i];
    const filePath = twoPaths ? statusTokens[++i] : firstPath;
    const status = toStatus(code);
    const count = counts.get(filePath) ?? { additions: 0, deletions: 0, binary: false };
    files.push({
      path: filePath,
      ...(status === "renamed" ? { oldPath: firstPath } : {}),
      status,
      ...count,
    });
  }

  return {
    diffText: patch,
    files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    truncated: false,
  };
}

export interface ApplyPatchOptions {
  /** Undo the patch instead of applying it. */
  reverse?: boolean;
}

function applyArgs(options: ApplyPatchOptions): string[] {
  return ["apply", "--whitespace=nowarn", ...(options.reverse ? ["-R"] : [])];
}

async function withPatchFile<T>(
  patch: string,
  fn: (patchFile: string) => Promise<T>,
): Promise<T> {
  return withScratchDir(async (dir) => {
    const patchFile = path.join(dir, "changes.patch");
    fs.writeFileSync(patchFile, patch.endsWith("\n") ? patch : `${patch}\n`);
    return fn(patchFile);
  });
}

/**
 * Whether the patch applies cleanly to the working tree as it stands now. A
 * file edited after the patch was taken no longer matches its context, so this
 * is the "did anything move on since?" check.
 */
export async function canApplyPatch(
  rootPath: string,
  patch: string,
  options: ApplyPatchOptions = {},
): Promise<boolean> {
  const git = openGit(await repoTopLevel(rootPath));
  return withPatchFile(patch, async (patchFile) => {
    try {
      await git.raw([...applyArgs(options), "--check", patchFile]);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Every path `git diff` would list between two commits — both sides of a move
 * — relative to the worktree root: what moving HEAD from one to the other
 * rewrote on disk.
 */
export async function changedPaths(
  rootPath: string,
  fromRef: string,
  toRef: string,
): Promise<string[]> {
  return splitNul(
    await openGit(rootPath).raw([
      "diff",
      "--name-only",
      "--no-renames",
      "--no-relative",
      "--no-ext-diff",
      "-z",
      fromRef,
      toRef,
    ]),
  );
}

/** Every path a patch touches — both sides of a move — as the patch names them. */
export async function patchPaths(rootPath: string, patch: string): Promise<string[]> {
  const git = openGit(await repoTopLevel(rootPath));
  // `apply --numstat` names only the side a move ends on, so read the patch
  // both ways round.
  const [forward, reverse] = await withPatchFile(patch, (patchFile) =>
    Promise.all([
      git.raw(["apply", "--numstat", "-z", patchFile]),
      git.raw(["apply", "--numstat", "-z", "-R", patchFile]),
    ]),
  );
  // "add\tdel\tpath\0", or in diff's own form for a move "add\tdel\t\0old\0new\0".
  const paths = new Set<string>();
  for (const raw of [forward, reverse]) {
    const tokens = splitNul(raw);
    for (let i = 0; i < tokens.length; i++) {
      const inlinePath = tokens[i].split("\t")[2];
      if (inlinePath) paths.add(inlinePath);
      else for (const moved of [tokens[++i], tokens[++i]]) if (moved) paths.add(moved);
    }
  }
  return [...paths];
}

/**
 * Apply the patch to the working tree only — the index stays as it was. `git
 * apply` is atomic across files: when any hunk fails, nothing is written.
 */
export async function applyPatch(
  rootPath: string,
  patch: string,
  options: ApplyPatchOptions = {},
): Promise<void> {
  const git = openGit(await repoTopLevel(rootPath));
  await withPatchFile(patch, async (patchFile) => {
    await git.raw([...applyArgs(options), patchFile]);
  });
}
