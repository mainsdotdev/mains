import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { invokeHandler } from "../../ipc-kit/handler-registry";
import { registerRunsIpc, unregisterRunsIpc } from "./runs.ipc";

const service = vi.hoisted(() => ({ archiveRun: vi.fn(), deleteRun: vi.fn(), moveRunToCollection: vi.fn(),
  getAllRuns: vi.fn(), getRunById: vi.fn(), listActiveRuns: vi.fn(), listPinnedChats: vi.fn(), setRunPinned: vi.fn(),
  renameMobileConversation: vi.fn() }));
vi.mock("./runs.service", () => ({ runsService: service }));
vi.mock("./user-decision-runtime", () => ({ openUserDecisions: vi.fn() }));
vi.mock("./user-input-broker", () => ({ handleToolApprovalResponse: vi.fn(), listPendingApprovals: vi.fn() }));

describe("paired chat metadata and actions at the real IPC seam", () => {
  beforeEach(() => registerRunsIpc());
  afterEach(() => { unregisterRunsIpc(); vi.resetAllMocks(); });
  const run = { id: "chat", accountId: "account", mode: "work", title: "Chat", isArchived: false, collectionId: "project",
    goal: "private prompt", systemPrompt: "private policy", toolPolicySnapshot: { secret: "private" },
    configSnapshot: { credential: "private", effortLevel: "high" } };

  it.each([CHANNELS.runs.getAll, CHANNELS.runs.getById, CHANNELS.runs.listActive, CHANNELS.runs.listPinned])(
    "uses the desktop fallback label in phone metadata from %s", async (channel) => {
      const row = { ...run, title: null, goal: "\n Hey, naber \nprivate prompt body" };
      const single = channel === CHANNELS.runs.getById;
      const reads = {
        [CHANNELS.runs.getById]: service.getRunById,
        [CHANNELS.runs.getAll]: service.getAllRuns,
        [CHANNELS.runs.listActive]: service.listActiveRuns,
        [CHANNELS.runs.listPinned]: service.listPinnedChats,
      };
      const read = reads[channel];
      read.mockResolvedValue(single ? row : [row]);
      const args = single ? ["chat"] : channel === CHANNELS.runs.getAll ? [100] : [];
      const phone = await invokeHandler(channel, args, { deviceId: "phone" });
      const expected = { ...row, title: "Hey, naber", goal: null, systemPrompt: null, toolPolicySnapshot: null,
        configSnapshot: { effortLevel: "high" } };
      expect(phone).toEqual({ success: true, data: single ? expected : [expected] });
      const desktop = await invokeHandler(channel, args, {});
      expect(desktop).toEqual({ success: true, data: single ? row : [channel === CHANNELS.runs.listPinned ? expected : row] });
      expect(JSON.stringify(phone)).not.toContain("private");
    },
  );

  it("renames and pins through receipt-enabled channels with a bounded phone projection", async () => {
    const device = { deviceId: "phone" };
    const title = { runId: "chat", title: "New name" };
    const pin = { runId: "chat", accountId: "account", pinned: true };
    const pinnedAt = new Date();
    service.renameMobileConversation.mockResolvedValue({ ...run, title: title.title });
    service.setRunPinned.mockResolvedValue({ ...run, pinnedAt });
    const renamed = await invokeHandler(CHANNELS.runs.rename, [title], device);
    const pinned = await invokeHandler(CHANNELS.runs.setPinned, [pin], device);
    expect(service.renameMobileConversation).toHaveBeenCalledWith(title);
    expect(service.setRunPinned).toHaveBeenCalledWith(pin, true);
    expect(renamed).toMatchObject({ success: true, data: { title: "New name", goal: null } });
    expect(pinned).toMatchObject({ success: true, data: { pinnedAt, goal: null } });
  });

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
