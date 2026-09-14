import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
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
