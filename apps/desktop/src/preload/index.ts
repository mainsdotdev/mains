import { contextBridge, ipcRenderer } from "electron";
import os from "node:os";
import { CHANNELS } from "../shared/ipc-kit/channels";
import type { ModeId } from "../shared/modes";
import type {
  AppshotCapture,
  AppshotsConfiguration,
  AppshotsSystemSettingsPane,
} from "../shared/appshots";
import type {
  KeyboardShortcutId,
} from "../shared/keyboard-shortcuts";

type BrowserDownloadState =
  | "progressing"
  | "paused"
  | "completed"
  | "cancelled"
  | "interrupted";

interface BrowserDownload {
  id: string;
  tabId: string | null;
  fileName: string;
  savePath: string;
  sourceUrl: string;
  mimeType: string;
  state: BrowserDownloadState;
  receivedBytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  startedAt: string;
  updatedAt: string;
}

interface BrowserHistoryEntry {
  id: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  visitedAt: string;
  visitCount: number;
}

type BrowserDevicePresetId =
  | "responsive"
  | "iphone-se"
  | "iphone-14-pro"
  | "iphone-14-pro-max"
  | "pixel-7"
  | "galaxy-s20-ultra"
  | "surface-duo"
  | "ipad-mini"
  | "ipad-air"
  | "nest-hub";

interface BrowserDeviceEmulation {
  enabled: boolean;
  presetId: BrowserDevicePresetId;
  width: number;
  height: number;
  deviceScaleFactor: number;
  scale: number;
}

type BrowserClearDataTimeRange =
  | "last-hour"
  | "last-day"
  | "last-week"
  | "last-four-weeks"
  | "all-time";

interface BrowserClearDataOptions {
  timeRange: BrowserClearDataTimeRange;
  history: boolean;
  cookiesAndSiteData: boolean;
  cache: boolean;
  downloads: boolean;
}

