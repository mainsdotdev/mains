import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { invokeHandler } from "../../ipc-kit/handler-registry";
import { registerRunsIpc, unregisterRunsIpc } from "./runs.ipc";

const service = vi.hoisted(() => ({ archiveRun: vi.fn(), deleteRun: vi.fn(), moveRunToCollection: vi.fn() }));
vi.mock("./runs.service", () => ({ runsService: service }));
vi.mock("./user-decision-runtime", () => ({ openUserDecisions: vi.fn() }));
vi.mock("./user-input-broker", () => ({ handleToolApprovalResponse: vi.fn(), listPendingApprovals: vi.fn() }));

describe("paired chat actions at the real IPC seam", () => {
  beforeEach(() => registerRunsIpc());
  afterEach(() => { unregisterRunsIpc(); vi.resetAllMocks(); });
  const run = { id: "chat", accountId: "account", mode: "work", isArchived: false, collectionId: "project",
    goal: "private prompt", systemPrompt: "private policy", toolPolicySnapshot: { secret: "private" },
    configSnapshot: { credential: "private", effortLevel: "high" } };

  it("moves through the existing payload and projects only phone metadata", async () => {
    service.moveRunToCollection.mockResolvedValue(run);
    const payload = { runId: "chat", accountId: "account", collectionId: "project" };
    const result = await invokeHandler(CHANNELS.runs.moveToCollection, [payload], { deviceId: "phone" });
    expect(service.moveRunToCollection).toHaveBeenCalledExactlyOnceWith(payload);
    expect(result).toMatchObject({ success: true, data: { id: "chat", collectionId: "project", goal: null, systemPrompt: null, toolPolicySnapshot: null, configSnapshot: { effortLevel: "high" } } });
    expect(JSON.stringify(result)).not.toContain("private");
    const desktop = await invokeHandler(CHANNELS.runs.moveToCollection, [payload], {});
    expect(desktop).toMatchObject({ success: true, data: run });
  });

  it("archives by the existing identity without returning execution policies to a phone", async () => {
    service.archiveRun.mockResolvedValue({ ...run, isArchived: true });
    const result = await invokeHandler(CHANNELS.runs.archive, ["chat"], { deviceId: "phone" });
    expect(service.archiveRun).toHaveBeenCalledExactlyOnceWith("chat");
    expect(result).toMatchObject({ success: true, data: { id: "chat", isArchived: true, goal: null } });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("keeps the desktop deletion acknowledgement and forwards a definite refusal", async () => {
    service.deleteRun.mockResolvedValue(undefined);
    expect(await invokeHandler(CHANNELS.runs.delete, ["chat"], { deviceId: "phone" })).toEqual({ success: true, data: undefined });
    expect(service.deleteRun).toHaveBeenCalledExactlyOnceWith("chat");
    service.deleteRun.mockRejectedValueOnce(new Error("Stop active responses first"));
    expect(await invokeHandler(CHANNELS.runs.delete, ["chat"], { deviceId: "phone" })).toEqual({ success: false, error: "Stop active responses first" });
  });
});
