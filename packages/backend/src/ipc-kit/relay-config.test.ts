import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { relayPublicKey } from "@mains/relay/crypto";
import { createNodeBackendRuntime } from "../runtime/node-backend-runtime";
import { configureBackendRuntime } from "../runtime/backend-runtime";
import { isRelayAccess, validateRelayUrl } from "@mains/contracts/relay";
import { loadRelayHostConfig } from "./relay-config";

describe("private relay configuration", () => {
  let directory: string | undefined, restore: (() => void) | undefined;
  afterEach(async () => {
    restore?.(); restore = undefined; vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("stays disabled without touching backend identity when unconfigured", async () => {
    vi.stubEnv("MAINS_RELAY_URL", ""); vi.stubEnv("MAINS_RELAY_SECRET_FILE", "");
    const identity = vi.fn();
    expect(await loadRelayHostConfig(identity)).toBeUndefined();
    expect(identity).not.toHaveBeenCalled();
  });

  it("requires both operator settings and TLS outside loopback", async () => {
    vi.stubEnv("MAINS_RELAY_URL", "wss://relay.example.com"); vi.stubEnv("MAINS_RELAY_SECRET_FILE", "");
    await expect(loadRelayHostConfig(async () => "backend")).rejects.toThrow(/both/);
    expect(validateRelayUrl("ws://127.0.0.1:8791")).toBe("ws://127.0.0.1:8791");
    for (const url of ["ws://relay.example.com", "wss://secret@relay.example.com", "wss://relay.example.com/?ticket=secret", "wss://relay.example.com/#key", "https://relay.example.com"]) {
      expect(() => validateRelayUrl(url)).toThrow();
    }
    expect(isRelayAccess({ url: "wss://relay.example.com", backendPublicKey: "invalid", ticket: "invalid", expiresAt: "tomorrow" })).toBe(false);
  });

  it("persists one encrypted identity and refuses corruption instead of silently changing the pairing pin", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "mains-relay-config-"));
    const secretFile = path.join(directory, "routing.secret");
    await writeFile(secretFile, "an-operator-routing-secret-with-more-than-32-bytes", { mode: 0o600 });
    vi.stubEnv("MAINS_RELAY_URL", "wss://relay.example.com"); vi.stubEnv("MAINS_RELAY_SECRET_FILE", secretFile);
    const runtime = createNodeBackendRuntime({ dataDir: directory, appVersion: "test" });
    restore = configureBackendRuntime(runtime);
    const first = await loadRelayHostConfig(async () => "backend-a");
    const second = await loadRelayHostConfig(async () => "backend-a");
    expect(relayPublicKey(first!.privateKey)).toBe(relayPublicKey(second!.privateKey));
    const identityPath = path.join(directory, "relay", "identity.enc");
    const encrypted = await readFile(identityPath);
    expect(encrypted.includes(Buffer.from(first!.privateKey))).toBe(false);
    const restoreMismatch = configureBackendRuntime({ ...runtime, secretStorage: { ...runtime.secretStorage, format: "electron-safe-storage-v1" } });
    try {
      await expect(loadRelayHostConfig(async () => "backend-a")).rejects.toThrow(/different or invalid storage format/);
      expect(await readFile(identityPath)).toEqual(encrypted);
    } finally { restoreMismatch(); }
    await writeFile(identityPath, "corrupted identity");
    await expect(loadRelayHostConfig(async () => "backend-a")).rejects.toThrow();
    expect((await readFile(identityPath)).toString()).toBe("corrupted identity");
  });
});
