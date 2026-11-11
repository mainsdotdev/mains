// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ get: vi.fn(), revoke: vi.fn() }));
vi.mock("@/lib/redux/api", () => ({ useLazyGetConnectionQuery: () => [h.get], useRevokeConnectionMutation: () => [h.revoke, { isLoading: false }] }));
vi.mock("@/components/ui", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/with-min-delay", () => ({ withMinDelay: <T,>(work: Promise<T>) => work }));
import { useConnectionModalState } from "./use-connection-modal-state";
import { createConnectionWizardLifecycle } from "../../../lib/connection-wizard-lifecycle";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("does not replace a reopened provider with an old initialization response", async () => {
  const old = deferred<any>();
  h.get.mockImplementation((key: { id: string }) => ({ unwrap: () => Promise.resolve({ id: key.id, revision: key.id, status: "active" }) }));
  const owner = createConnectionWizardLifecycle(() => true); owner.attach();
  const options = { open: true, onClose: vi.fn(), isConnected: true, provider: "github", appName: "GitHub", baseData: {}, fetchSelected: () => old.promise, owner };
  const hook = renderHook((props) => useConnectionModalState(props), { initialProps: options });
  await act(async () => {});
  hook.rerender({ ...options, open: false });
  hook.rerender({ ...options, open: true, provider: "linear", fetchSelected: async () => ({ connectionId: "linear", current: ["new"] }) });
  await waitFor(() => expect(hook.result.current.initState.data).toMatchObject({ connectionId: "linear" }));
  await act(async () => { old.resolve({ connectionId: "github", current: ["old"] }); });
  expect(hook.result.current.initState.data).toMatchObject({ connectionId: "linear" });
});
