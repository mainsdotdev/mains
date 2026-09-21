import fs from "node:fs";
import path from "node:path";
import { configureIpcMainAdapter } from "./ipc-kit/ipc-main";
import { configureRunNotificationSink } from "./modules/runs/run-notification-sink";
import {
  type BackendServer,
  type ServeOptions,
  startBackendServer,
} from "./serve";
import { configureBackendRuntime } from "./runtime/backend-runtime";
import { createNodeBackendRuntime } from "./runtime/node-backend-runtime";

export interface StandaloneServerOptions extends ServeOptions {
  dataDir: string;
  appVersion: string;
  appRoot?: string;
  resourcesPath?: string | null;
}

export interface StandaloneServer extends BackendServer {
  readonly dataDir: string;
}

/**
 * Start Mains in a genuine Node process. The caller owns the returned server and
 * must close it so schedulers, agents, terminals, sockets and SQLite are drained.
 */
export async function startStandaloneServer(
  options: StandaloneServerOptions,
): Promise<StandaloneServer> {
  const dataDir = path.resolve(options.dataDir);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const restoreRuntime = configureBackendRuntime(
    createNodeBackendRuntime({
      dataDir,
      appVersion: options.appVersion,
      appRoot: options.appRoot,
      resourcesPath: options.resourcesPath,
    }),
  );
  const restoreIpc = configureIpcMainAdapter(null);
  const restoreNotifications = configureRunNotificationSink(null);

  let server: BackendServer;
  try {
    server = await startBackendServer(options);
  } catch (error) {
    restoreNotifications();
    restoreIpc();
    restoreRuntime();
    throw error;
  }

  let closePromise: Promise<void> | null = null;
  return {
    sink: server.sink,
    port: server.port,
    token: server.token,
    dataDir,
    disconnectDevice: (deviceId) => server.disconnectDevice(deviceId),
    close() {
      if (closePromise) return closePromise;
      closePromise = server.close().finally(() => {
        restoreNotifications();
        restoreIpc();
        restoreRuntime();
      });
      return closePromise;
    },
  };
}