// Expose IPC methods to renderer process
const api = {
  // Entity operations (canonical content)
  entities: {
    getAll: (options?: {
      kind?: string;
      connectionId?: string;
      limit?: number;
    }) => ipcRenderer.invoke(CHANNELS.entities.getAll, options),
    getById: (id: string) => ipcRenderer.invoke(CHANNELS.entities.getById, id),
    create: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.entities.create, payload),
    update: (id: string, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.entities.update, id, payload),
    delete: (id: string) => ipcRenderer.invoke(CHANNELS.entities.delete, id),
    search: (query: string, options?: { kind?: string; limit?: number }) =>
      ipcRenderer.invoke(CHANNELS.entities.search, query, options),
  },
  search: {
    query: (input: {
      query: string;
      accountId?: string;
      limitPerKind?: number;
    }) => ipcRenderer.invoke(CHANNELS.search.query, input),
  },
  // Task operations (actionable domain)
  tasks: {
    getAll: (options?: { status?: string; limit?: number }) =>
      ipcRenderer.invoke(CHANNELS.tasks.getAll, options),
    getById: (entityId: string) =>
      ipcRenderer.invoke(CHANNELS.tasks.getById, entityId),
    create: (payload: unknown) => ipcRenderer.invoke(CHANNELS.tasks.create, payload),
    update: (entityId: string, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.tasks.update, entityId, payload),
    delete: (entityId: string) => ipcRenderer.invoke(CHANNELS.tasks.delete, entityId),
  },
  // Issue operations (actionable domain)
  issues: {
    getAll: (options?: { provider?: string; state?: string; repo?: string; limit?: number }) =>
      ipcRenderer.invoke(CHANNELS.issues.getAll, options),
    getById: (entityId: string) =>
      ipcRenderer.invoke(CHANNELS.issues.getById, entityId),
    getDetail: (entityId: string) =>
      ipcRenderer.invoke(CHANNELS.issues.getDetail, entityId),
    create: (payload: unknown) => ipcRenderer.invoke(CHANNELS.issues.create, payload),
    update: (entityId: string, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.issues.update, entityId, payload),
    delete: (entityId: string) => ipcRenderer.invoke(CHANNELS.issues.delete, entityId),
  },
  // Signal operations (error reports, crashes, alerts, feedback)
  signals: {
    getAll: (options?: { source?: string; level?: string; category?: string; state?: string; projectId?: string; limit?: number }) =>
      ipcRenderer.invoke(CHANNELS.signals.getAll, options),
    getById: (entityId: string) =>
      ipcRenderer.invoke(CHANNELS.signals.getById, entityId),
    create: (payload: unknown) => ipcRenderer.invoke(CHANNELS.signals.create, payload),
    update: (entityId: string, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.signals.update, entityId, payload),
    delete: (entityId: string) => ipcRenderer.invoke(CHANNELS.signals.delete, entityId),
  },
  // Account operations
  account: {
    get: () => ipcRenderer.invoke(CHANNELS.account.get),
    update: (payload: unknown) => ipcRenderer.invoke(CHANNELS.account.update, payload),
  },
  // Sync operations
  sync: {
    runEntitySync: (provider?: string) => ipcRenderer.invoke(CHANNELS.sync.runEntitySync, provider),
  },
  // Connections aggregate (identity + tokens + states). See ADR-0002.
  connections: {
    // ── integration-state list (Settings page) ──
    listStates: () => ipcRenderer.invoke(CHANNELS.connections.listStates),
    updateState: (
      id: string,
      payload: { isConnected: boolean; connectionId?: string | null },
    ) => ipcRenderer.invoke(CHANNELS.connections.updateState, id, payload),
    // ── credentials ──
    saveCredentials: (payload: {
      provider: string;
      connectionId: string;
      [key: string]: any;
    }) => ipcRenderer.invoke(CHANNELS.connections.saveCredentials, payload),
    checkCredentials: (provider: string) =>
      ipcRenderer.invoke(CHANNELS.connections.checkCredentials, provider),
    // ── identity + resource discovery ──
    getByProvider: (provider: string) =>
      ipcRenderer.invoke(CHANNELS.connections.getByProvider, provider),
    revoke: (provider: string) =>
      ipcRenderer.invoke(CHANNELS.connections.revoke, provider),
    getGithubRepos: (connectionId: string) =>
      ipcRenderer.invoke(CHANNELS.connections.getGithubRepos, connectionId),
    githubDeviceStart: () =>
      ipcRenderer.invoke(CHANNELS.connections.githubDeviceStart),
    githubDevicePoll: (deviceCode: string) =>
      ipcRenderer.invoke(CHANNELS.connections.githubDevicePoll, deviceCode),
    getLinearTeams: (connectionId: string) =>
      ipcRenderer.invoke(CHANNELS.connections.getLinearTeams, connectionId),
    getJiraProjects: (connectionId: string) =>
      ipcRenderer.invoke(CHANNELS.connections.getJiraProjects, connectionId),
    getAsanaProjects: (connectionId: string) =>
      ipcRenderer.invoke(CHANNELS.connections.getAsanaProjects, connectionId),
    getGitlabProjects: (connectionId: string) =>
      ipcRenderer.invoke(CHANNELS.connections.getGitlabProjects, connectionId),
    getTrelloBoards: (connectionId: string) =>
      ipcRenderer.invoke(CHANNELS.connections.getTrelloBoards, connectionId),
    getSentryProjects: (connectionId: string) =>
      ipcRenderer.invoke(CHANNELS.connections.getSentryProjects, connectionId),
    getSocketDevOrganizations: (connectionId: string) =>
      ipcRenderer.invoke(CHANNELS.connections.getSocketDevOrganizations, connectionId),
    saveResources: (payload: {
      provider: string;
      connectionId: string;
      resources?: any[];
      sources?: string[];
    }) => ipcRenderer.invoke(CHANNELS.connections.saveResources, payload),
    deleteResource: (resourceId: string) =>
      ipcRenderer.invoke(CHANNELS.connections.deleteResource, resourceId),
    getSelectedResources: (provider: string) =>
      ipcRenderer.invoke(CHANNELS.connections.getSelectedResources, provider),
  },
  // Guards operations (dependency security)
  guards: {
    getActiveGuard: () => ipcRenderer.invoke(CHANNELS.guards.getActiveGuard),
    checkPackage: (pkg: { name: string; version?: string; ecosystem: string }) =>
      ipcRenderer.invoke(CHANNELS.guards.checkPackage, pkg),
    checkPackages: (pkgs: Array<{ name: string; version?: string; ecosystem: string }>) =>
      ipcRenderer.invoke(CHANNELS.guards.checkPackages, pkgs),
    getPackageScore: (pkg: { name: string; version?: string; ecosystem: string }) =>
      ipcRenderer.invoke(CHANNELS.guards.getPackageScore, pkg),
    scanWorkspace: (workspaceId: string, rootPath: string) =>
      ipcRenderer.invoke(CHANNELS.guards.scanWorkspace, workspaceId, rootPath),
  },
  // SSH tunneling for remote backends (runs the local ssh client; not served remotely)
  ssh: {
    discoverHosts: () => ipcRenderer.invoke(CHANNELS.ssh.discoverHosts),
    openTunnel: (input: {
      host: string;
      remotePort: number;
      remoteCommand?: string | null;
    }) => ipcRenderer.invoke(CHANNELS.ssh.openTunnel, input),
    closeTunnel: (id: string) =>
      ipcRenderer.invoke(CHANNELS.ssh.closeTunnel, id),
  },
  // Encrypted at-rest storage for direct-mode backend owner tokens (local-only)
  remoteBackends: {
    setToken: (id: string, token: string) =>
      ipcRenderer.invoke(CHANNELS.remoteBackends.setToken, id, token),
    getToken: (id: string) =>
      ipcRenderer.invoke(CHANNELS.remoteBackends.getToken, id),
    deleteToken: (id: string) =>
      ipcRenderer.invoke(CHANNELS.remoteBackends.deleteToken, id),
  },
  // Expose THIS desktop app as a backend (network / SSH / tailnet) — local-only control
  localBackend: {
    getStatus: () => ipcRenderer.invoke(CHANNELS.localBackend.getStatus),
    setRemoteAccess: (enabled: boolean, port?: number) =>
      ipcRenderer.invoke(CHANNELS.localBackend.setRemoteAccess, enabled, port),
    setLanAccess: (enabled: boolean) =>
      ipcRenderer.invoke(CHANNELS.localBackend.setLanAccess, enabled),
    setTailscaleHttps: (enabled: boolean, httpsPort?: number) =>
      ipcRenderer.invoke(
        CHANNELS.localBackend.setTailscaleHttps,
        enabled,
        httpsPort,
      ),
    setKeepAwakeForRemoteAccess: (enabled: boolean) =>
      ipcRenderer.invoke(
        CHANNELS.localBackend.setKeepAwakeForRemoteAccess,
        enabled,
      ),
    // Replace the owner token; clients using the old one are disconnected
    rotateToken: () => ipcRenderer.invoke(CHANNELS.localBackend.rotateToken),
    // Phone pairing — mint a QR code, list/revoke the phones that used one
    createPairingCode: () =>
      ipcRenderer.invoke(CHANNELS.localBackend.createPairingCode),
    listPairedDevices: () =>
      ipcRenderer.invoke(CHANNELS.localBackend.listPairedDevices),
    revokePairedDevice: (id: string) =>
      ipcRenderer.invoke(CHANNELS.localBackend.revokePairedDevice, id),
    onPairedDevicesChanged: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on(CHANNELS.localBackend.pairedDevicesChanged, listener);
      return () =>
        ipcRenderer.removeListener(
          CHANNELS.localBackend.pairedDevicesChanged,
          listener,
        );
    },
  },
  // Projects operations (incl. project_resources + linked-issue queries)
  projects: {
    // ── lifecycle ──
    list: () => ipcRenderer.invoke(CHANNELS.projects.list),
    get: (id: string) => ipcRenderer.invoke(CHANNELS.projects.get, id),
    listByAccount: (accountId: string) =>
      ipcRenderer.invoke(CHANNELS.projects.listByAccount, accountId),
    findByRemoteOrigin: (accountId: string, remoteOrigin: string) =>
      ipcRenderer.invoke(CHANNELS.projects.findByRemoteOrigin, accountId, remoteOrigin),
    findOrCreate: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.projects.findOrCreate, payload),
    create: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.projects.create, payload),
    update: (id: string, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.projects.update, id, payload),
    remove: (id: string) => ipcRenderer.invoke(CHANNELS.projects.remove, id),
    delete: (id: string) => ipcRenderer.invoke(CHANNELS.projects.delete, id),
    archive: (id: string) => ipcRenderer.invoke(CHANNELS.projects.archive, id),
    listBranches: (id: string) =>
      ipcRenderer.invoke(CHANNELS.projects.listBranches, id),
    // ── resources ──
    listResources: (projectId: string) =>
      ipcRenderer.invoke(CHANNELS.projects.listResources, projectId),
    listAvailableResources: (projectId: string) =>
      ipcRenderer.invoke(CHANNELS.projects.listAvailableResources, projectId),
    addResource: (payload: { projectId: string; resourceId: string }) =>
      ipcRenderer.invoke(CHANNELS.projects.addResource, payload),
    removeResource: (payload: { projectId: string; resourceId: string }) =>
      ipcRenderer.invoke(CHANNELS.projects.removeResource, payload),
    // ── issues (via linked resources) ──
    listIssues: (projectId: string) =>
      ipcRenderer.invoke(CHANNELS.projects.listIssues, projectId),
  },
  // Non-developer Projects: organizational Collections for Work/Chat runs.
  collections: {
    list: (options: {
      accountId: string;
      includeArchived?: boolean;
    }) => ipcRenderer.invoke(CHANNELS.collections.list, options),
    get: (options: { id: string; accountId: string }) =>
      ipcRenderer.invoke(CHANNELS.collections.get, options),
    create: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.collections.create, payload),
    update: (options: { id: string; accountId: string }, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.collections.update, options, payload),
    reorder: (payload: { accountId: string; orderedIds: string[] }) =>
      ipcRenderer.invoke(CHANNELS.collections.reorder, payload),
    archive: (options: { id: string; accountId: string }) =>
      ipcRenderer.invoke(CHANNELS.collections.archive, options),
    unarchive: (options: { id: string; accountId: string }) =>
      ipcRenderer.invoke(CHANNELS.collections.unarchive, options),
    remove: (options: { id: string; accountId: string }) =>
      ipcRenderer.invoke(CHANNELS.collections.remove, options),
    listSources: (options: { accountId: string; collectionId: string }) =>
      ipcRenderer.invoke(CHANNELS.collections.listSources, options),
    addSource: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.collections.addSource, payload),
    removeSource: (payload: { accountId: string; id: string }) =>
      ipcRenderer.invoke(CHANNELS.collections.removeSource, payload),
  },
  // Space operations
  space: {
    getAll: () => ipcRenderer.invoke(CHANNELS.space.getAll),
    getById: (spaceId: string) => ipcRenderer.invoke(CHANNELS.space.getById, spaceId),
    create: (payload: unknown) => ipcRenderer.invoke(CHANNELS.space.create, payload),
    update: (spaceId: string, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.space.update, spaceId, payload),
    delete: (spaceId: string) => ipcRenderer.invoke(CHANNELS.space.delete, spaceId),
    archive: (spaceId: string) => ipcRenderer.invoke(CHANNELS.space.archive, spaceId),
    unarchive: (spaceId: string) => ipcRenderer.invoke(CHANNELS.space.unarchive, spaceId),
  },
  // App settings operations
  appSettings: {
    get: () => ipcRenderer.invoke(CHANNELS.appSettings.get),
    update: (patch: Record<string, unknown>) =>
      ipcRenderer.invoke(CHANNELS.appSettings.update, patch),
    onSpaceChanged: (
      callback: (data: { activeSpaceId: string | null }) => void,
    ) => {
      const listener = (_: any, data: { activeSpaceId: string | null }) =>
        callback(data);
      ipcRenderer.on(CHANNELS.space.changed, listener);
      return () => ipcRenderer.removeListener(CHANNELS.space.changed, listener);
    },
  },
  // macOS global window capture (local desktop only)
  appshots: {
    getStatus: () => ipcRenderer.invoke(CHANNELS.appshots.getStatus),
    configure: (configuration: AppshotsConfiguration) =>
      ipcRenderer.invoke(CHANNELS.appshots.configure, configuration),
    captureNow: () => ipcRenderer.invoke(CHANNELS.appshots.captureNow),
    consumePending: () =>
      ipcRenderer.invoke(CHANNELS.appshots.consumePending),
    acknowledge: (captureId: string) =>
      ipcRenderer.invoke(CHANNELS.appshots.acknowledge, captureId),
    deleteCapture: (captureName: string) =>
      ipcRenderer.invoke(CHANNELS.appshots.deleteCapture, captureName),
    requestAccessibility: () =>
      ipcRenderer.invoke(CHANNELS.appshots.requestAccessibility),
    openSystemSettings: (pane: AppshotsSystemSettingsPane) =>
      ipcRenderer.invoke(CHANNELS.appshots.openSystemSettings, pane),
    onCaptured: (callback: (capture: AppshotCapture) => void) => {
      const listener = (_event: unknown, capture: AppshotCapture) =>
        callback(capture);
      ipcRenderer.on(CHANNELS.appshots.captured, listener);
      return () =>
        ipcRenderer.removeListener(CHANNELS.appshots.captured, listener);
    },
    onError: (callback: (message: string) => void) => {
      const listener = (_event: unknown, payload: { message?: unknown }) =>
        callback(
          typeof payload?.message === "string"
            ? payload.message
            : "Lens capture failed",
        );
      ipcRenderer.on(CHANNELS.appshots.error, listener);
      return () => ipcRenderer.removeListener(CHANNELS.appshots.error, listener);
    },
  },
  // In-app keyboard shortcuts (local desktop only; Lens remains separate).
  keyboardShortcuts: {
    get: () => ipcRenderer.invoke(CHANNELS.keyboardShortcuts.get),
    update: (input: {
      id: KeyboardShortcutId;
      binding: string | null;
    }) => ipcRenderer.invoke(CHANNELS.keyboardShortcuts.update, input),
    resetAll: () => ipcRenderer.invoke(CHANNELS.keyboardShortcuts.resetAll),
  } satisfies {
    get: () => Promise<unknown>;
    update: (input: {
      id: KeyboardShortcutId;
      binding: string | null;
    }) => Promise<unknown>;
    resetAll: () => Promise<unknown>;
  },
  // Provider operations
  providers: {
    getAll: () => ipcRenderer.invoke(CHANNELS.providers.getAll),
    getById: (id: string) => ipcRenderer.invoke(CHANNELS.providers.getById, id),
    getByKind: (kind: "llm_runtime" | "agent_runtime") =>
      ipcRenderer.invoke(CHANNELS.providers.getByKind, kind),
    getEnabled: () => ipcRenderer.invoke(CHANNELS.providers.getEnabled),
    create: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.providers.create, payload),
    update: (id: string, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.providers.update, id, payload),
    updateRunSettings: (
      id: string,
      patch: {
        effortLevel?: string;
        permissionMode?: string;
        fastMode?: boolean;
        goalMode?: boolean;
        planMode?: boolean;
      },
    ) => ipcRenderer.invoke(CHANNELS.providers.updateRunSettings, id, patch),
    delete: (id: string) => ipcRenderer.invoke(CHANNELS.providers.delete, id),
    enable: (id: string) => ipcRenderer.invoke(CHANNELS.providers.enable, id),
    disable: (id: string) => ipcRenderer.invoke(CHANNELS.providers.disable, id),
    getModels: (id: string) => ipcRenderer.invoke(CHANNELS.providers.getModels, id),
    // Fired when async model-capability discovery enriches a provider's model
    // list (e.g. Cursor per-model effort levels). Renderer refetches models.
    onModelsUpdated: (callback: (data: { providerId: string }) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.providers.modelsUpdated, listener);
      return () => ipcRenderer.removeListener(CHANNELS.providers.modelsUpdated, listener);
    },
    getCommands: (id: string, workspacePath?: string) =>
      ipcRenderer.invoke(CHANNELS.providers.getCommands, id, workspacePath),
    getSkills: (id: string, workspacePath?: string) => ipcRenderer.invoke(CHANNELS.providers.getSkills, id, workspacePath),
    getRateLimits: (id: string) => ipcRenderer.invoke(CHANNELS.providers.getRateLimits, id),
    consumeRateLimitResetCredit: (id: string, params: unknown) =>
      ipcRenderer.invoke(CHANNELS.providers.consumeRateLimitResetCredit, id, params),
    // Fired when the provider streams a fresh rate-limit snapshot during a run
    // (Codex `account/rateLimits/updated`). Carries the mapped snapshot so the
    // renderer can patch its cache without a round-trip.
    onRateLimitsUpdated: (callback: (data: { providerId: string; rateLimits: unknown }) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.providers.rateLimitsUpdated, listener);
      return () => ipcRenderer.removeListener(CHANNELS.providers.rateLimitsUpdated, listener);
    },
    // Thread goal controls (Codex `thread/goal/*`), keyed by runId.
    setGoal: (id: string, runId: string, params: { objective?: string; status?: string; tokenBudget?: number }) =>
      ipcRenderer.invoke(CHANNELS.providers.setGoal, id, runId, params),
    getGoal: (id: string, runId: string) => ipcRenderer.invoke(CHANNELS.providers.getGoal, id, runId),
    clearGoal: (id: string, runId: string) => ipcRenderer.invoke(CHANNELS.providers.clearGoal, id, runId),
    // Fired when a thread goal changes (set/updated/cleared); goal === null on clear.
    onGoalUpdated: (callback: (data: { providerId: string; runId: string | null; goal: unknown }) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.providers.goalUpdated, listener);
      return () => ipcRenderer.removeListener(CHANNELS.providers.goalUpdated, listener);
    },
    getAccountInfo: (id: string) => ipcRenderer.invoke(CHANNELS.providers.getAccountInfo, id),
    updateCli: (id: string) => ipcRenderer.invoke(CHANNELS.providers.updateCli, id),
    getPlugins: (id: string) => ipcRenderer.invoke(CHANNELS.providers.getPlugins, id),
    getInstalledPlugins: (id: string) => ipcRenderer.invoke(CHANNELS.providers.getInstalledPlugins, id),
    getConnectors: (id: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke(CHANNELS.providers.getConnectors, id, forceRefresh),
    startConnectorOAuth: (id: string, serverName: string) =>
      ipcRenderer.invoke(CHANNELS.providers.startConnectorOAuth, id, serverName),
    onConnectorsUpdated: (callback: (data: { providerId: string }) => void) => {
      const listener = (_: any, data: { providerId: string }) => callback(data);
      ipcRenderer.on(CHANNELS.providers.connectorsUpdated, listener);
      return () =>
        ipcRenderer.removeListener(CHANNELS.providers.connectorsUpdated, listener);
    },
    readPlugin: (id: string, pluginName: string, marketplacePath: string) => ipcRenderer.invoke(CHANNELS.providers.readPlugin, id, pluginName, marketplacePath),
    installPlugin: (id: string, pluginId: string, scope?: string) => ipcRenderer.invoke(CHANNELS.providers.installPlugin, id, pluginId, scope),
    uninstallPlugin: (id: string, pluginId: string) => ipcRenderer.invoke(CHANNELS.providers.uninstallPlugin, id, pluginId),
    setPluginEnabled: (id: string, pluginId: string, enabled: boolean) => ipcRenderer.invoke(CHANNELS.providers.setPluginEnabled, id, pluginId, enabled),
    updatePlugin: (id: string, pluginId: string) => ipcRenderer.invoke(CHANNELS.providers.updatePlugin, id, pluginId),
    detectInstalled: () => ipcRenderer.invoke(CHANNELS.providers.detectInstalled),
  },
  // Tool calls operations
  toolCalls: {
    getByRun: (runId: string) =>
      ipcRenderer.invoke(CHANNELS.toolCalls.getByRun, runId),
    getByAccount: (accountId: string, limit?: number) =>
      ipcRenderer.invoke(CHANNELS.toolCalls.getByAccount, accountId, limit),
    create: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.toolCalls.create, payload),
    update: (id: number, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.toolCalls.update, id, payload),
    start: (id: number) => ipcRenderer.invoke(CHANNELS.toolCalls.start, id),
    complete: (id: number, output: unknown, latencyMs?: number) =>
      ipcRenderer.invoke(CHANNELS.toolCalls.complete, id, output, latencyMs),
    fail: (id: number, error: string) =>
      ipcRenderer.invoke(CHANNELS.toolCalls.fail, id, error),
  },
  // Workspace aggregate (workspaces + activity + diffs + reviews + findings)
  // See ADR-0001. Old per-table namespaces below are retained through Phase 3
  // of the consolidation and will be removed once renderer migration completes.
  workspace: {
    // ── lifecycle ──
    list: () => ipcRenderer.invoke(CHANNELS.workspace.list),
    listArchived: () => ipcRenderer.invoke(CHANNELS.workspace.listArchived),
    get: (id: string) => ipcRenderer.invoke(CHANNELS.workspace.get, id),
    listByAccount: (accountId: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.listByAccount, accountId),
    listGitStates: () =>
      ipcRenderer.invoke(CHANNELS.workspace.listGitStates),
    getByRootPath: (accountId: string, rootPath: string) =>
      ipcRenderer.invoke(
        CHANNELS.workspace.getByRootPath,
        accountId,
        rootPath,
      ),
    create: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.workspace.create, payload),
    createFromSource: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.workspace.createFromSource, payload),
    update: (id: string, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.workspace.update, id, payload),
    delete: (id: string, options?: { removeWorktree?: boolean }) =>
      ipcRenderer.invoke(CHANNELS.workspace.delete, id, options),
    archive: (id: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.archive, id),
    unarchive: (id: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.unarchive, id),
    // ── git operations (see CONTEXT.md "Workspace git operations") ──
    createBranch: (id: string, branch: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.createBranch, id, branch),
    renameBranch: (id: string, newBranchName: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.renameBranch, id, newBranchName),
    switchBranch: (id: string, branch: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.switchBranch, id, branch),
    discardPaths: (id: string, paths: string[]) =>
      ipcRenderer.invoke(CHANNELS.workspace.discardPaths, id, paths),
    selectDirectory: () =>
      ipcRenderer.invoke(CHANNELS.workspace.selectDirectory),
    onScriptComplete: (
      callback: (data: {
        workspaceId: string;
        script: "setup" | "archive";
        success: boolean;
        error?: string;
      }) => void,
    ) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.workspace.scriptComplete, listener);
      return () =>
        ipcRenderer.removeListener(CHANNELS.workspace.scriptComplete, listener);
    },
    onFindingsChanged: (
      callback: (data: { workspaceId: string }) => void,
    ) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.workspace.findingsChanged, listener);
      return () =>
        ipcRenderer.removeListener(
          CHANNELS.workspace.findingsChanged,
          listener,
        );
    },
    onGitStateChanged: (
      callback: (data: {
        workspaceId: string;
        branch: string | null;
        pathExists: boolean;
      }) => void,
    ) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.workspace.gitStateChanged, listener);
      return () =>
        ipcRenderer.removeListener(
          CHANNELS.workspace.gitStateChanged,
          listener,
        );
    },
    // ── activity ──
    listActivity: (workspaceId: string, limit?: number) =>
      ipcRenderer.invoke(CHANNELS.workspace.listActivity, workspaceId, limit),
    createActivity: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.workspace.createActivity, payload),
    createManyActivity: (payloads: unknown) =>
      ipcRenderer.invoke(CHANNELS.workspace.createManyActivity, payloads),
    deleteActivity: (id: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.deleteActivity, id),
    // ── diffs ──
    listDiffs: (workspaceId: string, limit?: number) =>
      ipcRenderer.invoke(CHANNELS.workspace.listDiffs, workspaceId, limit),
    getLatestDiff: (workspaceId: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.getLatestDiff, workspaceId),
    getLatestDiffSummary: (workspaceId: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.getLatestDiffSummary, workspaceId),
    getDiffByRun: (runId: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.getDiffByRun, runId),
    deleteLatestDiff: (workspaceId: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.deleteLatestDiff, workspaceId),
    resyncDiff: (workspaceId: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.resyncDiff, workspaceId),
    // ── reviews ──
    listReviews: (workspaceId: string, limit?: number) =>
      ipcRenderer.invoke(CHANNELS.workspace.listReviews, workspaceId, limit),
    getReview: (id: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.getReview, id),
    createReview: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.workspace.createReview, payload),
    updateReview: (id: string, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.workspace.updateReview, id, payload),
    deleteReview: (id: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.deleteReview, id),
    // ── findings ──
    listFindings: (reviewId: string, limit?: number) =>
      ipcRenderer.invoke(CHANNELS.workspace.listFindings, reviewId, limit),
    listFindingsByWorkspace: (workspaceId: string) =>
      ipcRenderer.invoke(
        CHANNELS.workspace.listFindingsByWorkspace,
        workspaceId,
      ),
    getFinding: (id: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.getFinding, id),
    createFinding: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.workspace.createFinding, payload),
    createManyFindings: (payloads: unknown) =>
      ipcRenderer.invoke(CHANNELS.workspace.createManyFindings, payloads),
    updateFinding: (id: string, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.workspace.updateFinding, id, payload),
    deleteFinding: (id: string) =>
      ipcRenderer.invoke(CHANNELS.workspace.deleteFinding, id),
  },
  // Runs operations
  runs: {
    listArchived: () => ipcRenderer.invoke(CHANNELS.runs.listArchived),
    /** Runs with a live session right now, across every space and workspace. */
    listActive: () => ipcRenderer.invoke(CHANNELS.runs.listActive),
    listRecent: (options: { accountId: string; providerId: string; mode: ModeId; limit?: number }) =>
      ipcRenderer.invoke(CHANNELS.runs.listRecent, options),
    getAll: (limit?: number) => ipcRenderer.invoke(CHANNELS.runs.getAll, limit),
    getById: (id: string) => ipcRenderer.invoke(CHANNELS.runs.getById, id),
    getExecutionRoot: (runId: string) =>
      ipcRenderer.invoke(CHANNELS.runs.getExecutionRoot, runId),
    listOutputFiles: (runId: string) =>
      ipcRenderer.invoke(CHANNELS.runs.listOutputFiles, runId),
    getByAccount: (accountId: string, limit?: number) =>
      ipcRenderer.invoke(CHANNELS.runs.getByAccount, accountId, limit),
    getByWorkspace: (
      workspaceId: string,
      options?: { providerId?: string; mode?: ModeId; limit?: number },
    ) => ipcRenderer.invoke(CHANNELS.runs.getByWorkspace, workspaceId, options),
    getByStatus: (
      accountId: string,
      status: "queued" | "running" | "succeeded" | "failed" | "canceled",
    ) => ipcRenderer.invoke(CHANNELS.runs.getByStatus, accountId, status),
    create: (payload: unknown) => ipcRenderer.invoke(CHANNELS.runs.create, payload),
    update: (id: string, payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.runs.update, id, payload),
    moveToCollection: (payload: {
      runId: string;
      accountId: string;
      collectionId: string | null;
    }) => ipcRenderer.invoke(CHANNELS.runs.moveToCollection, payload),
    setPinned: (payload: {
      runId: string;
      accountId: string;
      pinned: boolean;
    }) => ipcRenderer.invoke(CHANNELS.runs.setPinned, payload),
    start: (id: string) => ipcRenderer.invoke(CHANNELS.runs.start, id),
    complete: (id: string) => ipcRenderer.invoke(CHANNELS.runs.complete, id),
    fail: (id: string, error: string) =>
      ipcRenderer.invoke(CHANNELS.runs.fail, id, error),
    cancel: (id: string) => ipcRenderer.invoke(CHANNELS.runs.cancel, id),
    delete: (id: string) => ipcRenderer.invoke(CHANNELS.runs.delete, id),
    archive: (id: string) => ipcRenderer.invoke(CHANNELS.runs.archive, id),
    unarchive: (id: string) =>
      ipcRenderer.invoke(CHANNELS.runs.unarchive, id),
    // New methods for executing work runs
    getDetails: (runId: string) => ipcRenderer.invoke(CHANNELS.runs.getDetails, runId),
    execute: (payload: {
      accountId: string;
      workspaceId?: string;
      collectionId?: string;
      spaceId?: string;
      providerId: string;
      goal: string;
      model?: string;
      systemPrompt?: string;
      initialContext?: Array<{
        kind: "file" | "diff" | "selection" | "note";
        ref?: string;
        content?: string;
        metadata?: Record<string, unknown>;
      }>;
      configSnapshot?: Record<string, unknown>;
      toolPolicySnapshot?: Record<string, unknown>;
      attachments?: Array<{ name: string; type: string; data?: string; sourcePath?: string; mimeType: string }>;
      contextIssues?: Array<{ provider: string; number?: number | null; title: string; body?: string | null }>;
      contextSignals?: Array<{ source: string; level: string; category: string; title: string; body?: string | null; stackTrace?: string | null; eventCount?: number }>;
      contextFiles?: Array<{ path: string; type?: "file" | "directory" }>;
      contextSkills?: Array<{ name: string; path?: string; mentionPath?: string; displayName?: string; description?: string; shortDescription?: string; iconSmall?: string; iconLarge?: string; brandColor?: string; scope?: string }>;
    }) => ipcRenderer.invoke(CHANNELS.runs.execute, payload),
    abort: (runId: string) => ipcRenderer.invoke(CHANNELS.runs.abort, runId),
    getToolCalls: (runId: string, sinceUpdatedAt?: Date) =>
      ipcRenderer.invoke(CHANNELS.runToolCalls.getByRun, runId, sinceUpdatedAt),
    // Session resume methods
    continue: (payload: {
      runId: string;
      accountId: string;
      message: string;
      model?: string;
      additionalContext?: Array<{
        kind: "file" | "diff" | "selection" | "note";
        ref?: string;
        content?: string;
        metadata?: Record<string, unknown>;
      }>;
      attachments?: Array<{ name: string; type: string; data?: string; sourcePath?: string; mimeType: string }>;
      contextIssues?: Array<{ provider: string; number?: number | null; title: string; body?: string | null }>;
      contextSignals?: Array<{ source: string; level: string; category: string; title: string; body?: string | null; stackTrace?: string | null; eventCount?: number }>;
      contextFiles?: Array<{ path: string; type?: "file" | "directory" }>;
      contextSkills?: Array<{ name: string; path?: string; mentionPath?: string; displayName?: string; description?: string; shortDescription?: string; iconSmall?: string; iconLarge?: string; brandColor?: string; scope?: string }>;
    }) => ipcRenderer.invoke(CHANNELS.runs.continue, payload),
    canResume: (runId: string) => ipcRenderer.invoke(CHANNELS.runs.canResume, runId),
    fork: (payload: {
      sourceRunId: string;
      accountId: string;
      message: string;
      additionalContext?: Array<{
        kind: "file" | "diff" | "selection" | "note";
        ref?: string;
        content?: string;
        metadata?: Record<string, unknown>;
      }>;
      attachments?: Array<{ name: string; type: string; data?: string; sourcePath?: string; mimeType: string }>;
    }) => ipcRenderer.invoke(CHANNELS.runs.fork, payload),
    executeReview: (payload: {
      accountId: string;
      workspaceId: string;
      spaceId?: string;
      providerId: string;
      target: {
        type: "uncommittedChanges" | "baseBranch" | "commit" | "custom";
        branch?: string;
        sha?: string;
        title?: string;
        instructions?: string;
      };
      model?: string;
      systemPrompt?: string;
      configSnapshot?: Record<string, unknown>;
      toolPolicySnapshot?: Record<string, unknown>;
    }) => ipcRenderer.invoke(CHANNELS.runs.executeReview, payload),
    deleteSession: (runId: string) =>
      ipcRenderer.invoke(CHANNELS.runs.deleteSession, runId),
    // Interactive tool approval
    onToolApprovalRequest: (callback: (request: any) => void) => {
      const listener = (_: any, request: any) => callback(request);
      ipcRenderer.on(CHANNELS.runs.toolApprovalRequest, listener);
      return () =>
        ipcRenderer.removeListener(CHANNELS.runs.toolApprovalRequest, listener);
    },
    onToolApprovalResolved: (
      callback: (payload: { requestId: string }) => void,
    ) => {
      const listener = (_: any, payload: { requestId: string }) =>
        callback(payload);
      ipcRenderer.on(CHANNELS.runs.toolApprovalResolved, listener);
      return () =>
        ipcRenderer.removeListener(CHANNELS.runs.toolApprovalResolved, listener);
    },
    listPendingApprovals: (runId?: string) =>
      ipcRenderer.invoke(CHANNELS.runs.listPendingApprovals, runId),
    respondToolApproval: (response: {
      requestId: string;
      approved: boolean;
      answer?: string;
    }) => ipcRenderer.invoke(CHANNELS.runs.toolApprovalResponse, response),
    // Streaming events (ephemeral — pushed from main, not persisted)
    onStreamingEvent: (callback: (data: { runId: string; event: { type: string; kind: string; content?: string; metadata?: Record<string, unknown>; streamId?: string }; ts: number }) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.runs.ephemeralEvent, listener);
      return () => ipcRenderer.removeListener(CHANNELS.runs.ephemeralEvent, listener);
    },
    // Live context-window usage snapshots (ephemeral — pushed as the turn advances, not persisted).
    onContextUsage: (
      callback: (data: {
        runId: string;
        event: {
          type: "context_usage";
          totalTokens: number;
          maxTokens: number;
          percentage: number;
          model?: string;
          isAutoCompactEnabled?: boolean;
          autoCompactThreshold?: number;
          categories?: {
            name: string;
            tokens: number;
            kind: "used" | "free" | "buffer" | "deferred";
          }[];
          ts?: number;
        };
        ts: number;
      }) => void,
    ) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.runs.contextUsage, listener);
      return () => ipcRenderer.removeListener(CHANNELS.runs.contextUsage, listener);
    },
    // Fired after each persisted run event (log / tool_call / artifact / prompt_suggestion).
    // Renderer debounces and refetches run details — keeps the UI in sync without polling.
    onEventPersisted: (callback: (data: { runId: string; ts: number }) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.runs.eventPersisted, listener);
      return () => ipcRenderer.removeListener(CHANNELS.runs.eventPersisted, listener);
    },
    // Fired when a run's session starts ("running") and when it reaches a
    // terminal status (succeeded / failed / canceled).
    onStatusChanged: (callback: (data: { runId: string; status: string; ts: number }) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.runs.statusChanged, listener);
      return () => ipcRenderer.removeListener(CHANNELS.runs.statusChanged, listener);
    },
    // Fired when a run row changes outside the status lifecycle (today: the
    // generated title landing). The chat sidebar refreshes on it.
    onUpdated: (callback: (data: { runId: string; ts: number }) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.runs.updated, listener);
      return () => ipcRenderer.removeListener(CHANNELS.runs.updated, listener);
    },
    // Fired after the workspace diff is recomputed (incrementally during a run
    // and once finally at completion). Renderer refetches the diff.
    onDiffUpdated: (callback: (data: { runId: string; workspaceId: string; ts: number }) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.runs.diffUpdated, listener);
      return () => ipcRenderer.removeListener(CHANNELS.runs.diffUpdated, listener);
    },
  },
  // Run context operations
  runContext: {
    getByRun: (runId: string) =>
      ipcRenderer.invoke(CHANNELS.runContext.getByRun, runId),
    add: (payload: unknown) => ipcRenderer.invoke(CHANNELS.runContext.add, payload),
    remove: (id: number) => ipcRenderer.invoke(CHANNELS.runContext.remove, id),
  },
  // Run artifacts operations
  runArtifacts: {
    getByRun: (runId: string, sinceId?: number) =>
      ipcRenderer.invoke(CHANNELS.runArtifacts.getByRun, runId, sinceId),
    add: (payload: unknown) => ipcRenderer.invoke(CHANNELS.runArtifacts.add, payload),
    remove: (id: number) => ipcRenderer.invoke(CHANNELS.runArtifacts.remove, id),
  },
  // Run turns operations
  runTurns: {
    getByRun: (runId: string) => ipcRenderer.invoke(CHANNELS.runTurns.getByRun, runId),
    getChangesDiff: (runId: string, turnId: number) =>
      ipcRenderer.invoke(CHANNELS.runTurns.getChangesDiff, runId, turnId),
    undoChanges: (runId: string, turnId: number) =>
      ipcRenderer.invoke(CHANNELS.runTurns.undoChanges, runId, turnId),
  },
  // File explorer operations
  fileExplorer: {
    readDirectory: (options: {
      rootPath: string;
      depth?: number;
      includeHidden?: boolean;
      excludePatterns?: string[];
    }) => ipcRenderer.invoke(CHANNELS.fileExplorer.readDirectory, options),
    readDirectoryShallow: (
      dirPath: string,
      options?: { includeHidden?: boolean; excludePatterns?: string[] }
    ) => ipcRenderer.invoke(CHANNELS.fileExplorer.readDirectoryShallow, dirPath, options),
    getPathInfo: (targetPath: string) =>
      ipcRenderer.invoke(CHANNELS.fileExplorer.getPathInfo, targetPath),
    readFile: (filePath: string) =>
      ipcRenderer.invoke(CHANNELS.fileExplorer.readFile, filePath),
    /**
     * Read file text. Enforces regular-file, 2MB size limit, and binary
     * detection. No workspace boundary — the agent already has full
     * filesystem access so the renderer can preview anywhere.
     */
    readFileText: (options: {
      filePath: string;
      maxSizeBytes?: number;
    }) => ipcRenderer.invoke(CHANNELS.fileExplorer.readFileText, options),
    /**
     * Copy a readable file somewhere the user picks in the native save dialog.
     * Resolves to the saved path, or null when the dialog is cancelled.
     */
    saveFileAs: (sourcePath: string, suggestedName?: string) =>
      ipcRenderer.invoke(
        CHANNELS.fileExplorer.saveFileAs,
        sourcePath,
        suggestedName,
      ),
    /**
     * List directory contents for lazy loading.
     * Returns immediate children with hasChildren flag for directories.
     */
    listDir: (options: {
      dirPath: string;
      includeHidden?: boolean;
      excludePatterns?: string[];
    }) => ipcRenderer.invoke(CHANNELS.fileExplorer.listDir, options),
    searchFiles: (options: {
      rootPath: string;
      query: string;
      max?: number;
      includeHidden?: boolean;
      includeDirectories?: boolean;
      excludePatterns?: string[];
    }) => ipcRenderer.invoke(CHANNELS.fileExplorer.searchFiles, options),
    /**
     * Overwrite an existing regular file with UTF-8 text. Same 2MB cap and
     * regular-file safeguards as readFileText; does not create new files.
     * Pass expectedMtimeMs to reject the write if the file changed on disk.
     */
    writeFileText: (options: {
      filePath: string;
      content: string;
      expectedMtimeMs?: number;
    }) => ipcRenderer.invoke(CHANNELS.fileExplorer.writeFileText, options),
  },
  // NOTE: there is deliberately no `git` namespace — the git module is
  // main-process-internal. Renderer-triggered git effects are workspace/gitFlow
  // operations. See CONTEXT.md "git module".
  // Deterministic commit / push / PR flow (no chat agent)
  gitFlow: {
    /** Live branch + ahead/behind + pending +/- stats for the commit panel */
    getStatus: (workspaceId: string) =>
      ipcRenderer.invoke(CHANNELS.gitFlow.getStatus, workspaceId),
    /** Stage (+ optionally generate message) + commit, optionally pushing */
    commit: (payload: {
      workspaceId: string;
      message?: string;
      includeUnstaged?: boolean;
      providerId?: string;
      model?: string;
      push?: boolean;
    }) => ipcRenderer.invoke(CHANNELS.gitFlow.commit, payload),
    /** Push the current branch (standalone Push action) */
    push: (workspaceId: string) =>
      ipcRenderer.invoke(CHANNELS.gitFlow.push, workspaceId),
    /** Fetch + fast-forward the current branch from its upstream */
    pull: (workspaceId: string) =>
      ipcRenderer.invoke(CHANNELS.gitFlow.pull, workspaceId),
    /** Push (idempotent) then create a PR via gh, generating title/body if blank */
    createPr: (payload: {
      workspaceId: string;
      title?: string;
      body?: string;
      base?: string;
      draft?: boolean;
      providerId?: string;
      model?: string;
    }) => ipcRenderer.invoke(CHANNELS.gitFlow.createPr, payload),
    /** Headless one-shot commit-message generation */
    generateCommitMessage: (payload: {
      workspaceId: string;
      providerId: string;
      model?: string;
      includeUnstaged?: boolean;
    }) => ipcRenderer.invoke(CHANNELS.gitFlow.generateCommitMessage, payload),
    /** Headless one-shot PR title/body generation */
    generatePrBody: (payload: {
      workspaceId: string;
      providerId: string;
      model?: string;
      base?: string;
    }) => ipcRenderer.invoke(CHANNELS.gitFlow.generatePrBody, payload),
  },
  // Terminal operations
  terminal: {
    create: (payload: { id: string; cwd?: string }) =>
      ipcRenderer.invoke(CHANNELS.terminal.create, payload),
    write: (id: string, data: string) =>
      ipcRenderer.invoke(CHANNELS.terminal.write, id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke(CHANNELS.terminal.resize, id, cols, rows),
    destroy: (id: string) => ipcRenderer.invoke(CHANNELS.terminal.destroy, id),
    onData: (callback: (data: { id: string; data: string }) => void) => {
      const listener = (_: any, data: { id: string; data: string }) =>
        callback(data);
      ipcRenderer.on(CHANNELS.terminal.data, listener);
      return () => ipcRenderer.removeListener(CHANNELS.terminal.data, listener);
    },
  },
  platform: {
    homedir: os.homedir(),
  },
  imageProxy: {
    sign: (absPath: string) => ipcRenderer.invoke(CHANNELS.imageProxy.sign, absPath),
  },
  documents: {
    sign: (absPath: string) => ipcRenderer.invoke(CHANNELS.documents.sign, absPath),
  },
  visualizations: {
    sign: (absPath: string) => ipcRenderer.invoke(CHANNELS.visualizations.sign, absPath),
  },
  mcpApps: {
    readResource: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.mcpApps.readResource, payload),
    callTool: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.mcpApps.callTool, payload),
    sendMessage: (payload: unknown) =>
      ipcRenderer.invoke(CHANNELS.mcpApps.sendMessage, payload),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(CHANNELS.shell.openExternal, url),
    openPath: (path: string) => ipcRenderer.invoke(CHANNELS.shell.openPath, path),
    showItemInFolder: (path: string) => ipcRenderer.invoke(CHANNELS.shell.showItemInFolder, path),
    openInApp: (appId: string, path: string) => ipcRenderer.invoke(CHANNELS.shell.openInApp, appId, path),
    getInstalledApps: () => ipcRenderer.invoke(CHANNELS.shell.getInstalledApps),
    getAppsForFile: (filePath: string) =>
      ipcRenderer.invoke(CHANNELS.shell.getAppsForFile, filePath),
    openFileWithBundle: (filePath: string, bundleId: string) =>
      ipcRenderer.invoke(CHANNELS.shell.openFileWithBundle, filePath, bundleId),
  },
  stats: {
    getDashboard: (filter?: string) => ipcRenderer.invoke(CHANNELS.stats.getDashboard, filter),
  },
  app: {
    quit: () => ipcRenderer.invoke(CHANNELS.app.quit),
    // A notification or the menu bar asked the window for something: collect it.
    onWindowRequest: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on(CHANNELS.app.windowRequest, listener);
      return () => ipcRenderer.removeListener(CHANNELS.app.windowRequest, listener);
    },
    consumeWindowRequest: () =>
      ipcRenderer.invoke(CHANNELS.app.consumeWindowRequest),
    setUnsavedChanges: (hasChanges: boolean) =>
      ipcRenderer.invoke(CHANNELS.app.setUnsavedChanges, hasChanges),
    setMenuBarIconVisible: (visible: boolean) =>
      ipcRenderer.invoke(CHANNELS.app.setMenuBarIconVisible, visible),
    setThemeSource: (theme: "system" | "light" | "dark") =>
      ipcRenderer.invoke(CHANNELS.app.setThemeSource, theme),
    onFlushAndQuit: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on(CHANNELS.app.flushAndQuit, listener);
      return () => ipcRenderer.removeListener(CHANNELS.app.flushAndQuit, listener);
    },
    onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
      const listener = (_: any, isFullscreen: boolean) => callback(isFullscreen);
      ipcRenderer.on(CHANNELS.app.fullscreenChange, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.app.fullscreenChange, listener);
      };
    },
  },
  updates: {
    checkForUpdates: () => ipcRenderer.invoke(CHANNELS.updates.check),
    downloadUpdate: () => ipcRenderer.invoke(CHANNELS.updates.download),
    quitAndInstall: () => ipcRenderer.invoke(CHANNELS.updates.quitAndInstall),
    getStatus: () => ipcRenderer.invoke(CHANNELS.updates.getStatus),
    onStatusChange: (callback: (data: any) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.updates.status, listener);
      return () => ipcRenderer.removeListener(CHANNELS.updates.status, listener);
    },
  },

  // Embedded browser panel operations
  browser: {
    createTab: (url?: string) =>
      ipcRenderer.invoke(CHANNELS.browser.createTab, url),
    closeTab: (tabId: string) =>
      ipcRenderer.invoke(CHANNELS.browser.closeTab, tabId),
    activateTab: (tabId: string) =>
      ipcRenderer.invoke(CHANNELS.browser.activateTab, tabId),
    attach: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(CHANNELS.browser.attach, bounds),
    detach: () => ipcRenderer.invoke(CHANNELS.browser.detach),
    destroy: () => ipcRenderer.invoke(CHANNELS.browser.destroy),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(CHANNELS.browser.setBounds, bounds),
    setVisible: (visible: boolean) =>
      ipcRenderer.invoke(CHANNELS.browser.setVisible, visible),
    navigate: (url: string) => ipcRenderer.invoke(CHANNELS.browser.navigate, url),
    back: () => ipcRenderer.invoke(CHANNELS.browser.back),
    forward: () => ipcRenderer.invoke(CHANNELS.browser.forward),
    reload: () => ipcRenderer.invoke(CHANNELS.browser.reload),
    stop: () => ipcRenderer.invoke(CHANNELS.browser.stop),
    setSelectMode: (enabled: boolean) =>
      ipcRenderer.invoke(CHANNELS.browser.setSelectMode, enabled),
    getNavState: () => ipcRenderer.invoke(CHANNELS.browser.getNavState),
    getState: () => ipcRenderer.invoke(CHANNELS.browser.getState),
    getDownloads: () => ipcRenderer.invoke(CHANNELS.browser.getDownloads),
    getHistory: () => ipcRenderer.invoke(CHANNELS.browser.getHistory),
    removeHistoryEntry: (historyEntryId: string) =>
      ipcRenderer.invoke(CHANNELS.browser.removeHistoryEntry, historyEntryId),
    clearBrowsingData: (input: BrowserClearDataOptions) =>
      ipcRenderer.invoke(CHANNELS.browser.clearBrowsingData, input),
    clearHistory: () => ipcRenderer.invoke(CHANNELS.browser.clearHistory),
    cancelDownload: (downloadId: string) =>
      ipcRenderer.invoke(CHANNELS.browser.cancelDownload, downloadId),
    clearDownloads: () => ipcRenderer.invoke(CHANNELS.browser.clearDownloads),
    openDownload: (downloadId: string) =>
      ipcRenderer.invoke(CHANNELS.browser.openDownload, downloadId),
    showDownloadInFolder: (downloadId: string) =>
      ipcRenderer.invoke(CHANNELS.browser.showDownloadInFolder, downloadId),
    setZoomFactor: (factor: number) =>
      ipcRenderer.invoke(CHANNELS.browser.setZoomFactor, factor),
    setDeviceEmulation: (input: BrowserDeviceEmulation) =>
      ipcRenderer.invoke(CHANNELS.browser.setDeviceEmulation, input),
    findInPage: (input: {
      query: string;
      forward?: boolean;
      findNext?: boolean;
    }) => ipcRenderer.invoke(CHANNELS.browser.findInPage, input),
    stopFindInPage: (
      action: "clearSelection" | "keepSelection" = "clearSelection",
    ) => ipcRenderer.invoke(CHANNELS.browser.stopFindInPage, action),
    printPage: () => ipcRenderer.invoke(CHANNELS.browser.printPage),
    captureScreenshot: (mode: "viewport" | "fullPage") =>
      ipcRenderer.invoke(CHANNELS.browser.captureScreenshot, mode),
    /** Remove a browser capture PNG from userData/browser-captures. Pass the basename only. */
    deleteCapture: (captureName: string) =>
      ipcRenderer.invoke(CHANNELS.browser.deleteCapture, captureName),
    onNavState: (
      callback: (state: {
        tabId: string;
        url: string;
        title: string;
        faviconUrl: string | null;
        canGoBack: boolean;
        canGoForward: boolean;
        isLoading: boolean;
        zoomFactor: number;
        deviceEmulation: BrowserDeviceEmulation;
      }) => void,
    ) => {
      const listener = (_: any, state: any) => callback(state);
      ipcRenderer.on(CHANNELS.browser.navState, listener);
      return () => ipcRenderer.removeListener(CHANNELS.browser.navState, listener);
    },
    onStateChanged: (
      callback: (state: {
        activeTabId: string;
        tabs: Array<{
          tabId: string;
          url: string;
          title: string;
          faviconUrl: string | null;
          canGoBack: boolean;
          canGoForward: boolean;
          isLoading: boolean;
          isCrashed: boolean;
          zoomFactor: number;
          deviceEmulation: BrowserDeviceEmulation;
        }>;
      }) => void,
    ) => {
      const listener = (_: any, state: any) => callback(state);
      ipcRenderer.on(CHANNELS.browser.stateChanged, listener);
      return () =>
        ipcRenderer.removeListener(CHANNELS.browser.stateChanged, listener);
    },
    onFindResult: (
      callback: (result: {
        tabId: string;
        activeMatchOrdinal: number;
        matches: number;
        finalUpdate: boolean;
      }) => void,
    ) => {
      const listener = (_: any, result: any) => callback(result);
      ipcRenderer.on(CHANNELS.browser.findResult, listener);
      return () =>
        ipcRenderer.removeListener(CHANNELS.browser.findResult, listener);
    },
    onShortcut: (
      callback: (data:
        | { action: "focus-location" | "find" }
        | { action: "app-shortcut"; shortcutId: KeyboardShortcutId }
      ) => void,
    ) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.browser.shortcut, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.browser.shortcut, listener);
      };
    },
    onDownloadsChanged: (
      callback: (downloads: BrowserDownload[]) => void,
    ) => {
      const listener = (_: any, downloads: BrowserDownload[]) =>
        callback(downloads);
      ipcRenderer.on(CHANNELS.browser.downloadsChanged, listener);
      return () =>
        ipcRenderer.removeListener(CHANNELS.browser.downloadsChanged, listener);
    },
    onHistoryChanged: (
      callback: (entries: BrowserHistoryEntry[]) => void,
    ) => {
      const listener = (_: any, entries: BrowserHistoryEntry[]) =>
        callback(entries);
      ipcRenderer.on(CHANNELS.browser.historyChanged, listener);
      return () =>
        ipcRenderer.removeListener(CHANNELS.browser.historyChanged, listener);
    },
    onSelectModeChanged: (callback: (data: { enabled: boolean }) => void) => {
      const listener = (_: any, data: any) => callback(data);
      ipcRenderer.on(CHANNELS.browser.selectModeChanged, listener);
      return () =>
        ipcRenderer.removeListener(CHANNELS.browser.selectModeChanged, listener);
    },
    onSelection: (callback: (selection: any) => void) => {
      const listener = (_: any, selection: any) => callback(selection);
      ipcRenderer.on(CHANNELS.browser.selection, listener);
      return () => ipcRenderer.removeListener(CHANNELS.browser.selection, listener);
    },
  },

  // Automation operations (scheduled jobs)
  automations: {
    getAll: () => ipcRenderer.invoke(CHANNELS.automations.getAll),
    getById: (id: string) => ipcRenderer.invoke(CHANNELS.automations.getById, id),
    create: (accountId: string, input: unknown) =>
      ipcRenderer.invoke(CHANNELS.automations.create, accountId, input),
    update: (id: string, input: unknown) =>
      ipcRenderer.invoke(CHANNELS.automations.update, id, input),
    delete: (id: string) => ipcRenderer.invoke(CHANNELS.automations.delete, id),
    execute: (id: string) => ipcRenderer.invoke(CHANNELS.automations.execute, id),
    getRunHistory: (automationId: string, limit?: number) =>
      ipcRenderer.invoke(CHANNELS.automations.getRunHistory, automationId, limit),
    getAvailableActions: () => ipcRenderer.invoke(CHANNELS.automations.getAvailableActions),
  },

  // Pull request inbox (live provider queries, GitHub for now)
  pullRequests: {
    getAvailability: (provider?: string) =>
      ipcRenderer.invoke(CHANNELS.pullRequests.getAvailability, provider),
    search: (input: unknown) =>
      ipcRenderer.invoke(CHANNELS.pullRequests.search, input),
    getDetail: (input: unknown) =>
      ipcRenderer.invoke(CHANNELS.pullRequests.getDetail, input),
    getDiff: (input: unknown) =>
      ipcRenderer.invoke(CHANNELS.pullRequests.getDiff, input),
    merge: (input: unknown) =>
      ipcRenderer.invoke(CHANNELS.pullRequests.merge, input),
    markReady: (input: unknown) =>
      ipcRenderer.invoke(CHANNELS.pullRequests.markReady, input),
    addComment: (input: unknown) =>
      ipcRenderer.invoke(CHANNELS.pullRequests.addComment, input),
    addReviewComment: (input: unknown) =>
      ipcRenderer.invoke(CHANNELS.pullRequests.addReviewComment, input),
    replyToThread: (input: unknown) =>
      ipcRenderer.invoke(CHANNELS.pullRequests.replyToThread, input),
    resolveThread: (input: unknown) =>
      ipcRenderer.invoke(CHANNELS.pullRequests.resolveThread, input),
  },
  // Pulse operations (scheduled work runs)
  pulse: {
    getAll: () => ipcRenderer.invoke(CHANNELS.pulse.getAll),
    getById: (id: string) => ipcRenderer.invoke(CHANNELS.pulse.getById, id),
    create: (accountId: string, input: unknown) =>
      ipcRenderer.invoke(CHANNELS.pulse.create, accountId, input),
    update: (id: string, input: unknown) =>
      ipcRenderer.invoke(CHANNELS.pulse.update, id, input),
    delete: (id: string) => ipcRenderer.invoke(CHANNELS.pulse.delete, id),
    toggle: (id: string, isActive: boolean) =>
      ipcRenderer.invoke(CHANNELS.pulse.toggle, id, isActive),
    runNow: (id: string) => ipcRenderer.invoke(CHANNELS.pulse.runNow, id),
  },
};

// Expose protected methods that allow the renderer process
// to use ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("api", api);

// Generic, channel-based transport bridge. The renderer's Transport abstraction
// (src/renderer/lib/transport) routes every request/response (`invoke`) and push
// subscription (`subscribe`) through this, so the same call sites can later be
// pointed at a remote backend over WebSocket instead of Electron IPC by swapping
// the active transport. This is purely additive — the namespaced `window.api`
// above is unchanged. See docs/design/remote-backend.md.
const mainTransport = {
  invoke: (channel: string, args: unknown[] = []) =>
    ipcRenderer.invoke(channel, ...args),
  subscribe: (channel: string, listener: (payload: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, handler as never);
    return () => ipcRenderer.removeListener(channel, handler as never);
  },
};

contextBridge.exposeInMainWorld("mainTransport", mainTransport);

export type ApiType = typeof api;
export type MainTransport = typeof mainTransport;
