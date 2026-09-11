import { and, eq, notInArray } from "drizzle-orm";

import { type BackendDescriptor } from "@mains/contracts/backend";
import { CHANNELS } from "@mains/contracts/channels";
import {
  APPROVAL_TIMEOUT_MS,
  isTerminalRunStatus,
  type AccountResponse,
  type CollectionResponse,
  type CommandSummary,
  type ModelInfo,
  type PendingApproval,
  type ProjectResponse,
  type RunDiffUpdatedEvent,
  type ProviderModelsUpdatedEvent,
  type ProviderSummary,
  type RunArtifactResponse,
  type SpaceRecord,
  type RunEventPersistedEvent,
  type RunResponse,
  type RunStatusChangedEvent,
  type RunTurnResponse,
  type RunUpdatedEvent,
  type SkillSummary,
  type ToolApprovalRequest,
  type ToolApprovalResolvedEvent,
  type ToolCallResponse,
  type WorkspaceDiffSummary,
  type WorkspaceGitState,
  type WorkspaceResponse,
  ArtifactImage,
} from "@mains/contracts/runs";
import { WS_PROTOCOL_VERSION } from "@mains/contracts/ws-protocol";
import { db } from "@/db/client";
import {
  aiDataConsents,
  backends,
  collections,
  modelChoices,
  commands,
  models,
  pendingApprovals,
  projects,
  providers,
  runArtifacts,
  runTurns,
  runs,
  skills,
  spaceTargets,
  spaces,
  syncCursors,
  toolCalls,
  workspaces,
} from "@/db/schema";

import { parseShortstat } from "@/lib/format";
import { runSettingsFromConfig } from "@/lib/models";

import { ProtocolMismatchError } from "./connection-supervisor";
import type { WsTransport } from "./ws-transport";

/**
 * The sync layer: the only writer of the projection tables. It pulls snapshots
 * and per-run deltas from the backend and upserts them; screens read the
 * tables through live queries. Direction is Mac → phone only, so there is
 * nothing to merge — a newer answer simply replaces the row.
 *
 * Reconnects refetch snapshots rather than replaying missed events (design doc
 * §5.7); events only decide *which* run to refetch and when.
 */

/** How many runs the list keeps. Older ones live on the Mac. */
const RUN_LIST_LIMIT = 100;
const EVENT_DEBOUNCE_MS = 300;

