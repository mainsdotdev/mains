// ─────────────────────────────────────────────────────────────
// Git Flow Service
//
// Deterministic commit / push / PR orchestration driven from the UI
// (the git-actions panel) — the one place the actual git work lives.
// Agents no longer commit or open PRs through a mains tool; they use the
// shell like any other command, and the user drives the panel.
//
// The UI flow never round-trips through chat: it stages with simple-git,
// optionally generates a message/body via a one-shot headless model call
// (adapter.generateText), commits/pushes, and creates the PR with `gh`
// directly.
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// ─────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import {
  workspaceService,
  logWorkspaceActivity,
  emitFindingsChanged,
  recordWorkspaceDiff,
} from "../workspace";
import { runSessionRegistry } from "../runs/run-session-registry";
import { gitService, parsePerFileDiffStats } from "../git";
import { projectsService } from "../projects";
import { appSettingsService } from "../appSettings";
// `createWorkAdapter` is imported lazily inside the generation methods to break
// the gitFlow ↔ providers/adapters (mains-tools) require cycle.

const execFileAsync = promisify(execFile);

// ~25k tokens — comfortably within the one-shot model's context while keeping
// the generate call fast. Diffs beyond this are cut with an explicit marker so
// the model knows it saw a prefix, not the whole changeset.
const MAX_DIFF_CHARS = 100_000;

/** Cap a diff for the generation prompt, flagging the cut when one happens. */
function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated — showing the first ${MAX_DIFF_CHARS.toLocaleString("en-US")} of ${diff.length.toLocaleString("en-US")} characters]`;
}

/** A file in the working tree's diff, as the session panel lists it. */
export interface ChangedFile {
  /** Repo-relative path. */
  path: string;
  additions: number;
  deletions: number;
  /** Created since the last commit — discarding it deletes it. */
  isNew: boolean;
}

/** Live snapshot the commit panel renders (branch, stats, push state). */
export interface GitFlowStatus {
  branch: string;
  baseBranch: string | null;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  /** True when the repo has an `origin` remote. When false, push/PR can't work
   * and the panel offers "Publish repository" instead. */
  hasRemote: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  /**
   * The changed files with their own line counts, from the same snapshot the
   * totals come from. Paths and counts only: this status is refetched
   * throughout a run, and shipping the diff text with it would be paying for a
   * payload nothing on this screen renders.
   */
  files: ChangedFile[];
  /** True when the current branch is the repo's default — PR creation is
   * disabled here (you can't open a PR from the default branch to itself). */
  isDefaultBranch: boolean;
}

/** Preflight the Publish wizard reads to gate its Provider step + prefill. */
export interface PublishPreflight {
  /** The `gh` CLI is installed and authenticated (GitHub is publish-ready). */
  ghReady: boolean;
  /** Authenticated GitHub login, used as the default repo owner. */
  login: string | null;
  /** Sanitized default repository name (from the project/workspace). */
  suggestedName: string;
  /** The branch that will be published (current HEAD). */
  branch: string;
  /** True when an `origin` remote already exists (publish would be a no-op). */
  hasRemote: boolean;
  /** Human-readable reason GitHub isn't ready (e.g. gh not installed / not authed). */
  notReadyReason?: string;
}

export interface PublishResult {
  url: string;
  branch: string;
  owner: string;
  repo: string;
}

export interface CommitResult {
  hash: string;
  summary: string;
  pushed: boolean;
}

export interface PullResult {
  branch: string;
  /** Commits fast-forwarded in. 0 means the branch was already up to date. */
  received: number;
}

/** What to stage before committing. */
type StageMode = "all" | "none" | string[];

/**
 * Normalize a git remote URL so SSH and HTTPS variants match.
 * e.g. "git@github.com:user/repo.git" and "https://github.com/user/repo.git"
 * both become "github.com/user/repo".
 */
/**
 * Coerce an arbitrary project/workspace name into a valid GitHub repo name:
 * GitHub allows [A-Za-z0-9._-]; everything else (spaces included) becomes a
 * hyphen, with runs collapsed and edges trimmed.
 */
function sanitizeRepoName(name: string): string {
  return name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
}

function normalizeGitUrl(url: string): string {
  return url
    .replace(/^(https?:\/\/|git@|ssh:\/\/git@)/, "")
    .replace(/:(\d+\/)?/, "/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/** Pull insertion/deletion counts out of a git `--shortstat` string. */
function parseShortstat(shortstat: string): {
  additions: number;
  deletions: number;
} {
  return {
    additions: parseInt(shortstat.match(/(\d+) insertion/)?.[1] ?? "0", 10),
    deletions: parseInt(shortstat.match(/(\d+) deletion/)?.[1] ?? "0", 10),
  };
}

/** Strip code fences / surrounding quotes the model sometimes wraps output in. */
function cleanGenerated(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t
      .replace(/^```[a-zA-Z]*\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }
  return t;
}

