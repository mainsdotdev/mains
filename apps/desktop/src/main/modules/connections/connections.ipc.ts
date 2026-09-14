import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { connectionsService } from "./connections.service";
import type {
  SaveResourcesPayload,
  SaveCredentialsPayload,
} from "./connections.dto";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

// ─────────────────────────────────────────────────────────────
// Register Handlers
// ─────────────────────────────────────────────────────────────
export function registerConnectionsHandlers(): void {
  ipcMain.handle(
    CHANNELS.connections.listStates,
    handle(() => connectionsService.listStates()),
  );

  ipcMain.handle(
    CHANNELS.connections.updateState,
    handle((id: unknown, payload: unknown) => connectionsService.updateState(id, payload)),
  );

  ipcMain.handle(
    CHANNELS.connections.saveCredentials,
    handle((payload: SaveCredentialsPayload) => connectionsService.saveCredentials(payload)),
  );

  ipcMain.handle(
    CHANNELS.connections.checkCredentials,
    handle((provider: string) => connectionsService.checkCredentials(provider)),
  );

  ipcMain.handle(
    CHANNELS.connections.getGithubRepos,
    handle((connectionId: string) => connectionsService.getGithubRepos(connectionId)),
  );

  ipcMain.handle(
    CHANNELS.connections.githubDeviceStart,
    handle(() => connectionsService.startGithubDeviceFlow()),
  );

  ipcMain.handle(
    CHANNELS.connections.githubDevicePoll,
    handle((deviceCode: string) => connectionsService.pollGithubDeviceFlow(deviceCode)),
  );

  ipcMain.handle(
    CHANNELS.connections.getLinearTeams,
    handle((connectionId: string) => connectionsService.getLinearTeams(connectionId)),
  );

  ipcMain.handle(
    CHANNELS.connections.getJiraProjects,
    handle((connectionId: string) => connectionsService.getJiraProjects(connectionId)),
  );

  ipcMain.handle(
    CHANNELS.connections.getAsanaProjects,
    handle((connectionId: string) => connectionsService.getAsanaProjects(connectionId)),
  );

  ipcMain.handle(
    CHANNELS.connections.getGitlabProjects,
    handle((connectionId: string) => connectionsService.getGitlabProjects(connectionId)),
  );

  ipcMain.handle(
    CHANNELS.connections.getTrelloBoards,
    handle((connectionId: string) => connectionsService.getTrelloBoards(connectionId)),
  );

  ipcMain.handle(
    CHANNELS.connections.getSentryProjects,
    handle((connectionId: string) => connectionsService.getSentryProjects(connectionId)),
  );

  ipcMain.handle(
    CHANNELS.connections.getSocketDevOrganizations,
    handle((connectionId: string) => connectionsService.getSocketDevOrganizations(connectionId)),
  );

  ipcMain.handle(
    CHANNELS.connections.saveResources,
    handle((payload: SaveResourcesPayload) => connectionsService.saveResources(payload)),
  );

  ipcMain.handle(
    CHANNELS.connections.removeResource,
    handle((resourceId: string) => connectionsService.removeResource(resourceId)),
  );

  ipcMain.handle(
    CHANNELS.connections.getByProvider,
    handle((provider: string) => connectionsService.getByProvider(provider)),
  );

  ipcMain.handle(
    CHANNELS.connections.getSelectedResources,
    handle((provider: string) => connectionsService.getSelectedResources(provider)),
  );

  ipcMain.handle(
    CHANNELS.connections.deleteResource,
    handle((resourceId: string) => connectionsService.deleteResource(resourceId)),
  );

  ipcMain.handle(
    CHANNELS.connections.revoke,
    handle((provider: string) => connectionsService.revoke(provider)),
  );
}

// ─────────────────────────────────────────────────────────────
// Unregister Handlers
// ─────────────────────────────────────────────────────────────
export function unregisterConnectionsHandlers(): void {
  [
    CHANNELS.connections.listStates,
    CHANNELS.connections.updateState,
    CHANNELS.connections.saveCredentials,
    CHANNELS.connections.checkCredentials,
    CHANNELS.connections.getGithubRepos,
    CHANNELS.connections.githubDeviceStart,
    CHANNELS.connections.githubDevicePoll,
    CHANNELS.connections.getLinearTeams,
    CHANNELS.connections.getJiraProjects,
    CHANNELS.connections.getAsanaProjects,
    CHANNELS.connections.getGitlabProjects,
    CHANNELS.connections.getTrelloBoards,
    CHANNELS.connections.getSentryProjects,
    CHANNELS.connections.getSocketDevOrganizations,
    CHANNELS.connections.saveResources,
    CHANNELS.connections.removeResource,
    CHANNELS.connections.getByProvider,
    CHANNELS.connections.getSelectedResources,
    CHANNELS.connections.deleteResource,
    CHANNELS.connections.revoke,
  ].forEach((channel) => ipcMain.removeHandler(channel));
}
