// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { Provider, useDispatch, useSelector } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";
import workspaceReducer from "@/lib/redux/slices/workspaceSlice";
import { runOwnerKey } from "../../../../shared/ui-state-keys";
import type { Run } from "../types";

const mocks = vi.hoisted(() => ({
  provider: { config: { sandboxMode: "workspace-write", modelReasoningEffort: "medium" } },
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
  mocks.invoke.mockReset().mockResolvedValue({ success: true });
  mocks.transport = { invoke: mocks.invoke };
});

describe("conversation composer settings", () => {
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
    const { wrapper } = setup();
    const ownerKey = JSON.stringify(["local", "draft", "space", "codex", "developer", "workspace", null]);
    const { result } = renderHook(() => useConversationSettings({ providerId: "codex", ownerKey, runId: null, loadingRun: false }), { wrapper });
    const submitted = result.current.settings;
    await act(async () => { await result.current.changeModel("model-b"); });
    await act(async () => { await result.current.saveDraftSettingsToRun("created-run", submitted); });
    expect(mocks.invoke).toHaveBeenCalledWith("runs:update", ["created-run", {
      conversationSettings: expect.objectContaining({ model: "model-b" }),
    }]);
  });
});
