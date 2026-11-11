// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginMutation } from "@mains/backend/shared/plugin-mutation-lifecycle";
import { setTransport, resetTransport } from "@/lib/transport/registry";
import type { Transport } from "@/lib/transport/types";

const mocks = vi.hoisted(() => ({ install: vi.fn(), uninstall: vi.fn(), enable: vi.fn(), update: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/redux/api", () => ({
  useInstallProviderPluginMutation: () => [mocks.install],
  useUninstallProviderPluginMutation: () => [mocks.uninstall],
  useSetProviderPluginEnabledMutation: () => [mocks.enable],
  useUpdateProviderPluginMutation: () => [mocks.update],
}));
vi.mock("@/components/ui", () => ({ toast: { success: mocks.success, error: mocks.error } }));
import { usePluginMutations } from "./use-plugin-mutations";

function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fakeTransport(): Transport {
  return { kind: "fixture", invoke: vi.fn(), subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} };
}
const install: PluginMutation = { type: "install", pluginId: "demo@market", scope: "user" };
const actions = [
  { request: install, mutation: mocks.install, message: "installed" },
  { request: { type: "uninstall", pluginId: install.pluginId } as PluginMutation, mutation: mocks.uninstall, message: "uninstalled" },
  { request: { type: "setEnabled", pluginId: install.pluginId, enabled: true } as PluginMutation, mutation: mocks.enable, message: "enabled" },
  { request: { type: "setEnabled", pluginId: install.pluginId, enabled: false } as PluginMutation, mutation: mocks.enable, message: "disabled" },
  { request: { type: "update", pluginId: install.pluginId } as PluginMutation, mutation: mocks.update, message: "updated" },
];
beforeEach(() => {
  vi.resetAllMocks();
  setTransport(fakeTransport());
  for (const { mutation } of actions) mutation.mockReturnValue({ unwrap: async () => {} });
});
afterEach(() => { cleanup(); resetTransport(); });