async function invoke<T>(
  transport: WsTransport,
  channel: string,
  args: unknown[] = [],
): Promise<T> {
  const response = await transport.invoke(channel, args);
  if (!response.success) throw new Error(response.error);
  return response.data as T;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function toJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

// ── Descriptor ──

export async function describeBackend(transport: WsTransport): Promise<BackendDescriptor> {
  const descriptor = await invoke<BackendDescriptor>(transport, CHANNELS.backend.describe);
  if (descriptor.protocolVersion !== WS_PROTOCOL_VERSION) {
    throw new ProtocolMismatchError(
      `Your Mac speaks protocol ${descriptor.protocolVersion}; this app speaks ${WS_PROTOCOL_VERSION}. Update the older one.`,
    );
  }
  return descriptor;
}

export function upsertBackend(descriptor: BackendDescriptor): void {
  db.insert(backends)
    .values({
      backendId: descriptor.backendId,
      name: descriptor.name,
      appVersion: descriptor.appVersion,
      protocolVersion: descriptor.protocolVersion,
    })
    .onConflictDoUpdate({
      target: backends.backendId,
      set: {
        name: descriptor.name,
        appVersion: descriptor.appVersion,
        protocolVersion: descriptor.protocolVersion,
      },
    })
    .run();
}

// ── Row shaping ──

function upsertRun(backendId: string, run: RunResponse): void {
  const set = {
    title: run.title,
    status: run.status,
    mode: run.mode,
    providerId: run.providerId,
    model: run.model,
    workspaceId: run.workspaceId,
    collectionId: run.collectionId,
    startedAt: toDate(run.startedAt),
    endedAt: toDate(run.endedAt),
    lastError: run.lastError,
    isArchived: Boolean(run.isArchived),
    createdAt: toDate(run.createdAt) ?? new Date(0),
    updatedAt: toDate(run.updatedAt) ?? new Date(0),
  };
  db.insert(runs)
    .values({ backendId, id: run.id, ...set })
    .onConflictDoUpdate({ target: [runs.backendId, runs.id], set })
    .run();
}

function upsertWorkspace(backendId: string, workspace: WorkspaceResponse): void {
  const set = {
    name: workspace.name,
    projectId: workspace.projectId ?? null,
    rootPath: workspace.rootPath ?? null,
    status: workspace.status ?? null,
    updatedAt: toDate(workspace.updatedAt),
    isArchived: Boolean(workspace.isArchived),
  };
  db.insert(workspaces)
    .values({ backendId, id: workspace.id, ...set })
    .onConflictDoUpdate({ target: [workspaces.backendId, workspaces.id], set })
    .run();
}

function upsertTurn(backendId: string, turn: RunTurnResponse): void {
  const set = {
    promptContent: turn.promptContent,
    responseContent: turn.responseContent,
    status: turn.status,
    startedAt: toDate(turn.startedAt),
    endedAt: toDate(turn.endedAt),
    elapsedMs: turn.elapsedMs,
    model: turn.model,
  };
  db.insert(runTurns)
    .values({ backendId, runId: turn.runId, turnIndex: turn.turnIndex, ...set })
    .onConflictDoUpdate({
      target: [runTurns.backendId, runTurns.runId, runTurns.turnIndex],
      set,
    })
    .run();
}

function upsertToolCall(backendId: string, runId: string, call: ToolCallResponse): void {
  const set = {
    toolId: call.toolId,
    parentToolCallId: call.parentToolCallId,
    toolName: call.toolName,
    status: call.status,
    inputJson: toJson(call.input),
    outputJson: toJson(call.output),
    metadataJson: toJson(call.metadata),
    error: call.error,
    startedAt: toDate(call.startedAt),
    endedAt: toDate(call.endedAt),
    createdAt: toDate(call.createdAt) ?? new Date(0),
    updatedAt: toDate(call.updatedAt) ?? new Date(0),
  };
  db.insert(toolCalls)
    .values({ backendId, runId, id: call.id, ...set })
    .onConflictDoUpdate({
      target: [toolCalls.backendId, toolCalls.runId, toolCalls.id],
      set,
    })
    .run();
}

function upsertArtifact(backendId: string, runId: string, artifact: RunArtifactResponse): void {
  const set = {
    kind: artifact.kind,
    content: artifact.content,
    path: artifact.path,
    metadataJson: toJson(artifact.metadata),
    createdAt: toDate(artifact.createdAt) ?? new Date(0),
  };
  db.insert(runArtifacts)
    .values({ backendId, runId, id: artifact.id, ...set })
    .onConflictDoUpdate({
      target: [runArtifacts.backendId, runArtifacts.runId, runArtifacts.id],
      set,
    })
    .run();
}

function approvalRow(backendId: string, request: ToolApprovalRequest, expiresAt: number) {
  return {
    backendId,
    requestId: request.requestId,
    runId: request.runId,
    kind: request.kind,
    toolName: request.toolName,
    header: request.header ?? null,
    question: request.question ?? null,
    optionsJson: toJson(request.options),
    multiSelect: Boolean(request.multiSelect),
    description: request.description ?? null,
    toolInputJson: toJson(request.toolInput),
    requestedAt: new Date(request.timestamp),
    expiresAt: new Date(expiresAt),
    isOther: Boolean(request.isOther),
    isSecret: Boolean(request.isSecret),
    elicitationMode: request.elicitationMode ?? null,
    url: request.url ?? null,
  };
}

/** Drop one request locally — right after the phone answered it. */
export function deletePendingApproval(backendId: string, requestId: string): void {
  db.delete(pendingApprovals)
    .where(and(eq(pendingApprovals.backendId, backendId), eq(pendingApprovals.requestId, requestId)))
    .run();
}

function upsertApproval(backendId: string, request: ToolApprovalRequest, expiresAt: number): void {
  const { backendId: _b, requestId: _r, ...set } = approvalRow(backendId, request, expiresAt);
  db.insert(pendingApprovals)
    .values(approvalRow(backendId, request, expiresAt))
    .onConflictDoUpdate({
      target: [pendingApprovals.backendId, pendingApprovals.requestId],
      set,
    })
    .run();
}

/** The push carries no expiry; mirror the broker's rule (provider timeout, capped). */
function expiryFromRequest(request: ToolApprovalRequest): number {
  const requested = request.autoResolutionMs;
  const timeout =
    typeof requested === "number" && Number.isFinite(requested) && requested > 0
      ? Math.min(requested, APPROVAL_TIMEOUT_MS)
      : APPROVAL_TIMEOUT_MS;
  return Date.now() + timeout;
}

/** Replace the backend's pending set with what the Mac reports right now. */
export async function syncPendingApprovals(transport: WsTransport, backendId: string): Promise<void> {
  const list = await invoke<PendingApproval[]>(transport, CHANNELS.runs.listPendingApprovals);
  db.transaction(() => {
    db.delete(pendingApprovals).where(eq(pendingApprovals.backendId, backendId)).run();
    for (const request of list) upsertApproval(backendId, request, request.expiresAt);
  });
}

function deleteRunLocally(backendId: string, runId: string): void {
  db.delete(pendingApprovals)
    .where(and(eq(pendingApprovals.backendId, backendId), eq(pendingApprovals.runId, runId)))
    .run();
  db.delete(runArtifacts)
    .where(and(eq(runArtifacts.backendId, backendId), eq(runArtifacts.runId, runId)))
    .run();
  db.delete(toolCalls)
    .where(and(eq(toolCalls.backendId, backendId), eq(toolCalls.runId, runId)))
    .run();
  db.delete(runTurns)
    .where(and(eq(runTurns.backendId, backendId), eq(runTurns.runId, runId)))
    .run();
  db.delete(syncCursors)
    .where(and(eq(syncCursors.backendId, backendId), eq(syncCursors.runId, runId)))
    .run();
  db.delete(runs).where(and(eq(runs.backendId, backendId), eq(runs.id, runId))).run();
}

// ── Run targets: spaces, collections, providers ──

/** Some list channels answer `T[]`, others `{ items }`-style envelopes; take either. */
function asList<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const inner = (data as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner as T[];
  }
  return [];
}

