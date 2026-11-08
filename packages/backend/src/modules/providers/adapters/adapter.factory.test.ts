import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderDriver } from "../../../../shared/adapter.types";
import type { ProviderResponse } from "../providers.dto";
import { ResourceCleanupError } from "../../../runtime/resource-lifecycle";

const createCodexDriver = vi.fn();
const createClaudeDriver = vi.fn();
const createCopilotDriver = vi.fn();
const createCursorDriver = vi.fn();

vi.mock("./codex/codex.driver", () => ({ createCodexDriver: (c: any) => createCodexDriver(c) }));
vi.mock("./claude/claude.driver", () => ({ createClaudeDriver: (c: any) => createClaudeDriver(c) }));
vi.mock("./copilot/copilot.driver", () => ({ createCopilotDriver: (c: any) => createCopilotDriver(c) }));
vi.mock("./cursor/cursor.driver", () => ({ createCursorDriver: (c: any) => createCursorDriver(c) }));

import {
  clearAdapterCache,
  createWorkAdapter,
  getAccountInfoForProvider,
  updateCliForProvider,
  listSkillsForProvider,
  refreshWorkAdapterConfig,
  getWorkAdapter,
  shutdownWorkAdapter,
  shutdownAllWorkAdapters,
} from "./adapter.factory";

function fakeDriver(): ProviderDriver & { updateConfig: ReturnType<typeof vi.fn> } {
  return {
    createSession: vi.fn(),
    executePrompt: vi.fn(),
    updateConfig: vi.fn(),
  } as any;
}

function codexProvider(config: Record<string, unknown>): ProviderResponse {
  return {
    id: "codex",
    kind: "agent_runtime",
    displayName: "Codex",
    isEnabled: true,
    config,
    defaultModel: "gpt-5.6",
  } as ProviderResponse;
}

