import {
  configureBackendRuntime,
  type BackendRuntime,
} from "../src/runtime/backend-runtime";

/** Install a focused backend-runtime fake and return its restore function. */
export function installTestBackendRuntime(
  overrides: Partial<BackendRuntime> = {},
): () => void {
  let nextPowerId = 1;
  const activePowerIds = new Set<number>();
  const runtime: BackendRuntime = {
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
        const id = nextPowerId++;
        activePowerIds.add(id);
        return id;
      },
      isStarted: (id) => activePowerIds.has(id),
      stop: (id) => {
        activePowerIds.delete(id);
      },
    },
    imagePreview: null,
    ...overrides,
  };
  return configureBackendRuntime(runtime);
}