/** Everything a new run needs to be aimed at. Replaced wholesale per snapshot. */
export async function syncTargets(transport: WsTransport, backendId: string): Promise<void> {
  // Collections are per account on the Mac: `collections:list` filters by
  // `accountId` and answers nothing for a missing one.
  const account = await invoke<AccountResponse>(transport, CHANNELS.account.get);
  const [spaceList, collectionList, providerList, projectList] = await Promise.all([
    invoke<unknown>(transport, CHANNELS.space.getAll).then((d) => asList<SpaceRecord>(d, "spaces")),
    invoke<unknown>(transport, CHANNELS.collections.list, [{ accountId: account.id }]).then((d) =>
      asList<CollectionResponse>(d, "collections"),
    ),
    invoke<unknown>(transport, CHANNELS.providers.getEnabled).then((d) =>
      asList<ProviderSummary>(d, "providers"),
    ),
    invoke<unknown>(transport, CHANNELS.projects.list).then((d) => asList<ProjectResponse>(d, "projects")),
  ]);

  db.transaction(() => {
    db.delete(spaces).where(eq(spaces.backendId, backendId)).run();
    for (const space of spaceList) {
      db.insert(spaces)
        .values({
          backendId,
          id: space.id,
          name: space.name,
          icon: space.icon ?? null,
          providerId: space.providerId,
          mode: space.mode,
          model: space.model ?? null,
          sortOrder: space.sortOrder ?? null,
          isArchived: Boolean(space.isArchived),
        })
        .run();
    }
    db.delete(collections).where(eq(collections.backendId, backendId)).run();
    for (const collection of collectionList) {
      db.insert(collections)
        .values({
          backendId,
          id: collection.id,
          name: collection.name,
          icon: collection.icon ?? null,
          isArchived: Boolean(collection.isArchived),
        })
        .run();
    }
    db.delete(projects).where(eq(projects.backendId, backendId)).run();
    for (const project of projectList) {
      db.insert(projects)
        .values({
          backendId,
          id: project.id,
          name: project.name,
          icon: project.icon ?? null,
          isArchived: Boolean(project.isArchived),
        })
        .run();
    }
    db.delete(providers).where(eq(providers.backendId, backendId)).run();
    for (const provider of providerList) {
      const settings = runSettingsFromConfig(provider.id, provider.config);
      db.insert(providers)
        .values({
          backendId,
          id: provider.id,
          displayName: provider.displayName,
          isEnabled: provider.isEnabled !== false,
          effortLevel: settings.effortLevel,
          thinkingMode: settings.thinkingMode,
          permissionMode: settings.permissionMode,
          fastMode: settings.fastMode,
          goalMode: settings.goalMode,
          planMode: settings.planMode,
        })
        .run();
    }
  });
  const enabledIds = providerList.filter((p) => p.isEnabled !== false).map((p) => p.id);
  await syncModels(transport, backendId, enabledIds);
  // Skills and commands change far less often than models and nothing waits on
  // them, so a slow CLI listing must not hold the snapshot open.
  syncContextSources(transport, backendId, enabledIds).catch(() => {});
}

