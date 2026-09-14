import { describe, it, expect } from "vitest";
import reducer, {
  addBackend,
  markConnected,
  removeBackend,
  renameBackend,
  setActiveBackend,
} from "./backendsSlice";

describe("backendsSlice", () => {
  it("adds a backend with trimmed fields and a generated id", () => {
    const state = reducer(
      undefined,
      addBackend({ label: "  Dev box  ", wsUrl: "  ws://127.0.0.1:8787  " }),
    );
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toMatchObject({
      label: "Dev box",
      wsUrl: "ws://127.0.0.1:8787",
      lastConnectedAt: null,
    });
    expect(state.saved[0].id).toBeTruthy();
  });

  it("removes a backend and clears active when it was the active one", () => {
    let state = reducer(undefined, addBackend({ label: "A", wsUrl: "ws://a" }));
    const id = state.saved[0].id;
    state = reducer(state, setActiveBackend(id));
    state = reducer(state, removeBackend(id));
    expect(state.saved).toHaveLength(0);
    expect(state.activeBackendId).toBeNull();
  });

  it("keeps active untouched when removing a different backend", () => {
    let state = reducer(undefined, addBackend({ label: "A", wsUrl: "ws://a" }));
    state = reducer(state, addBackend({ label: "B", wsUrl: "ws://b" }));
    const [a, b] = state.saved;
    state = reducer(state, setActiveBackend(a.id));
    state = reducer(state, removeBackend(b.id));
    expect(state.saved).toHaveLength(1);
    expect(state.activeBackendId).toBe(a.id);
  });

  it("renames a backend (trimmed)", () => {
    let state = reducer(undefined, addBackend({ label: "A", wsUrl: "ws://a" }));
    const id = state.saved[0].id;
    state = reducer(state, renameBackend({ id, label: "  Renamed  " }));
    expect(state.saved[0].label).toBe("Renamed");
  });

  it("sets and clears the active backend", () => {
    let state = reducer(undefined, setActiveBackend("x"));
    expect(state.activeBackendId).toBe("x");
    state = reducer(state, setActiveBackend(null));
    expect(state.activeBackendId).toBeNull();
  });

  it("adds an SSH backend (ssh config, no wsUrl)", () => {
    const state = reducer(
      undefined,
      addBackend({
        label: "Tunnel",
        ssh: { host: "devbox", remotePort: 8787 },
      }),
    );
    expect(state.saved[0]).toMatchObject({
      label: "Tunnel",
      wsUrl: undefined,
      ssh: { host: "devbox", remotePort: 8787 },
    });
  });

  it("records the last connected time", () => {
    let state = reducer(undefined, addBackend({ label: "A", wsUrl: "ws://a" }));
    const id = state.saved[0].id;
    state = reducer(state, markConnected({ id, at: 1_700_000_000_000 }));
    expect(state.saved[0].lastConnectedAt).toBe(1_700_000_000_000);
  });
});
