// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { baseApi } from "@/lib/redux/api/baseApi";
import { connectionsApi } from "@/lib/redux/api/connectionsApi";
import backendsReducer from "@/lib/redux/slices/backendsSlice";
import { getTransport, resetTransport, setTransport, type Transport } from "@/lib/transport";
import { CHANNELS } from "@mains/contracts/channels";
import { ResourceWizardModal, type ResourceWizardConfig } from "./resource-wizard-modal";
// Keep the actual steps, Redux endpoints and transport. Only modal presentation
// and minimum animation delays are replaced, so races are deterministic.
vi.mock("@/lib/with-min-delay", () => ({ withMinDelay: <T,>(work: Promise<T>) => work }));
vi.mock("@/components/ui", async (original) => {
  const ui = await original<any>();
  const { WizardProvider } = await import("@/components/ui/wizard-modal/wizard-context");
  const React = await import("react");
  return { ...ui, WizardModal: ({ steps, initialData, onCancel }: any) => {
    const [step, goTo] = React.useState("loading"), [data, update] = React.useState(initialData);
    React.useEffect(() => { update((old: any) => ({ ...old, ...initialData })); }, [initialData]);
    const setData = React.useCallback((next: any) => update((old: any) => ({ ...old, ...next })), []);
    return <WizardProvider value={{ data, setData, goTo } as any}><button onClick={onCancel}>Close wizard</button>{steps.find((s: any) => s.id === step)?.render()}</WizardProvider>;
  } };
});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const config: ResourceWizardConfig = {
  provider: "github", appName: "GitHub", modalTitle: "GitHub", icon: "", credentialDescription: "Connect GitHub", credentialInstructions: "", credentialFields: [{ id: "token", label: "Token", placeholder: "Token", dataKey: "token" }], buildCredentials: (v) => v,
  loadingMessage: "Loading", selectTitle: "Choose repos", resourceLabel: "repo", resourceLabelPlural: "repos", revokeDescription: "Revoke", identityForItem: (r) => r.name, identityForCurrent: (r) => r.name, searchTextForItem: (r) => r.name, renderItemForSelect: (r) => r.name, renderItemForManage: (r) => r.name,
};
const disposers: Array<() => void> = [];
function fixture(overrides: (channel: string) => Promise<any> | undefined = () => undefined) {
  const invoke = vi.fn((channel: string) => overrides(channel) ?? Promise.resolve({ success: true, data: channel === CHANNELS.appSettings.get ? { accountId: "account" } : channel === CHANNELS.connections.getByProvider ? { connection: { id: "conn", provider: "github", status: "active", revision: "revision" } } : { revision: "saved", count: 1 } }));
  setTransport({ kind: "test", invoke, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} } as Transport);
  const store = configureStore({ reducer: { backends: backendsReducer, api: baseApi.reducer }, middleware: (defaults) => defaults().concat(baseApi.middleware) });
  const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><Provider store={store}>{children}</Provider></StrictMode>;
  const props = { open: true, onClose: vi.fn(), isConnected: false, onSuccess: vi.fn(), config, fetchAllResources: vi.fn().mockResolvedValue([{ name: "repo" }]) };
  disposers.push(() => { store.dispatch(baseApi.util.resetApiState()); }); return { store, invoke, props, wrapper };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); for (const dispose of disposers.splice(0)) dispose(); resetTransport(); });