/**
 * `providers:getModels` per provider, each tolerated on its own: a provider
 * whose CLI is missing must not hide the others' models.
 */
export async function syncModels(
  transport: WsTransport,
  backendId: string,
  providerIds: string[],
): Promise<void> {
  const results = await Promise.all(
    providerIds.map(async (providerId) => {
      try {
        const data = await invoke<unknown>(transport, CHANNELS.providers.getModels, [providerId]);
        return { providerId, list: asList<ModelInfo>(data, "models") };
      } catch {
        return null;
      }
    }),
  );
  db.transaction(() => {
    for (const result of results) {
      if (!result) continue;
      db.delete(models)
        .where(and(eq(models.backendId, backendId), eq(models.providerId, result.providerId)))
        .run();
      result.list.forEach((model, index) => {
        const levels = model.supportedEffortLevels ?? [];
        db.insert(models)
          .values({
            backendId,
            providerId: result.providerId,
            id: model.id,
            displayName: model.displayName,
            description: model.description ?? null,
            isDefault: Boolean(model.isDefault),
            effortLevels: levels.length > 0 ? JSON.stringify(levels) : null,
            supportsFastMode: model.supportsFastMode === true,
            sortOrder: index,
          })
          .run();
      });
    }
  });
}

/**
 * `providers:getSkills` + `providers:getCommands` per provider — what the
 * composer's context picker lists behind `@`, `$` and `/`.
 *
 * Same tolerance as the model sync: one provider whose CLI is missing must not
 * take the others' skills down with it. Both listings are replaced wholesale
 * per provider, because the Mac is the only writer and a removed skill has to
 * disappear here too.
 */
/**
 * A listing the Mac refused or failed is not the same as an empty one, and the
 * picker cannot tell them apart from the rows alone — so say it out loud. The
 * usual cause is a Mac still running a build whose device allowlist predates
 * these two channels.
 */
/**
 * First occurrence of each name wins.
 *
 * A provider may name the same thing twice — codex walks one entry per cwd and
 * repeats a skill that several of them see. The rows are keyed by name, so a
 * repeat used to abort the whole write and take the provider's commands down
 * with its skills. The desktop dedupes the same way where it merges plugins
 * into skills (`seenNames` in `mergeSkillsWithInstalledPlugins`).
 */
