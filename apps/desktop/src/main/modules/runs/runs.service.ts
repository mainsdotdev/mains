import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { PROVIDER_IDS } from "../../../shared/provider-ids";
import { runsRepo } from "./runs.repo";
import { providersService } from "../providers";
import { collectionsService } from "../collections";
import { projectsService } from "../projects";
import { workspaceService, assertWorkspacePathExists } from "../workspace";
import { spaceService } from "../space";
import { appSettingsService } from "../appSettings";
import { DEFAULT_MODE_ID, type ModeId } from "../../../shared/modes";
import type {
  ArtifactImage,
  ReadArtifactImagePayload,
  ReadRunTextFilePayload,
  RunTextFile,
} from "@mains/contracts/runs";
import {
  composeConfigSnapshot,
  composeExtraInstructions,
  composeToolPolicy,
} from "../../../shared/mode-harness";
import {
  createWorkAdapter,
  type WorkRunContextItem,
  type WorkRunAdapter,
  type WorkRunEvent,
} from "../providers/adapters";
import type { WorkRunResult } from "../../../shared/adapter.types";
import { createRunSession, type RunSession, type RunSessionResult } from "./run-session";
import {
  managedRunDir,
  removeManagedRunDir,
  resolveRunExecution,
} from "./run-execution";
import { materializeCollectionSourceContext } from "./run-collection-sources";
import { emit } from "../../ipc-kit";
import { runSessionRegistry } from "./run-session-registry";
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
  ReviewRunPayload,
  RunDetailsResponse,
  RunTurnResponse,
} from "./runs.dto";

