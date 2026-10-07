import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { prAttachmentStorage } from "./pr-attachment-storage";
import { prAttachmentUrl } from "@mains/contracts/pr-attachments";

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
    getCommitPreviewDiff: vi.fn(),
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
      sortOrder: 0,
      pinnedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    gitMock.getCurrentBranch.mockResolvedValue("feature/live");
    gitMock.getCommitPreviewDiff.mockResolvedValue("");
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
          stdout: _args.includes("--help") ? "--attach file" : "https://github.com/acme/repo/pull/1\n",
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
        "--base",
        "main",
        "--body-file",
        expect.stringMatching(/mains-pr-body-.*\/body\.md$/),
      ],
      {
        cwd: "/repo",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
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
        "--base",
        "release/2026-08",
        "--body-file",
        expect.stringMatching(/mains-pr-body-.*\/body\.md$/),
      ],
      {
        cwd: "/repo",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
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

  describe("PR media", () => {
    const stage = () => prAttachmentStorage.write({ workspaceId: "ws-1", name: "demo.png", size: 3, offset: 0, data: "YWJj" });

    it("keeps comparison positions and points every reference at the actual staged file", async () => {
      const { uploadId } = await prAttachmentStorage.write({ workspaceId: "ws-1", name: "before (1) | final.png", size: 3, offset: 0, data: "YWJj" });
      const body = `| Before | After |\n| --- | --- |\n| ![Before](${prAttachmentUrl(uploadId)}) | [Again](<${prAttachmentUrl(uploadId)}>) |`;
      let stagedPath = "";
      execFileMock.mockImplementation((_command, args: string[], _options, callback) => {
        if (args.includes("--help")) { callback(null, { stdout: "--attach", stderr: "" }); return; }
        stagedPath = args[args.indexOf("--attach") + 1];
        const sentBody = readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
        const destination = sentBody.match(/!\[Before\]\(([^)]+)\)/)![1];
        expect(decodeURI(destination)).toBe(stagedPath);
        expect(destination).not.toMatch(/[ |()]/);
        expect(sentBody).toBe(body.split(prAttachmentUrl(uploadId)).join(destination));
        callback(null, { stdout: "https://github.com/acme/repo/pull/1", stderr: "" });
      });
      await gitFlowService.createPr({ workspaceId: "ws-1", title: "Compare", body, attachmentIds: [uploadId] });
      expect(existsSync(stagedPath)).toBe(false);
    });

    it("rejects missing or foreign references before pushing", async () => {
      await expect(gitFlowService.createPr({ workspaceId: "ws-1", title: "Compare", body: `![Missing](${prAttachmentUrl("missing")})` })).rejects.toThrow("missing");
      expect(gitMock.push).not.toHaveBeenCalled();
    });

    it("rejects local HTML media references that gh cannot rewrite", async () => {
      const { uploadId } = await stage();
      await expect(gitFlowService.createPr({ workspaceId: "ws-1", title: "Compare", body: `<img src="${prAttachmentUrl(uploadId)}" />`, attachmentIds: [uploadId] })).rejects.toThrow("Use Markdown");
      expect(gitMock.push).not.toHaveBeenCalled();
      expect(() => prAttachmentStorage.claim("ws-1", [uploadId])).toThrow("unavailable");
    });

    it("passes attachments and the full Markdown body as files, then removes both", async () => {
      const { uploadId } = await stage();
      let bodyPath = ""; let mediaPath = ""; let body = "";
      execFileMock.mockImplementation((_command, args: string[], _options, callback) => {
        if (args.includes("--help")) { callback(null, { stdout: "--attach", stderr: "" }); return; }
        bodyPath = args[args.indexOf("--body-file") + 1];
        mediaPath = args[args.indexOf("--attach") + 1];
        body = readFileSync(bodyPath, "utf8");
        expect(readFileSync(mediaPath, "utf8")).toBe("abc");
        callback(null, { stdout: "https://github.com/acme/repo/pull/1", stderr: "" });
      });
      await expect(gitFlowService.createPr({ workspaceId: "ws-1", title: "Media", body: "## Summary\n- [x] Done", attachmentIds: [uploadId] })).resolves.toEqual({ url: "https://github.com/acme/repo/pull/1" });
      expect(body).toBe("## Summary\n- [x] Done");
      expect(existsSync(bodyPath)).toBe(false);
      expect(existsSync(mediaPath)).toBe(false);
    });

    it("rejects an older CLI before pushing and releases the attachment", async () => {
      const { uploadId } = await stage();
      execFileMock.mockImplementation((_command, _args, _options, callback) => callback(null, { stdout: "no media option", stderr: "" }));
      await expect(gitFlowService.createPr({ workspaceId: "ws-1", title: "Media", attachmentIds: [uploadId] })).rejects.toThrow("2.99");
      expect(gitMock.push).not.toHaveBeenCalled();
      expect(() => prAttachmentStorage.claim("ws-1", [uploadId])).toThrow("unavailable");
    });

    it("returns the created PR with a warning when gh exits nonzero after a partial upload", async () => {
      const { uploadId } = await stage();
      execFileMock.mockImplementation((_command, args: string[], _options, callback) => {
        if (args.includes("--help")) callback(null, { stdout: "--attach", stderr: "" });
        else callback(Object.assign(new Error("exit 1"), { stdout: "https://github.com/acme/repo/pull/7\n", stderr: "One video could not be uploaded." }));
      });
      await expect(gitFlowService.createPr({ workspaceId: "ws-1", title: "Media", attachmentIds: [uploadId] })).resolves.toEqual({ url: "https://github.com/acme/repo/pull/7", warning: "One video could not be uploaded." });
      expect(logWorkspaceActivity).toHaveBeenCalledWith(expect.objectContaining({ type: "pr", refId: "https://github.com/acme/repo/pull/7" }));
    });

    it("keeps a failure without a created URL as an error", async () => {
      const { uploadId } = await stage();
      execFileMock.mockImplementation((_command, args: string[], _options, callback) => {
        if (args.includes("--help")) callback(null, { stdout: "--attach", stderr: "" });
        else callback(Object.assign(new Error("exit 1"), { stdout: "", stderr: "Authentication failed." }));
      });
      await expect(gitFlowService.createPr({ workspaceId: "ws-1", title: "Media", attachmentIds: [uploadId] })).rejects.toThrow("Authentication failed");
      expect(logWorkspaceActivity).not.toHaveBeenCalled();
    });
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
    it("preview mode includes the full commit preview without staging and omits the model", async () => {
      gitMock.getCommitPreviewDiff.mockResolvedValue("tracked-hunk\nnew-file-hunk");
      generateTextMock.mockResolvedValue("feat: do the thing");

      const message = await gitFlowService.generateCommitMessage({
        workspaceId: "ws-1",
        providerId: "claude_code",
        preview: true,
      });

      expect(message).toBe("feat: do the thing");
      // Prefill must not mutate the index as a read side effect.
      expect(gitMock.stageFiles).not.toHaveBeenCalled();
      expect(gitMock.getCommitPreviewDiff).toHaveBeenCalledWith("/repo", true);
      const [prompt, opts] = generateTextMock.mock.calls[0];
      expect(prompt).toContain("tracked-hunk");
      expect(prompt).toContain("new-file-hunk");
      // No model → the driver's cheap one-shot default, not the chat model.
      expect(opts.model).toBeUndefined();
    });

    it("respects the staged-only choice when generating a preview", async () => {
      gitMock.getCommitPreviewDiff.mockResolvedValue("staged-only-hunk");
      generateTextMock.mockResolvedValue("fix: staged changes");

      await gitFlowService.generateCommitMessage({
        workspaceId: "ws-1",
        providerId: "claude_code",
        includeUnstaged: false,
        preview: true,
      });

      expect(gitMock.getCommitPreviewDiff).toHaveBeenCalledWith("/repo", false);
      expect(generateTextMock.mock.calls[0][0]).toContain("staged-only-hunk");
      expect(gitMock.stageFiles).not.toHaveBeenCalled();
    });

    it("surfaces a failed preview rather than generating from partial changes", async () => {
      gitMock.getCommitPreviewDiff.mockRejectedValue(new Error("Cannot read repository"));

      await expect(gitFlowService.generateCommitMessage({
        workspaceId: "ws-1",
        providerId: "claude_code",
        preview: true,
      })).rejects.toThrow("Cannot read repository");

      expect(generateTextMock).not.toHaveBeenCalled();
      expect(gitMock.stageFiles).not.toHaveBeenCalled();
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

    it("includes all branch commit subjects, including those beyond the old 20-commit cutoff", async () => {
      gitMock.getBranchDiff.mockResolvedValue("branch-diff");
      const subjects = Array.from({ length: 35 }, (_, i) => `change ${i + 1}`);
      gitMock.getBranchLog.mockResolvedValue(subjects);
      generateTextMock.mockResolvedValue("PR title\n\nPR body");

      await gitFlowService.generatePrBody({ workspaceId: "ws-1", providerId: "claude_code" });

      expect(gitMock.getBranchLog).toHaveBeenCalledWith("/repo", "origin/main");
      const prompt = generateTextMock.mock.calls[0][0];
      for (const subject of subjects) expect(prompt).toContain(`- ${subject}\n`);
      expect(gitMock.getLog).not.toHaveBeenCalled();
    });

    it("uses the complete working-tree preview without unrelated commit history when no base can be read", async () => {
      gitMock.getBranchDiff.mockRejectedValue(new Error("Unknown base"));
      gitMock.getCommitPreviewDiff.mockResolvedValue("new-file-hunk");
      generateTextMock.mockResolvedValue("PR title\n\nPR body");

      await gitFlowService.generatePrBody({ workspaceId: "ws-1", providerId: "claude_code" });

      expect(generateTextMock.mock.calls[0][0]).toContain("new-file-hunk");
      expect(gitMock.getLog).not.toHaveBeenCalled();
      expect(gitMock.getBranchLog).not.toHaveBeenCalled();
      expect(gitMock.stageFiles).not.toHaveBeenCalled();
    });

    it("retains branch commit history even when the commits produce an empty net diff", async () => {
      gitMock.getBranchDiff.mockResolvedValue("");
      gitMock.getBranchLog.mockResolvedValue(["Revert feature", "Add feature"]);
      generateTextMock.mockResolvedValue("PR title\n\nPR body");

      await gitFlowService.generatePrBody({ workspaceId: "ws-1", providerId: "claude_code" });

      expect(gitMock.getBranchLog).toHaveBeenCalledWith("/repo", "origin/main");
      expect(generateTextMock.mock.calls[0][0]).toContain("- Add feature");
      expect(gitMock.getBranchDiff).not.toHaveBeenCalledWith("/repo", "main");
    });

    it("surfaces a branch-log failure rather than silently omitting commits", async () => {
      gitMock.getBranchDiff.mockResolvedValue("branch-diff");
      gitMock.getBranchLog.mockRejectedValue(new Error("Cannot read branch history"));

      await expect(gitFlowService.generatePrBody({
        workspaceId: "ws-1", providerId: "claude_code",
      })).rejects.toThrow("Cannot read branch history");
      expect(generateTextMock).not.toHaveBeenCalled();
    });
  });
});
