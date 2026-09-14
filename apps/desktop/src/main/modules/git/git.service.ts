import { SimpleGit, StatusResult, LogResult, RemoteWithRefs } from "simple-git";
import { app } from "electron";
import path from "path";
import fs from "fs";
import { captureDiffSnapshot, openGit, type DiffSnapshot } from "./git-snapshot";

// ─────────────────────────────────────────────────────────────
// git service — main-process-internal deep module.
//
// Throw-style: every method returns a plain value and throws on failure.
// There is no ServiceResponse here and no IPC surface — renderer-triggered
// git effects go through workspace/gitFlow operations. See CONTEXT.md
// "git module".
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface GitStatusResponse {
  isClean: boolean;
  current: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  deleted: string[];
  untracked: string[];
  conflicted: string[];
}

export interface WorktreeImportResult {
  branchName: string;
  worktreePath: string;
  worktreeName: string;
  baseBranch: string;
  tracking: string | null;
  ahead: number;
  behind: number;
  originUrl: string | null;
}

export interface WorktreeImportOptions {
  projectName?: string;
  branchName?: string;
  baseBranch?: string;
}

export interface DirectImportResult {
  branchName: string;
  sourcePath: string;
  baseBranch: string;
  tracking: string | null;
  ahead: number;
  behind: number;
  originUrl: string | null;
}

export interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  author_email: string;
}

export interface GitRemote {
  name: string;
  fetchUrl: string | undefined;
  pushUrl: string | undefined;
}

// ─────────────────────────────────────────────────────────────
// Argument hardening
// ─────────────────────────────────────────────────────────────

// Transports like ext:: ("ext::sh -c ...") and fd:: execute arbitrary commands;
// file:// and bare local paths turn "clone" into local filesystem reads.
const SAFE_CLONE_URL =
  /^(https?:\/\/|ssh:\/\/|git:\/\/|[A-Za-z0-9._-]+@[A-Za-z0-9._~-]+:)/;

function assertCloneUrl(url: string): void {
  if (!url || url.startsWith("-")) throw new Error("Invalid repository URL");
  if (!SAFE_CLONE_URL.test(url)) {
    throw new Error(
      "Only https://, ssh://, git:// or user@host: repository URLs are supported",
    );
  }
}

/**
 * A repo-relative path that this process is willing to overwrite or delete.
 *
 * Discarding a change rewrites and in some cases removes a file, and the paths
 * arrive over IPC — so absolute paths, parent-directory escapes and leading
 * dashes (which git would read as options) are all refused rather than
 * normalized.
 */
export function assertRepoRelativePath(filePath: string): void {
  if (
    !filePath ||
    filePath.startsWith("-") ||
    filePath.startsWith("/") ||
    filePath.includes("\0") ||
    path.isAbsolute(filePath) ||
    path
      .normalize(filePath)
      .split(path.sep)
      .some((segment) => segment === "..")
  ) {
    throw new Error(`Invalid repository path: ${filePath}`);
  }
}

