import { configureStore } from "@reduxjs/toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "./baseApi";
import { providersApi, type AccountInfo, type Provider } from "./providersApi";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/transport", () => ({ getTransport: () => ({ invoke: mocks.invoke }) }));

function createStore() {
  return configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefault) => getDefault().concat(baseApi.middleware),
  });
}

let store: ReturnType<typeof createStore>;
let provider: Provider;
let account: AccountInfo;
let revision: number;
let cliUpdateSuccess: boolean;
const subscriptions: Array<{ unsubscribe(): void }> = [];
const calls = (channel: string, id = "claude_code") => mocks.invoke.mock.calls.filter(
  ([handler, args]) => handler === channel && args?.[0] === id,
).length;
const commands = (workspacePath: string, id = "claude_code") => ({ id, workspacePath });
const detail = { providerId: "claude_code", pluginName: "demo", marketplacePath: "/market" };

beforeEach(() => {
  store = createStore();
  revision = 1;
  cliUpdateSuccess = true;
  provider = { id: "claude_code", kind: "agent_runtime", displayName: "Claude", isEnabled: true,
    config: { binary: "/claude" }, capabilities: null, defaultModel: null, createdAt: 0, updatedAt: 0 };
  account = { account: null, requiresOpenaiAuth: false };
  mocks.invoke.mockImplementation(async (handler, args) => {
    if (handler === CHANNELS.providers.getById) return { success: true, data: provider };
    if (handler === CHANNELS.providers.getAccountInfo) return { success: true, data: account };
    if (handler === CHANNELS.providers.update) {
      provider = { ...provider, ...args[1] };
      return { success: true, data: provider };
    }
    if (handler === CHANNELS.providers.readPlugin) return { success: true, data: { description: `v${revision}` } };
    if (handler === CHANNELS.providers.updateCli) return { success: true, data: { success: cliUpdateSuccess, output: "" } };
    return { success: true, data: [{ name: `v${revision}` }] };
  });
});

afterEach(() => {
  for (const subscription of subscriptions.splice(0)) subscription.unsubscribe();
  store.dispatch(baseApi.util.resetApiState());
  vi.resetAllMocks();
});

async function watchCommands(path = "/workspace", id = "claude_code") {
  const subscription = store.dispatch(providersApi.endpoints.getProviderCommands.initiate(commands(path, id)));
  subscriptions.push(subscription);
  await subscription.unwrap();
}

describe("provider discovery cache", () => {
  it.each(["install", "uninstall", "enable", "update"])(
    "refreshes commands in every workspace and plugin details after plugin %s, scoped to its provider",
    async (operation) => {
      await watchCommands("/first");
      await watchCommands("/second");
      await watchCommands("/other", "codex");
      const skills = store.dispatch(providersApi.endpoints.getProviderSkills.initiate(commands("/other", "codex")));
      const plugin = store.dispatch(providersApi.endpoints.readProviderPlugin.initiate(detail));
      subscriptions.push(skills, plugin);
      await Promise.all([skills.unwrap(), plugin.unwrap()]);
      revision = 2;
      const input = { providerId: "claude_code", pluginId: "demo@market" };
      const mutation = operation === "install" ? providersApi.endpoints.installProviderPlugin.initiate(input)
        : operation === "uninstall" ? providersApi.endpoints.uninstallProviderPlugin.initiate(input)
          : operation === "enable" ? providersApi.endpoints.setProviderPluginEnabled.initiate({ ...input, enabled: false })
            : providersApi.endpoints.updateProviderPlugin.initiate(input);
      await store.dispatch(mutation).unwrap();

      await vi.waitFor(() => {
        expect(providersApi.endpoints.getProviderCommands.select(commands("/first"))(store.getState()).data?.[0].name).toBe("v2");
        expect(providersApi.endpoints.getProviderCommands.select(commands("/second"))(store.getState()).data?.[0].name).toBe("v2");
        expect(providersApi.endpoints.readProviderPlugin.select(detail)(store.getState()).data?.description).toBe("v2");
      });
      expect(calls(CHANNELS.providers.getCommands, "codex")).toBe(1);
      expect(calls(CHANNELS.providers.getSkills, "codex")).toBe(1);
    },
  );

  it.each([
    { binary: "/other-claude" }, { settingSources: ["project"] }, { plugins: [{ path: "/plugin" }] },
  ])("refreshes discovery after catalog settings change to %o, but preserves it for execution preferences", async (config) => {
    const providerQuery = store.dispatch(providersApi.endpoints.getProviderById.initiate(provider.id));
    subscriptions.push(providerQuery);
    await providerQuery.unwrap();
    await watchCommands();
    await store.dispatch(providersApi.endpoints.updateProvider.initiate({
      id: provider.id, payload: { config: { ...provider.config, effortLevel: "high" } },
    })).unwrap();
    expect(calls(CHANNELS.providers.getCommands)).toBe(1);

    revision = 2;
    await store.dispatch(providersApi.endpoints.updateProvider.initiate({
      id: provider.id, payload: { config: { ...provider.config, ...config } },
    })).unwrap();
    await vi.waitFor(() => expect(
      providersApi.endpoints.getProviderCommands.select(commands("/workspace"))(store.getState()).data?.[0].name,
    ).toBe("v2"));
  });

  it("refreshes discovery only after a successful CLI update", async () => {
    await watchCommands();
    cliUpdateSuccess = false;
    await store.dispatch(providersApi.endpoints.updateProviderCli.initiate(provider.id)).unwrap();
    expect(calls(CHANNELS.providers.getCommands)).toBe(1);
    cliUpdateSuccess = true;
    revision = 2;
    await store.dispatch(providersApi.endpoints.updateProviderCli.initiate(provider.id)).unwrap();
    await vi.waitFor(() => expect(
      providersApi.endpoints.getProviderCommands.select(commands("/workspace"))(store.getState()).data?.[0].name,
    ).toBe("v2"));
  });

  it("keeps discovery after an unsuccessful account check or settings write", async () => {
    const probe = store.dispatch(providersApi.endpoints.getProviderAccountInfo.initiate(provider.id));
    subscriptions.push(probe);
    await probe.unwrap();
    await watchCommands();
    mocks.invoke.mockResolvedValueOnce({ success: false, error: "offline" });
    await expect(probe.refetch().unwrap()).rejects.toBe("offline");
    mocks.invoke.mockResolvedValueOnce({ success: false, error: "write failed" });
    await expect(store.dispatch(providersApi.endpoints.updateProvider.initiate({
      id: provider.id, payload: { config: { binary: "/other" } },
    })).unwrap()).rejects.toBe("write failed");
    expect(calls(CHANNELS.providers.getCommands)).toBe(1);
  });

  it("refreshes cached discovery when an account or plan changes, without refreshing it on unchanged checks", async () => {
    const probe = store.dispatch(providersApi.endpoints.getProviderAccountInfo.initiate(provider.id));
    subscriptions.push(probe);
    await probe.unwrap();
    await watchCommands();
    await probe.refetch().unwrap();
    expect(calls(CHANNELS.providers.getCommands)).toBe(1);

    for (const nextAccount of [
      { type: "claude" as const, email: "user@example.test", planType: "Pro" },
      { type: "claude" as const, email: "user@example.test", planType: "Max" },
      null,
    ]) {
      revision++;
      account = { ...account, account: nextAccount };
      await probe.refetch().unwrap();
      await vi.waitFor(() => expect(
        providersApi.endpoints.getProviderCommands.select(commands("/workspace"))(store.getState()).data?.[0].name,
      ).toBe(`v${revision}`));
    }
  });
});
