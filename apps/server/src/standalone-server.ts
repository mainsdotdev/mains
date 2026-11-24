import fs from "node:fs";
import path from "node:path";
import { configureIpcMainAdapter } from "@mains/backend/ipc-kit/ipc-main";
import { configureRunNotificationSink } from "@mains/backend/modules/runs";
import {
  type BackendServer,
  type ServeOptions,
  startBackendServer,
} from "@mains/backend/serve";
import { configureBackendRuntime } from "@mains/backend/runtime/backend-runtime";
import { createNodeBackendRuntime } from "@mains/backend/runtime/node-backend-runtime";
import { serverImagePreview } from "./image-preview";
import { createResourceLifecycle } from "@mains/backend/runtime/resource-lifecycle";

export interface StandaloneServerOptions extends ServeOptions {
  dataDir: string;
  appVersion: string;
  appRoot?: string;
  resourcesPath?: string | null;
}

export interface StandaloneServer extends BackendServer {
  readonly dataDir: string;
}

let activeHost: object | undefined;

/**
 * Start Mains in a genuine Node process. The caller owns the returned server and
 * must close it so schedulers, agents, terminals, sockets and SQLite are drained.
 */
export async function startStandaloneServer(
  options: StandaloneServerOptions,
): Promise<StandaloneServer> {
  if (activeHost) throw new Error("A standalone backend already owns this process; close it before starting another");
  const lifecycle = createResourceLifecycle<StandaloneServer>("Standalone server");
  activeHost = lifecycle;
  return lifecycle.start(async (scope) => {
    scope.defer(() => { if (activeHost === lifecycle) activeHost = undefined; });
    scope.observe(options.signal);
    const dataDir = path.resolve(options.dataDir);
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

    const restoreRuntime = configureBackendRuntime(
      createNodeBackendRuntime({
        dataDir,
        appVersion: options.appVersion,
        appRoot: options.appRoot,
        resourcesPath: options.resourcesPath,
        imagePreview: serverImagePreview,
      }),
    );
    scope.defer(restoreRuntime);
    const restoreIpc = configureIpcMainAdapter(null);
    scope.defer(restoreIpc);
    const restoreNotifications = configureRunNotificationSink(null);
    scope.defer(restoreNotifications);

    const server = await startBackendServer(options);
    scope.defer(() => server.close());
    scope.assertActive();

    return {
      sink: server.sink,
      port: server.port,
      webUiAvailable: server.webUiAvailable,
      token: server.token,
      tailscaleUrl: server.tailscaleUrl,
      createWebLogin: (baseUrl) => server.createWebLogin(baseUrl),
      dataDir,
      createPairingCode: (endpoints) => server.createPairingCode(endpoints),
      disconnectDevice: (deviceId) => server.disconnectDevice(deviceId),
      connectedDeviceIds: () => server.connectedDeviceIds(),
      close() {
        return lifecycle.close();
      },
    };
  });
}
