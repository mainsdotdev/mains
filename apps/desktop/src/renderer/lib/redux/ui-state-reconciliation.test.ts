import { describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { runOwnerKey } from "../../../shared/ui-state-keys";
import type { AppDispatch, RootState } from "./index";
import type { Transport } from "../transport";

const harness = vi.hoisted(() => ({ transport: null as Transport | null }));
vi.mock("../transport", () => ({ getTransport: () => harness.transport }));

import { collectUiContextCandidates, reconcilePersistedUiState } from "./ui-state-reconciliation";

const localView = JSON.stringify(["local", "space", "codex", "developer", "ws-a"]);
const remoteView = JSON.stringify(["remote-1", "space", "codex", "developer", "ws-b"]);

function savedState(): RootState {
  return {
    backends: { activeBackendId: null },
    workspace: {
      draftTextByKey: { [runOwnerKey("local", "run-a")]: "text" },
      contextItemsByKey: {},
      composerContextKey: "default",
      workspaceViews: {
        [localView]: { activeTab: "run-b", previousNonEditorTab: null },
        [remoteView]: { activeTab: "remote-run", previousNonEditorTab: null },
      },
      workspaceViewKey: null,
      activeTab: "editor",
      previousNonEditorTab: null,
    },
    appSettings: {
      rightPaneByContext: {},
      documentViewerDocByContext: {},
      activeRightPaneContextKey: "default",
    },
  } as unknown as RootState;
}

describe("persisted UI reconciliation", () => {
  it("checks only saved IDs for the connected backend", () => {
    const candidates = collectUiContextCandidates(
      savedState(),
      "local",
      [runOwnerKey("local", "browser-only"), runOwnerKey("remote-1", "remote-only")],
    );
    expect(candidates).toEqual([
      { backendId: "local", kind: "run", id: "run-a" },
      { backendId: "local", kind: "run", id: "browser-only" },
      { backendId: "local", kind: "run", id: "run-b" },
      { backendId: "local", kind: "workspace", id: "ws-a" },
    ]);
  });

  it("forgets a missing run only after a successful get-by-ID response", async () => {
    const invoke = vi.fn(async (channel: string, args?: unknown[]) => {
      if (channel === CHANNELS.runs.getById && args?.[0] === "run-a") {
        return { success: true as const, data: null };
      }
      if (channel === CHANNELS.runs.getById && args?.[0] === "run-b") {
        return { success: false as const, error: "offline" };
      }
      return { success: true as const, data: { id: args?.[0] } };
    });
    const transport = { invoke, status: () => "connected" } as unknown as Transport;
    harness.transport = transport;
    const dispatch = vi.fn() as unknown as AppDispatch;
    const state = savedState();

    await reconcilePersistedUiState(dispatch, () => state, transport, "local");

    expect(invoke).toHaveBeenCalledWith(CHANNELS.runs.getById, ["run-a"]);
    expect(invoke).toHaveBeenCalledWith(CHANNELS.runs.getById, ["run-b"]);
    expect(invoke).toHaveBeenCalledWith(CHANNELS.workspace.get, ["ws-a"]);
    expect(vi.mocked(dispatch).mock.calls.map(([action]) => action.type)).toEqual([
      "workspace/forgetRunUiState",
      "appSettings/forgetRunRightPane",
    ]);
  });
});
