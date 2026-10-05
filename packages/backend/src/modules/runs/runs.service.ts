import { CHANNELS } from "@mains/contracts/channels";
import type { CreateRealtimeConversationPayload, CreateRealtimeConversationResponse, RunRealtimeStartPayload, RunRealtimeStopPayload, RunRealtimeEvent, VoiceTaskLink } from "@mains/contracts/realtime";
import { insertRunInputArtifact } from "./run-input-artifact";
import { createVoiceTaskCoordinator, VOICE_COORDINATOR_INSTRUCTIONS } from "./voice-task-coordinator";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getBackendRuntime } from "../../runtime/backend-runtime";

import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import { runsRepo } from "./runs.repo";
import { validateHistoryRequest } from "./run-history";
import type { ReadRunHistoryPayload } from "@mains/contracts/runs";
import { providersService } from "../providers";
import { collectionsService } from "../collections";
import { projectsService } from "../projects";
import { workspaceService, assertWorkspacePathExists } from "../workspace";
import { gitService } from "../git";
import { spaceService } from "../space";
import { appSettingsService } from "../appSettings";
import { DEFAULT_MODE_ID, type ModeId } from "@mains/contracts/modes";
import type {
  ArtifactImage,
  AttachmentFile,
  ReadArtifactImagePayload,
  ReadAttachmentImagePayload,
  ResolveAttachmentPathPayload,
  ReadRunTextFilePayload,
  RunOutputFile,
  RunTextFile,
  RunSteerPayload,
  RunSteerResponse,
  RunInputStatusPayload,
} from "@mains/contracts/runs";
import {
  composeConfigSnapshot,
  composeExtraInstructions,
  composeToolPolicy,
} from "../../../shared/mode-harness";
import {
  createWorkAdapter,
  emitUserPromptArtifact,
  type WorkRunContextItem,
  type WorkRunAdapter,
  type WorkRunEvent,
} from "../providers/adapters";
import type { WorkRunResult } from "../../../shared/adapter.types";
import { createRunSession, type RunSession, type RunSessionResult } from "./run-session";
import {
  managedRunDir,
  removeManagedRunDir,
  removeManagedRunImages,
  resolveRunExecution,
} from "./run-execution";
import {
  buildCollectionSourceInstructions,
  syncCollectionSourceDirectory,
} from "./run-collection-sources";
import { sanitizeRunAttachments } from "./run-attachments";
import { prepareRunAttachments, pruneUnreferencedAttachments, resolveRunAttachment } from "./run-attachment-storage";
import { readAttachmentImage } from "./run-attachment-images";
import { resolveConversationSettings, validateConversationSettings } from "./conversation-settings";
import { emit } from "../../ipc-kit";
import { runSessionRegistry } from "./run-session-registry";
import { withImageContentHashes } from "./run-image-content-hashes";
import type {
  CreateRunPayload,
  UpdateRunPayload,
  RunResponse,
  ArchivedRunResponse,
  ActiveRunResponse,
  RecentRunResponse,
  RunExperienceOptions,
  WorkspaceRunListOptions,
  CreateRunContextPayload,
  RunContextResponse,
  CreateRunArtifactPayload,
  RunArtifactResponse,
  CreateToolCallPayload,
  UpdateToolCallPayload,
  ToolCallResponse,
  RunStatus,
  StartRunPayload,
  StartRunResponse,
  StartRunContextItem,
  ContinueRunPayload,
  ContinueRunResponse,
  ForkRunPayload,
  ForkRunResponse,
  MoveRunToCollectionPayload,
  SetRunPinnedPayload,
  ReviewRunPayload,
  RunDetailsResponse,
  RunTurnResponse,
  RunTurnChangesSummary,
  RunTurnChangesDiffResponse,
} from "./runs.dto";

/** Longest side an image artifact is sent at — more than any phone shows. */
const ARTIFACT_IMAGE_MAX_SIDE = 1600;
/** Node hosts send original bytes; Codex image generation can return up to 32 MiB. */
const ARTIFACT_IMAGE_RAW_LIMIT = 32 * 1024 * 1024;
/** Keep one document response comfortably below the WebSocket message ceiling. */
const RUN_TEXT_FILE_MAX_BYTES = 2 * 1024 * 1024;
/** A basename fallback is bounded so one malformed run directory cannot stall the host. */
const RUN_TEXT_SEARCH_MAX_ENTRIES = 10_000;
const RUN_TEXT_SEARCH_MAX_DEPTH = 12;
const RUN_TEXT_SEARCH_EXCLUDES = new Set([".git", "node_modules"]);
/** A run folder is app-owned, but still bound traversal in case a tool explodes it. */
const RUN_OUTPUT_MAX_FILES = 500;
const RUN_OUTPUT_MAX_DEPTH = 12;
const MAX_ADDITIONAL_DIRECTORIES = 20;

/** Resolve grants on the host before they reach either provider runtime. */
function normalizeAdditionalDirectories(
  snapshot: Record<string, unknown> | null,
  providerId: string,
): Record<string, unknown> | null {
  if (!snapshot || !("additionalDirectories" in snapshot)) return snapshot;
  const input = snapshot.additionalDirectories;
  if (providerId !== PROVIDER_IDS.claude && providerId !== PROVIDER_IDS.codex) {
    // Older composers sent [] for every provider. No directories means no
    // grant; drop the unsupported field while preserving the other settings.
    if (Array.isArray(input) && input.length === 0) {
      const { additionalDirectories: _directories, ...remaining } = snapshot;
      return remaining;
    }
    throw new Error("Additional directories are supported by Claude and Codex only");
  }
  if (!Array.isArray(input) || input.length > MAX_ADDITIONAL_DIRECTORIES) {
    throw new Error(`Choose at most ${MAX_ADDITIONAL_DIRECTORIES} additional directories`);
  }
  const resolved = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string" || !path.isAbsolute(value)) {
      throw new Error("Additional directory paths must be absolute");
    }
    let realPath: string;
    try {
      realPath = fs.realpathSync(value);
      if (!fs.statSync(realPath).isDirectory()) {
        throw new Error("not a directory");
      }
    } catch {
      throw new Error(`Additional directory is unavailable: ${value}`);
    }
    resolved.add(realPath);
  }
  return { ...snapshot, additionalDirectories: [...resolved] };
}
const RUN_OUTPUT_EXCLUDES = new Set([
  ".mains",
  "project-resources",
  "collection-sources",
  ".git",
  "node_modules",
  "bower_components",
  ".DS_Store",
  "Thumbs.db",
]);

function withProjectResources(
  baseInstructions: string | null,
  projectInstructions: string | null,
): string | null {
  const parts = [baseInstructions, projectInstructions].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join("\n\n") : null;
}
/** Image types the phone decodes on its own, by extension — `nativeImage` reads only PNG and JPEG. */
const RAW_IMAGE_MIMES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/** Last model that actually handled a turn, falling back to the run's initial snapshot. */
function latestKnownModel(
  turns: RunTurnResponse[],
  initialModel: string | null,
): string | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const model = turns[i]?.model?.trim();
    if (model) return model;
  }
  return initialModel?.trim() || undefined;
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Visible files created in a managed Work/Chat directory. Legacy source copies
 * and the Collection source link are input context, not output. Symlinks are
 * deliberately not followed.
 */
async function listManagedOutputFiles(root: string): Promise<RunOutputFile[]> {
  const files: RunOutputFile[] = [];

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > RUN_OUTPUT_MAX_DEPTH || files.length >= RUN_OUTPUT_MAX_FILES) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );

    for (const entry of entries) {
      if (files.length >= RUN_OUTPUT_MAX_FILES) break;
      if (entry.name.startsWith(".") || RUN_OUTPUT_EXCLUDES.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, depth + 1);
        continue;
      }
      // `Dirent.isFile()` excludes symlinks, sockets, and device files.
      if (!entry.isFile()) continue;

      let stats: fs.Stats;
      try {
        stats = await fs.promises.stat(absolutePath);
      } catch {
        continue;
      }
      if (!stats.isFile()) continue;

      files.push({
        fileName: entry.name,
        relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
        absolutePath,
        size: stats.size,
        modifiedAt: Math.trunc(stats.mtimeMs),
      });
    }
  };

  await visit(root, 0);
  return files.sort(
    (a, b) =>
      b.modifiedAt - a.modifiedAt || a.relativePath.localeCompare(b.relativePath),
  );
}

/**
 * Where the browser inspector writes its screenshots — the one directory a run
 * attachment's `sourcePath` may point into (see run-attachments.ts).
 */
async function browserCaptureDir(): Promise<string> {
  return path.join(getBackendRuntime().getPath("userData"), "browser-captures");
}

/** Agent prose may append an editor line locator; it is not part of the path. */
function stripTextFileLocator(filePath: string): string {
  const hash = filePath.match(/^(.*?)#L\d+(?:-\d+)?$/);
  if (hash) return hash[1];
  const colon = filePath.match(/^(.*?):\d+(?::\d+)?$/);
  return colon ? colon[1] : filePath;
}

function decodeFileReference(filePath: string): string {
  try {
    return decodeURIComponent(filePath);
  } catch {
    return filePath;
  }
}

function isMarkdownPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".md" || extension === ".markdown";
}

function findMarkdownByBasename(root: string, reference: string): string | null {
  const wantedName = path.basename(reference);
  const wantedSuffix = reference.replace(/^\.\//, "").split(path.sep).join("/");
  const matches: string[] = [];
  let seen = 0;

  const visit = (directory: string, depth: number) => {
    if (depth > RUN_TEXT_SEARCH_MAX_DEPTH || seen >= RUN_TEXT_SEARCH_MAX_ENTRIES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (++seen > RUN_TEXT_SEARCH_MAX_ENTRIES) return;
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!RUN_TEXT_SEARCH_EXCLUDES.has(entry.name)) visit(candidate, depth + 1);
      } else if (entry.isFile() && entry.name === wantedName) {
        matches.push(candidate);
      }
    }
  };

  visit(root, 0);
  return (
    matches.find((candidate) =>
      path.relative(root, candidate).split(path.sep).join("/").endsWith(wantedSuffix),
    ) ??
    matches[0] ??
    null
  );
}