function dedupeByName<T extends { name: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    if (!item.name || seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

function reportUnavailable(channel: string, providerId: string, sink: string[]) {
  return (error: unknown): null => {
    const reason = error instanceof Error ? error.message : String(error);
    sink.push(reason);
    console.warn(`[sync] ${channel} unavailable for ${providerId}: ${reason}`);
    return null;
  };
}

/**
 * What one provider's listing came back as. `null` means the Mac refused or
 * failed the call — which is not the same as answering "nothing", and the two
 * look identical from the rows alone.
 */
export interface ContextSourcesResult {
  providerId: string;
  skills: number | null;
  commands: number | null;
  /** Set when either call failed; the first reason, for the picker to show. */
  error: string | null;
}

export async function syncContextSources(
  transport: WsTransport,
  backendId: string,
  providerIds: string[],
  /**
   * The workspace a listing is scoped to. Providers answer differently with and
   * without it — codex asks its app-server for `skills/list` against this cwd,
   * so project-scoped skills exist only when it is supplied.
   */
  workspacePath?: string | null,
): Promise<ContextSourcesResult[]> {
  const args = workspacePath ? [workspacePath] : [];
  const results = await Promise.all(
    providerIds.map(async (providerId) => {
      const failures: string[] = [];
      const [skillList, commandList] = await Promise.all([
        invoke<unknown>(transport, CHANNELS.providers.getSkills, [providerId, ...args])
          .then((d) => asList<SkillSummary>(d, "skills"))
          .catch(reportUnavailable(CHANNELS.providers.getSkills, providerId, failures)),
        invoke<unknown>(transport, CHANNELS.providers.getCommands, [providerId, ...args])
          .then((d) => asList<CommandSummary>(d, "commands"))
          .catch(reportUnavailable(CHANNELS.providers.getCommands, providerId, failures)),
      ]);
      if (skillList?.length === 0 && commandList?.length === 0) {
        // Not an error — but the picker will read as broken, and a provider
        // that answers nothing is worth seeing while diagnosing.
        console.warn(
          `[sync] ${providerId} listed no skills and no commands` +
            (workspacePath ? ` for ${workspacePath}` : " (no workspace path)"),
        );
      }
      return {
        providerId,
        skillList: skillList && dedupeByName(skillList),
        commandList: commandList && dedupeByName(commandList),
        error: failures[0] ?? null,
      };
    }),
  );

  db.transaction(() => {
    for (const { providerId, skillList, commandList } of results) {
      if (skillList) {
        db.delete(skills)
          .where(and(eq(skills.backendId, backendId), eq(skills.providerId, providerId)))
          .run();
        // Model-invoked-only skills never appear in a picker, so they are
        // dropped here rather than filtered at every read.
        skillList
          .filter((skill) => skill.name && skill.userInvokable !== false)
          .forEach((skill, index) => {
            db.insert(skills)
              .values({
                backendId,
                providerId,
                name: skill.name,
                displayName: skill.displayName ?? null,
                description: skill.description ?? null,
                shortDescription: skill.shortDescription ?? null,
                argumentHint: skill.argumentHint ?? null,
                iconSmall: skill.iconSmall ?? null,
                iconLarge: skill.iconLarge ?? null,
                brandColor: skill.brandColor ?? null,
                scope: skill.scope ?? null,
                path: skill.path ?? null,
                sortOrder: index,
              })
              // Deduped above; this is the backstop that keeps a surprise
              // repeat from rolling back the whole provider's listing.
              .onConflictDoNothing()
              .run();
          });
      }

      if (commandList) {
        db.delete(commands)
          .where(and(eq(commands.backendId, backendId), eq(commands.providerId, providerId)))
          .run();
        commandList
          .filter((command) => command.name && command.userFacing !== false)
          .forEach((command, index) => {
            db.insert(commands)
              .values({
                backendId,
                providerId,
                name: command.name,
                description: command.description ?? null,
                argumentHint: command.argumentHint ?? null,
                sortOrder: index,
              })
              .onConflictDoNothing()
              .run();
          });
      }
    }
  });

  return results.map(({ providerId, skillList, commandList, error }) => ({
    providerId,
    skills: skillList?.length ?? null,
    commands: commandList?.length ?? null,
    error,
  }));
}

/** Keeps the model lists fresh: async capability discovery pushes `providers:modelsUpdated`. */
export function attachTargetEvents(transport: WsTransport, backendId: string): () => void {
  return transport.subscribe(CHANNELS.providers.modelsUpdated, (payload) => {
    const { providerId } = payload as ProviderModelsUpdatedEvent;
    if (providerId) syncModels(transport, backendId, [providerId]).catch(() => {});
  });
}

/** The model this phone picked for a provider, or null for the Mac's default. */
export function getModelChoice(backendId: string, providerId: string): string | null {
  return (
    db
      .select({ modelId: modelChoices.modelId })
      .from(modelChoices)
      .where(and(eq(modelChoices.backendId, backendId), eq(modelChoices.providerId, providerId)))
      .get()?.modelId ?? null
  );
}

export function setModelChoice(backendId: string, providerId: string, modelId: string): void {
  db.insert(modelChoices)
    .values({ backendId, providerId, modelId })
    .onConflictDoUpdate({
      target: [modelChoices.backendId, modelChoices.providerId],
      set: { modelId },
    })
    .run();
}

export function getLastSpaceId(backendId: string): string | null {
  return (
    db
      .select({ lastSpaceId: backends.lastSpaceId })
      .from(backends)
      .where(eq(backends.backendId, backendId))
      .get()?.lastSpaceId ?? null
  );
}

export function setLastSpaceId(backendId: string, spaceId: string): void {
  db.update(backends).set({ lastSpaceId: spaceId }).where(eq(backends.backendId, backendId)).run();
}

/** The first usable space, by the desktop's own ordering. */
export function firstSpaceId(backendId: string): string | null {
  return (
    db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.backendId, backendId), eq(spaces.isArchived, false)))
      .orderBy(spaces.sortOrder, spaces.name)
      .get()?.id ?? null
  );
}

