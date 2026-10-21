// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeAuthStatus } from "@mains/contracts/bridge-auth";
import type { BridgeStatus, BridgeProjectScope } from "@mains/contracts/bridge";
import BridgeSettings from "./bridge";

const fixture = vi.hoisted(() => ({ transportKind: "ws" as "ws" | "ipc", status: {} as BridgeAuthStatus, sync: undefined as BridgeStatus | undefined, projects: [] as BridgeProjectScope[], scope: vi.fn(), include: vi.fn(), approve: vi.fn(), confirmKey: vi.fn(), revoke: vi.fn(), recover: vi.fn(), take: vi.fn(), regenerate: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), syncNow: vi.fn(), refetch: vi.fn() }));
vi.mock("@/lib/redux/api/bridgeApi", () => ({
  useGetBridgeAuthStatusQuery: () => ({ data: fixture.status, refetch: fixture.refetch }),
  useGetBridgeStatusQuery: () => ({ data: fixture.sync, refetch: fixture.refetch }),
  useGetBridgeProjectScopesQuery: () => ({ data: fixture.projects, refetch: fixture.refetch }),
  useSyncBridgeNowMutation: () => [fixture.syncNow],
}));
vi.mock("@/lib/transport", () => ({ getTransport: () => ({ kind: fixture.transportKind }), appApi: { bridge: { approveBackend: fixture.approve, confirmAccountKey: fixture.confirmKey, revokeBackend: fixture.revoke, enterRecoveryCode: fixture.recover, takeRecoveryCode: fixture.take, regenerateRecoveryCode: fixture.regenerate, signIn: fixture.signIn, signOut: fixture.signOut, setProjectLocalOnly: fixture.scope, includeLocalHistory: fixture.include } } }));
vi.mock("@/hooks/use-suppress-browser-view", () => ({ useSuppressBrowserView: () => {} }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.clearAllMocks(); fixture.refetch.mockResolvedValue(undefined);
  fixture.transportKind = "ws";
  fixture.projects = []; fixture.sync = undefined; fixture.scope.mockResolvedValue({ success: true }); fixture.include.mockResolvedValue({ success: true });
  fixture.approve.mockResolvedValue({ success: true }); fixture.revoke.mockResolvedValue({ success: true }); fixture.recover.mockResolvedValue({ success: false, error: "Recovery code does not match" });
  fixture.confirmKey.mockResolvedValue({ success: true });
  fixture.take.mockResolvedValue({ success: true, data: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH" });
  fixture.regenerate.mockResolvedValue({ success: true, data: "JJJJ-KKKK-LLLL-MMMM-NNNN-PPPP-QQQQ-RRRR" });
  fixture.signIn.mockResolvedValue({ success: true }); fixture.signOut.mockResolvedValue({ success: true }); fixture.syncNow.mockImplementation(() => ({ unwrap: () => Promise.resolve(true) }));
  fixture.status = { state: "ready", backendId: "A", hubUrl: "https://bridge.example", accountId: "account", email: "owner@example.com", label: "A", verificationCode: null, joinCodes: [], login: null,
    approvals: [{ requestId: "request", backendId: "B", publicKey: "key", signingPublicKey: "signing-key", label: "New laptop", platform: "darwin", code: "ABCD-EFGH-JKLM", expiresAt: "2026-10-15T20:00:00Z" }], backends: [], recoveryCodeAvailable: true, existing: { runs: 2, pages: 3 }, error: null };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Bridge key management", () => {
  it("keeps sync controls hidden until the join code from the approving device is explicitly verified", async () => {
    fixture.status = { ...fixture.status, state: "needs-verification", joinCodes: [], approvals: [] };
    fixture.projects = [{ id: "p", name: "Private project", localOnly: false, workspaces: 1, runs: 1 }];
    render(<BridgeSettings />);
    expect(screen.getByText("Verify this device")).toBeTruthy();
    expect(screen.queryByText("Project sync")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
    expect(screen.queryByText("JKLM-NPQR-STUV")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy join code" })).toBeNull();
    const input = screen.getByRole("textbox", { name: "Join code from the approving device" });
    const button = screen.getByRole("button", { name: "Verify and start sync" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); expect(fixture.confirmKey).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "ABC234" } });
    expect(button.disabled).toBe(true);
    fireEvent.submit(input.closest("form")!); expect(fixture.confirmKey).not.toHaveBeenCalled();
    fixture.confirmKey.mockResolvedValueOnce({ success: false, error: "Join codes do not match; do not enable sync" });
    fireEvent.change(input, { target: { value: "AAAA-BBBB-CCCC" } });
    expect(button.disabled).toBe(false);
    await act(async () => { fireEvent.click(button); });
    expect(fixture.confirmKey).toHaveBeenCalledExactlyOnceWith("AAAA-BBBB-CCCC");
    expect(screen.getByRole("alert").textContent).toContain("Join codes do not match");
    expect(fixture.syncNow).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "jklm npqr stuv" } });
    expect(button.disabled).toBe(false);
    await act(async () => { fireEvent.click(button); });
    expect(fixture.confirmKey).toHaveBeenLastCalledWith("JKLM-NPQR-STUV");
    expect(fixture.confirmKey).toHaveBeenCalledTimes(2);
  });
  it("never renders join codes while this device waits for verification, even if a status includes them", () => {
    fixture.status = { ...fixture.status, state: "needs-verification", approvals: [], joinCodes: [{ backendId: "B", label: "New laptop", code: "JKLM-NPQR-STUV" }] };
    render(<BridgeSettings />);
    expect(screen.getByText("Verify this device")).toBeTruthy();
    expect(screen.queryByText("JKLM-NPQR-STUV")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy join code" })).toBeNull();
  });
  it("shows the join code as the second step in the device setup card", () => {
    fixture.status = { ...fixture.status, approvals: [], joinCodes: [{ backendId: "B", label: "New laptop", code: "JKLM-NPQR-STUV" }] };
    render(<BridgeSettings />);
    const card = within(screen.getByRole("region", { name: "Set up New laptop" }));
    expect(screen.getByText("Device setup")).toBeTruthy();
    expect(card.getByText("Step 2 of 2 · Finish on the new device")).toBeTruthy();
    expect(card.getByText("JKLM-NPQR-STUV")).toBeTruthy();
    expect(card.getByRole("button", { name: "Copy join code" })).toBeTruthy();
  });
  it("replaces approval with the join code in the same card, then removes the completed setup", async () => {
    const view = render(<BridgeSettings />);
    const card = screen.getByRole("region", { name: "Set up New laptop" });
    expect(within(card).getByText("Step 1 of 2 · Approve device")).toBeTruthy();
    fireEvent.change(within(card).getByRole("textbox", { name: "Code shown on the new device" }), { target: { value: "ABCD-EFGH-JKLM" } });
    fixture.approve.mockImplementationOnce(async () => {
      fixture.status = { ...fixture.status, approvals: [], joinCodes: [{ backendId: "B", label: "New laptop", code: "JKLM-NPQR-STUV" }] };
      return { success: true };
    });
    await act(async () => { fireEvent.click(within(card).getByRole("button", { name: "Approve device" })); });
    expect(screen.getByRole("region", { name: "Set up New laptop" })).toBe(card);
    expect(within(card).getByText("JKLM-NPQR-STUV")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Approve device" })).toBeNull();
    expect(screen.queryByText("Join code for New laptop")).toBeNull();
    fixture.status = { ...fixture.status, joinCodes: [] };
    view.rerender(<BridgeSettings />);
    expect(screen.queryByRole("region", { name: "Set up New laptop" })).toBeNull();
    expect(screen.queryByText("JKLM-NPQR-STUV")).toBeNull();
    expect(screen.queryByText("Device setup")).toBeNull();
  });
  it.each(["publicKey", "signingPublicKey"] as const)("discards a completed code comparison when the recipient's %s changes", (key) => {
    const view = render(<BridgeSettings />);
    fireEvent.change(screen.getByRole("textbox", { name: "Code shown on the new device" }), { target: { value: "ABCD-EFGH-JKLM" } });
    expect((screen.getByRole("button", { name: "Approve device" }) as HTMLButtonElement).disabled).toBe(false);
    fixture.status = { ...fixture.status, approvals: [{ ...fixture.status.approvals[0], [key]: "changed-key" }] };
    view.rerender(<BridgeSettings />);
    expect((screen.getByRole("textbox", { name: "Code shown on the new device" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Approve device" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it.each([false, true])("shows connection details and confirms disconnect before removing data (remove synced: %s)", async (removeSynced) => {
    fixture.status.label = "Studio Mac";
    fixture.sync = { enabled: true, state: "connected", backendId: "A", label: "Studio Mac", lastSyncedAt: "2026-10-16T00:25:00Z", pendingRecords: 0, backends: [], runs: [], error: null };
    render(<BridgeSettings />);
    expect(screen.getByText(/^Last synced /)).toBeTruthy();
    expect(screen.queryByText(/https:\/\/bridge\.example/)).toBeNull();
    expect(screen.queryByText("Studio Mac")).toBeNull();
    expect(screen.queryByText(/Keep your Atlas and chats/)).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out of Bridge" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(fixture.signOut).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByText(/Unsent changes are always kept/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(fixture.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = screen.getByRole("dialog"), checkbox = within(dialog).getByRole("checkbox", { name: /Remove synced/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    if (removeSynced) fireEvent.click(checkbox);
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" })); });
    expect(fixture.signOut).toHaveBeenCalledExactlyOnceWith(removeSynced);
  });
  it("updates connection details for queued writes, offline state and a sync error", () => {
    fixture.sync = { enabled: true, state: "connected", backendId: "A", label: "A", lastSyncedAt: null, pendingRecords: 1, backends: [], runs: [], error: null };
    const view = render(<BridgeSettings />);
    expect(screen.getByText("1 change waiting to sync")).toBeTruthy();
    fixture.sync = { ...fixture.sync, state: "offline", pendingRecords: 3 }; view.rerender(<BridgeSettings />);
    expect(screen.getByText("Offline · 3 changes waiting to sync")).toBeTruthy();
    fixture.sync = { ...fixture.sync, state: "error", error: "Bridge connection timed out" }; view.rerender(<BridgeSettings />);
    expect(screen.getByText("Sync paused · 3 changes waiting to sync")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Bridge connection timed out");
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });
  it.each(["ready", "needs-approval"] as const)("offers a single retry action for an interrupted disconnect in %s", async (state) => {
    fixture.status.state = state; fixture.status.logoutPending = true;
    render(<BridgeSettings />);
    expect(screen.getAllByRole("button", { name: "Finish disconnecting" })).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Finish disconnecting" })); });
    expect(fixture.signOut).toHaveBeenCalledExactlyOnceWith(false);
  });
  it.each(["ws", "ipc"] as const)("identifies the computer affected by sync settings and sign-out over %s", (kind) => {
    fixture.transportKind = kind; fixture.status.label = "Studio Mac";
    fixture.status.backends = [{ backendId: "A", label: "Studio Mac", publicKey: "key", signingPublicKey: "signing-key", platform: "darwin", status: "approved", createdAt: "2026-10-16T00:00:00Z", lastSeen: null }];
    fixture.projects = [{ id: "p1", name: "Private project", localOnly: false, workspaces: 1, runs: 2 }];
    fixture.sync = { pendingRecords: 1, quota: { usedBytes: 1024 ** 3, limitBytes: 1024 ** 3, fileLimitBytes: 50 * 1024 ** 2, plan: "standard",
      subscription: { status: "none", planId: null, billingInterval: null, startsAt: null, expiresAt: null, canUpload: false } } } as BridgeStatus;
    const view = render(<BridgeSettings />), target = kind === "ws" ? "Studio Mac" : "this device";
    expect(screen.getByText("Devices")).toBeTruthy();
    const devices = within(screen.getByRole("list", { name: "Bridge devices" }));
    expect(devices.getByText("Studio Mac")).toBeTruthy();
    expect(devices.getByText(kind === "ws" ? "Connected device" : "This device")).toBeTruthy();
    expect(screen.queryByText(/Keep your Atlas and chats/)).toBeNull();
    expect(screen.getByText(/Storage is full/).textContent).toContain(`stay on ${target}`);
    expect(screen.getByText(/Sync workspaces and chats from/).textContent).toContain(`chats from ${target}.`);
    expect(screen.getByText(/New uploads are paused/).textContent).toContain(`Changes on ${target} stay queued`);
    expect(view.container.textContent).not.toMatch(/backend/i);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(`opened files stay on ${target}.`);
    expect(within(dialog).getByRole("checkbox", { name: `Remove synced Spaces, Collections and Atlas from ${target}` })).toBeTruthy();
    if (kind === "ws") {
      expect(document.body.textContent).not.toMatch(/this device|this computer/i);
      fixture.status = { ...fixture.status, backendId: "B", label: "Travel Mac" };
      view.rerender(<BridgeSettings />);
      expect(screen.getByRole("dialog").textContent).toContain("opened files stay on Travel Mac.");
      expect(within(screen.getByRole("dialog")).getByRole("checkbox", { name: "Remove synced Spaces, Collections and Atlas from Travel Mac" })).toBeTruthy();
    }
  });
  it("shows readable device details and confirms revocation for the selected device", async () => {
    const base = { publicKey: "key", signingPublicKey: "signing-key", createdAt: "2026-10-16T00:00:00Z", lastSeen: null };
    fixture.status.backends = [
      { ...base, backendId: "A", label: "MacBook Pro", platform: "darwin", status: "approved" },
      { ...base, backendId: "B", label: "Travel laptop", platform: "win32", status: "approved", lastSeen: "2026-10-15T18:20:00Z" },
      { ...base, backendId: "C", label: "Home server", platform: "linux", status: "pending" },
      { ...base, backendId: "D", label: "Old computer", platform: "darwin", status: "revoked", lastSeen: "invalid" },
    ];
    render(<BridgeSettings />);
    const rows = within(screen.getByRole("list", { name: "Bridge devices" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("macOS · Approved")).toBeTruthy();
    expect(within(rows[0]).getByText("Connected device")).toBeTruthy();
    expect(within(rows[0]).queryByRole("button", { name: "Revoke access" })).toBeNull();
    expect(within(rows[1]).getByText(/^Windows · Approved · Last seen /)).toBeTruthy();
    expect(within(rows[2]).getByText("Linux · Waiting for approval")).toBeTruthy();
    expect(screen.queryByText("Old computer")).toBeNull();
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Revoke access" }));
    expect(fixture.revoke).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/Travel laptop will lose sync access/)).toBeTruthy();
    fixture.revoke.mockImplementationOnce(async () => {
      fixture.status = { ...fixture.status, backends: fixture.status.backends.map((device) =>
        device.backendId === "B" ? { ...device, status: "revoked" } : device) };
      return { success: true };
    });
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Revoke access" })); });
    expect(fixture.revoke).toHaveBeenCalledExactlyOnceWith("B");
    expect(screen.queryByText("Travel laptop")).toBeNull();
    expect(within(screen.getByRole("list", { name: "Bridge devices" })).getAllByRole("listitem")).toHaveLength(2);
  });
  it("offers monthly/yearly choices without granting rights and refreshes the server-backed status", async () => {
    fixture.sync = { state: "read-only", pendingRecords: 3, error: null, quota: {
      usedBytes: 0, limitBytes: 1024 ** 3, fileLimitBytes: 50 * 1024 ** 2, plan: "standard",
      subscription: { status: "none", planId: null, billingInterval: null, startsAt: null, expiresAt: null, canUpload: false },
      plans: [{ id: "standard", name: "Bridge", storageLimitBytes: 1024 ** 3, fileLimitBytes: 50 * 1024 ** 2, writesPerMinute: 600, billingIntervals: ["monthly", "yearly"] }],
    } } as BridgeStatus;
    render(<BridgeSettings />);
    expect(screen.getByText("Subscription required")).toBeTruthy();
    expect(screen.getByText(/^Read only ·/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Yearly" }));
    expect(screen.getByRole("radio", { name: "Yearly" }).getAttribute("aria-checked")).toBe("true");
    expect(fixture.signIn).not.toHaveBeenCalled(); expect(fixture.syncNow).not.toHaveBeenCalled();
    expect(screen.getByText(/Purchases are not available yet/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh subscription status" })); });
    expect(fixture.syncNow).toHaveBeenCalledOnce();
  });
  it.each(["active", "expired", "revoked"] as const)("shows selected beta access and its expiry without purchase choices (%s)", async (status) => {
    fixture.sync = { state: status === "active" ? "connected" : "read-only", pendingRecords: 3, error: null, quota: {
      usedBytes: 0, limitBytes: 1024 ** 3, fileLimitBytes: 50 * 1024 ** 2, plan: "standard",
      subscription: { source: "beta", status, planId: "standard", billingInterval: null, startsAt: "2026-10-16T12:00:00Z", expiresAt: "2026-11-15T12:00:00Z", canUpload: status === "active" },
      plans: [{ id: "standard", name: "Bridge", storageLimitBytes: 1024 ** 3, fileLimitBytes: 50 * 1024 ** 2, writesPerMinute: 600, billingIntervals: ["monthly", "yearly"] }],
    } } as BridgeStatus;
    render(<BridgeSettings />);
    expect(screen.getByText("Beta access", { exact: true })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Monthly" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Yearly" })).toBeNull();
    expect(screen.queryByText(/Purchases are not available yet/)).toBeNull();
    if (status === "active") expect(screen.getByText(/^Beta access ends /)).toBeTruthy();
    else expect(screen.getByText(/New uploads are paused/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh access status" })); });
    expect(fixture.syncNow).toHaveBeenCalledOnce();
  });
  it.each([true, false])("toggles sync for only the selected project and offers a separate history opt-in (local only: %s)", async (localOnly) => {
    fixture.projects = [
      { id: "p1", name: "Private project", localOnly, workspaces: 2, runs: 3 },
      { id: "p2", name: "Other project", localOnly: false, workspaces: 1, runs: 0 },
    ]; fixture.status.localHistory = 4;
    render(<BridgeSettings />);
    const toggle = screen.getByRole("switch", { name: "Sync Private project" });
    expect(toggle.getAttribute("aria-checked")).toBe(String(!localOnly));
    await act(async () => { fireEvent.click(toggle); });
    expect(fixture.scope).toHaveBeenCalledExactlyOnceWith("p1", !localOnly);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sync existing history" })); });
    expect(fixture.include).toHaveBeenCalledOnce();
  });
  it("shows account storage usage and explains that quota errors keep local changes queued", () => {
    fixture.sync = { state: "error", quota: { usedBytes: 1024 ** 2, limitBytes: 4 * 1024 ** 2, fileLimitBytes: 50 * 1024 ** 2, plan: "standard" }, pendingRecords: 3, error: "Bridge storage quota exceeded; local changes remain queued" } as BridgeStatus;
    render(<BridgeSettings />);
    const meter = screen.getByRole("meter", { name: "Bridge storage used" });
    expect(meter.getAttribute("aria-valuenow")).toBe("25");
    expect(meter.getAttribute("aria-valuetext")).toBe("1 MiB of 4 MiB used");
    expect(screen.getByText("1 MiB / 4 MiB")).toBeTruthy();
    expect(screen.getByText(/3 changes waiting to sync/)).toBeTruthy(); expect(screen.getByRole("alert").textContent).toContain("remain queued");
  });
  it.each([
    { used: 0, limit: 1024 ** 2, percent: "0", text: "0 MiB / 1 MiB" },
    { used: 3 * 1024 ** 2, limit: 2 * 1024 ** 2, percent: "100", text: "3 MiB / 2 MiB" },
    { used: 0, limit: 0, percent: "100", text: "0 MiB / 0 MiB" },
  ])("keeps the storage meter bounded without hiding actual usage: $text", ({ used, limit, percent, text }) => {
    fixture.sync = { quota: { usedBytes: used, limitBytes: limit, fileLimitBytes: 50 * 1024 ** 2, plan: "standard" } } as BridgeStatus;
    render(<BridgeSettings />);
    expect(screen.getByRole("meter", { name: "Bridge storage used" }).getAttribute("aria-valuenow")).toBe(percent);
    expect(screen.getByText(text)).toBeTruthy();
    expect(!!screen.queryByText(/Storage is full/)).toBe(used >= limit);
  });
  it("approves only after the new device's code is typed, without displaying the expected code", async () => {
    render(<BridgeSettings />);
    const button = screen.getByRole("button", { name: "Approve device" }) as HTMLButtonElement;
    const input = screen.getByRole("textbox", { name: "Code shown on the new device" });
    expect(screen.queryByText("ABCD-EFGH-JKLM")).toBeNull(); expect(button.disabled).toBe(true);
    fireEvent.click(button); expect(fixture.approve).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "ABCD-EFGH-JKLN" } });
    expect(screen.getByRole("alert").textContent).toMatch(/does not match/); expect(button.disabled).toBe(true);
    fireEvent.submit(input); expect(fixture.approve).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "abcd efgh jklm" } });
    expect(screen.queryByText(/does not match/)).toBeNull(); expect(button.disabled).toBe(false);
    await act(async () => { fireEvent.click(button); });
    expect(fixture.approve).toHaveBeenCalledExactlyOnceWith({ ...fixture.status.approvals[0], code: "ABCD-EFGH-JKLM" });
  });
  it.each([
    { flow: "setup", code: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH" },
    { flow: "new", code: "JJJJ-KKKK-LLLL-MMMM-NNNN-PPPP-QQQQ-RRRR" },
  ])("reveals the $flow recovery code on request, copies it only on click and removes it when hidden", async ({ flow, code }) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    fixture.status.recoveryCodeAvailable = flow === "setup";
    render(<BridgeSettings />);
    expect(fixture.take).not.toHaveBeenCalled(); expect(fixture.regenerate).not.toHaveBeenCalled();
    if (flow === "setup") {
      expect(screen.queryByRole("button", { name: "New recovery code" })).toBeNull();
      fixture.take.mockImplementationOnce(async () => {
        fixture.status = { ...fixture.status, recoveryCodeAvailable: false };
        return { success: true, data: code };
      });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Show recovery code" })); });
    } else {
      fireEvent.click(screen.getByRole("button", { name: "New recovery code" }));
      expect(fixture.regenerate).not.toHaveBeenCalled();
      await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Replace code" })); });
      expect(fixture.regenerate).toHaveBeenCalledOnce();
    }
    const input = screen.getByRole("textbox", { name: "Recovery code" }) as HTMLInputElement;
    expect(input.value).toBe(code); expect(input.readOnly).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy recovery code" })); });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(code);
    fireEvent.click(screen.getByRole("button", { name: /hide code/ }));
    expect(screen.queryByDisplayValue(code)).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy recovery code" })).toBeNull();
    expect(screen.getByRole("button", { name: "New recovery code" })).toBeTruthy();
  });
  it("hides a revealed code when the selected backend changes", async () => {
    const view = render(<BridgeSettings />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Show recovery code" })); });
    expect(screen.getByDisplayValue("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH")).toBeTruthy();
    fixture.status = { ...fixture.status, backendId: "B" }; view.rerender(<BridgeSettings />);
    expect(screen.queryByDisplayValue("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy recovery code" })).toBeNull();
  });
  it("copies the verification code without unlocking, confirms disconnect and clears a failed recovery attempt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    fixture.status = { ...fixture.status, state: "needs-approval", verificationCode: "ABCD-EFGH-JKLM", joinCodes: [], approvals: [] };
    render(<BridgeSettings />);
    expect(writeText).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy verification code" })); });
    expect(writeText).toHaveBeenCalledExactlyOnceWith("ABCD-EFGH-JKLM");
    expect(fixture.recover).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Disconnect from Bridge" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect from Bridge" }));
    expect(fixture.recover).not.toHaveBeenCalled(); expect(fixture.signOut).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    const input = screen.getByLabelText("Recovery code") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH" } });
    await act(async () => { fireEvent.submit(input.closest("form")!); });
    expect(fixture.recover).toHaveBeenCalledOnce(); expect(input.value).toBe("");
    expect(screen.getByRole("alert").textContent).toContain("does not match");
    expect(screen.getByText("Approve A")).toBeTruthy();
  });
  it.each(["ws", "ipc"] as const)("opens device setup before starting the %s sign-in flow with the chosen name and history scope", async (kind) => {
    fixture.transportKind = kind;
    fixture.status = { ...fixture.status, state: "signed-out", accountId: null, approvals: [] };
    fixture.projects = [{ id: "p1", name: "Private project", localOnly: false, workspaces: 2, runs: 3 }];
    render(<BridgeSettings />);
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.queryByText("Project sync")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Sync Private project" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(fixture.signIn).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole("dialog", { name: "Sign in to Bridge" }));
    expect((dialog.getByRole("textbox", { name: "Device name" }) as HTMLInputElement).value).toBe("A");
    expect(dialog.getByRole("switch", { name: /Include existing history/ }).getAttribute("aria-checked")).toBe("true");
    expect(dialog.queryByRole("textbox", { name: "Bridge hub URL" })).toBeNull();
    fireEvent.change(dialog.getByRole("textbox", { name: "Device name" }), { target: { value: " Travel Mac " } });
    fireEvent.click(dialog.getByRole("switch", { name: /Include existing history/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Advanced" }));
    fireEvent.change(dialog.getByRole("textbox", { name: "Bridge hub URL" }), { target: { value: "https://my-bridge.example" } });
    await act(async () => { fireEvent.submit(dialog.getByRole("button", { name: "Sign in" }).closest("form")!); });
    expect(fixture.signIn).toHaveBeenCalledExactlyOnceWith({ hubUrl: "https://my-bridge.example", label: "Travel Mac", includeExisting: false, flow: kind === "ws" ? "device" : "loopback" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("offers no other hub in a released build that has one configured", async () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("__MAINS_BRIDGE_HUB_URL__", "https://configured-bridge.example");
    fixture.status = { ...fixture.status, state: "signed-out", accountId: null, hubUrl: null, approvals: [] };
    render(<BridgeSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByRole("button", { name: "Advanced" })).toBeNull();
    expect(dialog.queryByRole("textbox", { name: "Bridge hub URL" })).toBeNull();
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Sign in" })); });
    expect(fixture.signIn).toHaveBeenCalledExactlyOnceWith({ hubUrl: "https://configured-bridge.example", label: "A", includeExisting: true, flow: "device" });
  });
  it("still asks a released build without a configured hub for one", () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("__MAINS_BRIDGE_HUB_URL__", "");
    fixture.status = { ...fixture.status, state: "signed-out", accountId: null, hubUrl: null, approvals: [] };
    render(<BridgeSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByRole("button", { name: "Advanced" })).toBeNull();
    expect(dialog.getByRole("textbox", { name: "Bridge hub URL" })).toBeTruthy();
  });
  it("uses the configured origin for a fresh device without exposing server setup by default", async () => {
    vi.stubGlobal("__MAINS_BRIDGE_HUB_URL__", "https://configured-bridge.example");
    fixture.status = { ...fixture.status, state: "signed-out", accountId: null, hubUrl: null, approvals: [] };
    render(<BridgeSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByRole("textbox", { name: "Bridge hub URL" })).toBeNull();
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Sign in" })); });
    expect(fixture.signIn).toHaveBeenCalledExactlyOnceWith({ hubUrl: "https://configured-bridge.example", label: "A", includeExisting: true, flow: "device" });
  });
  it("keeps setup open after a failed sign-in and retries with the same selections", async () => {
    fixture.status = { ...fixture.status, state: "signed-out", accountId: null, approvals: [] };
    fixture.signIn.mockResolvedValueOnce({ success: false, error: "Could not reach Bridge" });
    render(<BridgeSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox", { name: "Device name" }), { target: { value: "Studio Mac" } });
    fireEvent.click(dialog.getByRole("switch", { name: /Include existing history/ }));
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Sign in" })); });
    expect(dialog.getByRole("alert").textContent).toBe("Could not reach Bridge");
    expect((dialog.getByRole("textbox", { name: "Device name" }) as HTMLInputElement).value).toBe("Studio Mac");
    expect(dialog.getByRole("switch", { name: /Include existing history/ }).getAttribute("aria-checked")).toBe("false");
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Sign in" })); });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fixture.signIn).toHaveBeenLastCalledWith({ hubUrl: "https://bridge.example", label: "Studio Mac", includeExisting: false, flow: "device" });
  });
  it("requires a custom origin when no default is configured and closes without starting sign-in", () => {
    vi.stubGlobal("__MAINS_BRIDGE_HUB_URL__", "");
    fixture.status = { ...fixture.status, state: "signed-out", accountId: null, hubUrl: null, approvals: [] };
    render(<BridgeSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("textbox", { name: "Bridge hub URL" })).toBeTruthy();
    expect((dialog.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(dialog.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fixture.signIn).not.toHaveBeenCalled();
  });
});
