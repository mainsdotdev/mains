import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("../workspace", () => ({
  workspaceService: {
    get: vi.fn(),
    deleteDiffs: vi.fn(),
    deleteFindingsByWorkspace: vi.fn(),
    resyncDiff: vi.fn(),
  },
  logWorkspaceActivity: vi.fn(),
  emitFindingsChanged: vi.fn(),
  recordWorkspaceDiff: vi.fn(),
}));

vi.mock("../git", () => ({
  gitService: {
    getCurrentBranch: vi.fn(),
    getRemotes: vi.fn(),
    stageFiles: vi.fn(),
    getStagedDiff: vi.fn(),
    getDiff: vi.fn(),
    getBranchDiff: vi.fn(),
    getBranchLog: vi.fn(),
    pullFastForward: vi.fn(),
    getLog: vi.fn(),
    commit: vi.fn(),
    getHeadSha: vi.fn(),
    push: vi.fn(),
  },
}));

const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
}));

vi.mock("../providers/providers.service", () => ({
  providersService: {
    getById: vi.fn().mockResolvedValue({
      id: "claude_code",
      displayName: "Claude",
      defaultModel: "some-big-chat-model",
    }),
  },
}));

vi.mock("../providers/adapters/adapter.factory", () => ({
  createWorkAdapter: vi.fn(() => ({ generateText: generateTextMock })),
}));

vi.mock("../projects", () => ({
  projectsService: {
    get: vi.fn(),
  },
}));

vi.mock("../appSettings", () => ({
  appSettingsService: {
    getSettings: vi.fn(),
  },
}));

vi.mock("../runs/run-session-registry", () => ({
  runSessionRegistry: {
    get: vi.fn(),
  },
}));

import { gitFlowService } from "./gitFlow.service";
import { gitService } from "../git";
import { workspaceService, logWorkspaceActivity } from "../workspace";