export function setSpaceTarget(
  backendId: string,
  spaceId: string,
  target: { workspaceId?: string | null; collectionId?: string | null },
): void {
  const set = {
    workspaceId: target.workspaceId ?? null,
    collectionId: target.collectionId ?? null,
  };
  db.insert(spaceTargets)
    .values({ backendId, spaceId, ...set })
    .onConflictDoUpdate({ target: [spaceTargets.backendId, spaceTargets.spaceId], set })
    .run();
}

// ── Snapshot ──

/** The run list and workspace names: fetched together, applied in one transaction. */
export async function syncSnapshot(transport: WsTransport, backendId: string): Promise<void> {
  const [runList, workspaceList] = await Promise.all([
    invoke<RunResponse[]>(transport, CHANNELS.runs.getAll, [RUN_LIST_LIMIT]),
    invoke<WorkspaceResponse[]>(transport, CHANNELS.workspace.list),
  ]);

  // Pending approvals and run targets ride along with every snapshot: a
  // reconnect must show what the Mac is waiting on even if the request push
  // was missed, and what a new run can be aimed at.
  await Promise.all([syncPendingApprovals(transport, backendId), syncTargets(transport, backendId)]);

  db.transaction((tx) => {
    for (const workspace of workspaceList) upsertWorkspace(backendId, workspace);
    for (const run of runList) upsertRun(backendId, run);

    // Anything not in the snapshot was deleted on the Mac (or aged out of the
    // window) — drop it, children first.
    const keep = runList.map((run) => run.id);
    const stale = tx
      .select({ id: runs.id })
      .from(runs)
      .where(
        keep.length > 0
          ? and(eq(runs.backendId, backendId), notInArray(runs.id, keep))
          : eq(runs.backendId, backendId),
      )
      .all();
    for (const { id } of stale) deleteRunLocally(backendId, id);

    tx.update(backends)
      .set({ lastSyncedAt: new Date() })
      .where(eq(backends.backendId, backendId))
      .run();
  });

  // What the Code sidebar prints beside each workspace. Both are best-effort:
  // a Mac that can't run git for one folder must not stall the snapshot.
  await Promise.all([
    syncGitStates(transport, backendId).catch(() => {}),
    ...workspaceList
      .filter((w) => !w.isArchived)
      .map((w) => syncDiffSummary(transport, backendId, w.id).catch(() => {})),
  ]);
}

/** Every workspace's current branch (`workspace:listGitStates`, one call). */
export async function syncGitStates(transport: WsTransport, backendId: string): Promise<void> {
  const states = await invoke<WorkspaceGitState[]>(transport, CHANNELS.workspace.listGitStates);
  db.transaction(() => {
    for (const state of states) applyGitState(backendId, state);
  });
}

function applyGitState(backendId: string, state: WorkspaceGitState): void {
  db.update(workspaces)
    .set({ branch: state.branch ?? null, pathExists: state.pathExists !== false })
    .where(and(eq(workspaces.backendId, backendId), eq(workspaces.id, state.workspaceId)))
    .run();
}

/** The size of a workspace's last diff snapshot (`workspace:getLatestDiffSummary`). */
export async function syncDiffSummary(
  transport: WsTransport,
  backendId: string,
  workspaceId: string,
): Promise<void> {
  const summary = await invoke<WorkspaceDiffSummary | null>(
    transport,
    CHANNELS.workspace.getLatestDiffSummary,
    [workspaceId],
  );
  const { additions, deletions } = parseShortstat(summary?.stats?.shortstat);
  db.update(workspaces)
    .set({ diffAdditions: additions, diffDeletions: deletions })
    .where(and(eq(workspaces.backendId, backendId), eq(workspaces.id, workspaceId)))
    .run();
}

/** Longest side the phone asks an image artifact to be sent at. */
const ARTIFACT_IMAGE_SIDE = 1200;

/** An image artifact's pixels, as the Mac scales them for a phone. */
export function readArtifactImage(transport: WsTransport, artifactId: number): Promise<ArtifactImage> {
  return invoke<ArtifactImage>(transport, CHANNELS.runArtifacts.readImage, [
    { artifactId, maxSide: ARTIFACT_IMAGE_SIDE },
  ]);
}

// ── Per-run ──

const inFlight = new Map<string, Promise<void>>();
const pendingAgain = new Set<string>();

