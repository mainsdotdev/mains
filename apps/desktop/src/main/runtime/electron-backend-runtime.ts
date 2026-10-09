import {
  app,
  nativeImage,
  powerSaveBlocker,
  safeStorage,
  shell,
} from "electron";
import type { BackendRuntime } from "@mains/backend/runtime/backend-runtime";

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
      format: "electron-safe-storage-v1",
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
      async resize(bytes, maxSide, preserveAlpha = false) {
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
                width: Math.max(1, Math.round(size.width * scale)),
                height: Math.max(1, Math.round(size.height * scale)),
                quality: "good",
              })
            : source;
        const outputSize = scaled.getSize();
        let hasAlpha = false;
        if (preserveAlpha) {
          // Inspect only the bounded, resized BGRA bitmap, not the original.
          const bitmap = scaled.toBitmap();
          for (let index = 3; index < bitmap.length; index += 4) {
            if (bitmap[index] < 255) { hasAlpha = true; break; }
          }
        }
        return {
          bytes: hasAlpha ? scaled.toPNG() : scaled.toJPEG(82),
          mime: hasAlpha ? "image/png" : "image/jpeg",
          width: outputSize.width,
          height: outputSize.height,
        };
      },
    },
  };
}
