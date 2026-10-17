// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeBackendInfo, BridgeStatus } from "@mains/contracts/bridge";
import { ReplicaComposerBar, isReplicaLive } from "./replica-composer-bar";

const online: BridgeBackendInfo = { backendId: "A", label: "Studio Mac", platform: "darwin", online: true, lastSeen: null };
const offline: BridgeBackendInfo = { ...online, online: false, lastSeen: "2026-10-17T10:15:00Z" };
const connected = { enabled: true, state: "connected" } as BridgeStatus;
const renderBar = (props: Partial<Parameters<typeof ReplicaComposerBar>[0]>) => render(<MemoryRouter initialEntries={["/code"]}>
  <Routes>
    <Route path="/code" element={<ReplicaComposerBar run={{ status: "succeeded", startedAt: null }} owner={offline} status={connected}
      hydration={undefined} variant="claude" {...props} />} />
    <Route path="/relay" element={<p>Relay page</p>} />
  </Routes>
</MemoryRouter>);
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ReplicaComposerBar", () => {
  it("shows the source device and its last-seen time in the composer slot", () => {
    renderBar({});
    expect(screen.getByTestId("replica-composer").textContent).toContain("Read-only · runs on Studio Mac");
    expect(screen.getByText(/^Offline since /)).toBeTruthy();
    expect(screen.queryByText(/Running/)).toBeNull();
  });

  it("shows a live running indicator with elapsed time only while the source is online", () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-17T10:00:00Z") });
    renderBar({ run: { status: "running", startedAt: Date.parse("2026-10-17T09:58:30Z") }, owner: online });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("Running · 1:31")).toBeTruthy();
    cleanup();
    // A stale "running" row from an offline source is not presented as live.
    renderBar({ run: { status: "running", startedAt: Date.parse("2026-10-17T09:58:30Z") }, owner: offline });
    expect(screen.queryByText(/Running/)).toBeNull();
    expect(isReplicaLive({ status: "queued" }, online)).toBe(true);
    expect(isReplicaLive({ status: "running" }, { ...online, online: null })).toBe(false);
  });

  it("explains saved data and pending downloads", () => {
    renderBar({ status: { enabled: true, state: "offline" } as BridgeStatus });
    expect(screen.getByText("· Showing saved data")).toBeTruthy();
    cleanup();
    renderBar({ hydration: { runId: "run", ready: false, error: null } });
    expect(screen.getByText("· Downloading conversation…")).toBeTruthy();
    cleanup();
    renderBar({ hydration: { runId: "run", ready: false, error: "offline" } });
    expect(screen.getByText("· Waiting to download this conversation")).toBeTruthy();
  });

  it("opens Relay to take control on the source device", () => {
    renderBar({});
    fireEvent.click(screen.getByRole("button", { name: "Control on device" }));
    expect(screen.getByText("Relay page")).toBeTruthy();
  });
});
