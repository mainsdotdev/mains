import { ipcMain } from "electron";
import { ok, fail } from "@mains/contracts/service-response";
import { CHANNELS } from "@mains/contracts/channels";
import { localBackendService } from "./localBackend.service";

// Registered via the REAL electron ipcMain (NOT the `ipcMain` shim) so these
// control handlers stay local-only — a remote client riding the exposed WS host
// must never be able to toggle/stop the exposure it depends on.
export function registerLocalBackendIpc() {
  ipcMain.handle(CHANNELS.localBackend.getStatus, () =>
    ok(localBackendService.getStatus()),
  );

  ipcMain.handle(
    CHANNELS.localBackend.setRemoteAccess,
    async (_e, enabled: boolean, port?: number) => {
      try {
        return ok(await localBackendService.setRemoteAccess(enabled, port));
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to update remote access",
        );
      }
    },
  );

  ipcMain.handle(
    CHANNELS.localBackend.setLanAccess,
    async (_e, enabled: boolean) => {
      try {
        return ok(await localBackendService.setLanAccess(enabled));
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to update LAN access",
        );
      }
    },
  );

  ipcMain.handle(
    CHANNELS.localBackend.setTailscaleHttps,
    async (_e, enabled: boolean, httpsPort?: number) => {
      try {
        return ok(await localBackendService.setTailscaleHttps(enabled, httpsPort));
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to update Tailscale HTTPS",
        );
      }
    },
  );

  ipcMain.handle(
    CHANNELS.localBackend.setKeepAwakeForRemoteAccess,
    async (_e, enabled: boolean) => {
      try {
        return ok(
          await localBackendService.setKeepAwakeForRemoteAccess(enabled),
        );
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to update keep awake",
        );
      }
    },
  );

  ipcMain.handle(CHANNELS.localBackend.rotateToken, async () => {
    try {
      return ok(await localBackendService.rotateToken());
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Failed to rotate token",
      );
    }
  });

  ipcMain.handle(
    CHANNELS.localBackend.createWebLogin,
    async (_e, baseUrl: string) => {
      try {
        return ok(localBackendService.createWebLogin(baseUrl));
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to create browser login",
        );
      }
    },
  );

  // Phone pairing rides on the exposure above, so it is local-only for the same
  // reason: a remote client must not be able to mint codes or revoke devices.
  ipcMain.handle(CHANNELS.localBackend.createPairingCode, async () => {
    try {
      return ok(await localBackendService.createPairingCode());
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Failed to create pairing code",
      );
    }
  });

  ipcMain.handle(CHANNELS.localBackend.listPairedDevices, async () => {
    try {
      return ok(await localBackendService.listPairedDevices());
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Failed to list paired devices",
      );
    }
  });

  ipcMain.handle(
    CHANNELS.localBackend.revokePairedDevice,
    async (_e, id: string) => {
      try {
        await localBackendService.revokePairedDevice(id);
        return ok(undefined);
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to revoke device",
        );
      }
    },
  );
}

export function unregisterLocalBackendIpc() {
  ipcMain.removeHandler(CHANNELS.localBackend.getStatus);
  ipcMain.removeHandler(CHANNELS.localBackend.setRemoteAccess);
  ipcMain.removeHandler(CHANNELS.localBackend.setLanAccess);
  ipcMain.removeHandler(CHANNELS.localBackend.setTailscaleHttps);
  ipcMain.removeHandler(CHANNELS.localBackend.setKeepAwakeForRemoteAccess);
  ipcMain.removeHandler(CHANNELS.localBackend.rotateToken);
  ipcMain.removeHandler(CHANNELS.localBackend.createWebLogin);
  ipcMain.removeHandler(CHANNELS.localBackend.createPairingCode);
  ipcMain.removeHandler(CHANNELS.localBackend.listPairedDevices);
  ipcMain.removeHandler(CHANNELS.localBackend.revokePairedDevice);
}