async function submit() {
  await screen.findByPlaceholderText("Token");
  fireEvent.change(screen.getByPlaceholderText("Token"), { target: { value: "fake-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}
it("does not discover resources or report success after closing a pending credential save", async () => {
  const save = deferred<any>();
  const f = fixture((ch) => ch === CHANNELS.connections.saveCredentials ? save.promise : undefined);
  const view = render(<ResourceWizardModal {...f.props} />, { wrapper: f.wrapper });
  await submit(); await waitFor(() => expect(f.invoke.mock.calls.some(([ch]) => ch === CHANNELS.connections.saveCredentials)).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Close wizard" })); view.rerender(<ResourceWizardModal {...f.props} open={false} />);
  await act(async () => { save.resolve({ success: true, data: { revision: "saved" } }); });
  expect(f.props.fetchAllResources).not.toHaveBeenCalled(); expect(f.props.onSuccess).not.toHaveBeenCalled();
});
it("completes credential validation and sends the captured revision with selection", async () => {
  const f = fixture(); render(<ResourceWizardModal {...f.props} />, { wrapper: f.wrapper });
  await submit(); await screen.findByText("Choose repos");
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save 1 repo" }));
  await waitFor(() => expect(f.props.onClose).toHaveBeenCalledTimes(1));
  const saved = f.invoke.mock.calls.find(([ch]) => ch === CHANNELS.connections.saveCredentials);
  expect(saved).toEqual([CHANNELS.connections.saveCredentials, [expect.objectContaining({ expectedRevision: "revision" })]]);
  expect(f.props.onSuccess).toHaveBeenCalledTimes(1);
});
it("does not dispatch automatic sync into a replacement transport after a late resource save", async () => {
  const save = deferred<any>(), f = fixture((ch) => ch === CHANNELS.connections.saveResources ? save.promise : undefined);
  const pending = f.store.dispatch(connectionsApi.endpoints.saveResources.initiate({ provider: "github", connectionId: "conn", resources: [] }));
  const original = getTransport(), other = { ...original, invoke: vi.fn() } as Transport;
  setTransport(other); setTransport(original);
  save.resolve({ success: true, data: { count: 0 } }); await pending;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.invoke.mock.calls.filter(([ch]) => ch === CHANNELS.sync.runEntitySync)).toHaveLength(0); expect(other.invoke).not.toHaveBeenCalled();
});
it("keeps a new wizard's discovery separate from a pending read on the previous backend", async () => {
  const oldRead = deferred<any>();
  const f = fixture((ch) => ch === CHANNELS.connections.getGithubRepos ? oldRead.promise : undefined);
  const first = f.store.dispatch(connectionsApi.endpoints.getGitHubRepos.initiate({ id: "conn", scope: "old-view" }));
  const otherInvoke = vi.fn().mockResolvedValue({ success: true, data: { repos: [{ name: "new-backend" }] } });
  setTransport({ ...getTransport(), invoke: otherInvoke } as Transport);
  const second = f.store.dispatch(connectionsApi.endpoints.getGitHubRepos.initiate({ id: "conn", scope: "new-view" }));
  expect(await second.unwrap()).toEqual([{ name: "new-backend" }]);
  expect(otherInvoke).toHaveBeenCalledWith(CHANNELS.connections.getGithubRepos, ["conn"]);
  oldRead.resolve({ success: true, data: { repos: [{ name: "old-backend" }] } }); await first;
});
it("preserves credentials and stays on the form when discovery fails, then retries", async () => {
  const f = fixture(); f.props.fetchAllResources.mockRejectedValueOnce(new Error("Access denied"));
  render(<ResourceWizardModal {...f.props} />, { wrapper: f.wrapper });
  await submit(); await screen.findByText("Access denied");
  expect((screen.getByPlaceholderText("Token") as HTMLInputElement).value).toBe("fake-token");
  expect(f.props.onSuccess).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Choose repos"); expect(f.props.onSuccess).toHaveBeenCalledTimes(1);
});
it("admits a single credential action before duplicate callbacks can render loading", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const save = deferred<any>(), f = fixture((ch) => ch === CHANNELS.connections.saveCredentials ? save.promise : undefined);
  const alternative = { label: "Device", tokenLabel: "Token", render: ({ submitValues }: any) => <button onClick={() => { void submitValues({ token: "fake-token" }); void submitValues({ token: "fake-token" }); }}>Submit twice</button> };
  render(<ResourceWizardModal {...f.props} config={{ ...config, credentialAlternative: alternative }} />, { wrapper: f.wrapper });
  fireEvent.click(await screen.findByRole("button", { name: "Submit twice" }));
  await waitFor(() => expect(f.invoke.mock.calls.filter(([ch]) => ch === CHANNELS.connections.saveCredentials)).toHaveLength(1));
  await act(async () => { save.resolve({ success: true, data: { revision: "saved" } }); });
  await screen.findByText("Choose repos"); expect(f.props.fetchAllResources).toHaveBeenCalledTimes(1);
});
it("retires a pending credential tail across an A to B to A transport swap", async () => {
  const save = deferred<any>(), f = fixture((ch) => ch === CHANNELS.connections.saveCredentials ? save.promise : undefined);
  render(<ResourceWizardModal {...f.props} />, { wrapper: f.wrapper }); await submit();
  await waitFor(() => expect(f.invoke.mock.calls.some(([ch]) => ch === CHANNELS.connections.saveCredentials)).toBe(true));
  const original = getTransport();
  act(() => { setTransport({ ...original, invoke: vi.fn() } as Transport); setTransport(original); });
  await act(async () => { save.resolve({ success: true, data: { revision: "saved" } }); });
  expect(f.props.fetchAllResources).not.toHaveBeenCalled(); expect(f.props.onSuccess).not.toHaveBeenCalled();
  expect((await screen.findByPlaceholderText("Token") as HTMLInputElement).value).toBe("");
});
