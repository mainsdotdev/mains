// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { Provider, useDispatch, useSelector } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";
import workspaceReducer, { rememberRunSettings, setConversationSettings } from "@/lib/redux/slices/workspaceSlice";
import { providerSettingsKey, runOwnerKey } from "../../../../shared/ui-state-keys";
import { snapshotRunSettingConfig, type ConversationSettings } from "@mains/contracts/run-settings";
import type { Run } from "../types";

const mocks = vi.hoisted(() => ({
  provider: { defaultModel: "", config: { sandboxMode: "workspace-write", modelReasoningEffort: "medium" } as Record<string, unknown> },
  getState: vi.fn(), invoke: vi.fn(), transport: {} as { invoke: (...args: unknown[]) => Promise<any> },
}));
vi.mock("@/lib/redux/hooks", () => ({ useAppDispatch: useDispatch, useAppSelector: useSelector }));
vi.mock("@/lib/redux", () => ({ store: { getState: () => mocks.getState() } }));
vi.mock("@/lib/transport", () => ({
  getTransport: () => mocks.transport,
  appEvents: { providers: { onModelsUpdated: () => () => {} } },
}));
vi.mock("@/lib/redux/api/providersApi", () => ({
  useGetProviderByIdQuery: () => ({ data: mocks.provider }),
  useGetProviderModelsQuery: () => ({ data: [
    { id: "model-a", displayName: "Model A", supportedEffortLevels: ["low", "medium", "high", "ultra", "FutureEffort"] },
    { id: "model-b", displayName: "Model B", supportedEffortLevels: ["low", "medium", "high"] },
  ] }),
  useGetProviderCommandsQuery: () => ({ data: [] }),
  useGetProviderSkillsQuery: () => ({ data: [] }),
}));
vi.mock("@/components/ui", () => ({ toast: { error: vi.fn() } }));

import { useConversationSettings } from "./use-conversation-settings";
import { useProviderModels } from "./use-provider-models";

function setup() {
  const store = configureStore({ reducer: { workspace: workspaceReducer } });
  mocks.getState.mockImplementation(() => store.getState());
  const wrapper = ({ children }: { children: ReactNode }) => createElement(Provider, { store } as ComponentProps<typeof Provider>, children);
  return { store, wrapper };
}
function run(id: string, model: string, permission: string, effort: string): Run {
  return { id, providerId: "codex", status: "succeeded", goal: "hello", model,
    configSnapshot: { conversationSettings: { model, config: { sandboxMode: permission, modelReasoningEffort: effort, thinkingMode: !!effort } } } };
}

beforeEach(() => {
  mocks.provider = { defaultModel: "", config: { sandboxMode: "workspace-write", modelReasoningEffort: "medium" } };
  mocks.invoke.mockReset().mockResolvedValue({ success: true });
  mocks.transport = { invoke: mocks.invoke };
});

