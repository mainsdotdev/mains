import {
  app,
  nativeImage,
  powerSaveBlocker,
  safeStorage,
  shell,
} from "electron";
import type { BackendRuntime } from "./backend-runtime";

/** Electron host adapter used by the desktop app and its legacy --serve mode. */
export function createElectronBackendRuntime(): BackendRuntime {
  return {
    kind: "electron",
    async whenReady() {
      if (!app.isReady()) await app.whenReady();
    },
    isPackaged: () => app.isPackaged,
    getAppVersion: () => app.getVersion(),
    getAppPath: () => app.getAppPath(),
    getPath: (name) => app.getPath(name),
    getResourcesPath: () => process.resourcesPath || null,
    openExternal: (url) => shell.openExternal(url),
    secretStorage: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value),
    },
    powerInhibitor: {
      start: (reason) => powerSaveBlocker.start(reason),
      isStarted: (id) => powerSaveBlocker.isStarted(id),
      stop: (id) => powerSaveBlocker.stop(id),
    },
    imagePreview: {
      resizeToJpeg(bytes, maxSide) {
        const source = nativeImage.createFromBuffer(bytes);
        if (source.isEmpty()) return null;
        const size = source.getSize();
        const scale = Math.min(
          1,
          maxSide / Math.max(size.width, size.height, 1),
        );
        const scaled =
          scale < 1
            ? source.resize({
                width: Math.round(size.width * scale),
                height: Math.round(size.height * scale),
                quality: "good",
              })
            : source;
        const outputSize = scaled.getSize();
        return {
          jpeg: scaled.toJPEG(82),
          width: outputSize.width,
          height: outputSize.height,
        };
      },
    },
  };
}
