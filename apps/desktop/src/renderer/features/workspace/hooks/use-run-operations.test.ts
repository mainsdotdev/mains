// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: "developer" as "developer" | "work" | "chat",
  dispatch: vi.fn(),
  execute: vi.fn(),
  createRealtimeConversation: vi.fn(),
  getAccount: vi.fn(),
}));

vi.mock("@/lib/transport", () => ({
  appApi: {
    account: { get: mocks.getAccount },
    runs: {
      execute: mocks.execute,
      createRealtimeConversation: mocks.createRealtimeConversation,
      canResume: vi.fn(),
    },
  },
}));

vi.mock("@/components/ui", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: () => mocks.dispatch,
}));

vi.mock("@/lib/redux/api", () => ({
  workspaceApi: {
    util: { invalidateTags: vi.fn() },
  },
}));

vi.mock("@/hooks/use-active-space", () => ({
  useActiveSpace: () => ({
    activeSpaceId: "space-1",
    activeSpace: { id: "space-1", mode: mocks.mode },
  }),
}));

import { useRunOperations } from "./use-run-operations";

beforeEach(() => {
  mocks.mode = "developer";
  mocks.dispatch.mockReset();
  mocks.execute.mockReset();
  mocks.createRealtimeConversation.mockReset();
  mocks.createRealtimeConversation.mockResolvedValue({ success: true, data: { runId: "voice-run" } });
  mocks.execute.mockResolvedValue({
    success: true,
    data: { runId: "run-1" },
  });
  mocks.getAccount.mockReset();
  mocks.getAccount.mockResolvedValue({
    success: true,
    data: { id: "account-1" },
  });
});

function renderOperations() {
  return renderHook(() =>
    useRunOperations({
      registerNewRun: async (runId) => runId,
      loadRunDetails: vi.fn(),
      onRunUpdated: vi.fn(),
    }),
  );
}

describe("useRunOperations collection payload", () => {
  it("reports failed voice preparation without starting a text run and allows a retry", async () => {
    mocks.createRealtimeConversation.mockResolvedValueOnce({ success: false, error: "Codex is not enabled" });
    const { result } = renderOperations();
    await act(async () => { expect(await result.current.createVoiceConversation("workspace-1")).toBeNull(); });
    expect(result.current.error).toBe("Codex is not enabled");
    expect(result.current.isLoading).toBe(false);
    await act(async () => { expect(await result.current.createVoiceConversation("workspace-1")).toBe("voice-run"); });
    expect(result.current.error).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("creates an empty voice conversation with draft settings without executing a prompt", async () => {
    const { result } = renderOperations();
    const settings = { model: "selected-model", config: { modelReasoningEffort: "ultra" } };
    let runId: string | null = null;
    await act(async () => {
      runId = await result.current.createVoiceConversation("workspace-1", "stale-collection", ["/tmp"], settings);
    });
    expect(runId).toBe("voice-run");
    expect(mocks.createRealtimeConversation).toHaveBeenCalledWith({
      accountId: "account-1", spaceId: "space-1", workspaceId: "workspace-1", collectionId: undefined,
      additionalDirectories: ["/tmp"], conversationSettings: settings,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("keeps collection membership and omits a stale workspace for fresh Work voice", async () => {
    mocks.mode = "work";
    const { result } = renderOperations();
    await act(async () => {
      await result.current.createVoiceConversation("stale-workspace", "collection-1");
    });
    expect(mocks.createRealtimeConversation).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: undefined, collectionId: "collection-1", spaceId: "space-1",
    }));
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("omits a stale Work/Chat collection when starting a Developer run", async () => {
    const { result } = renderOperations();

    await act(async () => {
      await result.current.executeRun(
        "Fix the bug",
        "/tmp/workspace",
        "claude_code",
        undefined,
        undefined,
        undefined,
        "collection-from-work-mode",
      );
    });

    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionId: undefined,
        spaceId: "space-1",
        workspaceId: "/tmp/workspace",
      }),
    );
    expect(mocks.execute.mock.calls[0][0]).not.toHaveProperty("additionalDirectories");
  });

  it("keeps collection membership for a Work run", async () => {
    mocks.mode = "work";
    const { result } = renderOperations();

    await act(async () => {
      await result.current.executeRun(
        "Write a report",
        undefined,
        "claude_code",
        undefined,
        undefined,
        undefined,
        "collection-1",
      );
    });

    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: "collection-1" }),
    );
  });
});