function readMarkdownWithinRoot(root: string, candidate: string): RunTextFile | null {
  const resolvedCandidate = path.resolve(candidate);
  if (!isWithin(root, resolvedCandidate)) return null;

  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync(resolvedCandidate);
  } catch {
    return null;
  }
  // Check again after following links. A symlink inside the run must not escape it.
  if (!isWithin(root, realCandidate)) return null;

  const stats = fs.lstatSync(realCandidate);
  if (!stats.isFile()) throw new Error("Cannot read non-regular file");
  if (stats.size > RUN_TEXT_FILE_MAX_BYTES) throw new Error("Markdown file is too large");

  const bytes = fs.readFileSync(realCandidate);
  if (bytes.subarray(0, 8192).includes(0)) throw new Error("This file isn't text");
  return {
    fileName: path.basename(realCandidate),
    relativePath: path.relative(root, realCandidate).split(path.sep).join("/"),
    content: bytes.toString("utf8"),
  };
}
// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function generateRunId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").substring(0, 16);
}

/**
 * Best-effort space lookup for harness composition: a missing space must not
 * block a run, so failures resolve to null (default-mode harness, no custom
 * system prompt).
 */
async function findSpaceForRun(spaceId: string | null | undefined) {
  if (!spaceId) return null;
  try {
    return await spaceService.getById(spaceId);
  } catch (err) {
    console.error("[RunsService] Space lookup failed for harness:", err);
    return null;
  }
}

/**
 * Resolve the experience mode for a new run: the payload's space if given,
 * otherwise the active space. Snapshotted onto the run row so resume/fork
 * keep behaving under the mode the run started with. The caller validates
 * that the resolved Space exists and owns the selected account/provider.
 */
async function resolveRunMode(spaceId: string | undefined): Promise<{
  spaceId: string | undefined;
  mode: ModeId;
  space: Awaited<ReturnType<typeof spaceService.getById>> | null;
}> {
  try {
    let resolvedSpaceId = spaceId;
    if (!resolvedSpaceId) {
      const settings = await appSettingsService.getSettings();
      resolvedSpaceId = settings.activeSpaceId ?? undefined;
    }
    const space = await findSpaceForRun(resolvedSpaceId);
    return {
      spaceId: resolvedSpaceId,
      mode: space?.mode ?? DEFAULT_MODE_ID,
      space,
    };
  } catch (err) {
    console.error("[RunsService] Mode resolution failed, using default:", err);
    return { spaceId, mode: DEFAULT_MODE_ID, space: null };
  }
}

async function validateCollectionForRun(
  collectionId: string | null | undefined,
  accountId: string,
  mode: ModeId,
): Promise<string | undefined> {
  if (!collectionId) return undefined;
  if (mode === "developer") {
    throw new Error("Developer runs cannot belong to a collection");
  }
  const collection = await collectionsService.get({ id: collectionId, accountId });
  if (!collection) throw new Error("Collection not found");
  if (collection.accountId !== accountId) {
    throw new Error("Collection does not belong to this account");
  }
  if (collection.isArchived) {
    throw new Error("Archived collections cannot accept runs");
  }
  return collection.id;
}

function fallbackTitle(goal: string): string {
  const firstLine = goal.split("\n")[0].trim();
  if (firstLine.length <= 60) return firstLine;
  const truncated = firstLine.substring(0, 60);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 20 ? truncated.substring(0, lastSpace) : truncated) + "...";
}

async function generateRunTitle(
  runId: string,
  adapter: WorkRunAdapter,
  goal: string,
  context?: StartRunContextItem[],
): Promise<void> {
  let title: string;
  try {
    if (adapter.generateTitle) {
      title = await adapter.generateTitle(goal, context as WorkRunContextItem[]);
    } else {
      title = fallbackTitle(goal);
    }
  } catch (err) {
    console.warn(`[RunsService] Title generation failed for ${runId}, using fallback:`, err);
    title = fallbackTitle(goal);
  }
  await runsRepo.updateRun(runId, { title });
  // Titles land seconds after the run starts; the chat sidebar refreshes on
  // this instead of polling.
  emit("runs:updated", { runId, ts: Date.now() });
}

/** Broadcast statusChanged for runs that fail before a session is created. */
function broadcastStatusChangedPreSession(runId: string, status: string): void {
  emit("runs:statusChanged", { runId, status, ts: Date.now() });
}

/** Wire an adapter run promise to session.finalize. Idempotent on both sides. */
function wireSessionCompletion(
  runPromise: Promise<WorkRunResult>,
  session: RunSession,
): void {
  runPromise
    .then((result) => {
      const status: RunSessionResult["status"] =
        result.status === "succeeded"
          ? "succeeded"
          : result.status === "canceled"
            ? "canceled"
            : "failed";
      return session.finalize({
        status,
        summary: result.status === "failed" ? result.summary : undefined,
        stopReason: result.stopReason,
        usage: result.usage,
      });
    })
    .catch((err) =>
      session.finalize({
        status: "failed",
        summary: err instanceof Error ? err.message : String(err),
      }),
    );
}

/**
 * Pre-session failure recovery — the orchestrator threw before adapter wiring.
 * If a session somehow registered, finalize it; else write status directly.
 */
async function handlePreSessionFailure(runId: string, error: unknown): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`[RunsService] Pre-session failure for ${runId}:`, errorMessage);
  const session = runSessionRegistry.get(runId);
  if (session) {
    await session.finalize({ status: "failed", summary: errorMessage });
    return;
  }
  try {
    await runsRepo.updateRun(runId, {
      status: "failed",
      endedAt: new Date(),
      lastError: errorMessage,
    });
  } catch {
    // Run row may not exist yet — ignore
  }
  broadcastStatusChangedPreSession(runId, "failed");
}

type RunSessionLifecycleAction = "archive" | "unarchive" | "delete";

/**
 * Keep Mains' archived-run state aligned with Codex's persisted thread store.
 *
 * **Best effort by design.** Mains owns its own archive/unarchive/delete state;
 * the Codex thread store is a second copy the user can mutate independently
 * (from the Codex CLI, or by deleting the rollout). Archiving a run in Mains
 * that was already archived on the Codex side answers
 * `no rollout found for thread id … (-32600)` — the two stores agreeing, not a
 * reason to refuse the local mutation. Every failure here is therefore logged
 * and swallowed, so the Codex layer can never block the operation the user
 * actually asked for.
 */
