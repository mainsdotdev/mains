import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeBackendRuntime } from "./node-backend-runtime";

const temporaryDirectories: string[] = [];

function makeRuntime() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-runtime-"));
  temporaryDirectories.push(dataDir);
  return {
    dataDir,
    runtime: createNodeBackendRuntime({
      dataDir,
      appRoot: "/opt/mains",
      appVersion: "1.2.3",
      resourcesPath: "/opt/mains/resources",
    }),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Node backend runtime", () => {
  it("exposes the standalone host paths and version", () => {
    const { dataDir, runtime } = makeRuntime();
    expect(runtime.kind).toBe("node");
    expect(runtime.getPath("userData")).toBe(dataDir);
    expect(runtime.getAppPath()).toBe("/opt/mains");
    expect(runtime.getResourcesPath()).toBe("/opt/mains/resources");
    expect(runtime.getAppVersion()).toBe("1.2.3");
  });

  it("encrypts credentials with a persistent per-data-dir key", () => {
    const { dataDir, runtime } = makeRuntime();
    const encrypted = runtime.secretStorage.encryptString("secret-token");

    expect(encrypted.toString("utf8")).not.toContain("secret-token");
    expect(runtime.secretStorage.decryptString(encrypted)).toBe("secret-token");
    expect(fs.statSync(path.join(dataDir, "server-secret.key")).mode & 0o777).toBe(
      0o600,
    );

    const restarted = createNodeBackendRuntime({
      dataDir,
      appVersion: "1.2.3",
    });
    expect(restarted.secretStorage.decryptString(encrypted)).toBe("secret-token");
  });

  it("rejects Electron or otherwise foreign credential ciphertext", () => {
    const { runtime } = makeRuntime();
    expect(() =>
      runtime.secretStorage.decryptString(Buffer.from("foreign-ciphertext")),
    ).toThrow(/different Mains runtime/);
  });
});
