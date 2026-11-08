import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { invokeHandler } from "../../ipc-kit/handler-registry";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createProvider } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type { ProviderResponse } from "./providers.dto";
import { registerProvidersIpc, unregisterProvidersIpc } from "./providers.ipc";
import { providersService } from "./providers.service";

let db: DatabaseInstance;
let cleanup: () => void;

vi.mock("../../db/client", () => ({ getDb: () => db }));
vi.mock("./adapters", () => ({ refreshWorkAdapterConfig: vi.fn() }));

describe("providers IPC for paired devices", () => {
  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    createAccount(db, { id: "default" });
    createProvider(db, {
      id: "claude_code",
      config: JSON.stringify({
        apiKey: "secret",
        baseUrl: "http://internal",
        effortLevel: "high",
        thinkingMode: true,
      }),
    });
    registerProvidersIpc();
  });

  afterEach(() => {
    unregisterProvidersIpc();
    vi.restoreAllMocks();
    cleanup();
  });

  it("cancels a catalog only for its requesting client, provider and request id", async () => {
    let signal!: AbortSignal;
    vi.spyOn(providersService, "getPlugins").mockImplementation((_id, captured) => {
      signal = captured!;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const pending = invokeHandler(CHANNELS.providers.getPlugins, ["codex", "request"], { clientId: "first" });
    await invokeHandler(CHANNELS.providers.cancelPluginCatalog, ["codex", "request"], { clientId: "second" });
    await invokeHandler(CHANNELS.providers.cancelPluginCatalog, ["claude_code", "request"], { clientId: "first" });
    await invokeHandler(CHANNELS.providers.cancelPluginCatalog, ["codex", "other"], { clientId: "first" });
    expect(signal.aborted).toBe(false);
    await invokeHandler(CHANNELS.providers.cancelPluginCatalog, ["codex", "request"], { clientId: "first" });
    expect(signal.aborted).toBe(true);
    await expect(pending).resolves.toEqual({ success: false, error: "Plugin catalog request cancelled" });
  });

  it("retires outstanding catalog reads when the provider handlers shut down", async () => {
    let signal!: AbortSignal;
    vi.spyOn(providersService, "getPlugins").mockImplementation((_id, captured) => {
      signal = captured!;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const pending = invokeHandler(CHANNELS.providers.getPlugins, ["codex", "request"]);
    unregisterProvidersIpc();
    expect(signal.aborted).toBe(true);
    await expect(pending).resolves.toEqual({ success: false, error: "Plugin catalog request cancelled" });
  });

  it("projects the update response like getEnabled, even for an empty patch", async () => {
    const context = { deviceId: "phone" };
    const updated = await invokeHandler(
      CHANNELS.providers.updateRunSettings,
      ["claude_code", {}],
      context,
    );
    const enabled = await invokeHandler(CHANNELS.providers.getEnabled, [], context);

    expect(updated.success).toBe(true);
    expect(enabled.success).toBe(true);
    if (!updated.success || !enabled.success) return;

    const provider = updated.data as ProviderResponse;
    expect(provider.config).toEqual({ effortLevel: "high", thinkingMode: true });
    expect(provider).toEqual((enabled.data as ProviderResponse[])[0]);
  });

  it("keeps the full response for a local caller", async () => {
    const updated = await invokeHandler(
      CHANNELS.providers.updateRunSettings,
      ["claude_code", {}],
    );

    expect(updated.success).toBe(true);
    if (!updated.success) return;
    expect((updated.data as ProviderResponse).config).toMatchObject({
      apiKey: "secret",
      baseUrl: "http://internal",
      effortLevel: "high",
      thinkingMode: true,
    });
  });
});
