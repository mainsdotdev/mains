import { ipcMain } from "@mains/backend/ipc-kit/ipc-main";
import { handle } from "@mains/backend/ipc-kit";
import { CHANNELS } from "@mains/contracts/channels";
import { sshService, type OpenTunnelInput } from "./ssh.service";

export function registerSshIpc(): void {
  ipcMain.handle(
    CHANNELS.ssh.discoverHosts,
    handle(() => sshService.discoverHosts()),
  );
  ipcMain.handle(
    CHANNELS.ssh.openTunnel,
    handle((input: OpenTunnelInput) => sshService.openTunnel(input)),
  );
  ipcMain.handle(
    CHANNELS.ssh.closeTunnel,
    handle((id: string) => sshService.closeTunnel(id)),
  );
}

export function unregisterSshIpc(): void {
  ipcMain.removeHandler(CHANNELS.ssh.discoverHosts);
  ipcMain.removeHandler(CHANNELS.ssh.openTunnel);
  ipcMain.removeHandler(CHANNELS.ssh.closeTunnel);
}