async function syncRunOnce(transport: WsTransport, backendId: string, runId: string): Promise<void> {
  const run = await invoke<RunResponse | null>(transport, CHANNELS.runs.getById, [runId]);
  if (!run) {
    deleteRunLocally(backendId, runId);
    return;
  }

  // Turns are few and edit in place: always a full fetch (always correct).
  // Artifacts are insert-only (cursor = max id) and tool calls update in
  // place (cursor = max updatedAt): fetch only what's newer, exactly like
  // the desktop's run cache.
  const cursor = db
    .select({
      toolUpdatedAt: syncCursors.toolUpdatedAt,
      artifactId: syncCursors.artifactId,
    })
    .from(syncCursors)
    .where(and(eq(syncCursors.backendId, backendId), eq(syncCursors.runId, runId)))
    .get();
  const toolSince = cursor?.toolUpdatedAt ?? undefined;
  const artifactSince = cursor?.artifactId ?? undefined;

  const [turns, calls, artifacts, approvals] = await Promise.all([
    invoke<RunTurnResponse[]>(transport, CHANNELS.runTurns.getByRun, [runId]),
    invoke<ToolCallResponse[]>(transport, CHANNELS.runToolCalls.getByRun, [runId, toolSince]),
    invoke<RunArtifactResponse[]>(transport, CHANNELS.runArtifacts.getByRun, [
      runId,
      artifactSince,
    ]),
    // Authoritative per run, so a missed request/resolved push heals on the
    // next refetch instead of leaving a stale card.
    invoke<PendingApproval[]>(transport, CHANNELS.runs.listPendingApprovals, [runId]),
  ]);

  db.transaction(() => {
    upsertRun(backendId, run);
    for (const turn of turns) upsertTurn(backendId, turn);
    for (const call of calls) upsertToolCall(backendId, runId, call);
    for (const artifact of artifacts) upsertArtifact(backendId, runId, artifact);
    db.delete(pendingApprovals)
      .where(and(eq(pendingApprovals.backendId, backendId), eq(pendingApprovals.runId, runId)))
      .run();
    for (const request of approvals) upsertApproval(backendId, request, request.expiresAt);

    let maxUpdated = toolSince?.getTime() ?? 0;
    for (const call of calls) {
      const updated = toDate(call.updatedAt)?.getTime() ?? 0;
      if (updated > maxUpdated) maxUpdated = updated;
    }
    let maxArtifactId = artifactSince ?? 0;
    for (const artifact of artifacts) {
      if (artifact.id > maxArtifactId) maxArtifactId = artifact.id;
    }
    const cursorRow = {
      toolUpdatedAt: maxUpdated > 0 ? new Date(maxUpdated) : null,
      artifactId: maxArtifactId > 0 ? maxArtifactId : null,
      fullSyncedAt: new Date(),
    };
    db.insert(syncCursors)
      .values({ backendId, runId, ...cursorRow })
      .onConflictDoUpdate({
        target: [syncCursors.backendId, syncCursors.runId],
        set: cursorRow,
      })
      .run();
  });
}

/**
 * Refresh one run's row, turns and tool calls. One load per run at a time; a
 * request that lands mid-load queues a single trailing reload, so two
 * concurrent syncs can't interleave into a partial transcript.
 */