async function syncCodexRunSession(
  run: RunResponse,
  action: RunSessionLifecycleAction,
): Promise<void> {
  if (run.providerId !== PROVIDER_IDS.codex || !run.sessionId) return;

  try {
    const provider = await providersService.getById(run.providerId);
    if (!provider) return;

    const adapter = createWorkAdapter(provider);
    const lifecycleMethod =
      action === "archive"
        ? adapter.archiveSession
        : action === "unarchive"
          ? adapter.unarchiveSession
          : adapter.deleteSession;

    if (!lifecycleMethod) return;
    await lifecycleMethod.call(adapter, run.id);
  } catch (err) {
    console.warn(
      `[RunsService] Codex thread ${action} failed for run ${run.id}; ` +
        `continuing with the local ${action}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Runs Service
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// Single-item reads return null for absence; mutations on a missing
// target throw (see CONTEXT.md "absence rule").
// ─────────────────────────────────────────────────────────────
// Claims cover async continuation preparation, before a live session exists.
const continuingRuns = new Set<string>();
const realtimeConnections = new Map<string, {
  connectionId: string;
  cancelRequested: boolean;
  prepared: Promise<void>;
  dispose?: () => void;
}>();

export const runsService = {
  async createRealtimeConversation(payload: CreateRealtimeConversationPayload): Promise<CreateRealtimeConversationResponse> {
    const { spaceId, mode, space } = await resolveRunMode(payload.spaceId);
    if (!spaceId || !space) throw new Error("A valid space is required to start voice chat");
    if (space.accountId !== payload.accountId) throw new Error("Space does not belong to this account");
    if (space.providerId !== PROVIDER_IDS.codex) throw new Error("Voice chat is currently available for Codex.");
    const provider = await providersService.getById(space.providerId);
    if (!provider?.isEnabled || provider.kind !== "agent_runtime") throw new Error("Codex is not enabled");
    let workspace: Awaited<ReturnType<typeof workspaceService.get>> = null;
    if (mode === "developer") {
      if (!payload.workspaceId) throw new Error("Select a workspace before starting voice chat.");
      workspace = await workspaceService.get(payload.workspaceId);
      if (!workspace) throw new Error("Workspace not found");
      if (workspace.accountId !== payload.accountId) throw new Error("Workspace does not belong to this account");
      assertWorkspacePathExists(workspace.rootPath, workspace.name);
    } else if (payload.workspaceId) {
      throw new Error("Work and Chat runs do not use a workspace");
    }
    const collectionId = await validateCollectionForRun(payload.collectionId, payload.accountId, mode);
    const settings = resolveConversationSettings(space.providerId, provider.config,
      composeConfigSnapshot(mode, space.providerId, null), undefined, payload.conversationSettings);
    const configSnapshot = normalizeAdditionalDirectories(composeConfigSnapshot(mode, space.providerId, {
      ...settings.config, conversationSettings: settings,
      ...(payload.additionalDirectories !== undefined ? { additionalDirectories: payload.additionalDirectories } : {}),
    }), space.providerId);
    const runId = generateRunId();
    // No work has started: the existing terminal status represents an idle
    // conversation. Its first prompt, turn and timestamps come from real input.
    await runsRepo.insertRun({
      id: runId, accountId: payload.accountId, workspaceId: workspace?.id, collectionId,
      spaceId, providerId: space.providerId, mode, model: settings.model || undefined,
      status: "succeeded", configSnapshot: configSnapshot ?? undefined,
      toolPolicySnapshot: composeToolPolicy(mode, null) ?? undefined,
    });
    emit(CHANNELS.runs.updated, { runId, ts: Date.now() });
    return { runId };
  },

  async startRealtime(payload: RunRealtimeStartPayload): Promise<void> {
    if (typeof payload?.connectionId !== "string" || !/^[\w-]{1,80}$/.test(payload.connectionId) ||
        typeof payload.sdp !== "string" || payload.sdp.length > 262_144 || !payload.sdp.startsWith("v=0")) {
      throw new Error("Invalid voice connection request.");
    }
    const run = await runsRepo.findRunById(payload.runId);
    if (!run) throw new Error("Run not found");
    if (run.accountId !== payload.accountId) throw new Error("Run does not belong to this account");
    if (run.isArchived) throw new Error("Unarchive this conversation before starting voice chat.");
    if (run.providerId !== PROVIDER_IDS.codex) throw new Error("Voice chat is currently available for Codex.");
    if (continuingRuns.has(run.id)) throw new Error("Wait for this response to start before opening voice chat.");
    if (realtimeConnections.has(run.id)) throw new Error("Voice chat is already active for this conversation.");
    let prepared!: () => void;
    const connection: NonNullable<ReturnType<typeof realtimeConnections.get>> = { connectionId: payload.connectionId, cancelRequested: false,
      prepared: new Promise<void>((resolve) => { prepared = resolve; }) };
    realtimeConnections.set(run.id, connection);
    let coordinator: ReturnType<typeof createVoiceTaskCoordinator> | undefined;
    try {
      const provider = await providersService.getById(run.providerId);
      if (!provider?.isEnabled) throw new Error("Codex is not enabled");
      const adapter = createWorkAdapter(provider);
      if (!adapter.startRealtime) throw new Error("This provider does not support voice chat.");
      const workspace = run.workspaceId ? await workspaceService.get(run.workspaceId) : null;
      if (run.workspaceId && !workspace) throw new Error("Run workspace no longer exists");
      if (workspace) assertWorkspacePathExists(workspace.rootPath, workspace.name);
      const execution = resolveRunExecution({ runId: run.id, mode: run.mode, workspace });
      const turns = await runsRepo.findTurnsByRun(run.id);
      // An already-running thread keeps the permissions/model it started with.
      const settings = resolveConversationSettings(run.providerId, provider.config, run.configSnapshot,
        latestKnownModel(turns, run.model), runSessionRegistry.get(run.id) ? undefined : payload.conversationSettings);
      const configSnapshot = normalizeAdditionalDirectories(composeConfigSnapshot(run.mode, run.providerId, {
        ...(run.configSnapshot ?? {}), ...settings.config, conversationSettings: settings,
      }), run.providerId);
      const toolPolicy = composeToolPolicy(run.mode, run.toolPolicySnapshot);
      const space = await findSpaceForRun(run.spaceId);
      const projectInstructions = await buildCollectionSourceInstructions({
        runId: run.id, accountId: run.accountId, collectionId: run.collectionId,
        cwd: execution.workspaceId ? null : execution.cwd,
      });
      const linkedArtifacts = await runsRepo.findArtifactsByRun(run.id);
      const links = linkedArtifacts.flatMap((artifact) => {
        const link = artifact.metadata?.voiceTask as VoiceTaskLink | undefined;
        return artifact.metadata?.kind === "voice-task" && link && typeof link.id === "string" &&
          typeof link.taskKey === "string" && typeof link.title === "string" ? [link] : [];
      });
      coordinator = createVoiceTaskCoordinator({
        parentRunId: run.id, accountId: run.accountId, links,
        isActive: () => realtimeConnections.get(run.id) === connection && !connection.cancelRequested,
        async create(args) {
          const target = await resolveRunMode(run.spaceId ?? undefined);
          if (!target.space || target.space.accountId !== run.accountId ||
              target.space.providerId !== run.providerId || target.mode !== run.mode) {
            throw new Error("The voice conversation's space settings changed. Reopen voice in the intended space before delegating work.");
          }
          const { runId } = await runsService.executeRun({
            accountId: run.accountId, providerId: run.providerId,
            spaceId: target.spaceId ?? undefined, workspaceId: run.workspaceId ?? undefined,
            collectionId: run.collectionId ?? undefined, goal: args.prompt,
            model: settings.model || undefined, conversationSettings: settings,
            systemPrompt: run.systemPrompt ?? undefined, configSnapshot: configSnapshot ?? undefined,
            toolPolicySnapshot: toolPolicy ?? undefined,
            initialContext: [{ kind: "note", content: `This task was delegated from a Mains voice conversation. Follow the user's task and constraints; write progress and the final report in this working chat. The voice conversation can send follow-up instructions.`,
              metadata: { voiceDelegation: { parentRunId: run.id, title: run.title || "Voice conversation", taskKey: args.taskKey } } }],
          });
          await runsService.updateRun(runId, { title: args.title });
          return { id: runId, taskKey: args.taskKey, title: args.title, spaceId: target.spaceId ?? null,
            providerId: run.providerId, mode: run.mode, workspaceId: run.workspaceId, collectionId: run.collectionId };
        },
        async persist(link) {
          await insertRunInputArtifact(run.id, { type: "artifact", kind: "report", content: link.title,
            metadata: { kind: "voice-task", source: "voice-coordinator", voiceTask: link } });
          emit(CHANNELS.runs.eventPersisted, { runId: run.id, ts: Date.now() });
          emit(CHANNELS.runs.updated, { runId: link.id, ts: Date.now() });
        },
        getRun: (id) => runsService.getRunById(id), getTurns: (id) => runsService.getTurnsByRun(id),
        getArtifacts: (id) => runsService.getArtifactsByRun(id), getTools: (id) => runsService.getToolCallsByRun(id),
        async inputAccepted(runId, clientUserMessageId) {
          return (await runsService.getInputStatus({ runId, accountId: run.accountId, clientUserMessageId })).accepted;
        },
        async send(runId, message, clientUserMessageId, running) {
          const additionalContext: StartRunContextItem[] = [{ kind: "note", metadata: {
            voiceDelegation: { parentRunId: run.id, title: run.title || "Voice conversation" },
          } }];
          if (running) await runsService.steerRun({ runId, accountId: run.accountId, message, clientUserMessageId, additionalContext });
          else await runsService.continueRun({ runId, accountId: run.accountId, message, clientUserMessageId, additionalContext });
        },
        async cancel(id) { await runsService.cancelRun(id); },
        async end() {
          emit(CHANNELS.runs.realtimeEvent, { runId: run.id, connectionId: payload.connectionId, type: "ending" } satisfies RunRealtimeEvent);
          await runsService.stopRealtime({ runId: run.id, accountId: run.accountId, connectionId: payload.connectionId });
        },
        notify(content, announce) {
          if (realtimeConnections.get(run.id) !== connection || connection.cancelRequested) return;
          emit(CHANNELS.runs.realtimeEvent, { runId: run.id, connectionId: payload.connectionId,
            type: "context", eventId: generateRunId(), content, announce } satisfies RunRealtimeEvent);
        },
      });
      connection.dispose = coordinator.dispose;
      let session: RunSession | undefined;
      let nativeTurnId: string | undefined;
      let latestUserItemId: string | undefined;
      const transcriptContext = new Map<string, { steering: boolean; providerTurnId?: string }>();
      const completedItems = new Set<string>();
      const itemTimestamps = new Map<string, number>();
      let persistence = Promise.resolve();
      const onRealtimeEvent = (event: RunRealtimeEvent) => {
        emit(CHANNELS.runs.realtimeEvent, event);
        if (event.type === "closed" && realtimeConnections.get(run.id) === connection) {
          coordinator?.dispose();
          realtimeConnections.delete(run.id);
        }
        if (event.type === "started") coordinator?.activate();
        if (event.type !== "transcript" || completedItems.has(event.itemId)) return;
        if (!transcriptContext.has(event.itemId)) {
          transcriptContext.set(event.itemId, {
            steering: event.role === "user" && !!runSessionRegistry.get(run.id), providerTurnId: nativeTurnId,
          });
          if (transcriptContext.size > 256) transcriptContext.delete(transcriptContext.keys().next().value!);
        }
        if (event.role === "user") latestUserItemId = event.itemId;
        // Capture delivery at speech start, not at transcript completion: the
        // initiating speech can finish transcription after its work has begun.
        const context = transcriptContext.get(event.itemId);
        const providerTurnId = context?.providerTurnId;
        const streamId = `voice-${payload.connectionId}-${event.itemId}`;
        const voiceStartedAt = itemTimestamps.get(event.itemId) ?? Date.now();
        itemTimestamps.set(event.itemId, voiceStartedAt);
        if (itemTimestamps.size > 256) itemTimestamps.delete(itemTimestamps.keys().next().value!);
        const kind = event.role === "user" ? "user-prompt" : "report";
        const metadata = {
          source: event.role === "user" ? "user" : "agent_message", voice: true,
          clientUserMessageId: streamId, streamId, voiceStartedAt, itemId: event.itemId,
          realtimeSessionId: payload.connectionId,
          ...(providerTurnId ? { providerTurnId } : {}),
          ...(context?.steering ? { delivery: "steer" } : {}),
        };
        // Speech has its own lifetime, including while the work turn is idle.
        // Reuse chat snapshots; only final text takes the existing DB path.
        emit(CHANNELS.runs.ephemeralEvent, { runId: run.id, ts: voiceStartedAt,
          event: { type: "artifact", kind, content: event.text, streamId,
            metadata: { ...metadata, streaming: !event.final } },
        });
        if (!event.final) return;
        completedItems.add(event.itemId);
        if (completedItems.size > 256) {
          const oldest = completedItems.values().next().value!;
          completedItems.delete(oldest);
          transcriptContext.delete(oldest);
          itemTimestamps.delete(oldest);
        }
        if (!event.text.trim()) return;
        persistence = persistence.then(async () => {
          await insertRunInputArtifact(run.id, {
            type: "artifact", kind, content: event.text, metadata,
          });
          if (event.role === "user" && !run.goal?.trim()) {
            const current = await runsRepo.findRunById(run.id);
            if (current && !current.goal?.trim()) {
              await runsRepo.updateRun(run.id, { goal: event.text.trim() });
              emit(CHANNELS.runs.updated, { runId: run.id, ts: Date.now() });
            }
          }
          emit(CHANNELS.runs.eventPersisted, { runId: run.id, ts: Date.now() });
        }).catch((error) => console.error("[RunsService] Voice transcript persistence failed:", error));
      };
      // Stop can arrive before the driver owns a native session. Keep the
      // claim through preparation and cancel before issuing the native start.
      if (connection.cancelRequested) {
        onRealtimeEvent({ runId: run.id, connectionId: payload.connectionId, type: "closed", reason: "ended" });
        return;
      }
      await adapter.startRealtime({
        runId: run.id, accountId: run.accountId, execution, connectionId: payload.connectionId, sdp: payload.sdp,
        model: settings.model || undefined, mode: run.mode, systemPrompt: run.systemPrompt,
        configSnapshot, toolPolicy,
        voiceTools: coordinator.tools,
        voiceInstructions: `${VOICE_COORDINATOR_INSTRUCTIONS}\nPreviously linked working chats (use ListVoiceTasks for all): ${JSON.stringify(links.slice(-16).map(({ id, taskKey, title }) => ({ runId: id, taskKey, title })))}`,
        extraInstructions: withProjectResources(composeExtraInstructions(run.mode, space?.systemPrompt), projectInstructions),
      }, onRealtimeEvent, {
        async onTurnStarted(providerTurnId, message, model) {
          await runSessionRegistry.whenIdle(run.id);
          const fresh = await runsRepo.findRunById(run.id);
          if (!fresh || fresh.isArchived) throw new Error("This conversation is no longer available.");
          const existingTurns = await runsRepo.findTurnsByRun(run.id);
          nativeTurnId = providerTurnId;
          const context = latestUserItemId ? transcriptContext.get(latestUserItemId) : undefined;
          if (context && !context.providerTurnId) context.providerTurnId = providerTurnId;
          await runsRepo.updateRun(run.id, {
            status: "running", startedAt: new Date(), endedAt: null, lastError: null,
            configSnapshot: configSnapshot ?? undefined, toolPolicySnapshot: toolPolicy ?? undefined,
          }, { preserveConversationSettings: true });
          if (workspace) await workspaceService.update(workspace.id, { status: "in_progress" });
          session = createRunSession({
            runId: run.id, accountId: run.accountId, providerId: run.providerId, execution,
            initialPromptContent: message || "Voice request",
            initialModel: model, initialProviderTurnId: providerTurnId,
            initialTurnMetadata: { inputSource: "voice", realtimeSessionId: payload.connectionId },
            seedTurnIndex: existingTurns.reduce((max, turn) => Math.max(max, turn.turnIndex), -1),
          });
        },
        async onEvent(event) {
          // Stamp work at its source; closing or changing calls cannot change
          // the presentation of already-delegated messages, tools or logs.
          const projected = event.type === "artifact" || event.type === "tool_call" || event.type === "log"
            ? { ...event, metadata: { ...event.metadata, inputSource: "voice", realtimeSessionId: payload.connectionId,
              ...(nativeTurnId ? { providerTurnId: nativeTurnId } : {}) } }
            : event;
          await session?.project(projected);
        },
        async onCompleted(result) {
          if (session) await session.finalize(result);
          else if (result.status === "failed") await handlePreSessionFailure(run.id, new Error(result.summary || "Voice task failed."));
          session = undefined;
          nativeTurnId = undefined;
        },
      });
    } catch (error) {
      coordinator?.dispose();
      if (realtimeConnections.get(run.id) === connection) realtimeConnections.delete(run.id);
      throw error;
    } finally { prepared(); }
  },

  async stopRealtime(payload: RunRealtimeStopPayload): Promise<void> {
    const run = await runsRepo.findRunById(payload.runId);
    if (!run) throw new Error("Run not found");
    if (run.accountId !== payload.accountId) throw new Error("Run does not belong to this account");
    const connection = realtimeConnections.get(run.id);
    if (!connection || connection.connectionId !== payload.connectionId) return;
    connection.cancelRequested = true;
    connection.dispose?.();
    await connection.prepared;
    if (realtimeConnections.get(run.id) !== connection) return;
    const provider = await providersService.getById(run.providerId);
    if (!provider) throw new Error("Codex is unavailable. Voice chat closure could not be confirmed.");
    const adapter = createWorkAdapter(provider);
    if (!adapter.stopRealtime) throw new Error("Voice chat closure is unavailable for this provider.");
    await adapter.stopRealtime(run.id, payload.connectionId);
  },
  // ─── Run Operations ───
  async getAllRuns(limit?: number): Promise<RunResponse[]> {
    return runsRepo.findAllRuns(limit);
  },

  async listArchivedRuns(): Promise<ArchivedRunResponse[]> {
    const archived = await runsRepo.findArchivedRuns();
    if (archived.length === 0) return [];

    const workspaceIds = [
      ...new Set(
        archived
          .map((run) => run.workspaceId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const workspaceEntries = await Promise.all(
      workspaceIds.map(async (id) => [id, await workspaceService.get(id)] as const),
    );
    const workspaceById = new Map(workspaceEntries);

    // A workspace wears its project's icon, the same one the sidebar prints.
    const projectIds = [
      ...new Set(
        [...workspaceById.values()]
          .filter((workspace) => workspace !== null)
          .map((workspace) => workspace.projectId),
      ),
    ];
    const projectEntries = await Promise.all(
      projectIds.map(
        async (id) =>
          [id, (await projectsService.get(id))?.icon ?? null] as const,
      ),
    );
    const projectIconById = new Map(projectEntries);

    // Chats have no workspace — their collection names the group instead. One
    // list per account covers every run, archived collections included, so a
    // chat filed under a hidden project still finds its name.
    const accountIds = [
      ...new Set(
        archived.filter((run) => run.collectionId).map((run) => run.accountId),
      ),
    ];
    const collectionLists = await Promise.all(
      accountIds.map((accountId) =>
        collectionsService.list({ accountId, includeArchived: true }),
      ),
    );
    const collectionById = new Map(
      collectionLists.flat().map((collection) => [collection.id, collection]),
    );

    return archived.map((run) => {
      const workspace = run.workspaceId
        ? workspaceById.get(run.workspaceId)
        : null;
      const collection = run.collectionId
        ? collectionById.get(run.collectionId)
        : null;
      return {
        ...run,
        workspace: workspace
          ? {
              id: workspace.id,
              name: workspace.name,
              isArchived: workspace.isArchived,
              icon: projectIconById.get(workspace.projectId) ?? null,
            }
          : null,
        collection: collection
          ? {
              id: collection.id,
              name: collection.name,
              icon: collection.icon,
            }
          : null,
      };
    });
  },

  /**
   * The runs that are still working, whichever space or workspace they belong
   * to — what the sidebar's background-runs dock lists.
   *
   * The DB row says a run is `running`; the session registry says it *still* is.
   * A crash (or a kill -9 that skips the before-quit finalize) leaves rows that
   * satisfy the first and not the second, and a card for one of those would
   * offer the user a session that no longer exists. Queued runs have no session
   * yet by definition, so they pass on the row alone.
   */
  async listActiveRuns(): Promise<ActiveRunResponse[]> {
    const pending = await runsRepo.findPendingRuns();
    const live = pending.filter(
      (run) => run.status === "queued" || runSessionRegistry.get(run.id) !== undefined,
    );
    if (live.length === 0) return [];

    const workspaceIds = [
      ...new Set(
        live
          .map((run) => run.workspaceId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const workspaceEntries = await Promise.all(
      workspaceIds.map(async (id) => [id, await workspaceService.get(id)] as const),
    );
    const workspaceById = new Map(workspaceEntries);

    return live.map((run) => {
      const workspace = run.workspaceId
        ? workspaceById.get(run.workspaceId)
        : null;
      return {
        ...run,
        workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
      };
    });
  },

  /** Newest-touched runs in one account/provider/mode experience. */
  async listRecentRuns(
    options: RunExperienceOptions,
  ): Promise<RecentRunResponse[]> {
    return runsRepo.findRecentRunsByExperience(options);
  },

  async getRunById(id: string): Promise<RunResponse | null> {
    return runsRepo.findRunById(id);
  },

  /**
   * Where this run's files live — its workspace root, or the managed directory
   * a workspace-less run executes in. The renderer needs it to resolve the bare
   * filenames agents write into their answers ("report.md"), which have no
   * meaning without a base. Null when the run is gone, or when a developer run
   * somehow has no workspace.
   */
  async getRunExecutionRoot(runId: string): Promise<string | null> {
    const run = await runsRepo.findRunById(runId);
    if (!run) return null;
    if (run.workspaceId) {
      const workspace = await workspaceService.get(run.workspaceId);
      return workspace?.rootPath ?? null;
    }
    if (run.mode === "developer") return null;
    return managedRunDir(run.id, run.mode);
  },

  /**
   * Files the agent left in a Work/Chat run's managed directory. Developer
   * runs use workspace changes instead; scanning their whole repository would
   * mislabel pre-existing files as deliverables.
   */
  async listRunOutputFiles(runId: string): Promise<RunOutputFile[]> {
    const run = await runsRepo.findRunById(runId);
    if (!run || run.mode === "developer" || run.workspaceId) return [];
    return listManagedOutputFiles(managedRunDir(run.id, run.mode));
  },

  /**
   * Resolve one Markdown file named in agent prose. Paired devices get this
   * narrow read instead of fileExplorer access: only Work/Chat, only the
   * selected run's managed directory, and only bounded text files.
   */
  async readTextFile(payload: ReadRunTextFilePayload): Promise<RunTextFile> {
    const runId = payload.runId?.trim();
    const rawReference = payload.filePath?.trim();
    if (!runId) throw new Error("Run id is required");
    if (!rawReference) throw new Error("File path is required");
    if (rawReference.length > 4096 || rawReference.includes("\0")) {
      throw new Error("Invalid file path");
    }

    const run = await runsRepo.findRunById(runId);
    if (!run) throw new Error("Run not found");
    if (run.mode === "developer") {
      throw new Error("Markdown preview is only available for Work and Chat runs");
    }

    const reference = stripTextFileLocator(decodeFileReference(rawReference));
    if (!isMarkdownPath(reference)) throw new Error("Only Markdown files can be previewed");

    const runRoot = managedRunDir(run.id, run.mode);
    let realRoot: string;
    try {
      realRoot = fs.realpathSync(runRoot);
    } catch {
      throw new Error("Run files are no longer available");
    }

    const direct = path.isAbsolute(reference)
      ? path.resolve(reference)
      : path.resolve(realRoot, reference.replace(/^\.\//, ""));
    const directlyRead = readMarkdownWithinRoot(realRoot, direct);
    if (directlyRead) return directlyRead;

    // Agent-written references can be bare names or carry a stale directory
    // prefix. Mirror the desktop's user-facing fallback inside this run only.
    const located = findMarkdownByBasename(realRoot, reference);
    const fallback = located ? readMarkdownWithinRoot(realRoot, located) : null;
    if (fallback) return fallback;
    throw new Error(`File not found: ${path.basename(reference)}`);
  },

  async getRunsByAccount(
    accountId: string,
    limit?: number,
  ): Promise<RunResponse[]> {
    return runsRepo.findRunsByAccount(accountId, limit);
  },

  async getRunsByWorkspace(
    workspaceId: string,
    options?: WorkspaceRunListOptions,
  ): Promise<RunResponse[]> {
    return runsRepo.findRunsByWorkspace(workspaceId, options);
  },

  async getRunsByStatus(
    accountId: string,
    status: RunStatus,
  ): Promise<RunResponse[]> {
    return runsRepo.findRunsByStatus(accountId, status);
  },

  async createRun(payload: CreateRunPayload): Promise<string> {
    return runsRepo.insertRun(payload);
  },

  async updateRun(id: string, payload: UpdateRunPayload): Promise<RunResponse> {
    const patch = { ...payload };
    if (payload.conversationSettings !== undefined) {
      const run = await runsRepo.findRunById(id);
      if (!run) throw new Error("Run not found");
      patch.conversationSettings = validateConversationSettings(run.providerId, payload.conversationSettings);
    }
    const updated = await runsRepo.updateRun(id, patch);
    if (!updated) throw new Error("Run not found");
    return updated;
  },

  async moveRunToCollection(
    payload: MoveRunToCollectionPayload,
  ): Promise<RunResponse> {
    const run = await runsRepo.findRunById(payload.runId);
    if (!run) throw new Error("Run not found");
    if (run.accountId !== payload.accountId) {
      throw new Error("Run does not belong to this account");
    }
    if (run.mode === "developer") {
      throw new Error("Developer runs cannot belong to a collection");
    }
    const collectionId = await validateCollectionForRun(
      payload.collectionId,
      run.accountId,
      run.mode,
    );
    const updated = await runsRepo.moveToCollection(
      run.id,
      collectionId ?? null,
    );
    if (!updated) throw new Error("Run not found");
    if (!run.workspaceId) {
      await syncCollectionSourceDirectory({
        cwd: managedRunDir(run.id, run.mode),
        accountId: run.accountId,
        collectionId,
      });
    }
    emit("runs:updated", { runId: run.id, ts: Date.now() });
    return updated;
  },

  /**
   * Pinning is a chat-sidebar affordance, so it carries the same account and
   * mode guards as filing a chat under a collection — a developer run lives in
   * the workspace list, which has no pinned group to be hoisted into.
   */
  async setRunPinned(payload: SetRunPinnedPayload): Promise<RunResponse> {
    const run = await runsRepo.findRunById(payload.runId);
    if (!run) throw new Error("Run not found");
    if (run.accountId !== payload.accountId) {
      throw new Error("Run does not belong to this account");
    }
    if (run.mode === "developer") {
      throw new Error("Developer runs cannot be pinned");
    }
    const updated = await runsRepo.setPinned(
      run.id,
      payload.pinned ? new Date() : null,
    );
    if (!updated) throw new Error("Run not found");
    emit("runs:updated", { runId: run.id, ts: Date.now() });
    return updated;
  },

  async startRun(id: string): Promise<RunResponse> {
    return this.updateRun(id, { status: "running", startedAt: new Date() });
  },

  async completeRun(id: string): Promise<RunResponse> {
    return this.updateRun(id, { status: "succeeded", endedAt: new Date() });
  },

  async failRun(id: string, error: string): Promise<RunResponse> {
    return this.updateRun(id, {
      status: "failed",
      endedAt: new Date(),
      lastError: error,
    });
  },

  async cancelRun(id: string): Promise<RunResponse> {
    return this.updateRun(id, { status: "canceled", endedAt: new Date() });
  },

  async deleteRun(id: string): Promise<void> {
    const run = await runsRepo.findRunById(id);
    if (!run) throw new Error("Run not found");
    await syncCodexRunSession(run, "delete");
    removeManagedRunDir(run.id, run.mode);
    await runsRepo.deleteRun(id);
    removeManagedRunImages(id);
    await pruneUnreferencedAttachments();
  },

  /** Delete every run of a workspace (project removal cleanup). */
  async deleteRunsByWorkspace(workspaceId: string): Promise<void> {
    const runIds = await runsRepo.findRunIdsByWorkspaceId(workspaceId);
    await runsRepo.deleteRunsByWorkspaceId(workspaceId);
    for (const runId of runIds) removeManagedRunImages(runId);
    await pruneUnreferencedAttachments();
  },

  async archiveRun(id: string): Promise<RunResponse> {
    const run = await runsRepo.findRunById(id);
    if (!run) throw new Error("Run not found");
    await syncCodexRunSession(run, "archive");
    const archived = await runsRepo.archiveRun(id);
    if (!archived) throw new Error("Run not found");
    return archived;
  },

  async unarchiveRun(id: string): Promise<RunResponse> {
    const run = await runsRepo.findRunById(id);
    if (!run) throw new Error("Run not found");
    if (run.workspaceId) {
      const workspace = await workspaceService.get(run.workspaceId);
      if (!workspace) {
        throw new Error("Cannot restore a run whose workspace was deleted");
      }
      if (workspace.isArchived) {
        throw new Error("Unarchive the workspace before restoring this run");
      }
    } else if (run.mode === "developer") {
      throw new Error("Cannot restore a developer run without a workspace");
    }
    if (run.collectionId) {
      const collection = await collectionsService.get({
        id: run.collectionId,
        accountId: run.accountId,
      });
      if (!collection || collection.isArchived) {
        await runsRepo.moveToCollection(run.id, null);
      }
    }
    await syncCodexRunSession(run, "unarchive");
    const unarchived = await runsRepo.unarchiveRun(id);
    if (!unarchived) throw new Error("Run not found");
    return unarchived;
  },

  // ─── Run Context Operations ───
  async getContextByRun(runId: string): Promise<RunContextResponse[]> {
    return runsRepo.findContextByRun(runId);
  },

  async addContext(payload: CreateRunContextPayload): Promise<number> {
    return runsRepo.insertContext(payload);
  },

  async removeContext(id: number): Promise<void> {
    await runsRepo.deleteContext(id);
  },

  // ─── Run Artifact Operations ───
  async getHistoryPage(payload: ReadRunHistoryPayload) {
    validateHistoryRequest(payload);
    if (!await runsRepo.findRunById(payload.runId)) throw new Error("Conversation not found");
    const page = runsRepo.findHistoryPage(payload);
    return { ...page, artifacts: await withImageContentHashes(page.artifacts) };
  },

  async getToolOutput(runId: string, toolId: number) {
    if (typeof runId !== "string" || !runId || !Number.isSafeInteger(toolId) || toolId <= 0) throw new Error("Invalid tool call");
    const result = runsRepo.findToolOutput(runId, toolId);
    if (!result) throw new Error("Tool call not found in this conversation");
    return result;
  },

  async getArtifactsByRun(
    runId: string,
    sinceId?: number,
  ): Promise<RunArtifactResponse[]> {
    return withImageContentHashes(await runsRepo.findArtifactsByRun(runId, sinceId));
  },

  /**
   * An image artifact's pixels, sized for a phone. The desktop's renderer reads
   * image files off the disk through a signed protocol; a paired device has no
   * disk and only its socket, so the bytes go over that — after `nativeImage`
   * has shrunk them to a screen's worth. Always JPEG: this is a chat preview,
   * not the file.
   */
  async readArtifactImage(payload: ReadArtifactImagePayload): Promise<ArtifactImage> {
    const artifact = await runsRepo.findArtifactById(payload.artifactId);
    if (!artifact) throw new Error("Artifact not found");
    if (artifact.kind !== "image") throw new Error("Not an image artifact");
    // The adapters record where the file is in the metadata, not the column.
    const filePath =
      artifact.path ??
      (typeof artifact.metadata?.path === "string" ? artifact.metadata.path : null);
    const bytes =
      artifact.blobData ??
      (filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath) : null);
    if (!bytes) throw new Error("Image file is missing");
    const maxSide = Math.min(
      Math.max(payload.maxSide ?? ARTIFACT_IMAGE_MAX_SIDE, 128),
      ARTIFACT_IMAGE_MAX_SIDE,
    );
    const preview = await getBackendRuntime().imagePreview?.resizeToJpeg(
      bytes,
      maxSide,
    );
    if (!preview) {
      // The Node server intentionally has no image codec. Phones can decode
      // these formats themselves, so send bounded original bytes instead.
      const ext = (filePath ?? "").split(".").pop()?.toLowerCase() ?? "";
      const mime = RAW_IMAGE_MIMES[ext];
      if (!mime) throw new Error("Unsupported image format");
      if (bytes.length > ARTIFACT_IMAGE_RAW_LIMIT) throw new Error("Image is too large to send");
      return { mime, base64: bytes.toString("base64"), width: null, height: null };
    }
    return {
      mime: "image/jpeg",
      base64: preview.jpeg.toString("base64"),
      width: preview.width,
      height: preview.height,
    };
  },

  readAttachmentImage(payload: ReadAttachmentImagePayload): Promise<ArtifactImage> {
    return readAttachmentImage(payload);
  },

  async resolveAttachmentPath(payload: ResolveAttachmentPathPayload): Promise<string> {
    return (await resolveRunAttachment(payload.runId, payload.attachmentId)).path;
  },

  async readAttachmentFile(payload: ResolveAttachmentPathPayload): Promise<AttachmentFile> {
    const { attachment, path: sourcePath } = await resolveRunAttachment(payload.runId, payload.attachmentId);
    return { attachmentId: attachment.id, name: attachment.name, type: attachment.type, mimeType: attachment.mimeType,
      byteSize: attachment.byteSize, base64: (await fs.promises.readFile(sourcePath)).toString("base64") };
  },

  async addArtifact(payload: CreateRunArtifactPayload): Promise<number> {
    return runsRepo.insertArtifact(payload);
  },

  async removeArtifact(id: number): Promise<void> {
    await runsRepo.deleteArtifact(id);
  },

  // ─── Tool Call Operations ───
  async getToolCallsByRun(
    runId: string,
    sinceUpdatedAt?: Date,
  ): Promise<ToolCallResponse[]> {
    return runsRepo.findToolCallsByRun(runId, sinceUpdatedAt);
  },

  async addToolCall(payload: CreateToolCallPayload): Promise<number> {
    return runsRepo.insertToolCall(payload);
  },

  async updateToolCall(
    id: number,
    payload: UpdateToolCallPayload,
  ): Promise<void> {
    await runsRepo.updateToolCall(id, payload);
  },

  // ─── Composite Read ───
  async getRunDetails(runId: string): Promise<RunDetailsResponse | null> {
    const run = await runsRepo.findRunById(runId);
    if (!run) return null;
    const [context, artifacts, toolCalls, turns] = await Promise.all([
      runsRepo.findContextByRun(runId),
      runsRepo.findArtifactsByRun(runId),
      runsRepo.findToolCallsByRun(runId),
      runsRepo.findTurnsByRun(runId),
    ]);
    return { run, context, artifacts: await withImageContentHashes(artifacts), toolCalls, turns };
  },

  // ─── Orchestrators ───

  /**
   * Start a new run. Validates provider+workspace, creates the run row,
   * persists initial context, then spawns a RunSession wired to the adapter.
   * The session owns the lifecycle from here on; this method returns immediately.
   */
  async executeRun(payload: StartRunPayload): Promise<StartRunResponse> {
    // Before anything is written: a refused attachment must leave no run behind.
    const uploads = sanitizeRunAttachments(payload.attachments, await browserCaptureDir());
    const runId = generateRunId();
    try {
      const provider = await providersService.getById(payload.providerId);
      if (!provider) {
        throw new Error(`Provider "${payload.providerId}" not found`);
      }
      if (!provider.isEnabled) {
        throw new Error(`Provider "${provider.displayName}" is not enabled`);
      }
      if (provider.kind !== "agent_runtime") {
        throw new Error(
          `Provider "${provider.displayName}" is not an agent runtime`,
        );
      }

      const { spaceId: resolvedSpaceId, mode, space } = await resolveRunMode(payload.spaceId);
      if (!resolvedSpaceId || !space) {
        throw new Error("A valid space is required to start a run");
      }
      if (space.accountId !== payload.accountId) {
        throw new Error("Space does not belong to this account");
      }
      if (space.providerId !== payload.providerId) {
        throw new Error("Space does not use the selected provider");
      }
      let workspace: Awaited<ReturnType<typeof workspaceService.get>> = null;
      if (mode === "developer") {
        if (!payload.workspaceId) {
          throw new Error("Developer runs require a workspace");
        }
        workspace = await workspaceService.get(payload.workspaceId);
        if (!workspace) {
          throw new Error(`Workspace "${payload.workspaceId}" not found`);
        }
        if (workspace.accountId !== payload.accountId) {
          throw new Error("Workspace does not belong to this account");
        }
        assertWorkspacePathExists(workspace.rootPath, workspace.name);
      } else if (payload.workspaceId) {
        throw new Error("Work and Chat runs do not use a workspace");
      }
      const collectionId = await validateCollectionForRun(
        payload.collectionId,
        payload.accountId,
        mode,
      );
      const baseInstructions = composeExtraInstructions(mode, space?.systemPrompt);
      // Persist the *composed* values — the run row records what actually ran.
      // Pin Claude's selected output style when the chat is created. A later
      // provider-settings change must not restyle an existing conversation.
      const providerOutputStyle =
        payload.providerId === PROVIDER_IDS.claude &&
        typeof provider.config?.outputStyle === "string"
          ? { outputStyle: provider.config.outputStyle }
          : {};
      const conversationSettings = resolveConversationSettings(
        payload.providerId, provider.config,
        composeConfigSnapshot(mode, payload.providerId, payload.configSnapshot),
        payload.model, payload.conversationSettings,
      );
      const configSnapshot = normalizeAdditionalDirectories(
        composeConfigSnapshot(mode, payload.providerId, {
          ...providerOutputStyle,
          ...(payload.configSnapshot ?? {}),
          ...conversationSettings.config,
          conversationSettings,
          ...(payload.additionalDirectories !== undefined
            ? { additionalDirectories: payload.additionalDirectories }
            : {}),
        }),
        payload.providerId,
      );
      const toolPolicy = composeToolPolicy(mode, payload.toolPolicySnapshot);
      const execution = resolveRunExecution({ runId, mode, workspace });
      if (workspace) {
        await workspaceService.update(workspace.id, { status: "in_progress" });
      }

      await runsRepo.insertRun({
        id: runId,
        accountId: payload.accountId,
        workspaceId: workspace?.id,
        collectionId,
        spaceId: resolvedSpaceId,
        providerId: payload.providerId,
        mode,
        model: conversationSettings.model || undefined,
        goal: payload.goal,
        status: "running",
        systemPrompt: payload.systemPrompt,
        configSnapshot: configSnapshot ?? undefined,
        toolPolicySnapshot: toolPolicy ?? undefined,
      });
      await runsRepo.updateRun(runId, { startedAt: new Date() });
      const attachments = await prepareRunAttachments(runId, uploads);

      const projectInstructions = await buildCollectionSourceInstructions({
        runId,
        accountId: payload.accountId,
        collectionId,
        cwd: execution.workspaceId ? null : execution.cwd,
      });
      const extraInstructions = withProjectResources(baseInstructions, projectInstructions);

      if (payload.initialContext && payload.initialContext.length > 0) {
        for (const ctx of payload.initialContext) {
          await runsRepo.insertContext({
            runId,
            kind: ctx.kind as "file" | "selection" | "diff" | "note",
            ref: ctx.ref,
            content: ctx.content,
            contentHash: ctx.content ? hashContent(ctx.content) : undefined,
            metadata: ctx.metadata,
          });
        }
      }

      const session = createRunSession({
        runId,
        accountId: payload.accountId,
        providerId: payload.providerId,
        execution,
        initialPromptContent: payload.goal,
      });

      const adapter = createWorkAdapter(provider);
      generateRunTitle(runId, adapter, payload.goal, payload.initialContext).catch((err) =>
        console.error(`[RunsService] Title generation failed for ${runId}:`, err),
      );

      const runPromise = adapter.startRun(
        {
          runId,
          accountId: payload.accountId,
          execution,
          goal: payload.goal,
          clientPromptId: payload.clientPromptId,
          model: conversationSettings.model || undefined,
          systemPrompt: payload.systemPrompt,
          mode,
          extraInstructions,
          context: payload.initialContext as WorkRunContextItem[] | undefined,
          toolPolicy,
          configSnapshot,
          attachments,
          contextIssues: payload.contextIssues,
          contextSignals: payload.contextSignals,
          contextFiles: payload.contextFiles,
          skills: payload.contextSkills,
        },
        (event: WorkRunEvent) =>
          session.project(event).catch((err) =>
            console.error(`[RunsService] project failed for ${runId}:`, err),
          ),
      );

      wireSessionCompletion(runPromise, session);

      return { runId };
    } catch (error) {
      await handlePreSessionFailure(runId, error);
      throw error;
    }
  },

  /**
   * Run a code review. Same shape as executeRun, but uses adapter.reviewRun
   * (with adapter.startRun as fallback). Workspace status transitions to in_review.
   */
  async executeReview(payload: ReviewRunPayload): Promise<StartRunResponse> {
    const runId = generateRunId();
    try {
      const provider = await providersService.getById(payload.providerId);
      if (!provider) {
        throw new Error(`Provider "${payload.providerId}" not found`);
      }
      if (!provider.isEnabled) {
        throw new Error(`Provider "${provider.displayName}" is not enabled`);
      }
      if (provider.kind !== "agent_runtime") {
        throw new Error(
          `Provider "${provider.displayName}" is not an agent runtime`,
        );
      }

      // Reviews are a Developer-mode surface: they feed the review/finding
      // rows and the git ceremony the other modes hide, and the review request
      // carries no mode harness (no toolPolicy, no configSnapshot). A Work or
      // Chat space is refused here rather than allowed to run unharnessed —
      // before the workspace flips to in_review, so a refusal leaves no trace.
      const { spaceId: resolvedSpaceId, mode } = await resolveRunMode(payload.spaceId);
      if (mode !== "developer") {
        throw new Error("Code review is only available in Developer spaces");
      }

      const workspace = await workspaceService.get(payload.workspaceId);
      if (!workspace) {
        throw new Error(`Workspace "${payload.workspaceId}" not found`);
      }
      assertWorkspacePathExists(workspace.rootPath, workspace.name);

      await workspaceService.update(payload.workspaceId, { status: "in_review" });

      const goalDescription = `Review ${
        payload.target.type === "uncommittedChanges"
          ? "uncommitted changes"
          : payload.target.type === "baseBranch"
            ? `changes vs ${payload.target.branch ?? "base branch"}`
            : payload.target.type === "commit"
              ? `commit ${payload.target.sha ?? ""}`
              : "code changes"
      }`;

      const conversationSettings = resolveConversationSettings(
        payload.providerId, provider.config, payload.configSnapshot, payload.model, payload.conversationSettings,
      );
      const configSnapshot = composeConfigSnapshot(mode, payload.providerId, {
        ...payload.configSnapshot, ...conversationSettings.config, conversationSettings,
      });

      await runsRepo.insertRun({
        id: runId,
        accountId: payload.accountId,
        workspaceId: payload.workspaceId,
        spaceId: resolvedSpaceId,
        providerId: payload.providerId,
        mode,
        model: conversationSettings.model || undefined,
        goal: goalDescription,
        status: "running",
        systemPrompt: payload.systemPrompt,
        // Composed, not raw: developer's harness adds nothing, but the caller's
        // snapshots still get validated and normalized here rather than sitting
        // on the row until continueRun's compose rejects them mid-resume.
        configSnapshot: configSnapshot ?? undefined,
        toolPolicySnapshot:
          composeToolPolicy(mode, payload.toolPolicySnapshot) ?? undefined,
      });
      await runsRepo.updateRun(runId, { startedAt: new Date() });

      const session = createRunSession({
        runId,
        accountId: payload.accountId,
        providerId: payload.providerId,
        execution: { cwd: workspace.rootPath, workspaceId: workspace.id },
        initialPromptContent: goalDescription,
      });

      const adapter = createWorkAdapter(provider);

      const eventCallback = (event: WorkRunEvent) =>
        session.project(event).catch((err) =>
          console.error(`[RunsService] project failed for review run ${runId}:`, err),
        );

      let runPromise: Promise<WorkRunResult>;
      if (adapter.reviewRun) {
        runPromise = adapter.reviewRun(
          {
            runId,
            accountId: payload.accountId,
            execution: { cwd: workspace.rootPath, workspaceId: workspace.id },
            target: payload.target,
            model: conversationSettings.model || undefined,
            configSnapshot,
          },
          eventCallback,
        );
      } else {
        // Fallback: use startRun with a review goal text
        runPromise = adapter.startRun(
          {
            runId,
            accountId: payload.accountId,
            execution: { cwd: workspace.rootPath, workspaceId: workspace.id },
            goal: "review code changes in this workspace",
            model: conversationSettings.model || undefined,
            configSnapshot,
            systemPrompt: payload.systemPrompt,
          },
          eventCallback,
        );
      }

      wireSessionCompletion(runPromise, session);

      return { runId };
    } catch (error) {
      await handlePreSessionFailure(runId, error);
      throw error;
    }
  },

  /**
   * Continue a previously-completed run, resuming the adapter session.
   * Un-finalizes the run row, recovers the turn counter from existing turns,
   * spawns a new RunSession (with seedTurnIndex so turns continue from the right index).
   */
  async continueRun(payload: ContinueRunPayload): Promise<ContinueRunResponse> {
    const { runId, accountId, message, additionalContext } = payload;
    if (continuingRuns.has(runId)) throw new Error("This conversation is already starting a response.");
    continuingRuns.add(runId);
    try {
      // Preconditions must not mark someone else's live turn failed.
      const existing = await runsRepo.findRunById(runId);
      if (!existing) throw new Error("Run not found");
      if (existing.accountId !== accountId) throw new Error("Run does not belong to this account");
      if (realtimeConnections.has(runId)) throw new Error("End voice chat before starting a new text response.");
      if (existing.isArchived) throw new Error("Unarchive this conversation before sending a message.");
      if (runSessionRegistry.get(runId) || existing.status === "running" || existing.status === "queued") {
        throw new Error("This conversation already has an active response.");
      }
      const uploads = sanitizeRunAttachments(payload.attachments, await browserCaptureDir());
      let continuationStarted = false;
      try {
        const run = await runsRepo.findRunById(runId);
        if (!run) throw new Error("Run not found");
        if (run.accountId !== accountId) {
          throw new Error("Run does not belong to this account");
        }

        const provider = await providersService.getById(run.providerId);
        if (!provider) {
          throw new Error(`Provider "${run.providerId}" not found`);
        }
        if (!provider.isEnabled) {
          throw new Error(`Provider "${provider.displayName}" is not enabled`);
        }

        const workspace = run.workspaceId
          ? await workspaceService.get(run.workspaceId)
          : null;
        if (run.workspaceId && !workspace) {
          throw new Error("Run workspace no longer exists");
        }
        if (workspace) {
          assertWorkspacePathExists(workspace.rootPath, workspace.name);
        }
        const execution = resolveRunExecution({
          runId,
          mode: run.mode,
          workspace,
        });

        const adapter = createWorkAdapter(provider);
        if (!adapter.continueRun) {
          throw new Error("Provider does not support session resumption");
        }
        if (adapter.canResumeSession) {
          const canResume = await adapter.canResumeSession(runId);
          if (!canResume) {
            throw new Error("Session cannot be resumed (not found or expired)");
          }
        }

        const attachments = await prepareRunAttachments(runId, uploads, payload.clientUserMessageId);

        const existingTurns = await runsRepo.findTurnsByRun(runId);
        const seedTurnIndex = existingTurns.reduce(
          (max, t) => Math.max(max, t.turnIndex),
          -1,
        );
        const previousModel = latestKnownModel(existingTurns, run.model);
        const conversationSettings = resolveConversationSettings(
          run.providerId, provider.config, run.configSnapshot,
          payload.model ?? previousModel,
          payload.conversationSettings ?? (payload.model ? {
            model: payload.model,
            config: resolveConversationSettings(run.providerId, provider.config, run.configSnapshot, previousModel).config,
          } : undefined),
        );

        const toolPolicy = composeToolPolicy(
          run.mode,
          run.toolPolicySnapshot,
        );
        const configSnapshot = normalizeAdditionalDirectories(
          composeConfigSnapshot(run.mode, run.providerId, {
            ...(run.configSnapshot ?? {}),
            ...conversationSettings.config,
            conversationSettings,
            ...(payload.additionalDirectories !== undefined
              ? { additionalDirectories: payload.additionalDirectories }
              : {}),
          }),
          run.providerId,
        );

        if (workspace) {
          await workspaceService.update(workspace.id, { status: "in_progress" });
        }

        await runsRepo.updateRun(runId, {
          status: "running",
          startedAt: new Date(),
          endedAt: null,
          lastError: null,
          configSnapshot: configSnapshot ?? undefined,
          toolPolicySnapshot: toolPolicy ?? undefined,
        }, { preserveConversationSettings: !!payload.conversationSettings });

        const projectInstructions = await buildCollectionSourceInstructions({
          runId,
          accountId,
          collectionId: run.collectionId,
          cwd: execution.workspaceId ? null : execution.cwd,
        });

        if (additionalContext && additionalContext.length > 0) {
          for (const ctx of additionalContext) {
            await runsRepo.insertContext({
              runId,
              kind: ctx.kind as "file" | "selection" | "diff" | "note",
              ref: ctx.ref,
              content: ctx.content,
              contentHash: ctx.content ? hashContent(ctx.content) : undefined,
              metadata: ctx.metadata,
            });
          }
        }

        const session = createRunSession({
          runId,
          accountId,
          providerId: run.providerId,
          execution,
          initialPromptContent: message,
          seedTurnIndex,
        });

        // Re-derive the harness from the run row's mode snapshot — the space's
        // current mode is irrelevant, but its system prompt is re-read live.
        const space = await findSpaceForRun(run.spaceId);

        let acceptInput: () => void = () => {};
        const inputAccepted = new Promise<void>((resolve) => { acceptInput = resolve; });
        const waitForInput = !!payload.clientUserMessageId && run.providerId === PROVIDER_IDS.codex;
        const runPromise = adapter.continueRun(
          {
            runId,
            accountId,
            execution,
            message,
            clientPromptId: payload.clientPromptId,
            ...(waitForInput ? {
              clientUserMessageId: payload.clientUserMessageId,
              onInputAccepted: async () => { acceptInput(); },
            } : {}),
            // An omitted model means "as before". `runs.model` is the initial
            // snapshot; a conversation may have switched since then.
            model: conversationSettings.model || undefined,
            systemPrompt: run.systemPrompt,
            mode: run.mode,
            extraInstructions: withProjectResources(
              composeExtraInstructions(run.mode, space?.systemPrompt),
              projectInstructions,
            ),
            toolPolicy,
            configSnapshot,
            context: additionalContext as WorkRunContextItem[] | undefined,
            attachments,
            contextIssues: payload.contextIssues,
            contextSignals: payload.contextSignals,
            contextFiles: payload.contextFiles,
            skills: payload.contextSkills,
          },
          (event: WorkRunEvent) =>
            waitForInput ? session.project(event) : session.project(event).catch((err) =>
              console.error(`[RunsService] project failed for ${runId}:`, err),
            ),
        );

        continuationStarted = true;
        wireSessionCompletion(runPromise, session);
        if (waitForInput) {
          await Promise.race([
            inputAccepted,
            runPromise.then((result) => {
              throw new Error(result.summary || "Codex did not accept the queued message.");
            }),
          ]);
        }

        return { runId, resumed: true };
      } catch (error) {
        if (!continuationStarted) await handlePreSessionFailure(runId, error);
        throw error;
      }
    } finally {
      continuingRuns.delete(runId);
    }
  },

  async steerRun(payload: RunSteerPayload): Promise<RunSteerResponse> {
    const run = await runsRepo.findRunById(payload.runId);
    if (!run) throw new Error("Run not found");
    if (run.accountId !== payload.accountId) throw new Error("Run does not belong to this account");
    if (run.isArchived) throw new Error("Unarchive this conversation before sending a message.");
    if (run.providerId !== PROVIDER_IDS.codex) throw new Error("This provider does not support steering.");
    if (!runSessionRegistry.get(run.id) || run.status !== "running") {
      throw new Error("There is no active Codex turn to steer. The message stays queued.");
    }
    if (!payload.clientUserMessageId || typeof payload.message !== "string") throw new Error("Invalid message.");
    const uploads = sanitizeRunAttachments(payload.attachments, await browserCaptureDir());
    const provider = await providersService.getById(run.providerId);
    if (!provider?.isEnabled) throw new Error("Codex is not enabled.");
    const adapter = createWorkAdapter(provider);
    if (!adapter.steerRun) throw new Error("This provider does not support steering.");
    const attachments = await prepareRunAttachments(run.id, uploads, payload.clientUserMessageId);
    const { turnId } = await adapter.steerRun({
      runId: run.id, message: payload.message,
      clientUserMessageId: payload.clientUserMessageId,
      attachments, context: payload.additionalContext,
      contextIssues: payload.contextIssues, contextFiles: payload.contextFiles,
      contextSignals: payload.contextSignals, skills: payload.contextSkills,
    });
    return { runId: run.id, turnId };
  },

  async getInputStatus(payload: RunInputStatusPayload): Promise<{ accepted: boolean }> {
    const run = await runsRepo.findRunById(payload.runId);
    if (!run) throw new Error("Run not found");
    if (run.accountId !== payload.accountId) throw new Error("Run does not belong to this account");
    const artifacts = await runsRepo.findArtifactsByRun(run.id);
    if (artifacts.some((artifact) => artifact.metadata?.clientUserMessageId === payload.clientUserMessageId)) {
      return { accepted: true };
    }
    const provider = await providersService.getById(run.providerId);
    const adapter = provider ? createWorkAdapter(provider) : undefined;
    const result = await adapter?.getInputStatus?.(run.id, payload.clientUserMessageId, run.sessionId ?? undefined) ?? { accepted: false };
    if (result.accepted && payload.input) {
      const input = payload.input;
      const uploads = sanitizeRunAttachments(input.attachments, await browserCaptureDir());
      const attachments = await prepareRunAttachments(run.id, uploads, payload.clientUserMessageId);
      await emitUserPromptArtifact(async (event) => {
        if (event.type === "artifact" && await insertRunInputArtifact(run.id, event)) {
          emit(CHANNELS.runs.eventPersisted, { runId: run.id });
        }
      }, input.message, {
        runId: run.id, clientUserMessageId: payload.clientUserMessageId,
        providerTurnId: result.turnId, ...(payload.delivery === "steer" ? { delivery: "steer" } : {}),
        attachments, context: input.additionalContext,
        contextIssues: input.contextIssues, contextSignals: input.contextSignals,
        contextFiles: input.contextFiles, contextSkills: input.contextSkills,
      });
    }
    return { accepted: result.accepted };
  },

  /**
   * Fork a completed run's session into a new run that branches from the source.
   * Creates a new run row, then spawns a RunSession wired to adapter.forkRun.
   */
  async forkRun(payload: ForkRunPayload): Promise<ForkRunResponse> {
    const { sourceRunId, accountId, message } = payload;
    const uploads = sanitizeRunAttachments(payload.attachments, await browserCaptureDir());
    const newRunId = generateRunId();
    try {
      const sourceRun = await runsRepo.findRunById(sourceRunId);
      if (!sourceRun) throw new Error("Source run not found");
      if (sourceRun.accountId !== accountId) {
        throw new Error("Source run does not belong to this account");
      }

      const provider = await providersService.getById(sourceRun.providerId);
      if (!provider) {
        throw new Error(`Provider "${sourceRun.providerId}" not found`);
      }
      if (!provider.isEnabled) {
        throw new Error(`Provider "${provider.displayName}" is not enabled`);
      }

      const workspace = sourceRun.workspaceId
        ? await workspaceService.get(sourceRun.workspaceId)
        : null;
      if (sourceRun.workspaceId && !workspace) {
        throw new Error("Source run workspace no longer exists");
      }
      if (workspace) {
        assertWorkspacePathExists(workspace.rootPath, workspace.name);
      }

      const adapter = createWorkAdapter(provider);
      if (!adapter.forkRun) {
        throw new Error("Provider does not support session forking");
      }
      if (adapter.canResumeSession) {
        const canResume = await adapter.canResumeSession(sourceRunId);
        if (!canResume) {
          throw new Error(
            "Source session cannot be forked (not found or expired)",
          );
        }
      }

      const sourceTurns = await runsRepo.findTurnsByRun(sourceRunId);
      const conversationSettings = resolveConversationSettings(
        sourceRun.providerId, provider.config, sourceRun.configSnapshot,
        latestKnownModel(sourceTurns, sourceRun.model),
      );
      const sourceModel = conversationSettings.model || undefined;

      if (workspace) {
        await workspaceService.update(workspace.id, { status: "in_progress" });
      }

      const toolPolicy = composeToolPolicy(
        sourceRun.mode,
        sourceRun.toolPolicySnapshot,
      );
      const configSnapshot = composeConfigSnapshot(
        sourceRun.mode,
        sourceRun.providerId,
        { ...sourceRun.configSnapshot, ...conversationSettings.config, conversationSettings },
      );

      await runsRepo.insertRun({
        id: newRunId,
        accountId,
        workspaceId: sourceRun.workspaceId ?? undefined,
        collectionId: sourceRun.collectionId ?? undefined,
        spaceId: sourceRun.spaceId ?? undefined,
        providerId: sourceRun.providerId,
        mode: sourceRun.mode,
        model: sourceModel,
        goal: message,
        status: "running",
        systemPrompt: sourceRun.systemPrompt ?? undefined,
        configSnapshot: configSnapshot ?? undefined,
        toolPolicySnapshot: toolPolicy ?? undefined,
      });

      runsRepo.inheritAttachmentRefs(sourceRunId, newRunId);
      const attachments = await prepareRunAttachments(newRunId, uploads);

      const execution = resolveRunExecution({
        runId: newRunId,
        mode: sourceRun.mode,
        workspace,
      });

      const projectInstructions = await buildCollectionSourceInstructions({
        runId: newRunId,
        accountId,
        collectionId: sourceRun.collectionId,
        cwd: execution.workspaceId ? null : execution.cwd,
      });
      if (payload.additionalContext) {
        for (const item of payload.additionalContext) {
          await runsRepo.insertContext({
            runId: newRunId,
            kind: item.kind,
            ref: item.ref,
            content: item.content,
            contentHash: item.content ? hashContent(item.content) : undefined,
            metadata: item.metadata,
          });
        }
      }

      const session = createRunSession({
        runId: newRunId,
        accountId,
        providerId: sourceRun.providerId,
        execution,
        initialPromptContent: message,
      });

      generateRunTitle(newRunId, adapter, message).catch((err) =>
        console.error(`[RunsService] Title generation failed for forked run ${newRunId}:`, err),
      );

      // The fork inherits the source run's harness wholesale — same mode
      // snapshot, same composed policy/config (the fork row copied them).
      const sourceSpace = await findSpaceForRun(sourceRun.spaceId);

      const runPromise = adapter.forkRun(
        {
          runId: newRunId,
          sourceRunId,
          accountId,
          execution,
          message,
          // Fork from the model that handled the latest source turn, not the
          // model the source happened to start with.
          model: sourceModel,
          mode: sourceRun.mode,
          extraInstructions: withProjectResources(
            composeExtraInstructions(sourceRun.mode, sourceSpace?.systemPrompt),
            projectInstructions,
          ),
          toolPolicy,
          configSnapshot,
          context: payload.additionalContext as WorkRunContextItem[] | undefined,
          attachments,
        },
        (event: WorkRunEvent) =>
          session.project(event).catch((err) =>
            console.error(`[RunsService] project failed for forked run ${newRunId}:`, err),
          ),
      );

      wireSessionCompletion(runPromise, session);

      return { runId: newRunId, sourceRunId };
    } catch (error) {
      await handlePreSessionFailure(newRunId, error);
      throw error;
    }
  },

  /**
   * Abort a running run. Signals the adapter via the session; cleanup happens
   * on the completion path (session.finalize). Edge case: if the DB says
   * running but no live session is registered (process restart), write
   * status="canceled" directly.
   */
  async abortRun(runId: string): Promise<void> {
    const run = await runsRepo.findRunById(runId);
    if (!run) throw new Error("Run not found");
    if (run.status !== "running" && run.status !== "queued") {
      throw new Error(`Run is not running (status: ${run.status})`);
    }

    const session = runSessionRegistry.get(runId);
    if (session) {
      await session.abort();
      return;
    }

    // No live session to abort, for one of two reasons: the run never started
    // (queued), or the process restarted mid-run and the DB row outlived its
    // session. Both cancel the row directly — the background-runs dock offers
    // stop on either, and neither has anything left to interrupt.
    await runsRepo.updateRun(runId, {
      status: "canceled",
      endedAt: new Date(),
      lastError:
        run.status === "queued"
          ? "Run canceled before it started"
          : "Run had no live session (likely process restart mid-run)",
    });
    broadcastStatusChangedPreSession(runId, "canceled");
  },

  // ─── Session inspection / deletion ───
  async canResumeRun(runId: string): Promise<boolean> {
    const run = await runsRepo.findRunById(runId);
    if (!run) return false;

    // Can only resume runs that completed (succeeded, failed, or canceled)
    if (run.status === "running" || run.status === "queued") {
      return false;
    }

    const provider = await providersService.getById(run.providerId);
    if (!provider) return false;

    const adapter = createWorkAdapter(provider);
    if (!adapter.canResumeSession) return false;

    return adapter.canResumeSession(runId);
  },

  async getTurnsByRun(runId: string): Promise<RunTurnResponse[]> {
    return runsRepo.findTurnsByRun(runId);
  },

  async getTurnChangesDiff(
    runId: string,
    turnId: number,
  ): Promise<RunTurnChangesDiffResponse | null> {
    return runsRepo.findTurnChanges(runId, turnId);
  },

  /**
   * Reverse-apply one turn's stored patch to its workspace. Refused while the
   * run is live (the agent may be editing the same files), when a parallel
   * run wrote one of its files during the turn (`shared`), and when any file
   * the turn touched has moved on since — `git apply --check` decides that,
   * and a failed check writes nothing. See CONTEXT.md "turn changes".
   */
  async undoTurnChanges(
    runId: string,
    turnId: number,
  ): Promise<RunTurnChangesSummary> {
    const run = await runsRepo.findRunById(runId);
    if (!run) throw new Error("Run not found");
    if (runSessionRegistry.get(runId)) {
      throw new Error("Wait for the run to finish before undoing its changes.");
    }
    const changes = await runsRepo.findTurnChanges(runId, turnId);
    if (!changes) throw new Error("This turn has no recorded changes.");
    if (changes.undoneAt) throw new Error("These changes were already undone.");
    if (changes.truncated) {
      throw new Error(
        "This turn's changes were too large to store in full, so they can't be undone.",
      );
    }
    // Reverse-applying would take the parallel run's edits to these files too.
    if (changes.files.some((f) => f.shared)) {
      throw new Error(
        "A parallel run changed some of these files too, so this turn can't be undone automatically.",
      );
    }
    const workspace = run.workspaceId
      ? await workspaceService.get(run.workspaceId)
      : null;
    if (!workspace) throw new Error("Workspace not found");

    const { diffText, ...summary } = changes;
    const applies = await gitService.canApplyPatch(workspace.rootPath, diffText, {
      reverse: true,
    });
    if (!applies) {
      throw new Error(
        "Some of these files changed after this turn, so its changes can't be undone automatically.",
      );
    }
    await gitService.applyPatch(workspace.rootPath, diffText, { reverse: true });
    const undoneAt = new Date();
    await runsRepo.markTurnChangesUndone(changes.id, undoneAt);

    // The workspace's own diff (sidebar count, Changes tab) moved underneath it.
    await workspaceService.resyncDiff(workspace.id).catch((err) =>
      console.error(`[RunsService] resyncDiff after undo failed for ${runId}:`, err),
    );
    emit("runs:diffUpdated", { runId, workspaceId: workspace.id, ts: Date.now() });
    return { ...summary, undoneAt };
  },

  async deleteRunSession(runId: string): Promise<void> {
    const run = await runsRepo.findRunById(runId);
    if (!run) throw new Error("Run not found");

    const provider = await providersService.getById(run.providerId);
    if (!provider) return;

    const adapter = createWorkAdapter(provider);
    if (adapter.deleteSession) {
      await adapter.deleteSession(runId);
    }
  },
};
