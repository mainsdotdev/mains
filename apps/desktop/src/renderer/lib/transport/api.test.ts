import { afterEach, describe, expect, it, vi } from "vitest";
import { appApi } from "./api";
import { resetTransport, setTransport } from "./registry";
import type { Transport } from "./types";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

function fakeTransport(): Transport {
  return {
    kind: "fake",
    invoke: vi.fn(async () => ({ success: true as const, data: null })),
    subscribe: vi.fn(() => () => {}),
    status: () => "connected",
    onStatusChange: () => () => {},
  };
}

describe("appApi", () => {
  afterEach(() => {
    resetTransport();
  });

  it("forwards method calls to the active transport with channel + args", async () => {
    const t = fakeTransport();
    setTransport(t);

    await appApi.runs.getById("r1");
    await appApi.fileExplorer.readFileText({ filePath: "/a/b.txt" });
    await appApi.terminal.create({ id: "t1", cwd: "/x" });

    expect(t.invoke).toHaveBeenCalledWith(CHANNELS.runs.getById, ["r1"]);
    expect(t.invoke).toHaveBeenCalledWith(CHANNELS.fileExplorer.readFileText, [
      { filePath: "/a/b.txt" },
    ]);
    expect(t.invoke).toHaveBeenCalledWith(CHANNELS.terminal.create, [
      { id: "t1", cwd: "/x" },
    ]);
  });

  it("maps the two non-obvious channels correctly", async () => {
    const t = fakeTransport();
    setTransport(t);

    await appApi.runs.getToolCalls("r1");
    await appApi.runs.respondToolApproval({ requestId: "q1", approved: true });

    // getToolCalls lives on the runToolCalls namespace, not runs.getToolCalls
    expect(t.invoke).toHaveBeenCalledWith(CHANNELS.runToolCalls.getByRun, ["r1"]);
    // respondToolApproval maps to the toolApprovalResponse channel
    expect(t.invoke).toHaveBeenCalledWith(CHANNELS.runs.toolApprovalResponse, [
      { requestId: "q1", approved: true },
    ]);
  });
});