describe("createWorkAdapter", () => {
  beforeEach(() => {
    clearAdapterCache();
    vi.clearAllMocks();
  });

  it("retains a failed shutdown in the cache so the same owner can be retried", async () => {
    const driver = { ...fakeDriver(), shutdown: vi.fn().mockRejectedValueOnce(new Error("close failed")).mockResolvedValue(undefined) };
    createCodexDriver.mockReturnValue(driver);
    const provider = codexProvider({});
    const adapter = createWorkAdapter(provider);
    await expect(shutdownWorkAdapter(provider.id)).rejects.toThrow("close failed");
    expect(getWorkAdapter(provider.id)).toBe(adapter);
    expect(createWorkAdapter(provider)).toBe(adapter);
    expect(createCodexDriver).toHaveBeenCalledTimes(1);
    await shutdownWorkAdapter(provider.id);
    expect(getWorkAdapter(provider.id)).toBeUndefined();
    expect(driver.shutdown).toHaveBeenCalledTimes(2);
  });

  it("cannot evict a replacement adapter when an older shutdown completes late", async () => {
    let release!: () => void;
    const old = { ...fakeDriver(), shutdown: vi.fn(() => new Promise<void>((resolve) => { release = resolve; })) };
    createCodexDriver.mockReturnValue(old);
    const provider = codexProvider({});
    const original = createWorkAdapter(provider);
    const stopping = shutdownWorkAdapter(provider.id);
    await vi.waitFor(() => expect(old.shutdown).toHaveBeenCalledTimes(1));
    expect(getWorkAdapter(provider.id)).toBe(original);
    clearAdapterCache();
    createCodexDriver.mockReturnValue(fakeDriver());
    const replacement = createWorkAdapter(provider);
    release(); await stopping;
    expect(getWorkAdapter(provider.id)).toBe(replacement);
    await shutdownWorkAdapter(provider.id);
  });

  it("reports bulk shutdown failure, retains failed owners, and retries only those owners", async () => {
    const failed = { ...fakeDriver(), shutdown: vi.fn().mockRejectedValueOnce(new Error("native shutdown failed")).mockResolvedValue(undefined) };
    const successful = { ...fakeDriver(), shutdown: vi.fn().mockResolvedValue(undefined) };
    createCodexDriver.mockReturnValue(failed);
    createClaudeDriver.mockReturnValue(successful);
    const codex = createWorkAdapter(codexProvider({}));
    createWorkAdapter({ ...codexProvider({}), id: "claude_code", displayName: "Claude" });
    const error: unknown = await shutdownAllWorkAdapters().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ResourceCleanupError);
    expect(getWorkAdapter("codex")).toBe(codex);
    expect(getWorkAdapter("claude_code")).toBeUndefined();
    await (error as ResourceCleanupError).close();
    expect(getWorkAdapter("codex")).toBeUndefined();
    expect(failed.shutdown).toHaveBeenCalledTimes(2);
    expect(successful.shutdown).toHaveBeenCalledTimes(1);
  });

  /**
   * The bug this guards: rebuilding the driver on a config write spawned a
   * second `codex app-server` while the first still held its threads, so the
   * next resume failed with "already has an active writer".
   */
  it("refreshes the cached adapter instead of building a second driver", () => {
    const driver = fakeDriver();
    createCodexDriver.mockReturnValue(driver);

    const first = createWorkAdapter(codexProvider({ planMode: true }));
    const second = createWorkAdapter(codexProvider({ planMode: false }));

    expect(second).toBe(first);
    expect(createCodexDriver).toHaveBeenCalledTimes(1);
    expect(driver.updateConfig).toHaveBeenCalledWith({
      planMode: false,
      defaultModel: "gpt-5.6",
    });
  });

  it("folds the provider's defaultModel column into the config it builds", () => {
    const driver = fakeDriver();
    createCodexDriver.mockReturnValue(driver);

    createWorkAdapter(codexProvider({ sandboxMode: "read-only" }));

    expect(createCodexDriver).toHaveBeenCalledWith({
      sandboxMode: "read-only",
      defaultModel: "gpt-5.6",
    });
  });

  it("rejects a disabled provider before touching the cache", () => {
    expect(() =>
      createWorkAdapter({ ...codexProvider({}), isEnabled: false }),
    ).toThrow(/is not enabled/);
    expect(createCodexDriver).not.toHaveBeenCalled();
  });

  it("clears discovery after catalog settings change while retaining the live adapter", () => {
    const driver = { ...fakeDriver(), invalidateCatalogs: vi.fn() };
    createCodexDriver.mockReturnValue(driver);
    const adapter = createWorkAdapter(codexProvider({ binary: "/codex" }));
    refreshWorkAdapterConfig(codexProvider({ binary: "/codex", planMode: true }));
    expect(driver.invalidateCatalogs).not.toHaveBeenCalled();

    refreshWorkAdapterConfig(codexProvider({ binary: "/other-codex", planMode: true }));
    expect(driver.invalidateCatalogs).toHaveBeenCalledOnce();
    expect(createWorkAdapter(codexProvider({ binary: "/other-codex", planMode: false }))).toBe(adapter);
    expect(driver.invalidateCatalogs).toHaveBeenCalledOnce();
    expect(createCodexDriver).toHaveBeenCalledOnce();
  });

  it("clears account-dependent discovery on initial and changed account checks, preserving it on failures", async () => {
    const driver = { ...fakeDriver(), invalidateCatalogs: vi.fn(), getAccountInfo: vi.fn() };
    createCodexDriver.mockReturnValue(driver);
    const provider = codexProvider({});
    driver.getAccountInfo.mockResolvedValue({ account: null, requiresOpenaiAuth: false });
    await getAccountInfoForProvider(provider);
    expect(driver.invalidateCatalogs).toHaveBeenCalledOnce();
    await getAccountInfoForProvider(provider);
    expect(driver.invalidateCatalogs).toHaveBeenCalledOnce();

    driver.getAccountInfo.mockResolvedValue({
      account: { type: "chatgpt", email: "user@example.test", planType: "pro" }, requiresOpenaiAuth: false,
    });
    await getAccountInfoForProvider(provider);
    expect(driver.invalidateCatalogs).toHaveBeenCalledTimes(2);
    driver.getAccountInfo.mockRejectedValueOnce(new Error("offline"));
    await expect(getAccountInfoForProvider(provider)).rejects.toThrow("offline");
    expect(driver.invalidateCatalogs).toHaveBeenCalledTimes(2);
    await getAccountInfoForProvider(provider);
    expect(driver.invalidateCatalogs).toHaveBeenCalledTimes(2);
    expect(createCodexDriver).toHaveBeenCalledOnce();
  });

  it("clears discovery only after a successful CLI update without replacing the adapter", async () => {
    const driver = { ...fakeDriver(), invalidateCatalogs: vi.fn(), updateCli: vi.fn() };
    createCodexDriver.mockReturnValue(driver);
    const provider = codexProvider({});
    driver.updateCli.mockResolvedValueOnce({ success: false, output: "failed" });
    await updateCliForProvider(provider);
    expect(driver.invalidateCatalogs).not.toHaveBeenCalled();
    driver.updateCli.mockResolvedValueOnce({ success: true, output: "updated" });
    await updateCliForProvider(provider);
    expect(driver.invalidateCatalogs).toHaveBeenCalledOnce();
    expect(createCodexDriver).toHaveBeenCalledOnce();
  });

  it("preserves installed plugin identity as a structured mention path", async () => {
    const driver = {
      ...fakeDriver(),
      listSkills: vi.fn().mockResolvedValue([]),
      listPlugins: vi.fn().mockResolvedValue({
        marketplaces: [],
        marketplaceLoadErrors: [],
        remoteSyncError: null,
        featuredPluginIds: [],
      }),
      listInstalledPlugins: vi.fn().mockResolvedValue({
        marketplaces: [{
          name: "openai-curated-remote",
          path: "",
          interface: null,
          plugins: [{
            id: "app-694546cd042881919bb746a8dc300f38@openai-curated-remote",
            name: "app-694546cd042881919bb746a8dc300f38",
            source: { type: "remote", path: "" },
            installed: true,
            enabled: true,
            installPolicy: "AVAILABLE",
            authPolicy: "ON_INSTALL",
            interface: {
              displayName: "Skyscanner",
              capabilities: ["apps"],
              screenshots: [],
            },
          }],
        }],
        marketplaceLoadErrors: [],
        remoteSyncError: null,
        featuredPluginIds: [],
      }),
    } as ProviderDriver;
    createCodexDriver.mockReturnValue(driver);

    const skills = await listSkillsForProvider(codexProvider({}), "C:\\Repo");
    expect(driver.listInstalledPlugins).toHaveBeenCalledWith("C:\\Repo");

    expect(skills).toEqual([
      expect.objectContaining({
        name: "app-694546cd042881919bb746a8dc300f38",
        displayName: "Skyscanner",
        scope: "plugin",
        mentionPath:
          "plugin://app-694546cd042881919bb746a8dc300f38@openai-curated-remote",
      }),
    ]);
  });
});

describe("refreshWorkAdapterConfig", () => {
  beforeEach(() => {
    clearAdapterCache();
    vi.clearAllMocks();
  });

  it("pushes the new config into a live adapter", () => {
    const driver = fakeDriver();
    createCodexDriver.mockReturnValue(driver);
    createWorkAdapter(codexProvider({ planMode: true }));

    refreshWorkAdapterConfig(codexProvider({ planMode: false }));

    expect(driver.updateConfig).toHaveBeenCalledWith({
      planMode: false,
      defaultModel: "gpt-5.6",
    });
  });

  it("is a no-op when the provider has no cached adapter", () => {
    expect(() =>
      refreshWorkAdapterConfig(codexProvider({ planMode: false })),
    ).not.toThrow();
    expect(createCodexDriver).not.toHaveBeenCalled();
  });
});