describe("gitFlowService — live branch invariants", () => {
  const gitMock = vi.mocked(gitService);
  const workspaceMock = vi.mocked(workspaceService);

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceMock.get.mockResolvedValue({
      id: "ws-1",
      accountId: "default",
      projectId: "project-1",
      name: "repo",
      rootPath: "/repo",
      repoUrl: "https://github.com/acme/repo.git",
      baseBranch: "main",
      metadata: null,
      status: "todo",
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    gitMock.getCurrentBranch.mockResolvedValue("feature/live");
    gitMock.getRemotes.mockResolvedValue([
      {
        name: "origin",
        fetchUrl: "https://github.com/acme/repo.git",
        pushUrl: "https://github.com/acme/repo.git",
      },
    ]);
    gitMock.push.mockResolvedValue({
      branch: "feature/live",
      remote: "origin",
    });
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (
          error: Error | null,
          result: { stdout: string; stderr: string },
        ) => void,
      ) =>
        callback(null, {
          stdout: "https://github.com/acme/repo/pull/1\n",
          stderr: "",
        }),
    );
  });

  it("commits and pushes the branch captured at action start", async () => {
    gitMock.getStagedDiff.mockResolvedValue("diff");
    gitMock.commit.mockResolvedValue({
      hash: "abc123",
      summary: "1 changed, 1 insertions, 0 deletions",
    });
    gitMock.getHeadSha.mockRejectedValue(new Error("skip snapshot"));

    await gitFlowService.commit({
      workspaceId: "ws-1",
      message: "test",
      push: true,
    });

    expect(gitMock.commit).toHaveBeenCalledWith("/repo", "test");
    expect(gitMock.push).toHaveBeenCalledWith("/repo", {
      branch: "feature/live",
    });
  });

  it("pushes and opens the PR with one consistent live head and explicit base", async () => {
    await gitFlowService.createPr({
      workspaceId: "ws-1",
      title: "Live branch PR",
      body: "Body",
    });

    expect(gitMock.push).toHaveBeenCalledWith("/repo", {
      branch: "feature/live",
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "gh",
      [
        "pr",
        "create",
        "--title",
        "Live branch PR",
        "--head",
        "feature/live",
        "--body",
        "Body",
        "--base",
        "main",
      ],
      {
        cwd: "/repo",
        timeout: 30_000,
      },
      expect.any(Function),
    );
  });

  it("targets the base the PR form picked instead of the workspace default", async () => {
    await gitFlowService.createPr({
      workspaceId: "ws-1",
      title: "Live branch PR",
      body: "Body",
      base: "release/2026-08",
    });

    expect(execFileMock).toHaveBeenCalledWith(
      "gh",
      [
        "pr",
        "create",
        "--title",
        "Live branch PR",
        "--head",
        "feature/live",
        "--body",
        "Body",
        "--base",
        "release/2026-08",
      ],
      {
        cwd: "/repo",
        timeout: 30_000,
      },
      expect.any(Function),
    );
  });

  it("rejects a PR whose live head equals its base before pushing", async () => {
    gitMock.getCurrentBranch.mockResolvedValue("main");

    await expect(
      gitFlowService.createPr({
        workspaceId: "ws-1",
        title: "Invalid PR",
      }),
    ).rejects.toThrow('Cannot create a pull request from "main" to itself');

    expect(gitMock.push).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  describe("pull", () => {
    const activityMock = vi.mocked(logWorkspaceActivity);
    const workspaceServiceMock = vi.mocked(workspaceService);

    it("re-anchors the diff and logs the pull when commits arrive", async () => {
      gitMock.pullFastForward.mockResolvedValue({
        received: 2,
        head: "sha-new",
      });

      const result = await gitFlowService.pull("ws-1");

      expect(result).toEqual({ branch: "feature/live", received: 2 });
      // HEAD moved: left alone, the recorded diff would show the pulled
      // commits as local work.
      expect(workspaceServiceMock.resyncDiff).toHaveBeenCalledWith("ws-1");
      expect(activityMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-1",
          type: "pull",
          title: "You pulled 2 commits",
        }),
      );
    });

    it("touches nothing when the branch was already up to date", async () => {
      gitMock.pullFastForward.mockResolvedValue({
        received: 0,
        head: "sha-same",
      });

      const result = await gitFlowService.pull("ws-1");

      expect(result).toEqual({ branch: "feature/live", received: 0 });
      expect(workspaceServiceMock.resyncDiff).not.toHaveBeenCalled();
      expect(activityMock).not.toHaveBeenCalled();
    });

    it("refuses to pull onto a detached HEAD", async () => {
      gitMock.getCurrentBranch.mockResolvedValue("HEAD");

      await expect(gitFlowService.pull("ws-1")).rejects.toThrow(
        "Cannot pull while HEAD is detached",
      );
      expect(gitMock.pullFastForward).not.toHaveBeenCalled();
    });

    // Same guard as push/PR: a drifted origin is the wrong repository, and
    // pulling from it would import someone else's history.
    it("aborts before pulling when the remote has drifted", async () => {
      workspaceMock.get.mockResolvedValue({
        id: "ws-1",
        accountId: "default",
        projectId: "proj-1",
        name: "repo",
        rootPath: "/repo",
        repoUrl: "https://github.com/acme/repo.git",
        baseBranch: "main",
        metadata: null,
        status: "todo",
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      const { projectsService } = await import("../projects");
      vi.mocked(projectsService.get).mockResolvedValue({
        id: "proj-1",
        remoteOrigin: "https://github.com/acme/other.git",
      } as any);

      await expect(gitFlowService.pull("ws-1")).rejects.toThrow(
        /Remote origin mismatch/,
      );
      expect(gitMock.pullFastForward).not.toHaveBeenCalled();
    });
  });

  describe("generateCommitMessage", () => {
    it("preview mode reads the diffs without staging and omits the model", async () => {
      gitMock.getStagedDiff.mockResolvedValue("staged-hunk");
      gitMock.getDiff.mockResolvedValue("working-hunk");
      generateTextMock.mockResolvedValue("feat: do the thing");

      const message = await gitFlowService.generateCommitMessage({
        workspaceId: "ws-1",
        providerId: "claude_code",
        preview: true,
      });

      expect(message).toBe("feat: do the thing");
      // Prefill must not mutate the index as a read side effect.
      expect(gitMock.stageFiles).not.toHaveBeenCalled();
      const [prompt, opts] = generateTextMock.mock.calls[0];
      expect(prompt).toContain("staged-hunk");
      expect(prompt).toContain("working-hunk");
      // No model → the driver's cheap one-shot default, not the chat model.
      expect(opts.model).toBeUndefined();
    });

    it("non-preview mode stages before reading the staged diff", async () => {
      gitMock.getStagedDiff.mockResolvedValue("staged-hunk");
      generateTextMock.mockResolvedValue("fix: stage first");

      await gitFlowService.generateCommitMessage({
        workspaceId: "ws-1",
        providerId: "claude_code",
      });

      expect(gitMock.stageFiles).toHaveBeenCalledWith("/repo");
      expect(gitMock.getDiff).not.toHaveBeenCalled();
    });
  });

  describe("generatePrBody", () => {
    it("summarizes the diff against the picked base, not the workspace's", async () => {
      gitMock.getBranchDiff.mockImplementation(async (_root, ref) =>
        ref === "origin/release/2026-08" ? "release-diff" : "",
      );
      gitMock.getBranchLog.mockResolvedValue(["feat: the thing"]);
      generateTextMock.mockResolvedValue("PR title\n\nPR body");

      const result = await gitFlowService.generatePrBody({
        workspaceId: "ws-1",
        providerId: "claude_code",
        base: "release/2026-08",
      });

      expect(result).toEqual({ title: "PR title", body: "PR body" });
      // The workspace's own base ("main") is never consulted once the form
      // picked one — otherwise the summary describes a different changeset
      // than the PR contains.
      expect(gitMock.getBranchDiff).toHaveBeenCalledWith(
        "/repo",
        "origin/release/2026-08",
      );
      expect(gitMock.getBranchDiff).not.toHaveBeenCalledWith(
        "/repo",
        "origin/main",
      );
      expect(generateTextMock.mock.calls[0][0]).toContain("release-diff");
    });

    it("falls back to the workspace base branch when none is picked", async () => {
      gitMock.getBranchDiff.mockImplementation(async (_root, ref) =>
        ref === "origin/main" ? "main-diff" : "",
      );
      gitMock.getBranchLog.mockResolvedValue([]);
      generateTextMock.mockResolvedValue("PR title\n\nPR body");

      await gitFlowService.generatePrBody({
        workspaceId: "ws-1",
        providerId: "claude_code",
      });

      expect(gitMock.getBranchDiff).toHaveBeenCalledWith("/repo", "origin/main");
    });
  });
});