// A ref starting with "-" would be parsed as an option by git, not a revision.
function assertRef(ref: string): void {
  if (!ref || ref.startsWith("-") || /[\s\0]/.test(ref)) {
    throw new Error("Invalid git ref");
  }
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

function getGit(rootPath: string): SimpleGit {
  return openGit(rootPath);
}

/** The worktrees directory under app data (falls back to ./.data headless). */
function worktreesDir(): string {
  const userDataPath = app?.getPath("userData") || path.join(process.cwd(), ".data");
  return path.join(userDataPath, "worktrees");
}

/** Unique fruit + random suffix, shared by the import branch and worktree. */
function generateFruitName(): string {
  const fruits = [
    "apple", "banana", "cherry", "mango", "peach",
    "grape", "orange", "pineapple", "strawberry", "watermelon",
    "kiwi", "blueberry", "raspberry", "lemon", "lime",
    "papaya", "plum", "pear", "coconut", "avocado",
  ];
  const fruit = fruits[Math.floor(Math.random() * fruits.length)];
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${fruit}-${suffix}`;
}

/** The `origin` fetch/push URL, or null when the repo has no origin remote. */
async function readOriginUrl(git: SimpleGit): Promise<string | null> {
  try {
    const remotes: RemoteWithRefs[] = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    return origin ? origin.refs.fetch || origin.refs.push || null : null;
  } catch {
    // No remotes, that's fine
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Git service
// ─────────────────────────────────────────────────────────────

export const gitService = {
  /** Current branch name. */
  async getCurrentBranch(rootPath: string): Promise<string> {
    const branch = await getGit(rootPath).revparse(["--abbrev-ref", "HEAD"]);
    return branch.trim();
  },

  /**
   * Repository integration branch. Prefer origin/HEAD, then conventional local
   * branches, and only then the current checkout.
   */
  async getDefaultBranch(rootPath: string): Promise<string> {
    const git = getGit(rootPath);
    try {
      const remoteHead = (
        await git.raw([
          "symbolic-ref",
          "--quiet",
          "--short",
          "refs/remotes/origin/HEAD",
        ])
      ).trim();
      if (remoteHead.startsWith("origin/")) {
        return remoteHead.slice("origin/".length);
      }
    } catch {
      // Repositories without an origin/HEAD fall through to local branches.
    }

    const branches = await git.branchLocal();
    if (branches.all.includes("main")) return "main";
    if (branches.all.includes("master")) return "master";
    return (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
  },

  /** Absolute git directory; worktrees resolve to their own .git/worktrees entry. */
  async getGitDirectory(rootPath: string): Promise<string> {
    const gitDir = await getGit(rootPath).revparse(["--absolute-git-dir"]);
    return gitDir.trim();
  },

  /** Working-tree status. */
  async getStatus(rootPath: string): Promise<GitStatusResponse> {
    const status: StatusResult = await getGit(rootPath).status();
    return {
      isClean: status.isClean(),
      current: status.current,
      tracking: status.tracking,
      ahead: status.ahead,
      behind: status.behind,
      staged: status.staged,
      modified: status.modified,
      deleted: status.deleted,
      untracked: status.not_added,
      conflicted: status.conflicted,
    };
  },

  /** Local + remote branch names (raw, `remotes/…` prefixes included). */
  async getBranches(
    rootPath: string,
  ): Promise<{ current: string; all: string[] }> {
    const summary = await getGit(rootPath).branch();
    return { current: summary.current, all: summary.all };
  },

  /** Recent commits. */
  async getLog(rootPath: string, limit: number = 10): Promise<GitLogEntry[]> {
    const log: LogResult = await getGit(rootPath).log({ maxCount: limit });
    return log.all.map((entry) => ({
      hash: entry.hash,
      date: entry.date,
      message: entry.message,
      author_name: entry.author_name,
      author_email: entry.author_email,
    }));
  },

  /** Configured remotes. */
  async getRemotes(rootPath: string): Promise<GitRemote[]> {
    const remotes: RemoteWithRefs[] = await getGit(rootPath).getRemotes(true);
    return remotes.map((remote) => ({
      name: remote.name,
      fetchUrl: remote.refs.fetch,
      pushUrl: remote.refs.push,
    }));
  },

  /** Working-tree diff, optionally scoped to one file. */
  async getDiff(rootPath: string, filePath?: string): Promise<string> {
    const git = getGit(rootPath);
    return filePath ? git.diff([filePath]) : git.diff();
  },

  /**
   * Diff of the current branch against `baseRef`, three-dot style
   * (`git diff base...HEAD`) — i.e. only the changes the branch introduced
   * since it diverged from the base, which is exactly what a PR would show.
   * Independent of the working tree, so it works after the branch is committed
   * and clean.
   */
  async getBranchDiff(rootPath: string, baseRef: string): Promise<string> {
    return getGit(rootPath).diff([`${baseRef}...HEAD`]);
  },

  /**
   * Commit subject lines unique to the current branch (`git log base..HEAD`),
   * i.e. excluding the base branch's own history. Used to summarize a PR.
   */
  async getBranchLog(
    rootPath: string,
    baseRef: string,
    limit = 20,
  ): Promise<string[]> {
    const raw = await getGit(rootPath).raw([
      "log",
      `${baseRef}..HEAD`,
      "--pretty=%s",
      "-n",
      String(limit),
    ]);
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  },

  /**
   * The staged (index) diff — i.e. `git diff --cached`. This is exactly what
   * the next commit will record, so it's the input we feed the model when
   * generating a commit message.
   */
  async getStagedDiff(rootPath: string): Promise<string> {
    return getGit(rootPath).diff(["--cached"]);
  },

  /** HEAD commit sha. */
  async getHeadSha(rootPath: string): Promise<string> {
    const sha = await getGit(rootPath).revparse(["HEAD"]);
    return sha.trim();
  },

  /**
   * Deep diff-capture: unified diff since `baseRef` including synthetic hunks
   * for untracked files and an untracked-aware shortstat. All-or-throw — see
   * CONTEXT.md "DiffSnapshot / captureDiffSnapshot".
   */
  async captureDiffSnapshot(
    rootPath: string,
    baseRef: string,
  ): Promise<DiffSnapshot> {
    return captureDiffSnapshot(rootPath, baseRef);
  },

  /** Whether the path is inside a git repository. */
  async isGitRepo(rootPath: string): Promise<boolean> {
    return getGit(rootPath).checkIsRepo();
  },

  /**
   * Repo-relative paths of every file git does not ignore: tracked plus
   * untracked-but-not-ignored (`ls-files --cached --others
   * --exclude-standard`), minus deleted-but-still-tracked paths. Honors
   * nested .gitignore files and global excludes — the candidate set a
   * VS Code-style file search operates on.
   */
  async listNonIgnoredFiles(rootPath: string): Promise<string[]> {
    const git = getGit(rootPath);
    const [listed, deleted] = await Promise.all([
      git.raw(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]),
      git.raw(["ls-files", "--deleted", "-z"]),
    ]);
    const deletedSet = new Set(deleted.split("\0").filter(Boolean));
    const files: string[] = [];
    for (const rel of listed.split("\0")) {
      if (rel && !deletedSet.has(rel)) files.push(rel);
    }
    return files;
  },

  /**
   * Import a local git repo by creating a branch + worktree.
   * Returns full metadata needed for workspace creation.
   */
  async importLocalRepo(
    sourcePath: string,
    options: WorktreeImportOptions = {},
  ): Promise<WorktreeImportResult> {
    const git = getGit(sourcePath);

    const isRepo = await git.checkIsRepo();
    if (!isRepo) throw new Error("Not a git repository");

    const baseBranch =
      options.baseBranch ?? (await this.getDefaultBranch(sourcePath));
    const originUrl = await readOriginUrl(git);

    // One name for both the branch and the worktree (or the custom name).
    const fruitName = options.branchName || generateFruitName();
    const branchName = fruitName;
    const worktreeName = fruitName;
    assertRef(baseBranch);
    assertRef(branchName);

    // Prefer the local integration branch, but allow origin/HEAD to resolve to
    // a remote-only branch in repos that have never checked it out locally.
    const localBranches = await git.branchLocal();
    const baseRef = localBranches.all.includes(baseBranch)
      ? baseBranch
      : `origin/${baseBranch}`;

    // Create the import branch (staying in the source repo).
    await git.raw(["branch", branchName, baseRef]);

    // Worktree lands under a project subfolder when a projectName is given.
    const parentDir = options.projectName
      ? path.join(worktreesDir(), options.projectName)
      : worktreesDir();
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const worktreePath = path.join(parentDir, worktreeName);
    await git.raw(["worktree", "add", worktreePath, branchName]);

    // Tracking info from the worktree context.
    const status: StatusResult = await getGit(worktreePath).status();

    return {
      branchName,
      worktreePath,
      worktreeName,
      baseBranch,
      tracking: status.tracking,
      ahead: status.ahead,
      behind: status.behind,
      originUrl,
    };
  },

  /**
   * Import a local git repo without creating a worktree.
   * Uses the source path and active branch directly.
   */
  async importLocalRepoDirect(sourcePath: string): Promise<DirectImportResult> {
    const git = getGit(sourcePath);

    const isRepo = await git.checkIsRepo();
    if (!isRepo) throw new Error("Not a git repository");

    const branchName = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    const baseBranch = await this.getDefaultBranch(sourcePath);
    const originUrl = await readOriginUrl(git);
    const status: StatusResult = await git.status();

    return {
      branchName,
      sourcePath,
      baseBranch,
      tracking: status.tracking,
      ahead: status.ahead,
      behind: status.behind,
      originUrl,
    };
  },

  /**
   * Create a new empty repo: mkdir under parentPath (defaults to user Desktop),
   * git init on `main`, seed README, commit. Throws if the folder already exists.
   */
  async initRepo(
    projectName: string,
    parentPath?: string,
  ): Promise<{ rootPath: string; defaultBranch: string }> {
    const targetParent = parentPath ?? app.getPath("desktop");
    const rootPath = path.join(targetParent, projectName);
    if (fs.existsSync(rootPath)) throw new Error("Folder already exists");
    fs.mkdirSync(rootPath, { recursive: false });

    try {
      const git = getGit(rootPath);
      await git.init(false, ["--initial-branch=main"]);

      fs.writeFileSync(path.join(rootPath, "README.md"), `# ${projectName}\n`);
      await git.add(".");
      try {
        await git.commit("Initial commit");
      } catch {
        // Fallback when the user has no global git identity configured.
        await git.raw([
          "-c",
          "user.email=mains@local",
          "-c",
          "user.name=Mains",
          "commit",
          "-m",
          "Initial commit",
        ]);
      }

      return { rootPath, defaultBranch: "main" };
    } catch (error) {
      try {
        fs.rmSync(rootPath, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      throw error;
    }
  },

  /** Clone a remote git repository to a local path. */
  async cloneRepo(
    url: string,
    targetPath: string,
  ): Promise<{ clonedPath: string; defaultBranch: string; originUrl: string }> {
    assertCloneUrl(url);

    // Extract repo name from URL for the folder name.
    const repoName = url
      .replace(/\.git$/, "")
      .split("/")
      .pop() || "repo";
    const clonePath = path.join(targetPath, repoName);

    // Clone using simple-git (not bound to any repo yet).
    await openGit().clone(url, clonePath);

    const defaultBranch = (
      await getGit(clonePath).revparse(["--abbrev-ref", "HEAD"])
    ).trim();

    return { clonedPath: clonePath, defaultBranch, originUrl: url };
  },

  /** Stage files for commit (all when unspecified). */
  async stageFiles(rootPath: string, files?: string[]): Promise<void> {
    const git = getGit(rootPath);
    if (files && files.length > 0) {
      await git.add(files);
    } else {
      await git.add("-A");
    }
  },

  /** Commit staged changes. */
  async commit(
    rootPath: string,
    message: string,
  ): Promise<{ hash: string; summary: string }> {
    const result = await getGit(rootPath).commit(message);
    return {
      hash: result.commit || "",
      summary: `${result.summary.changes} changed, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions`,
    };
  },

  /**
   * Push the current branch to a remote. When the branch has no upstream yet
   * (common in fresh worktrees, even after the first commit), pushes with
   * `--set-upstream` so subsequent pushes work without arguments.
   */
  async push(
    rootPath: string,
    options?: { setUpstream?: boolean; remote?: string; branch?: string },
  ): Promise<{ branch: string; remote: string }> {
    const git = getGit(rootPath);
    const remote = options?.remote ?? "origin";
    const branch =
      options?.branch ?? (await git.revparse(["--abbrev-ref", "HEAD"])).trim();

    // Set upstream when explicitly asked, or when the branch isn't tracking
    // a remote yet — otherwise a bare `git push` would error.
    let setUpstream = options?.setUpstream ?? false;
    if (!setUpstream) {
      const status = await git.status();
      if (!status.tracking) setUpstream = true;
    }

    const args = setUpstream
      ? ["--set-upstream", remote, branch]
      : [remote, branch];
    await git.push(args);
    return { branch, remote };
  },

  /**
   * Fetch and fast-forward the current branch onto its upstream.
   *
   * `--ff-only` is the point, not a limitation. A pull that cannot fast-forward
   * changes *nothing*: no merge commit, no conflicted tree, nothing to undo.
   * The alternatives can stop half-way and leave the repo in a state this app
   * has no way out of — the diff surfaces would render conflict markers as
   * ordinary work and a run would edit them — so git's refusal is the better
   * outcome, in the same spirit as `checkoutBranch` not stashing for anyone.
   *
   * Returns how many commits arrived, so callers don't re-derive "already up
   * to date" from a diffless HEAD comparison.
   */
  async pullFastForward(
    rootPath: string,
  ): Promise<{ received: number; head: string }> {
    const git = getGit(rootPath);
    const before = (await git.revparse(["HEAD"])).trim();
    await git.raw(["pull", "--ff-only"]);
    const head = (await git.revparse(["HEAD"])).trim();
    if (head === before) return { received: 0, head };
    const count = (
      await git.raw(["rev-list", "--count", `${before}..${head}`])
    ).trim();
    return { received: Number(count) || 0, head };
  },

  /**
   * Add a new remote to the repository (e.g. `origin` when publishing a repo
   * that was created locally with no remote). Throws if the remote name already
   * exists, so callers should check `getRemotes` first when that matters.
   */
  async addRemote(rootPath: string, name: string, url: string): Promise<void> {
    await getGit(rootPath).addRemote(name, url);
  },

  /** Rename a local branch. */
  async renameBranch(
    rootPath: string,
    oldName: string,
    newName: string,
  ): Promise<string> {
    await getGit(rootPath).raw(["branch", "-m", oldName, newName]);
    return newName;
  },

  /** Remove a worktree. */
  async removeWorktree(sourcePath: string, worktreePath: string): Promise<void> {
    await getGit(sourcePath).raw([
      "worktree",
      "remove",
      worktreePath,
      "--force",
    ]);
  },

  /** Hard-reset the working tree to a given ref and clean untracked files. */
  /**
   * Check out an existing branch in this working tree.
   *
   * Deliberately a plain `git checkout <branch>`: git's own rules decide the
   * outcome, and its refusals are the ones worth surfacing. Uncommitted work
   * that doesn't collide comes along; work that would be overwritten makes git
   * refuse, as does a branch already checked out in another worktree. Nothing
   * is forced or stashed on the user's behalf.
   *
   * A name that exists only on the remote resolves the way it does on the
   * command line — git creates the local tracking branch.
   */
  async checkoutBranch(rootPath: string, branch: string): Promise<void> {
    assertRef(branch);
    await getGit(rootPath).checkout(branch);
  },

  /**
   * Create a branch at the current HEAD and check it out (`checkout -b`).
   *
   * Unlike `checkoutBranch` this can't collide with the working tree: the
   * commit doesn't change, only the name pointing at it, so uncommitted work
   * always comes along and git has nothing to refuse over. What it does refuse
   * — a name already taken, a name git considers malformed — arrives as its own
   * message, which is the one worth showing.
   *
   * A detached HEAD is a valid starting point: the new branch is created at
   * whatever commit is checked out.
   */
  async createBranch(rootPath: string, branch: string): Promise<void> {
    assertRef(branch);
    await getGit(rootPath).checkoutLocalBranch(branch);
  },

  /**
   * Discard the working-tree changes to specific files, restoring each to its
   * HEAD state.
   *
   * A file that HEAD knows is checked back out. One HEAD doesn't have was
   * created since the last commit, so its "HEAD state" is not existing: it is
   * unstaged if staged and deleted from disk. That deletion is unrecoverable
   * for an untracked file — git never had a copy.
   *
   * Paths are repo-relative and validated; everything runs behind `--` so a
   * path can never be read as an option.
   */
  async discardPaths(rootPath: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    for (const filePath of paths) assertRepoRelativePath(filePath);
    const git = getGit(rootPath);

    // One call rather than one per file: which of these exist in HEAD?
    // A repo with no commits yet has no HEAD at all — then none of them do.
    const inHead = new Set<string>();
    try {
      const listed = await git.raw([
        "ls-tree",
        "-r",
        "--name-only",
        "HEAD",
        "--",
        ...paths,
      ]);
      for (const line of listed.split("\n")) {
        const name = line.trim();
        if (name) inHead.add(name);
      }
    } catch {
      // No HEAD — leave the set empty.
    }

    const committed = paths.filter((p) => inHead.has(p));
    const created = paths.filter((p) => !inHead.has(p));

    if (committed.length > 0) {
      await git.raw(["checkout", "HEAD", "--", ...committed]);
    }
    if (created.length > 0) {
      // --ignore-unmatch: the file may only ever have lived in the working
      // tree, in which case there is no index entry to drop.
      await git.raw([
        "rm",
        "--force",
        "--ignore-unmatch",
        "--cached",
        "--",
        ...created,
      ]);
      for (const filePath of created) {
        fs.rmSync(path.join(rootPath, filePath), { force: true });
      }
    }
  },
};