/** Longest side an image artifact is sent at — more than any phone shows. */
const ARTIFACT_IMAGE_MAX_SIDE = 1600;
/** A file sent as it is (a format the Mac can't scale) must fit in one message. */
const ARTIFACT_IMAGE_RAW_LIMIT = 8 * 1024 * 1024;
/** Keep one document response comfortably below the WebSocket message ceiling. */
const RUN_TEXT_FILE_MAX_BYTES = 2 * 1024 * 1024;
/** A basename fallback is bounded so one malformed run directory cannot stall the host. */
const RUN_TEXT_SEARCH_MAX_ENTRIES = 10_000;
const RUN_TEXT_SEARCH_MAX_DEPTH = 12;
const RUN_TEXT_SEARCH_EXCLUDES = new Set([".git", "node_modules"]);
/** Image types the phone decodes on its own, by extension — `nativeImage` reads only PNG and JPEG. */
const RAW_IMAGE_MIMES: Record<string, string> = {
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
export const runsService = {
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
    const updated = await runsRepo.updateRun(id, payload);
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
  },

  /** Delete every run of a workspace (project removal cleanup). */
  async deleteRunsByWorkspace(workspaceId: string): Promise<void> {
    await runsRepo.deleteRunsByWorkspaceId(workspaceId);
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
  async getArtifactsByRun(
    runId: string,
    sinceId?: number,
  ): Promise<RunArtifactResponse[]> {
    return runsRepo.findArtifactsByRun(runId, sinceId);
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
    // Loaded here rather than at the top: the service also runs outside
    // Electron (tests), where the module is a stub.
    const { nativeImage } = await import("electron");
    const source = nativeImage.createFromBuffer(bytes);
    if (source.isEmpty()) {
      // Not PNG or JPEG, so nothing here can scale it — but the phone reads
      // WebP and friends itself, so the file goes as it is, within reason.
      const ext = (filePath ?? "").split(".").pop()?.toLowerCase() ?? "";
      const mime = RAW_IMAGE_MIMES[ext];
      if (!mime) throw new Error("Unsupported image format");
      if (bytes.length > ARTIFACT_IMAGE_RAW_LIMIT) throw new Error("Image is too large to send");
      return { mime, base64: bytes.toString("base64"), width: null, height: null };
    }
    const maxSide = Math.min(
      Math.max(payload.maxSide ?? ARTIFACT_IMAGE_MAX_SIDE, 128),
      ARTIFACT_IMAGE_MAX_SIDE,
    );
    const size = source.getSize();
    const scale = Math.min(1, maxSide / Math.max(size.width, size.height, 1));
    const scaled =
      scale < 1
        ? source.resize({
            width: Math.round(size.width * scale),
            height: Math.round(size.height * scale),
            quality: "good",
          })
        : source;
    const out = scaled.getSize();
    return {
      mime: "image/jpeg",
      base64: scaled.toJPEG(82).toString("base64"),
      width: out.width,
      height: out.height,
    };
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
    return { run, context, artifacts, toolCalls, turns };
  },

  // ─── Orchestrators ───

  /**
   * Start a new run. Validates provider+workspace, creates the run row,
   * persists initial context, then spawns a RunSession wired to the adapter.
   * The session owns the lifecycle from here on; this method returns immediately.
   */
  async executeRun(payload: StartRunPayload): Promise<StartRunResponse> {
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
        await workspaceService.update(workspace.id, { status: "in_progress" });
      } else if (payload.workspaceId) {
        throw new Error("Work and Chat runs do not use a workspace");
      }
      const collectionId = await validateCollectionForRun(
        payload.collectionId,
        payload.accountId,
        mode,
      );
      const execution = resolveRunExecution({ runId, mode, workspace });
      const extraInstructions = composeExtraInstructions(mode, space?.systemPrompt);
      // Persist the *composed* values — the run row records what actually ran.
      const configSnapshot = composeConfigSnapshot(mode, payload.providerId, payload.configSnapshot);
      const toolPolicy = composeToolPolicy(mode, payload.toolPolicySnapshot);

      await runsRepo.insertRun({
        id: runId,
        accountId: payload.accountId,
        workspaceId: workspace?.id,
        collectionId,
        spaceId: resolvedSpaceId,
        providerId: payload.providerId,
        mode,
        model: payload.model,
        goal: payload.goal,
        status: "running",
        systemPrompt: payload.systemPrompt,
        configSnapshot: configSnapshot ?? undefined,
        toolPolicySnapshot: toolPolicy ?? undefined,
      });
      await runsRepo.updateRun(runId, { startedAt: new Date() });

      const collectionContext = await materializeCollectionSourceContext({
        runId,
        accountId: payload.accountId,
        collectionId,
        execution,
      });
      const effectiveInitialContext: WorkRunContextItem[] = [
        ...collectionContext,
        ...((payload.initialContext ?? []) as WorkRunContextItem[]),
      ];

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
          model: payload.model,
          systemPrompt: payload.systemPrompt,
          mode,
          extraInstructions,
          context:
            effectiveInitialContext.length > 0
              ? effectiveInitialContext
              : undefined,
          toolPolicy,
          configSnapshot,
          attachments: payload.attachments,
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

      await runsRepo.insertRun({
        id: runId,
        accountId: payload.accountId,
        workspaceId: payload.workspaceId,
        spaceId: resolvedSpaceId,
        providerId: payload.providerId,
        mode,
        model: payload.model,
        goal: goalDescription,
        status: "running",
        systemPrompt: payload.systemPrompt,
        // Composed, not raw: developer's harness adds nothing, but the caller's
        // snapshots still get validated and normalized here rather than sitting
        // on the row until continueRun's compose rejects them mid-resume.
        configSnapshot:
          composeConfigSnapshot(mode, payload.providerId, payload.configSnapshot) ??
          undefined,
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
            delivery: payload.delivery,
            model: payload.model,
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
            model: payload.model,
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

      const existingTurns = await runsRepo.findTurnsByRun(runId);
      const seedTurnIndex = existingTurns.reduce(
        (max, t) => Math.max(max, t.turnIndex),
        -1,
      );

      if (workspace) {
        await workspaceService.update(workspace.id, { status: "in_progress" });
      }

      const toolPolicy = composeToolPolicy(
        run.mode,
        run.toolPolicySnapshot,
      );
      const configSnapshot = composeConfigSnapshot(
        run.mode,
        run.providerId,
        run.configSnapshot,
      );

      await runsRepo.updateRun(runId, {
        status: "running",
        startedAt: new Date(),
        endedAt: null,
        lastError: null,
        configSnapshot: configSnapshot ?? undefined,
        toolPolicySnapshot: toolPolicy ?? undefined,
      });

      const collectionContext = await materializeCollectionSourceContext({
        runId,
        accountId,
        collectionId: run.collectionId,
        execution,
      });
      const effectiveAdditionalContext: WorkRunContextItem[] = [
        ...collectionContext,
        ...((additionalContext ?? []) as WorkRunContextItem[]),
      ];

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

      const runPromise = adapter.continueRun(
        {
          runId,
          accountId,
          execution,
          message,
          // The run's own model unless the caller names another: a phone that
          // sends none means "as before", not "whatever the adapter has".
          model: payload.model ?? run.model ?? undefined,
          systemPrompt: run.systemPrompt,
          mode: run.mode,
          extraInstructions: composeExtraInstructions(run.mode, space?.systemPrompt),
          toolPolicy,
          configSnapshot,
          context:
            effectiveAdditionalContext.length > 0
              ? effectiveAdditionalContext
              : undefined,
          attachments: payload.attachments,
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

      return { runId, resumed: true };
    } catch (error) {
      await handlePreSessionFailure(runId, error);
      throw error;
    }
  },

  /**
   * Fork a completed run's session into a new run that branches from the source.
   * Creates a new run row, then spawns a RunSession wired to adapter.forkRun.
   */
  async forkRun(payload: ForkRunPayload): Promise<ForkRunResponse> {
    const { sourceRunId, accountId, message } = payload;
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
        sourceRun.configSnapshot,
      );

      await runsRepo.insertRun({
        id: newRunId,
        accountId,
        workspaceId: sourceRun.workspaceId ?? undefined,
        collectionId: sourceRun.collectionId ?? undefined,
        spaceId: sourceRun.spaceId ?? undefined,
        providerId: sourceRun.providerId,
        mode: sourceRun.mode,
        model: sourceRun.model ?? undefined,
        goal: message,
        status: "running",
        systemPrompt: sourceRun.systemPrompt ?? undefined,
        configSnapshot: configSnapshot ?? undefined,
        toolPolicySnapshot: toolPolicy ?? undefined,
      });

      const execution = resolveRunExecution({
        runId: newRunId,
        mode: sourceRun.mode,
        workspace,
      });

      const collectionContext = await materializeCollectionSourceContext({
        runId: newRunId,
        accountId,
        collectionId: sourceRun.collectionId,
        execution,
      });
      const effectiveAdditionalContext: WorkRunContextItem[] = [
        ...collectionContext,
        ...((payload.additionalContext ?? []) as WorkRunContextItem[]),
      ];
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
          // The forked run row inherits the source's model; the request has to
          // carry it too, or the provider picks its own default for a
          // conversation that was already running on something else.
          model: sourceRun.model ?? undefined,
          mode: sourceRun.mode,
          extraInstructions: composeExtraInstructions(sourceRun.mode, sourceSpace?.systemPrompt),
          toolPolicy,
          configSnapshot,
          context:
            effectiveAdditionalContext.length > 0
              ? effectiveAdditionalContext
              : undefined,
          attachments: payload.attachments,
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
