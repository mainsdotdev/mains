// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeAuthStatus } from "@mains/contracts/bridge-auth";
import type { BridgeStatus, BridgeProjectScope } from "@mains/contracts/bridge";
import BridgeSettings from "./bridge";

const fixture = vi.hoisted(() => ({ status: {} as BridgeAuthStatus, sync: undefined as BridgeStatus | undefined, projects: [] as BridgeProjectScope[], scope: vi.fn(), include: vi.fn(), approve: vi.fn(), recover: vi.fn(), take: vi.fn(), signIn: vi.fn(), refetch: vi.fn() }));
vi.mock("@/lib/redux/api/bridgeApi", () => ({
  useGetBridgeAuthStatusQuery: () => ({ data: fixture.status, refetch: fixture.refetch }),
  useGetBridgeStatusQuery: () => ({ data: fixture.sync, refetch: fixture.refetch }),
  useGetBridgeProjectScopesQuery: () => ({ data: fixture.projects, refetch: fixture.refetch }),
}));
vi.mock("@/lib/transport", () => ({ getTransport: () => ({ kind: "ws" }), appApi: { bridge: { approveBackend: fixture.approve, enterRecoveryCode: fixture.recover, takeRecoveryCode: fixture.take, signIn: fixture.signIn, setProjectLocalOnly: fixture.scope, includeLocalHistory: fixture.include } } }));
vi.mock("@/hooks/use-suppress-browser-view", () => ({ useSuppressBrowserView: () => {} }));

beforeEach(() => {
  vi.clearAllMocks(); fixture.refetch.mockResolvedValue(undefined);
  fixture.projects = []; fixture.sync = undefined; fixture.scope.mockResolvedValue({ success: true }); fixture.include.mockResolvedValue({ success: true });
  fixture.approve.mockResolvedValue({ success: true }); fixture.recover.mockResolvedValue({ success: false, error: "Recovery code does not match" });
  fixture.take.mockResolvedValue({ success: true, data: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH" });
  fixture.signIn.mockResolvedValue({ success: true });
  fixture.status = { state: "ready", backendId: "A", hubUrl: "https://bridge.example", accountId: "account", email: "owner@example.com", label: "A", verificationCode: null, login: null,
    approvals: [{ requestId: "request", backendId: "B", publicKey: "key", label: "New laptop", platform: "darwin", code: "ABC234", expiresAt: "2026-10-15T20:00:00Z" }], backends: [], recoveryCodeAvailable: true, existing: { runs: 2, pages: 3 }, error: null };
});
afterEach(cleanup);

describe("Bridge key management", () => {
  it("changes only the selected project’s scope and offers a separate history opt-in", async () => {
    fixture.projects = [{ id: "p1", name: "Private project", localOnly: true, workspaces: 2, runs: 3 }]; fixture.status.localHistory = 4;
    render(<BridgeSettings />);
    expect((screen.getByRole("checkbox", { name: "Local only" }) as HTMLInputElement).checked).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: "Local only" })); });
    expect(fixture.scope).toHaveBeenCalledExactlyOnceWith("p1", false);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sync existing history" })); });
    expect(fixture.include).toHaveBeenCalledOnce();
  });
  it("shows account storage usage and explains that quota errors keep local changes queued", () => {
    fixture.sync = { quota: { usedBytes: 1024 ** 2, limitBytes: 2 * 1024 ** 2, fileLimitBytes: 50 * 1024 ** 2, plan: "standard" }, pendingRecords: 3, error: "Bridge storage quota exceeded; local changes remain queued" } as BridgeStatus;
    render(<BridgeSettings />);
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe(String(1024 ** 2));
    expect(screen.getByText("3 queued")).toBeTruthy(); expect(screen.getByRole("alert").textContent).toContain("remain queued");
  });
  it("requires an explicit matching-code check before approving the displayed backend", async () => {
    render(<BridgeSettings />);
    const button = screen.getByRole("button", { name: "Approve backend" }) as HTMLButtonElement;
    expect(screen.getByText("ABC234")).toBeTruthy(); expect(button.disabled).toBe(true);
    fireEvent.click(button); expect(fixture.approve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /code matches/ }));
    await act(async () => { fireEvent.click(button); });
    expect(fixture.approve).toHaveBeenCalledExactlyOnceWith(fixture.status.approvals[0]);
  });
  it("only reveals a setup recovery code on request and removes it from the page when hidden", async () => {
    render(<BridgeSettings />); expect(fixture.take).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Show setup recovery/ })); });
    expect(screen.getByText("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /hide code/ }));
    expect(screen.queryByText("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH")).toBeNull();
  });
  it("hides a revealed code when the selected backend changes", async () => {
    const view = render(<BridgeSettings />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Show setup recovery/ })); });
    expect(screen.getByText("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH")).toBeTruthy();
    fixture.status = { ...fixture.status, backendId: "B" }; view.rerender(<BridgeSettings />);
    expect(screen.queryByText("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH")).toBeNull();
  });
  it("clears a submitted recovery code even when unlocking fails and keeps the backend pending", async () => {
    fixture.status = { ...fixture.status, state: "needs-approval", verificationCode: "ABC234", approvals: [] };
    render(<BridgeSettings />);
    const input = screen.getByLabelText("Recovery code") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH" } });
    await act(async () => { fireEvent.submit(input.closest("form")!); });
    expect(fixture.recover).toHaveBeenCalledOnce(); expect(input.value).toBe("");
    expect(screen.getByRole("alert").textContent).toContain("does not match");
    expect(screen.getByText("Approve this backend")).toBeTruthy();
  });
  it("starts a remote backend’s device-code flow with the chosen existing-history scope", async () => {
    fixture.status = { ...fixture.status, state: "signed-out", accountId: null, approvals: [] };
    render(<BridgeSettings />);
    fireEvent.change(screen.getByPlaceholderText("https://bridge.example.com"), { target: { value: "https://my-bridge.example" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Include existing history/ }));
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
    await waitFor(() => expect(fixture.signIn).toHaveBeenCalledWith({ hubUrl: "https://my-bridge.example", label: undefined, includeExisting: false, flow: "device" }));
  });
});