export function syncRun(transport: WsTransport, backendId: string, runId: string): Promise<void> {
  const key = `${backendId}:${runId}`;
  const running = inFlight.get(key);
  if (running) {
    pendingAgain.add(key);
    return running;
  }
  const task = (async () => {
    try {
      do {
        pendingAgain.delete(key);
        await syncRunOnce(transport, backendId, runId);
      } while (pendingAgain.has(key));
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
}

/** Only the run row — for `runs:updated` (title landed, etc.). */
async function syncRunRow(transport: WsTransport, backendId: string, runId: string): Promise<void> {
  const run = await invoke<RunResponse | null>(transport, CHANNELS.runs.getById, [runId]);
  if (run) upsertRun(backendId, run);
  else deleteRunLocally(backendId, runId);
}

// ── Events ──

export interface RunEventOptions {
  /** The run whose transcript is on screen — the only one worth refetching per event burst. */
  isViewing(runId: string): boolean;
}

/**
 * Wire the backend's pushes to targeted refetches. Every push is broadcast to
 * all clients today (design doc P1: selective subscription later), so the
 * rule is: status flips refresh the run they name; transcript-progress pushes
 * refresh only the run being viewed, debounced.
 */
export function attachRunEvents(
  transport: WsTransport,
  backendId: string,
  options: RunEventOptions,
): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const swallow = (promise: Promise<unknown>) => {
    promise.catch(() => {
      // A refetch that fails will be retried by the next event or reconnect.
    });
  };

  const offStatus = transport.subscribe(CHANNELS.runs.statusChanged, (payload) => {
    const { runId, status } = payload as RunStatusChangedEvent;
    // A terminal status means the transcript settled: pull all of it, so a
    // finished run is ready before the user opens it.
    swallow(
      isTerminalRunStatus(status) || options.isViewing(runId)
        ? syncRun(transport, backendId, runId)
        : syncRunRow(transport, backendId, runId),
    );
  });

  // The Mac snapshots a workspace's diff as a run ends; refresh its size.
  const offDiff = transport.subscribe(CHANNELS.runs.diffUpdated, (payload) => {
    const { workspaceId } = payload as RunDiffUpdatedEvent;
    if (workspaceId) swallow(syncDiffSummary(transport, backendId, workspaceId));
  });

  const offGitState = transport.subscribe(CHANNELS.workspace.gitStateChanged, (payload) => {
    applyGitState(backendId, payload as WorkspaceGitState);
  });

  const offUpdated = transport.subscribe(CHANNELS.runs.updated, (payload) => {
    const { runId } = payload as RunUpdatedEvent;
    swallow(syncRunRow(transport, backendId, runId));
  });

  const offPersisted = transport.subscribe(CHANNELS.runs.eventPersisted, (payload) => {
    const { runId } = payload as RunEventPersistedEvent;
    if (!options.isViewing(runId)) return;
    const existing = timers.get(runId);
    if (existing) clearTimeout(existing);
    timers.set(
      runId,
      setTimeout(() => {
        timers.delete(runId);
        swallow(syncRun(transport, backendId, runId));
      }, EVENT_DEBOUNCE_MS),
    );
  });

  const offApprovalRequest = transport.subscribe(CHANNELS.runs.toolApprovalRequest, (payload) => {
    const request = payload as ToolApprovalRequest;
    upsertApproval(backendId, request, expiryFromRequest(request));
  });

  const offApprovalResolved = transport.subscribe(CHANNELS.runs.toolApprovalResolved, (payload) => {
    const { requestId } = payload as ToolApprovalResolvedEvent;
    db.delete(pendingApprovals)
      .where(and(eq(pendingApprovals.backendId, backendId), eq(pendingApprovals.requestId, requestId)))
      .run();
  });

  return () => {
    offStatus();
    offDiff();
    offGitState();
    offUpdated();
    offPersisted();
    offApprovalRequest();
    offApprovalResolved();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}

// ── Reads used outside live queries ──

export function runExists(backendId: string, runId: string): boolean {
  return (
    db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.backendId, backendId), eq(runs.id, runId)))
      .get() !== undefined
  );
}

/** Drop everything cached for a backend (forgetting a Mac). */
export function clearBackend(backendId: string): void {
  db.transaction(() => {
    db.delete(aiDataConsents).where(eq(aiDataConsents.backendId, backendId)).run();
    db.delete(spaceTargets).where(eq(spaceTargets.backendId, backendId)).run();
    db.delete(spaces).where(eq(spaces.backendId, backendId)).run();
    db.delete(collections).where(eq(collections.backendId, backendId)).run();
    db.delete(providers).where(eq(providers.backendId, backendId)).run();
    db.delete(projects).where(eq(projects.backendId, backendId)).run();
    db.delete(models).where(eq(models.backendId, backendId)).run();
    db.delete(skills).where(eq(skills.backendId, backendId)).run();
    db.delete(commands).where(eq(commands.backendId, backendId)).run();
    db.delete(modelChoices).where(eq(modelChoices.backendId, backendId)).run();
    db.delete(pendingApprovals).where(eq(pendingApprovals.backendId, backendId)).run();
    db.delete(runArtifacts).where(eq(runArtifacts.backendId, backendId)).run();
    db.delete(toolCalls).where(eq(toolCalls.backendId, backendId)).run();
    db.delete(runTurns).where(eq(runTurns.backendId, backendId)).run();
    db.delete(syncCursors).where(eq(syncCursors.backendId, backendId)).run();
    db.delete(runs).where(eq(runs.backendId, backendId)).run();
    db.delete(workspaces).where(eq(workspaces.backendId, backendId)).run();
    db.delete(backends).where(eq(backends.backendId, backendId)).run();
  });
}
