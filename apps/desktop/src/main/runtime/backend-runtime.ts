/**
 * Host capabilities used by the execution backend.
 *
 * Domain modules depend on this small interface instead of Electron. The
 * desktop installs an Electron adapter; the standalone server installs a Node
 * adapter. Keeping the seam here lets the DB, provider drivers, git and run
 * lifecycle execute in either host without knowing which one booted them.
 */

export type BackendPath = "userData" | "desktop";

export interface SecretStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface PowerInhibitorAdapter {
  start(reason: "prevent-app-suspension"): number;
  isStarted(id: number): boolean;
  stop(id: number): void;
}

export interface ImagePreview {
  jpeg: Buffer;
  width: number;
  height: number;
}

export interface ImagePreviewAdapter {
  /** Returns null when the host cannot decode the supplied bytes. */
  resizeToJpeg(bytes: Buffer, maxSide: number): ImagePreview | null;
}

export interface BackendRuntime {
  readonly kind: "electron" | "node";
  whenReady(): Promise<void>;
  isPackaged(): boolean;
  getAppVersion(): string;
  getAppPath(): string;
  getPath(name: BackendPath): string;
  getResourcesPath(): string | null;
  openExternal(url: string): Promise<unknown>;
  readonly secretStorage: SecretStorageAdapter;
  readonly powerInhibitor: PowerInhibitorAdapter;
  readonly imagePreview: ImagePreviewAdapter | null;
}

let installed: BackendRuntime | null = null;

/** Install the process-wide host adapter. Returns a restore function for tests. */
export function configureBackendRuntime(runtime: BackendRuntime): () => void {
  const previous = installed;
  installed = runtime;
  return () => {
    installed = previous;
  };
}

export function getBackendRuntime(): BackendRuntime {
  if (!installed) {
    throw new Error(
      "Backend runtime is not configured; install the Electron or Node adapter before booting Mains",
    );
  }
  return installed;
}