describe("plugin mutation ownership", () => {
  it("claims synchronously against every competing action and releases only after settlement", async () => {
    const native = deferred();
    mocks.install.mockReturnValueOnce({ unwrap: () => native.promise });
    const { result } = renderHook(() => usePluginMutations("claude_code"));
    let started!: Promise<void>;
    await act(async () => {
      started = result.current.perform(install);
      await Promise.all(actions.map(({ request }) => result.current.perform(request)));
    });
    expect(mocks.install).toHaveBeenCalledTimes(1);
    expect(mocks.uninstall).not.toHaveBeenCalled();
    expect(mocks.enable).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(result.current.pending(install.pluginId)?.type).toBe("install");
    await act(async () => { native.resolve(); await started; });
    expect(result.current.pending(install.pluginId)).toBeUndefined();
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith("Plugin installed");
  });

  it("captures the installation scope and keeps other plugins independent", async () => {
    const native = deferred();
    mocks.install.mockReturnValueOnce({ unwrap: () => native.promise });
    const { result } = renderHook(() => usePluginMutations("claude_code"));
    const request: PluginMutation = { ...install, type: "install", scope: "user" };
    let started!: Promise<void>;
    act(() => { started = result.current.perform(request); });
    request.scope = "project";
    await act(async () => { await result.current.perform({ ...request, pluginId: "other@market" }); });
    expect(mocks.install).toHaveBeenNthCalledWith(1, { providerId: "claude_code", pluginId: install.pluginId, scope: "user" });
    expect(mocks.install).toHaveBeenNthCalledWith(2, { providerId: "claude_code", pluginId: "other@market", scope: "project" });
    expect(result.current.pending(install.pluginId)).toMatchObject({ type: "install", scope: "user" });
    expect(result.current.pending("other@market")).toBeUndefined();
    await act(async () => { native.resolve(); await started; });
  });

  it.each(actions)("releases a failed $message operation for an explicit retry", async ({ request, mutation, message }) => {
    mutation.mockReturnValueOnce({ unwrap: async () => { throw { data: { error: "Native operation failed" } }; } });
    const { result } = renderHook(() => usePluginMutations("claude_code"));
    await act(async () => { await result.current.perform(request); });
    expect(result.current.pending(request.pluginId)).toBeUndefined();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith("Native operation failed");
    await act(async () => { await result.current.perform(request); });
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(`Plugin ${message}`);
  });

  it("remains usable after StrictMode effect replay", async () => {
    const { result } = renderHook(() => usePluginMutations("codex"), { wrapper: StrictMode });
    await act(async () => { await result.current.perform(install); });
    expect(mocks.install).toHaveBeenCalledExactlyOnceWith({ providerId: "codex", pluginId: install.pluginId, scope: "user" });
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith("Plugin installed");
  });

  it.each(["success", "failure"])("ignores the old provider's late %s without releasing the replacement's claim", async (outcome) => {
    const old = deferred(), current = deferred();
    mocks.install.mockReturnValueOnce({ unwrap: () => old.promise }).mockReturnValueOnce({ unwrap: () => current.promise });
    const { result, rerender } = renderHook(({ providerId }) => usePluginMutations(providerId), { initialProps: { providerId: "claude_code" } });
    let first!: Promise<void>, second!: Promise<void>;
    const retained = result.current.perform;
    act(() => { first = result.current.perform(install); });
    rerender({ providerId: "codex" });
    await act(async () => { await retained({ type: "update", pluginId: "other@market" }); second = result.current.perform(install); });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.install).toHaveBeenNthCalledWith(2, { providerId: "codex", pluginId: install.pluginId, scope: "user" });
    await act(async () => { if (outcome === "success") old.resolve(); else old.reject(new Error("Old failure")); await first; });
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(result.current.pending(install.pluginId)?.type).toBe("install");
    await act(async () => { current.resolve(); await second; });
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith("Plugin installed");
  });

  it("retires every backend binding even through a batched round trip", async () => {
    const original = fakeTransport(); setTransport(original);
    const old = deferred(), current = deferred();
    mocks.install.mockReturnValueOnce({ unwrap: () => old.promise });
    mocks.update.mockReturnValueOnce({ unwrap: () => current.promise });
    const { result } = renderHook(() => usePluginMutations("codex"));
    let first!: Promise<void>, second!: Promise<void>;
    act(() => { first = result.current.perform(install); });
    const retained = result.current.perform;
    act(() => { setTransport(fakeTransport()); setTransport(original); });
    expect(result.current.pending(install.pluginId)).toBeUndefined();
    await act(async () => { await retained(install); second = result.current.perform({ type: "update", pluginId: install.pluginId }); });
    expect(mocks.install).toHaveBeenCalledTimes(1);
    await act(async () => { old.reject(new Error("Old backend failed")); await first; });
    expect(mocks.error).not.toHaveBeenCalled();
    expect(result.current.pending(install.pluginId)?.type).toBe("update");
    await act(async () => { current.resolve(); await second; });
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith("Plugin updated");
  });

  it.each(["success", "failure"])("suppresses notifications and retained actions after unmount (%s)", async (outcome) => {
    const native = deferred(); mocks.install.mockReturnValueOnce({ unwrap: () => native.promise });
    const { result, unmount } = renderHook(() => usePluginMutations("claude_code"));
    const retained = result.current.perform;
    let started!: Promise<void>;
    act(() => { started = retained(install); });
    unmount();
    await retained({ type: "update", pluginId: "other@market" });
    if (outcome === "success") native.resolve(); else native.reject(new Error("Retired failure"));
    await started;
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("retires retained actions before the replacement provider's layout effects", async () => {
    const retained: { perform?: ReturnType<typeof usePluginMutations>["perform"] } = {};
    const { result, rerender } = renderHook(({ providerId }) => {
      const mutations = usePluginMutations(providerId);
      useLayoutEffect(() => { if (providerId === "codex") void retained.perform?.(install); }, [providerId]);
      return mutations;
    }, { initialProps: { providerId: "claude_code" } });
    retained.perform = result.current.perform;
    await act(async () => { rerender({ providerId: "codex" }); });
    expect(mocks.install).not.toHaveBeenCalled();
  });
});
