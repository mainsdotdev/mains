import { configureBackendRuntime } from "../src/runtime/backend-runtime";

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
    format: "mns1-aes-gcm-v1",
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
