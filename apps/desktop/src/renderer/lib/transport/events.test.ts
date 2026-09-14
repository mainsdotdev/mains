import { afterEach, describe, expect, it, vi } from "vitest";
import { appEvents } from "./events";
import { resetTransport, setTransport } from "./registry";
import type { Transport } from "./types";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

function fakeTransport(): Transport {
  return {
    kind: "fake",
    invoke: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    status: () => "connected",
    onStatusChange: () => () => {},
  };
}

describe("appEvents", () => {
  afterEach(() => {
    resetTransport();
  });

  it("maps each backend event to its channel via the active transport", () => {
    const t = fakeTransport();
    setTransport(t);
    const cb = vi.fn();

    const offs = [
      appEvents.runs.onStreamingEvent(cb),
      appEvents.runs.onContextUsage(cb),
      appEvents.runs.onToolApprovalRequest(cb),
      appEvents.runs.onToolApprovalResolved(cb),
      appEvents.providers.onModelsUpdated(cb),
      appEvents.workspace.onScriptComplete(cb),
      appEvents.workspace.onGitStateChanged(cb),
      appEvents.terminal.onData(cb),
    ];

    const subscribe = t.subscribe as ReturnType<typeof vi.fn>;
    expect(subscribe).toHaveBeenCalledWith(CHANNELS.runs.ephemeralEvent, cb);
    expect(subscribe).toHaveBeenCalledWith(CHANNELS.runs.contextUsage, cb);
    expect(subscribe).toHaveBeenCalledWith(CHANNELS.runs.toolApprovalRequest, cb);
    expect(subscribe).toHaveBeenCalledWith(CHANNELS.runs.toolApprovalResolved, cb);
    expect(subscribe).toHaveBeenCalledWith(CHANNELS.providers.modelsUpdated, cb);
    expect(subscribe).toHaveBeenCalledWith(CHANNELS.workspace.scriptComplete, cb);
    expect(subscribe).toHaveBeenCalledWith(CHANNELS.workspace.gitStateChanged, cb);
    expect(subscribe).toHaveBeenCalledWith(CHANNELS.terminal.data, cb);

    for (const off of offs) off();
  });
});