describe("conversation composer settings", () => {
  it.each([
    ["retired-model", "high", "model-a", "high"],
    ["model-b", "FutureEffort", "model-b", "high"],
  ])("corrects old model/effort %s/%s without replacing last-used defaults", async (model, effort, expectedModel, expectedEffort) => {
    const { wrapper, store } = setup();
    store.dispatch(rememberRunSettings({ backendId: null, providerId: "codex", settings: {
      model: "model-b", config: { sandboxMode: "read-only", modelReasoningEffort: "low", thinkingMode: true },
    } }));
    const remembered = store.getState().workspace.lastRunSettingsByProvider[providerSettingsKey(null, "codex")];
    const selected = run("old-settings", model, "danger-full-access", effort);
    const { result } = renderHook(() => {
      const conversation = useConversationSettings({ providerId: "codex", ownerKey: runOwnerKey(null, selected.id), runId: selected.id, run: selected, loadingRun: false });
      const models = useProviderModels("codex", "codex", conversation.settings.model, conversation.changeModel,
        undefined, conversation.settings.config, conversation.changeConfig, conversation.ready);
      return { conversation, models };
    }, { wrapper });
    await waitFor(() => expect(result.current.models).toMatchObject({ selectedModel: expectedModel, effortLevel: expectedEffort }));
    expect(store.getState().workspace.lastRunSettingsByProvider[providerSettingsKey(null, "codex")]).toBe(remembered);
    expect(store.getState().workspace.runSettingsIntentByProvider).toEqual({});
    // An explicit selection in this chat must still become the next-run default.
    await act(async () => { await result.current.models.handlePermissionModeChange("workspace-write"); });
    expect(store.getState().workspace.lastRunSettingsByProvider[providerSettingsKey(null, "codex")])
      .toMatchObject({ model: expectedModel, config: { sandboxMode: "workspace-write", modelReasoningEffort: expectedEffort } });
  });

  it.each(["older-first", "newer-first"])("orders successful defaults by intent when responses arrive %s", async (order) => {
    const { wrapper, store } = setup();
    const a = run("pending-a", "model-a", "danger-full-access", "high");
    const b = run("newer-b", "model-b", "read-only", "low");
    const { result, rerender } = renderHook(({ selected }) => useConversationSettings({
      providerId: "codex", ownerKey: runOwnerKey(null, selected.id), runId: selected.id, run: selected, loadingRun: false,
    }), { wrapper, initialProps: { selected: a } });
    let revisionA!: number;
    act(() => { revisionA = result.current.beginSettingsIntent(); });
    const settingsA = result.current.settings;
    const finishA = result.current.rememberSettings;
    rerender({ selected: b });
    let revisionB!: number;
    act(() => { revisionB = result.current.beginSettingsIntent(); });
    const settingsB = result.current.settings;
    if (order === "older-first") {
      act(() => { finishA(settingsA, revisionA); });
      // B has not succeeded yet. A remains the valid fallback if B fails.
      expect(store.getState().workspace.lastRunSettingsByProvider[providerSettingsKey(null, "codex")].model).toBe("model-a");
    }
    act(() => { result.current.rememberSettings(settingsB, revisionB); });
    act(() => { finishA(settingsA, revisionA); });
    expect(store.getState().workspace.lastRunSettingsByProvider[providerSettingsKey(null, "codex")])
      .toMatchObject({ model: "model-b", config: { sandboxMode: "read-only" } });
  });

  it("keeps pending settings intents independent across backends", async () => {
    const { wrapper, store } = setup();
    const selected = run("same-id", "model-a", "workspace-write", "high");
    const { result, rerender } = renderHook(({ backendId }: { backendId: string | null }) => useConversationSettings({
      backendId, providerId: "codex", ownerKey: runOwnerKey(backendId, selected.id), runId: selected.id, run: selected, loadingRun: false,
    }), { wrapper, initialProps: { backendId: null as string | null } });
    let revision!: number;
    act(() => { revision = result.current.beginSettingsIntent(); });
    const submitted = result.current.settings;
    const finishLocal = result.current.rememberSettings;
    rerender({ backendId: "remote" });
    await act(async () => { await result.current.changeConfig({ sandboxMode: "read-only" }); });
    act(() => { finishLocal(submitted, revision); });
    expect(store.getState().workspace.lastRunSettingsByProvider).toMatchObject({
      [providerSettingsKey(null, "codex")]: { config: { sandboxMode: "workspace-write" } },
      [providerSettingsKey("remote", "codex")]: { config: { sandboxMode: "read-only" } },
    });
  });

  it.each([
    ["claude_code", "permissionMode", "bypassPermissions"],
    ["codex", "sandboxMode", "danger-full-access"],
    ["copilot_cli", "permissionMode", "acceptEdits"],
    ["cursor", "mode", "ask"],
  ])("inherits the latest %s run controls and resets Plan/Goal when opening New Run", async (providerId, permissionKey, permission) => {
    const { wrapper, store } = setup();
    const selected = { ...run("existing", "model-a", "read-only", "medium"), providerId };
    const draftKey = JSON.stringify(["local", "draft", "space", providerId, "developer", "ws", null]);
    // A previously visited New Run draft must not mask newer run preferences.
    store.dispatch(setConversationSettings({ key: draftKey, settings: { model: "stale-draft", config: { planMode: true } } }));
    const { result, rerender } = renderHook(({ draft }) => useConversationSettings({
      providerId, ownerKey: draft ? draftKey : runOwnerKey(null, selected.id),
      runId: draft ? null : selected.id, run: draft ? undefined : selected, loadingRun: false,
    }), { wrapper, initialProps: { draft: false } });
    const latest: ConversationSettings = { model: "model-b", config: {
      [permissionKey]: permission, effortLevel: "high", modelReasoningEffort: "ultra",
      thinkingMode: true, ultracode: true, fastMode: true, serviceTier: "fast", planMode: true, goalMode: true,
    } };
    await act(async () => { await result.current.changeSettings(latest); });
    rerender({ draft: true });
    expect(result.current.settings).toEqual({
      model: latest.model,
      config: { ...snapshotRunSettingConfig(providerId, { ...latest.config }), planMode: false, goalMode: false },
    });
    // Plan can be deliberately enabled for this draft without becoming a default.
    await act(async () => { await result.current.changeConfig({ planMode: true }); });
    expect(result.current.settings.config.planMode).toBe(true);
    rerender({ draft: false });
    expect(result.current.settings).toEqual(latest);
    rerender({ draft: true });
    expect(result.current.settings.config).toMatchObject({ planMode: false, goalMode: false });
  });

  it("keeps Off and disabled fast mode, and does not replace defaults just by opening an old chat", async () => {
    const { wrapper, store } = setup();
    const latest = { model: "model-b", config: { modelReasoningEffort: "", thinkingMode: false, serviceTier: "", fastMode: false, sandboxMode: "read-only" } };
    store.dispatch(rememberRunSettings({ backendId: null, providerId: "codex", settings: latest }));
    const old = run("old", "model-a", "danger-full-access", "high");
    const { result, rerender } = renderHook(({ draft }) => useConversationSettings({
      providerId: "codex", ownerKey: draft ? JSON.stringify(["local", "draft"]) : runOwnerKey(null, old.id),
      runId: draft ? null : old.id, run: draft ? undefined : old, loadingRun: false,
    }), { wrapper, initialProps: { draft: false } });
    expect(result.current.settings.model).toBe("model-a");
    rerender({ draft: true });
    expect(result.current.settings).toMatchObject(latest);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await act(async () => { await result.current.changeModel("unsent-model"); });
    expect(store.getState().workspace.lastRunSettingsByProvider[providerSettingsKey(null, "codex")].model).toBe("model-b");
  });

  it("scopes inherited defaults by backend and provider and starts provider Plan/Goal defaults off", () => {
    const { wrapper, store } = setup();
    mocks.provider.defaultModel = "provider-default";
    mocks.provider.config = { goalMode: true, planMode: true };
    store.dispatch(rememberRunSettings({ backendId: null, providerId: "codex", settings: { model: "local-codex", config: {} } }));
    store.dispatch(rememberRunSettings({ backendId: "remote", providerId: "claude_code", settings: { model: "remote-claude", config: {} } }));
    const { result, rerender } = renderHook(({ backendId, providerId }: { backendId: string | null; providerId: string }) => useConversationSettings({
      backendId, providerId, ownerKey: JSON.stringify([backendId ?? "local", "draft", "space", providerId]), runId: null, loadingRun: false,
    }), { wrapper, initialProps: { backendId: null as string | null, providerId: "codex" } });
    expect(result.current.settings.model).toBe("local-codex");
    rerender({ backendId: "remote", providerId: "codex" });
    expect(result.current.settings).toMatchObject({ model: "provider-default", config: { goalMode: false, planMode: false } });
    rerender({ backendId: "remote", providerId: "claude_code" });
    expect(result.current.settings.model).toBe("remote-claude");
    rerender({ backendId: null, providerId: "claude_code" });
    expect(result.current.settings.model).toBe("provider-default");
  });

  it("inherits an existing-run selection immediately while its backend save is pending", async () => {
    const { wrapper, store } = setup();
    const selected = run("pending-edit", "model-a", "read-only", "high");
    const { result, rerender } = renderHook(({ draft }) => useConversationSettings({
      providerId: "codex", ownerKey: draft ? JSON.stringify(["local", "draft"]) : runOwnerKey(null, selected.id),
      runId: draft ? null : selected.id, run: draft ? undefined : selected, loadingRun: false,
    }), { wrapper, initialProps: { draft: false } });
    let finish!: (result: { success: boolean }) => void;
    mocks.invoke.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let saving!: Promise<boolean>;
    act(() => { saving = result.current.changeModel("model-b"); });
    rerender({ draft: true });
    expect(result.current.settings.model).toBe("model-b");
    expect(store.getState().workspace.lastRunSettingsByProvider[providerSettingsKey(null, "codex")].model).toBe("model-b");
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    await act(async () => { finish({ success: true }); await saving; });
  });

  it.each(["ultra", "FutureEffort"])("saves and restores advertised effort %j and clamps only on an unsupported model", async (effort) => {
    const selected = run("dynamic-effort", "model-a", "read-only", "medium");
    const useControls = () => {
      const conversation = useConversationSettings({ providerId: "codex", ownerKey: runOwnerKey(null, selected.id), runId: selected.id, run: selected, loadingRun: false });
      const models = useProviderModels("codex", "codex", conversation.settings.model, conversation.changeModel,
        undefined, conversation.settings.config, conversation.changeConfig);
      return { conversation, models };
    };
    const { wrapper } = setup();
    const first = renderHook(useControls, { wrapper });
    expect(first.result.current.models.selectedModelInfo?.supportedEffortLevels).toContain(effort);
    await act(async () => { await first.result.current.models.handleEffortLevelChange(effort); });
    const saved = first.result.current.conversation.settings;
    expect(saved.config.modelReasoningEffort).toBe(effort);
    expect(mocks.invoke).toHaveBeenLastCalledWith("runs:update", [selected.id, { conversationSettings: saved }]);
    first.unmount();

    selected.configSnapshot = { conversationSettings: saved };
    const fresh = setup();
    const restored = renderHook(useControls, { wrapper: fresh.wrapper });
    expect(restored.result.current.models.effortLevel).toBe(effort);
    await act(async () => { restored.result.current.models.handleModelChange("model-b"); });
    expect(restored.result.current.models).toMatchObject({ selectedModel: "model-b", effortLevel: "high" });
    expect(restored.result.current.conversation.settings.config.modelReasoningEffort).toBe("high");
  });

  it("restores each chat's controls and keeps changes out of another chat and the provider defaults", async () => {
    const { wrapper } = setup();
    const a = run("a", "model-a", "read-only", "high");
    const b = run("b", "model-b", "danger-full-access", "low");
    const { result, rerender } = renderHook(({ selected }: { selected: Run }) => {
      const conversation = useConversationSettings({ providerId: "codex", ownerKey: runOwnerKey(null, selected.id), runId: selected.id, run: selected, loadingRun: false });
      const models = useProviderModels("codex", "codex", conversation.settings.model, conversation.changeModel,
        undefined, conversation.settings.config, conversation.changeConfig);
      return { conversation, models };
    }, { wrapper, initialProps: { selected: a } });
    expect(result.current.models).toMatchObject({ selectedModel: "model-a", permissionMode: "read-only", effortLevel: "high" });
    rerender({ selected: b });
    await act(async () => {
      await result.current.models.handlePermissionModeChange("workspace-write");
      await result.current.models.handleEffortLevelChange("");
    });
    expect(result.current.models).toMatchObject({ selectedModel: "model-b", permissionMode: "workspace-write", effortLevel: "" });
    rerender({ selected: a });
    expect(result.current.models).toMatchObject({ selectedModel: "model-a", permissionMode: "read-only", effortLevel: "high" });
    expect(mocks.provider.config).toEqual({ sandboxMode: "workspace-write", modelReasoningEffort: "medium" });
    expect(mocks.invoke.mock.calls.every((call) => call[1][0] === "b")).toBe(true);
  });

  it("loads persisted run settings in a fresh renderer and scopes identical run ids by backend", () => {
    const a = run("same-id", "model-a", "read-only", "high");
    const b = run("same-id", "model-b", "workspace-write", "low");
    const { wrapper } = setup();
    const { result, rerender, unmount } = renderHook(({ backend, selected }: { backend: string; selected: Run }) => useConversationSettings({
      providerId: "codex", ownerKey: runOwnerKey(backend, selected.id), runId: selected.id, run: selected, loadingRun: false,
    }), { wrapper, initialProps: { backend: "local", selected: a } });
    rerender({ backend: "remote", selected: b });
    expect(result.current.settings.model).toBe("model-b");
    rerender({ backend: "local", selected: a });
    expect(result.current.settings.model).toBe("model-a");
    unmount();
    const fresh = setup();
    const restored = renderHook(() => useConversationSettings({ providerId: "codex", ownerKey: runOwnerKey(null, a.id), runId: a.id, run: a, loadingRun: false }), { wrapper: fresh.wrapper });
    expect(restored.result.current.settings).toEqual(a.configSnapshot?.conversationSettings);
  });

  it("waits for historical turns before seeding and persisting a legacy chat's last model", async () => {
    const { wrapper, store } = setup();
    const legacy = { ...run("legacy", "model-a", "read-only", "high"), configSnapshot: null };
    const ownerKey = runOwnerKey(null, legacy.id);
    const { result, rerender } = renderHook(({ loading, latestModel }: { loading: boolean; latestModel?: string }) => useConversationSettings({
      providerId: "codex", ownerKey, runId: legacy.id, run: legacy, loadingRun: loading, latestModel,
    }), { wrapper, initialProps: { loading: true, latestModel: undefined as string | undefined } });
    expect(store.getState().workspace.conversationSettingsByKey[ownerKey]).toBeUndefined();
    await act(async () => { rerender({ loading: false, latestModel: "model-b" }); });
    expect(result.current.settings.model).toBe("model-b");
    expect(mocks.invoke).toHaveBeenCalledWith("runs:update", [legacy.id, {
      conversationSettings: expect.objectContaining({ model: "model-b" }),
    }]);
  });

  it("keeps catalog defaults from replacing a chat while its record is loading", async () => {
    const { wrapper, store } = setup();
    const ownerKey = runOwnerKey(null, "loading");
    const saved = run("loading", "model-b", "read-only", "high");
    const { result, rerender } = renderHook(({ selected }: { selected?: Run }) => {
      const conversation = useConversationSettings({ providerId: "codex", ownerKey, runId: "loading", run: selected, loadingRun: !selected });
      const models = useProviderModels("codex", "codex", conversation.settings.model, conversation.changeModel,
        undefined, conversation.settings.config, conversation.changeConfig, conversation.ready);
      return { conversation, models };
    }, { wrapper, initialProps: { selected: undefined as Run | undefined } });
    expect(result.current.conversation.ready).toBe(false);
    await act(async () => { expect(await result.current.conversation.changeModel("model-a")).toBe(false); });
    expect(store.getState().workspace.conversationSettingsByKey[ownerKey]).toBeUndefined();
    expect(mocks.invoke).not.toHaveBeenCalled();
    rerender({ selected: saved });
    expect(result.current.models).toMatchObject({ selectedModel: "model-b", permissionMode: "read-only", effortLevel: "high" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("remembers a selection changed while the first message was starting", async () => {
    const { wrapper, store } = setup();
    const ownerKey = JSON.stringify(["local", "draft", "space", "codex", "developer", "workspace", null]);
    const { result } = renderHook(() => useConversationSettings({ providerId: "codex", ownerKey, runId: null, loadingRun: false }), { wrapper });
    const submitted = result.current.settings;
    let revision!: number;
    act(() => { revision = result.current.beginSettingsIntent(); });
    await act(async () => { await result.current.changeModel("model-b"); });
    await act(async () => { await result.current.saveDraftSettingsToRun("created-run", submitted); });
    act(() => { result.current.rememberSettings(submitted, revision); });
    expect(store.getState().workspace.lastRunSettingsByProvider[providerSettingsKey(null, "codex")].model).toBe("model-b");
    expect(mocks.invoke).toHaveBeenCalledWith("runs:update", ["created-run", {
      conversationSettings: expect.objectContaining({ model: "model-b" }),
    }]);
  });
});
