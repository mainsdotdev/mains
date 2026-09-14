// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: "developer" as "developer" | "work" | "chat",
  dispatch: vi.fn(),
  execute: vi.fn(),
  getAccount: vi.fn(),
}));

vi.mock("@/lib/transport", () => ({
  appApi: {
    account: { get: mocks.getAccount },
    runs: {
      execute: mocks.execute,
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