export const gitFlowService = {
  // ───────────────────────────────────────────────────────────
  // Internal helpers
  // ───────────────────────────────────────────────────────────

  /** Resolve a workspace's on-disk root; throws when it has none. */
  async resolveRoot(
    workspaceId: string,
  ): Promise<{ rootPath: string; projectId: string | null }> {
    const workspace = await workspaceService.get(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (!workspace.rootPath) throw new Error("Workspace has no root path");
    return {
      rootPath: workspace.rootPath,
      projectId: workspace.projectId ?? null,
    };
  },

  /** Commit instructions, project-level first then app-level. */
  async getCommitInstructions(workspaceId: string): Promise<string | null> {
    const workspace = await workspaceService.get(workspaceId);
    if (workspace?.projectId) {
      const project = await projectsService.get(workspace.projectId);
      if (project?.commitInstructions) return project.commitInstructions;
    }
    const settings = await appSettingsService.getSettings();
    return settings?.commitInstructions || null;
  },

  /** PR instructions, project-level first then app-level. */
  async getPrInstructions(workspaceId: string): Promise<string | null> {
    const workspace = await workspaceService.get(workspaceId);
    if (workspace?.projectId) {
      const project = await projectsService.get(workspace.projectId);
      if (project?.prInstructions) return project.prInstructions;
    }
    const settings = await appSettingsService.getSettings();
    return settings?.prInstructions || null;
  },

  async stage(rootPath: string, mode: StageMode): Promise<void> {
    if (mode === "none") return;
    if (mode === "all") {
      await gitService.stageFiles(rootPath);
      return;
    }
    if (Array.isArray(mode) && mode.length > 0) {
      await gitService.stageFiles(rootPath, mode);
    }
  },

  /**
   * Throw if the workspace's `origin` remote has drifted from the project's
   * stored `remoteOrigin`. Must run BEFORE any push/PR so we never upload
   * commits to the wrong repository.
   */
  async assertRemoteMatches(
    workspaceId: string | null,
    rootPath: string,
  ): Promise<void> {
    if (!workspaceId) return;
    const workspace = await workspaceService.get(workspaceId);
    if (!workspace?.projectId) return;
    const project = await projectsService.get(workspace.projectId);
    if (!project?.remoteOrigin) return;
    const remotes = await gitService.getRemotes(rootPath).catch(() => null);
    if (!remotes) return;
    const origin = remotes.find((r) => r.name === "origin");
    const currentRemote = origin?.fetchUrl || origin?.pushUrl;
    if (
      currentRemote &&
      normalizeGitUrl(currentRemote) !== normalizeGitUrl(project.remoteOrigin)
    ) {
      throw new Error(
        `Remote origin mismatch. Expected "${project.remoteOrigin}" but found "${currentRemote}". Aborting to prevent using the wrong repository.`,
      );
    }
  },

  /**
   * The branch a PR should target: the workspace's explicit base branch first,
   * then the project's default branch.
   */
  async resolveBaseBranch(workspaceId: string | null): Promise<string | null> {
    if (!workspaceId) return null;
    const workspace = await workspaceService.get(workspaceId);
    if (!workspace) return null;
    if (workspace.baseBranch) return workspace.baseBranch;
    if (workspace.projectId) {
      const project = await projectsService.get(workspace.projectId);
      if (project?.defaultBranch) return project.defaultBranch;
    }
    return null;
  },

  // ───────────────────────────────────────────────────────────
  // Shared building blocks (also used by the MCP tools)
  // ───────────────────────────────────────────────────────────

  /**
   * Stage (per `stage`) + commit + recapture the post-commit diff so the
   * Changes tab reflects a clean tree, clear accepted findings, and log the
   * activity. Drives the git-actions panel's commit row.
   */
  async performCommit(params: {
    workspaceId: string | null;
    rootPath: string;
    runId: string | null;
    message: string;
    stage: StageMode;
  }): Promise<{ hash: string; summary: string }> {
    const { workspaceId, rootPath, runId, message } = params;

    await this.stage(rootPath, params.stage);
    const result = await gitService.commit(rootPath, message);

    // Recapture diff from the new HEAD so the Changes tab reflects the
    // post-commit state (clean working tree).
    const newHead = await gitService.getHeadSha(rootPath).catch(() => null);

    if (workspaceId && newHead) {
      await workspaceService.deleteDiffs(workspaceId);
      try {
        const snapshot = await gitService.captureDiffSnapshot(
          rootPath,
          newHead,
        );
        if (snapshot.files.length > 0) {
          await recordWorkspaceDiff(workspaceId, runId, snapshot);
        }
      } catch (err) {
        // Best-effort: the commit itself succeeded; the stale pre-commit diff
        // row is already gone, which is the important part.
        console.error("[GitFlow] Post-commit diff recapture failed:", err);
      }
    }

    if (runId && newHead) {
      runSessionRegistry.get(runId)?.updateBaseRef(newHead);
    }

    // Committed code is accepted — drop its review findings.
    if (workspaceId) {
      await workspaceService.deleteFindingsByWorkspace(workspaceId);
      emitFindingsChanged(workspaceId);
      logWorkspaceActivity({
        workspaceId,
        type: "commit",
        title: message.split("\n")[0],
        refId: newHead ?? undefined,
      });
    }

    return result;
  },

  /**
   * Verify the remote, run `gh pr create`, and log the activity. Drives the
   * git-actions panel's PR row. Throws on failure (callers wrap).
   */
  async performCreatePR(params: {
    workspaceId: string | null;
    rootPath: string;
    title: string;
    body?: string;
    base?: string;
    head?: string;
    draft?: boolean;
    labels?: string[];
  }): Promise<{ url: string; stdout: string; stderr?: string }> {
    const { workspaceId, rootPath } = params;

    // Never create a PR against a drifted remote.
    await this.assertRemoteMatches(workspaceId, rootPath);

    // Pass --head explicitly: in worktrees upstream tracking may be unset even
    // after push, so gh can't infer the head branch.
    const currentBranch =
      params.head ??
      (await gitService.getCurrentBranch(rootPath).catch(() => null));
    if (params.base && params.base === currentBranch) {
      throw new Error(
        `Cannot create a pull request from "${currentBranch}" to itself`,
      );
    }

    const ghArgs = ["pr", "create", "--title", params.title];
    if (currentBranch) ghArgs.push("--head", currentBranch);
    if (params.body) ghArgs.push("--body", params.body);
    if (params.base) ghArgs.push("--base", params.base);
    if (params.draft) ghArgs.push("--draft");
    for (const label of params.labels ?? []) ghArgs.push("--label", label);

    const { stdout, stderr } = await execFileAsync("gh", ghArgs, {
      cwd: rootPath,
      timeout: 30_000,
    });

    const output = stdout.trim();
    const prUrl = output.match(/https:\/\/github\.com\/[^\s]+/)?.[0];

    if (workspaceId) {
      logWorkspaceActivity({
        workspaceId,
        type: "pr",
        title: params.title,
        summary: params.body,
        refId: prUrl ?? undefined,
        metadata: {
          base: params.base,
          draft: params.draft,
          labels: params.labels,
        },
      });
    }

    return { url: prUrl ?? output, stdout: output, stderr: stderr?.trim() || undefined };
  },

  // ───────────────────────────────────────────────────────────
  // Headless generation (one-shot, no chat)
  // ───────────────────────────────────────────────────────────

  /**
   * Generate a commit message from the staged diff + commit instructions via a
   * single headless model call. Stages first (per `includeUnstaged`) unless a
   * `stagedDiff` is supplied by the caller.
   */
  async generateCommitMessage(params: {
    workspaceId: string;
    rootPath?: string;
    providerId: string;
    model?: string;
    includeUnstaged?: boolean;
    stagedDiff?: string;
    /**
     * Fill-the-form path (the Generate button in the commit form): summarize
     * what WOULD be committed without touching the index — staging as a read
     * side effect would surprise anyone watching `git status` in a terminal.
     */
    preview?: boolean;
  }): Promise<string> {
    let rootPath = params.rootPath;
    if (!rootPath) {
      ({ rootPath } = await this.resolveRoot(params.workspaceId));
    }

    let diff = params.stagedDiff;
    if (diff === undefined) {
      if (params.preview) {
        const staged = await gitService.getStagedDiff(rootPath).catch(() => "");
        const working =
          params.includeUnstaged === false
            ? ""
            : await gitService.getDiff(rootPath).catch(() => "");
        diff = [staged, working].filter(Boolean).join("\n");
      } else {
        await this.stage(
          rootPath,
          params.includeUnstaged === false ? "none" : "all",
        );
        diff = await gitService.getStagedDiff(rootPath);
      }
    }
    if (!diff.trim()) throw new Error("No staged changes to summarize");

    // Lazy: breaks the gitFlow ↔ providers/adapters (mains-tools) require cycle.
    const { providersService } = await import("../providers/providers.service");
    const provider = await providersService.getById(params.providerId);
    if (!provider) throw new Error("Provider not found");
    const { createWorkAdapter } = await import(
      "../providers/adapters/adapter.factory"
    );
    const adapter = createWorkAdapter(provider);
    if (!adapter.generateText) {
      throw new Error(
        `Provider "${provider.displayName}" does not support message generation`,
      );
    }

    const instructions = await this.getCommitInstructions(params.workspaceId);
    const system = [
      "You are a senior engineer writing a git commit message for a staged diff.",
      "Output ONLY the commit message — nothing else.",
      "Format: a concise summary line (imperative mood, <= 72 chars), then optionally a blank line and a short body.",
      "No surrounding quotes, no code fences, no preamble like 'Here is'.",
      instructions ? `\nProject commit instructions:\n${instructions}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const prompt = `Write a commit message for these staged changes:\n\n${truncateDiff(diff)}`;

    // No model fallback on purpose: left undefined, the driver picks its cheap
    // one-shot default (e.g. Haiku for Claude) — a commit message doesn't need
    // the chat model, and the big ones make the commit button hang for 10s+.
    const text = await adapter.generateText(prompt, {
      system,
      model: params.model,
    });
    const message = cleanGenerated(text);
    if (!message) throw new Error("Empty commit message generated");
    return message;
  },

  /**
   * Generate a PR title + body from the branch diff vs HEAD's base and the PR
   * instructions. First non-empty line becomes the title, the rest the body.
   */
  async generatePrBody(params: {
    workspaceId: string;
    providerId: string;
    model?: string;
    /**
     * The base the PR will target, when the form's picker has moved it off the
     * workspace default. The description has to describe the diff the PR will
     * actually contain, so the chosen base wins here too.
     */
    base?: string;
  }): Promise<{ title: string; body: string }> {
    const { rootPath } = await this.resolveRoot(params.workspaceId);

    // Prefer the branch diff vs its base — that's what the PR will actually
    // contain, and unlike the working-tree/staged diffs it's still populated
    // after the branch is committed and the tree is clean. Try the remote
    // base first (the PR target), then the local base. Fall back to the
    // working-tree + staged diff only when no base is known.
    const baseBranch =
      params.base?.trim() || (await this.resolveBaseBranch(params.workspaceId));
    let diff = "";
    let baseRef: string | null = null;
    if (baseBranch) {
      for (const ref of [`origin/${baseBranch}`, baseBranch]) {
        const r = await gitService
          .getBranchDiff(rootPath, ref)
          .catch(() => "");
        if (r.trim()) {
          diff = r;
          baseRef = ref;
          break;
        }
      }
    }
    if (!diff.trim()) {
      const staged = await gitService.getStagedDiff(rootPath).catch(() => "");
      const working = await gitService.getDiff(rootPath).catch(() => "");
      diff = [staged, working].filter(Boolean).join("\n");
    }

    // Lazy: breaks the gitFlow ↔ providers/adapters (mains-tools) require cycle.
    const { providersService } = await import("../providers/providers.service");
    const provider = await providersService.getById(params.providerId);
    if (!provider) throw new Error("Provider not found");
    const { createWorkAdapter } = await import(
      "../providers/adapters/adapter.factory"
    );
    const adapter = createWorkAdapter(provider);
    if (!adapter.generateText) {
      throw new Error(
        `Provider "${provider.displayName}" does not support generation`,
      );
    }

    const instructions = await this.getPrInstructions(params.workspaceId);
    const system = [
      "You write GitHub pull request descriptions.",
      "Output the PR title on the FIRST line, then a blank line, then the PR body in Markdown.",
      "No code fences around the whole thing, no 'Title:' prefix.",
      instructions ? `\nProject PR instructions:\n${instructions}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Prefer commits unique to this branch (base..HEAD) when the base is
    // known, so the summary isn't polluted by the base branch's own history;
    // fall back to recent repo commits only when there's no base ref.
    let commits = "";
    if (baseRef) {
      const messages = await gitService
        .getBranchLog(rootPath, baseRef, 20)
        .catch(() => [] as string[]);
      commits = messages.map((m) => `- ${m}`).join("\n");
    } else {
      const log = await gitService.getLog(rootPath, 20).catch(() => []);
      commits = log.map((c) => `- ${c.message}`).join("\n");
    }

    const prompt = [
      "Write a pull request title and body for this branch.",
      commits ? `\nRecent commits:\n${commits}` : "",
      diff ? `\nDiff:\n${truncateDiff(diff)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Same cheap-default reasoning as generateCommitMessage: no model → the
    // driver's fast one-shot default.
    const text = cleanGenerated(
      await adapter.generateText(prompt, {
        system,
        model: params.model,
      }),
    );

      const lines = text.split("\n");
      const titleIdx = lines.findIndex((l) => l.trim().length > 0);
      if (titleIdx === -1) throw new Error("Empty PR description generated");
    const title = lines[titleIdx].trim().replace(/^#+\s*/, "");
    const body = lines
      .slice(titleIdx + 1)
      .join("\n")
      .trim();
    return { title, body };
  },

  // ───────────────────────────────────────────────────────────
  // UI-facing deterministic operations
  // ───────────────────────────────────────────────────────────

  /** Live status for the commit panel header + button enablement. */
  async getStatus(workspaceId: string): Promise<GitFlowStatus> {
    const workspace = await workspaceService.get(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    if (!workspace.rootPath) throw new Error("Workspace has no root path");
    const rootPath = workspace.rootPath;

    const [branchName, status, headSha, remotes] = await Promise.all([
      gitService.getCurrentBranch(rootPath).catch(() => null),
      gitService.getStatus(rootPath).catch(() => null),
      gitService.getHeadSha(rootPath).catch(() => null),
      gitService.getRemotes(rootPath).catch(() => []),
    ]);

    if (!status) throw new Error("Failed to get git status");
    const hasRemote = remotes.some((r) => r.name === "origin");
    const branch = branchName ?? status.current ?? "";

    const baseBranch = await this.resolveBaseBranch(workspaceId);
    const isDefaultBranch = baseBranch
      ? branch === baseBranch
      : branch === "main" || branch === "master";

    // Use the exact same computation the sidebar / Changes tab rely on
    // (captureDiffSnapshot), anchored to the current HEAD like resyncDiff — so
    // the panel's +/- matches the workspace item. Crucially this counts every
    // line of each untracked file as an insertion, which a plain `git diff
    // HEAD` omits.
    let additions = 0;
    let deletions = 0;
    let changedFiles = 0;
    let files: ChangedFile[] = [];
    if (headSha) {
      const snapshot = await gitService
        .captureDiffSnapshot(rootPath, headSha)
        .catch(() => null);
      if (snapshot) {
        const perFile = parsePerFileDiffStats(snapshot.diffText);
        files = snapshot.files.map((path) => ({
          path,
          additions: perFile.get(path)?.additions ?? 0,
          deletions: perFile.get(path)?.deletions ?? 0,
          isNew: perFile.get(path)?.isNew ?? false,
        }));
        changedFiles = snapshot.files.length;
        const parsed = parseShortstat(snapshot.shortstat);
        additions = parsed.additions;
        deletions = parsed.deletions;
      }
    }

    return {
      branch,
      baseBranch,
      ahead: status.ahead,
      behind: status.behind,
      hasUpstream: !!status.tracking,
      hasRemote,
      additions,
      deletions,
      changedFiles,
      files,
      isDefaultBranch,
    };
  },

  /**
   * Stage + (optionally generate) + commit, optionally pushing afterwards.
   * The deterministic replacement for the chat-driven "Commit changes" goal.
   */
  async commit(params: {
    workspaceId: string;
    message?: string;
    includeUnstaged?: boolean;
    providerId?: string;
    model?: string;
    push?: boolean;
  }): Promise<CommitResult> {
    const { rootPath } = await this.resolveRoot(params.workspaceId);
    const branch = await gitService.getCurrentBranch(rootPath);
    if (!branch || branch === "HEAD") {
      throw new Error("Cannot commit while HEAD is detached");
    }

    const stageMode: StageMode =
      params.includeUnstaged === false ? "none" : "all";
    await this.stage(rootPath, stageMode);

    const staged = await gitService.getStagedDiff(rootPath);
    if (!staged.trim()) throw new Error("No staged changes to commit");

    let message = params.message?.trim() || "";
    if (!message) {
      if (!params.providerId) {
        throw new Error(
          "Provide a commit message or a provider to generate one",
        );
      }
      message = await this.generateCommitMessage({
        workspaceId: params.workspaceId,
        rootPath,
        providerId: params.providerId,
        model: params.model,
        stagedDiff: staged,
      });
    }

    const result = await this.performCommit({
      workspaceId: params.workspaceId,
      rootPath,
      runId: null,
      message,
      stage: "none", // already staged above
    });

    let pushed = false;
    if (params.push) {
      await gitService.push(rootPath, { branch });
      pushed = true;
      logWorkspaceActivity({
        workspaceId: params.workspaceId,
        type: "push",
        title: "You pushed changes",
        metadata: { branch },
      });
    }

    return { ...result, pushed };
  },

  /** Push the current branch (used by the standalone Push action). */
  async push(workspaceId: string): Promise<CommitResult> {
    const { rootPath } = await this.resolveRoot(workspaceId);
    const branch = await gitService.getCurrentBranch(rootPath);
    if (!branch || branch === "HEAD") {
      throw new Error("Cannot push while HEAD is detached");
    }
    await gitService.push(rootPath, { branch });
    logWorkspaceActivity({
      workspaceId,
      type: "push",
      title: "You pushed changes",
      metadata: { branch },
    });
    return { hash: "", summary: "Pushed", pushed: true };
  },

  /**
   * Fast-forward the current branch from its upstream (see
   * `gitService.pullFastForward` for why nothing else is on offer).
   *
   * When commits actually arrive, HEAD has moved and the recorded diff is
   * anchored to where it used to be — left alone, the Changes tab would show
   * every pulled commit as local work. `resyncDiff` re-anchors it to the new
   * HEAD, the same correction a commit makes.
   */
  async pull(workspaceId: string): Promise<PullResult> {
    const { rootPath } = await this.resolveRoot(workspaceId);
    const branch = await gitService.getCurrentBranch(rootPath);
    if (!branch || branch === "HEAD") {
      throw new Error("Cannot pull while HEAD is detached");
    }
    // Never pull from a remote the project doesn't recognize.
    await this.assertRemoteMatches(workspaceId, rootPath);

    const { received } = await gitService.pullFastForward(rootPath);
    if (received === 0) return { branch, received };

    try {
      await workspaceService.resyncDiff(workspaceId);
    } catch (err) {
      // Best-effort: the pull itself landed, which is the part that can't be
      // retried for free. A stale diff row is fixed by the next resync.
      console.error("[GitFlow] Post-pull diff resync failed:", err);
    }

    logWorkspaceActivity({
      workspaceId,
      type: "pull",
      title: `You pulled ${received} commit${received === 1 ? "" : "s"}`,
      metadata: { branch, commits: received },
    });

    return { branch, received };
  },

  // ───────────────────────────────────────────────────────────
  // Publish (create the GitHub repo for a repo with no remote)
  // ───────────────────────────────────────────────────────────

  /**
   * Preflight for the Publish wizard: is `gh` installed + authenticated, what's
   * the authed login (default owner), a sanitized default repo name, and the
   * branch we'd publish. Never throws — surfaces readiness via `ghReady`.
   */
  async getPublishPreflight(workspaceId: string): Promise<PublishPreflight> {
    const { rootPath, projectId } = await this.resolveRoot(workspaceId);

    const [branch, remotes] = await Promise.all([
      gitService.getCurrentBranch(rootPath).catch(() => "main"),
      gitService.getRemotes(rootPath).catch(() => []),
    ]);
    const hasRemote = remotes.some((r) => r.name === "origin");

    // Default repo name from the project, then the workspace, then the folder.
    let name = "";
    const workspace = await workspaceService.get(workspaceId);
    if (projectId) {
      const project = await projectsService.get(projectId);
      name = project?.name || "";
    }
    if (!name) name = workspace?.name || basename(rootPath);
    const suggestedName = sanitizeRepoName(name);

    // `gh api user` succeeds only when gh is installed AND authenticated.
    let ghReady = false;
    let login: string | null = null;
    let notReadyReason: string | undefined;
    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["api", "user", "--jq", ".login"],
        { timeout: 15_000 },
      );
      login = stdout.trim() || null;
      ghReady = !!login;
      if (!ghReady) notReadyReason = "Could not read your GitHub login.";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        notReadyReason =
          "The GitHub CLI (gh) isn't installed. Install it, then run `gh auth login`.";
      } else {
        notReadyReason =
          "You're not signed in to the GitHub CLI. Run `gh auth login` in your terminal.";
      }
    }

    return {
      ghReady,
      login,
      suggestedName,
      branch,
      hasRemote,
      notReadyReason,
    };
  },

  /**
   * Publish a local repo to GitHub: create the remote repo with `gh`, wire up
   * the `origin` remote using the chosen protocol, push the current branch, and
   * record the origin on the project so subsequent push/PR checks pass.
   */
  async publish(params: {
    workspaceId: string;
    /** "owner/name" — owner is a GitHub user or org the account can create in. */
    ownerRepo: string;
    visibility: "private" | "public";
    remoteName?: string;
    protocol: "ssh" | "https";
  }): Promise<PublishResult> {
    const { rootPath, projectId } = await this.resolveRoot(
      params.workspaceId,
    );
    const remoteName = params.remoteName?.trim() || "origin";

    const [owner, rawName] = params.ownerRepo.split("/").map((s) => s.trim());
    const name = sanitizeRepoName(rawName || "");
    if (!owner || !name) {
      throw new Error(
        "Enter a repository as owner/name (e.g. octocat/my-repo).",
      );
    }

    // Don't clobber an existing remote of the same name.
    const remotes = await gitService.getRemotes(rootPath).catch(() => []);
    if (remotes.some((r) => r.name === remoteName)) {
      throw new Error(`A remote named "${remoteName}" already exists.`);
    }

    // Create the empty repo on GitHub (no --source/--push: we wire the remote
    // ourselves so the SSH/HTTPS choice is honored).
    const ghArgs = [
      "repo",
      "create",
      `${owner}/${name}`,
      params.visibility === "private" ? "--private" : "--public",
    ];
    let htmlUrl = `https://github.com/${owner}/${name}`;
    try {
      const { stdout } = await execFileAsync("gh", ghArgs, {
        cwd: rootPath,
        timeout: 30_000,
      });
      htmlUrl = stdout.match(/https:\/\/github\.com\/[^\s]+/)?.[0] ?? htmlUrl;
    } catch (error) {
      const stderr = (error as any)?.stderr?.trim?.();
      throw new Error(stderr || "Failed to create the GitHub repository.");
    }

    // Wire the remote with the chosen protocol, then push + set upstream.
    const remoteUrl =
      params.protocol === "ssh"
        ? `git@github.com:${owner}/${name}.git`
        : `https://github.com/${owner}/${name}.git`;

    const branch = await gitService
      .getCurrentBranch(rootPath)
      .catch(() => "main");

    await gitService.addRemote(rootPath, remoteName, remoteUrl);
    await gitService.push(rootPath, {
      setUpstream: true,
      remote: remoteName,
      branch,
    });

    // Record the origin + default branch on the project so assertRemoteMatches
    // and future push/PR flows treat this as a normal remote-backed repo.
    if (projectId) {
      await projectsService.update(projectId, {
        remoteOrigin: htmlUrl,
        defaultBranch: branch,
      });
    }

    return { url: htmlUrl, branch, owner, repo: name };
  },

  /**
   * Push (idempotent) then create a PR with `gh`, generating title/body when
   * not supplied. Deterministic replacement for the "Create a PR" chat goal.
   */
  async createPr(params: {
    workspaceId: string;
    title?: string;
    body?: string;
    base?: string;
    draft?: boolean;
    providerId?: string;
    model?: string;
  }): Promise<{ url: string }> {
    try {
      const { rootPath } = await this.resolveRoot(params.workspaceId);

      let title = params.title?.trim() || "";
      let body = params.body ?? "";
      if (!title) {
        if (!params.providerId) {
          throw new Error("Provide a PR title or a provider to generate one");
        }
        const gen = await this.generatePrBody({
          workspaceId: params.workspaceId,
          providerId: params.providerId,
          model: params.model,
          // Same base the PR will target — otherwise the generated summary
          // describes a diff against a branch we aren't opening against.
          base: params.base,
        });
        title = gen.title;
        if (!body) body = gen.body;
      }

      // Verify the remote BEFORE pushing — otherwise a drifted origin would
      // upload commits to the wrong repo before performCreatePR's check aborts.
      await this.assertRemoteMatches(params.workspaceId, rootPath);
      const head = await gitService.getCurrentBranch(rootPath);
      if (!head || head === "HEAD") {
        throw new Error("Cannot create a pull request from a detached HEAD");
      }

      // Resolve the PR base: explicit > workspace base branch > project default.
      const base =
        params.base?.trim() ||
        (await this.resolveBaseBranch(params.workspaceId)) ||
        undefined;
      if (base === head) {
        throw new Error(`Cannot create a pull request from "${head}" to itself`);
      }

      // Branch must exist on the remote before `gh pr create`.
      await gitService.push(rootPath, { branch: head });

      const result = await this.performCreatePR({
        workspaceId: params.workspaceId,
        rootPath,
        title,
        body,
        base,
        head,
        draft: params.draft,
      });
      return { url: result.url };
    } catch (error) {
      // `gh` failures carry the useful message on stderr; surface it.
      const stderr = (error as any)?.stderr?.trim?.();
      if (stderr) throw new Error(stderr);
      throw error;
    }
  },
};
