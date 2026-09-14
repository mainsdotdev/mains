import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderDriver } from "../../../../shared/adapter.types";
import type { ProviderResponse } from "../providers.dto";

const createCodexDriver = vi.fn();
const createClaudeDriver = vi.fn();
const createCopilotDriver = vi.fn();
const createCursorDriver = vi.fn();

vi.mock("./codex.driver", () => ({ createCodexDriver: (c: any) => createCodexDriver(c) }));
vi.mock("./claude.driver", () => ({ createClaudeDriver: (c: any) => createClaudeDriver(c) }));
vi.mock("./copilot.driver", () => ({ createCopilotDriver: (c: any) => createCopilotDriver(c) }));
vi.mock("./cursor.driver", () => ({ createCursorDriver: (c: any) => createCursorDriver(c) }));

import {
  clearAdapterCache,
  createWorkAdapter,
  refreshWorkAdapterConfig,
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
