/**
 * Global test setup — mocks Electron and other native modules
 * that are unavailable in the Vitest Node environment.
 */
import { vi } from "vitest";
import { configureBackendRuntime } from "../main/runtime/backend-runtime";

const activePowerInhibitors = new Set<number>();
let nextPowerInhibitorId = 1;

configureBackendRuntime({
  kind: "node",
  whenReady: async () => {},
  isPackaged: () => false,
  getAppVersion: () => "0.4.2",
  getAppPath: () => process.cwd(),
  getPath: (name) => `/tmp/mains-test/${name}`,
  getResourcesPath: () => null,
  openExternal: async () => {},
  secretStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8"),
    decryptString: (value) => value.toString("utf8"),
  },
  powerInhibitor: {
    start: () => {
      const id = nextPowerInhibitorId++;
      activePowerInhibitors.add(id);
      return id;
    },
    isStarted: (id) => activePowerInhibitors.has(id),
    stop: (id) => {
      activePowerInhibitors.delete(id);
    },
  },
  imagePreview: null,
});

// Desktop-only modules still need an Electron façade in the Vitest Node host.
vi.mock("electron", () => ({
  app: {
    isReady: () => true,
    whenReady: () => Promise.resolve(),
    getPath: (name: string) => `/tmp/mains-test/${name}`,
    getVersion: () => "0.4.2",
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, "utf-8"),
    decryptString: (b: Buffer) => b.toString("utf-8"),
  },
}));
