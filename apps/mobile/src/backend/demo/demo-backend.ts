import { CHANNELS } from "@mains/contracts/channels";
import type {
  ArtifactImage,
  ContinueRunPayload,
  FileAttachment,
  ForkRunPayload,
  PendingApproval,
  ReadArtifactImagePayload,
  SkillSummary,
  SpaceModePayload,
  StartRunPayload,
  ToolApprovalResponse,
  UpdateRunSettingsPayload,
} from "@mains/contracts/runs";
import { WS_PROTOCOL_VERSION } from "@mains/contracts/ws-protocol";

import type { DemoHandler } from "./demo-socket";
import rawSnapshot from "./demo-snapshot.json";
import {
  demoScenarioForPrompt,
  type DemoScenario,
  type DemoToolSpec,
} from "./demo-scenarios";

/**
 * The demo Mac: everything a paired Mac answers over the wire, answered from
 * a sanitized snapshot exported by `scripts/export-demo-snapshot.mjs`.
 * Reads serve that snapshot; sends play a small curated local scenario so the
 * reviewer watches the real run UI without an agent or network connection.
 */

/** Rows travel as the wire DTOs with dates as ISO strings; `toDate` reads them. */
type Json = Record<string, unknown>;

interface DemoRun extends Json {
  id: string;
  providerId: string;
  mode: string;
  title: string | null;
  status: string;
  workspaceId: string | null;
  collectionId: string | null;
  createdAt: string;
  updatedAt: string;
}
interface DemoArtifact extends Json {
  id: number;
  runId: string;
  kind: string;
  content: string | null;
  path: string | null;
  metadata: Json | null;
  createdAt: string;
}
interface DemoToolCall extends Json {
  id: number;
  runId: string;
  toolName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}
interface DemoSnapshot {
  backend: { backendId: string; name: string; appVersion: string };
  account: Json;
  spaces: (Json & { id: string })[];
  collections: Json[];
  projects: Json[];
  providers: (Json & { id: string; config: Json })[];
  models: Record<string, Json[]>;
  skills: Record<string, Json[]>;
  commands: Record<string, Json[]>;
  workspaces: Json[];
  gitStates: Json[];
  diffSummaries: Record<string, Json | null>;
  runs: DemoRun[];
  turns: Record<string, (Json & { id: number })[]>;
  toolCalls: Record<string, (Json & { id: number; runId: string })[]>;
  artifacts: Record<string, DemoArtifact[]>;
  images: Record<string, ArtifactImage>;
}

const snapshot = rawSnapshot as unknown as DemoSnapshot;

/** Between replayed items — slow enough to watch, fast enough for a reviewer. */
const REPLAY_STEP_MS = 700;
/** Demo typing cadence; two word-like tokens per frame keeps the sample legible. */
const STREAM_STEP_MS = 32;
const STREAM_TOKENS_PER_STEP = 2;
/** An ignored approval answers itself, so the demo never wedges. */
const APPROVAL_AUTO_RESOLVE_MS = 15_000;
const RUN_LIST_DEFAULT = 50;

const now = () => new Date().toISOString();

export class DemoBackend implements DemoHandler {
  private readonly runs: DemoRun[] = snapshot.runs.map((run) => ({ ...run }));
  private readonly artifacts = new Map<string, DemoArtifact[]>(
    Object.entries(snapshot.artifacts).map(([runId, list]) => [runId, list.map((a) => ({ ...a }))]),
  );
  private readonly toolCalls = new Map<string, DemoToolCall[]>(
    Object.entries(snapshot.toolCalls).map(([runId, list]) => [
      runId,
      list.map((call) => ({ ...call })) as DemoToolCall[],
    ]),
  );
  private readonly turns = new Map<string, (Json & { id: number })[]>(
    Object.entries(snapshot.turns).map(([runId, list]) => [runId, list.map((t) => ({ ...t }))]),
  );
  private readonly spaces = snapshot.spaces.map((space) => ({ ...space }));
  private readonly providers = snapshot.providers.map((provider) => ({
    ...provider,
    config: { ...provider.config },
  }));
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly approvalContinuations = new Map<
    string,
    { runId: string; approve: () => void; deny: () => void }
  >();

  private emit: ((channel: string, payload: unknown) => void) | null = null;
  private readonly timersByRun = new Map<
    string,
    Set<ReturnType<typeof setTimeout>>
  >();
  private nextId = 1_000_000;
  private runCounter = 0;

  attach(emit: (channel: string, payload: unknown) => void): void {
    this.emit = emit;
  }

  detach(): void {
    this.emit = null;
  }

  private push(channel: string, payload: unknown): void {
    this.emit?.(channel, payload);
  }

  private later(runId: string, ms: number, fn: () => void): void {
    const timers = this.timersByRun.get(runId) ?? new Set();
    this.timersByRun.set(runId, timers);
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (timers.size === 0) this.timersByRun.delete(runId);
      fn();
    }, ms);
    timers.add(timer);
  }

  private clearTimers(runId: string): void {
    const timers = this.timersByRun.get(runId);
    if (!timers) return;
    for (const timer of timers) clearTimeout(timer);
    this.timersByRun.delete(runId);
  }

  // ── The wire ─────────────────────────────────────────────────────────────

  invoke(channel: string, args: unknown[]): unknown {
    switch (channel) {
      case CHANNELS.backend.describe:
        return {
          backendId: snapshot.backend.backendId,
          name: snapshot.backend.name,
          appVersion: snapshot.backend.appVersion,
          protocolVersion: WS_PROTOCOL_VERSION,
          capabilities: ["runs", "workspace", "providers", "space", "projects", "collections"],
          serverTime: now(),
        };
      case CHANNELS.account.get:
        return snapshot.account;
      case CHANNELS.space.getAll:
        return this.spaces;
      case CHANNELS.collections.list:
        return snapshot.collections;
      case CHANNELS.projects.list:
        return snapshot.projects;
      case CHANNELS.providers.getEnabled:
        return this.providers;
      case CHANNELS.providers.getModels:
        return snapshot.models[String(args[0])] ?? [];
      case CHANNELS.providers.getSkills:
        return snapshot.skills[String(args[0])] ?? [];
      case CHANNELS.providers.getCommands:
        return snapshot.commands[String(args[0])] ?? [];
      case CHANNELS.providers.updateRunSettings:
        return this.updateRunSettings(String(args[0]), (args[1] ?? {}) as UpdateRunSettingsPayload);
      case CHANNELS.workspace.list:
        return snapshot.workspaces;
      case CHANNELS.workspace.listGitStates:
        return snapshot.gitStates;
      case CHANNELS.workspace.getLatestDiffSummary:
        return snapshot.diffSummaries[String(args[0])] ?? null;
      case CHANNELS.runs.getAll: {
        const limit = typeof args[0] === "number" ? args[0] : RUN_LIST_DEFAULT;
        return [...this.runs]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, limit);
      }
      case CHANNELS.runs.getById:
        return this.runs.find((run) => run.id === args[0]) ?? null;
      case CHANNELS.runs.listPendingApprovals: {
        const runId = typeof args[0] === "string" ? args[0] : null;
        return [...this.approvals.values()].filter(
          (approval) => !runId || approval.runId === runId,
        );
      }
      case CHANNELS.runTurns.getByRun:
        return this.turns.get(String(args[0])) ?? [];
      case CHANNELS.runToolCalls.getByRun:
        return this.toolCalls.get(String(args[0])) ?? [];
      case CHANNELS.runArtifacts.getByRun: {
        const list = this.artifacts.get(String(args[0])) ?? [];
        const sinceId = typeof args[1] === "number" ? args[1] : null;
        return sinceId === null ? list : list.filter((artifact) => artifact.id > sinceId);
      }
      case CHANNELS.runArtifacts.readImage: {
        const { artifactId } = args[0] as ReadArtifactImagePayload;
        const image = snapshot.images[String(artifactId)];
        if (!image) throw new Error("Image file is missing");
        return image;
      }
      case CHANNELS.runs.execute:
        return this.execute(args[0] as StartRunPayload);
      case CHANNELS.runs.continue:
        return this.continueRun(args[0] as ContinueRunPayload);
      case CHANNELS.runs.fork:
        return this.fork(args[0] as ForkRunPayload);
      case CHANNELS.runs.abort:
        return this.abort(String(args[0]));
      case CHANNELS.runs.toolApprovalResponse:
        return this.respondToApproval(args[0] as ToolApprovalResponse);
      case CHANNELS.space.update:
        return this.updateSpace(String(args[0]), (args[1] ?? {}) as Partial<SpaceModePayload>);
      default:
        throw new Error(`The demo Mac does not answer "${channel}"`);
    }
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  private updateSpace(spaceId: string, patch: Partial<SpaceModePayload>): Json {
    const space = this.spaces.find((s) => s.id === spaceId);
    if (!space) throw new Error("Space not found");
    if (patch.mode) space.mode = patch.mode;
    return space;
  }

  /** The same key-per-provider mapping the desktop applies (`lib/models.ts` reads it back). */
  private updateRunSettings(providerId: string, patch: UpdateRunSettingsPayload): Json {
    const provider = this.providers.find((p) => p.id === providerId);
    if (!provider) throw new Error("Provider not found");
    const config = provider.config;
    const effortCoupled = providerId === "codex" || providerId === "cursor";
    if (patch.effortLevel !== undefined) {
      if (effortCoupled) config.modelReasoningEffort = patch.effortLevel;
      else if (patch.effortLevel === "ultracode") config.ultracode = true;
      else {
        config.ultracode = false;
        config.effortLevel = patch.effortLevel;
        config.thinkingMode = patch.effortLevel !== "";
      }
    }
    if (patch.permissionMode !== undefined) {
      const key = { claude_code: "permissionMode", copilot_cli: "permissionMode", codex: "sandboxMode", cursor: "mode" }[
        providerId
      ];
      if (key) config[key] = patch.permissionMode;
    }
    if (patch.fastMode !== undefined) {
      if (providerId === "codex") config.serviceTier = patch.fastMode ? "fast" : "standard";
      else config.fastMode = patch.fastMode;
    }
    if (patch.goalMode !== undefined) config.goalMode = patch.goalMode;
    if (patch.planMode !== undefined) config.planMode = patch.planMode;
    return provider;
  }

  // ── Runs: every send plays a bundled, prompt-matched scenario ────────────

  private execute(payload: StartRunPayload): { runId: string } {
    this.runCounter += 1;
    const runId = `demo-run-${Date.now()}-${this.runCounter}`;
    const space = this.spaces.find((s) => s.id === payload.spaceId);
    const run: DemoRun = {
      id: runId,
      accountId: "demo-account",
      workspaceId: payload.workspaceId ?? null,
      collectionId: payload.collectionId ?? null,
      spaceId: payload.spaceId,
      providerId: payload.providerId,
      mode: (space?.mode as string | undefined) ?? "chat",
      model: payload.model ?? null,
      title: null,
      goal: payload.goal,
      status: "running",
      startedAt: now(),
      endedAt: null,
      lastError: null,
      stopReason: null,
      isArchived: false,
      createdAt: now(),
      updatedAt: now(),
    };
    this.runs.push(run);
    this.artifacts.set(runId, []);
    this.toolCalls.set(runId, []);
    this.turns.set(runId, []);
    this.startReplay(
      run,
      payload.goal,
      payload.attachments,
      payload.contextSkills,
    );
    return { runId };
  }

  private continueRun(payload: ContinueRunPayload): { runId: string; resumed: boolean } {
    const run = this.runs.find((r) => r.id === payload.runId);
    if (!run) throw new Error("Run not found");
    run.status = "running";
    run.endedAt = null;
    run.updatedAt = now();
    this.startReplay(
      run,
      payload.message,
      payload.attachments,
      payload.contextSkills,
    );
    return { runId: run.id, resumed: true };
  }

  private fork(payload: ForkRunPayload): { runId: string; sourceRunId: string } {
    const source = this.runs.find((run) => run.id === payload.sourceRunId);
    const { runId } = this.execute({
      accountId: "demo-account",
      spaceId: String(source?.spaceId ?? this.spaces[0]?.id ?? ""),
      providerId: source?.providerId ?? "codex",
      goal: payload.message,
      ...(source?.workspaceId ? { workspaceId: source.workspaceId } : {}),
      ...(source?.collectionId ? { collectionId: source.collectionId } : {}),
    });
    return { runId, sourceRunId: payload.sourceRunId };
  }

  private abort(runId: string): void {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) return;
    this.clearTimers(runId);
    for (const approval of this.approvals.values()) {
      if (approval.runId !== runId) continue;
      this.approvals.delete(approval.requestId);
      this.approvalContinuations.delete(approval.requestId);
      this.push(CHANNELS.runs.toolApprovalResolved, {
        requestId: approval.requestId,
      });
    }
    run.status = "canceled";
    run.endedAt = now();
    run.updatedAt = now();
    this.push(CHANNELS.runs.statusChanged, { runId, status: "canceled", ts: Date.now() });
  }

  private respondToApproval(response: ToolApprovalResponse): void {
    const approval = this.approvals.get(response.requestId);
    const continuation = this.approvalContinuations.get(response.requestId);
    if (!approval || !continuation) return;
    this.approvals.delete(response.requestId);
    this.approvalContinuations.delete(response.requestId);
    this.push(CHANNELS.runs.toolApprovalResolved, { requestId: response.requestId });
    if (response.approved) continuation.approve();
    else continuation.deny();
  }

  /**
   * Play a curated scenario onto `run`. The reviewer's own prompt is always
   * the subject, and the transcript explicitly says that bundled sample data
   * is being used. Agent text takes the ephemeral stream path before its real
   * `eventPersisted` push, so the phone exercises both halves of a paired run.
   */
  private startReplay(
    run: DemoRun,
    prompt: string,
    attachments?: FileAttachment[],
    contextSkills?: SkillSummary[],
  ): void {
    const scenario = demoScenarioForPrompt(prompt);
    this.push(CHANNELS.runs.statusChanged, { runId: run.id, status: "running", ts: Date.now() });

    const files = (attachments ?? []).map((attachment) => ({
      path: `/Users/demo/Shared from iPhone/${safeFileName(attachment.name)}`,
    }));
    this.appendArtifact(run, "user-prompt", prompt, {
      source: "user",
      ...(contextSkills?.length ? { skills: contextSkills } : {}),
      ...(files.length ? { files } : {}),
    });

    this.later(run.id, REPLAY_STEP_MS, () => {
      if (run.status !== "running") return;
      if (!run.title) {
        run.title = scenario.title;
        run.updatedAt = now();
        this.push(CHANNELS.runs.updated, { runId: run.id, ts: Date.now() });
      }
      this.streamReport(run, scenario.intro(prompt), () => {
        this.playInspection(run, scenario, prompt, 0);
      });
    });
  }

  private playInspection(
    run: DemoRun,
    scenario: DemoScenario,
    prompt: string,
    index: number,
  ): void {
    this.later(run.id, REPLAY_STEP_MS, () => {
      if (run.status !== "running") return;
      const tool = scenario.inspectionTools[index];
      if (!tool) {
        this.askApproval(run, scenario, prompt);
        return;
      }
      this.appendToolCall(run, tool);
      this.playInspection(run, scenario, prompt, index + 1);
    });
  }

  /** One approval per scenario, with genuinely different approve/deny branches. */
  private askApproval(
    run: DemoRun,
    scenario: DemoScenario,
    prompt: string,
  ): void {
    const requestId = `demo-approval-${Date.now()}-${this.nextId++}`;
    const approval: PendingApproval = {
      requestId,
      runId: run.id,
      toolName: "Bash",
      toolInput: { command: scenario.approval.command },
      kind: "tool_approval",
      header: scenario.approval.header,
      question: scenario.approval.question,
      timestamp: Date.now(),
      expiresAt: Date.now() + APPROVAL_AUTO_RESOLVE_MS,
    };
    this.approvals.set(requestId, approval);
    this.approvalContinuations.set(requestId, {
      runId: run.id,
      approve: () => {
        if (run.status !== "running") return;
        this.appendToolCall(run, {
          toolName: "Bash",
          input: {
            command: scenario.approval.command,
            description: "Validate the sample mobile workspace",
          },
          output: scenario.approval.output,
        });
        this.finishAfterReport(run, scenario.approvedResult(prompt));
      },
      deny: () => {
        if (run.status !== "running") return;
        this.finishAfterReport(run, scenario.deniedResult(prompt));
      },
    });
    this.push(CHANNELS.runs.toolApprovalRequest, approval);
    this.later(run.id, APPROVAL_AUTO_RESOLVE_MS, () => {
      if (!this.approvals.has(requestId)) return;
      this.respondToApproval({ requestId, approved: true });
    });
  }

  private appendArtifact(
    run: DemoRun,
    kind: string,
    content: string,
    metadata: Json = { source: "assistant.message", isFromSubagent: false },
  ): void {
    const list = this.artifacts.get(run.id) ?? [];
    this.artifacts.set(run.id, list);
    list.push({
      id: this.nextId++,
      runId: run.id,
      kind,
      content,
      path: null,
      metadata,
      createdAt: now(),
    });
    run.updatedAt = now();
    this.push(CHANNELS.runs.eventPersisted, { runId: run.id, ts: Date.now() });
  }

  /** Exercise the same transient WebSocket path as a paired Mac before persisting. */
  private streamReport(run: DemoRun, content: string, onComplete: () => void): void {
    const tokens = content.match(/\S+\s*/g) ?? [content];
    const streamId = `demo-msg-${run.id}-${this.nextId++}`;
    let count = 0;
    const step = () => {
      if (run.status !== "running") return;
      count = Math.min(tokens.length, count + STREAM_TOKENS_PER_STEP);
      this.push(CHANNELS.runs.ephemeralEvent, {
        runId: run.id,
        event: {
          type: "artifact",
          kind: "report",
          content: tokens.slice(0, count).join(""),
          metadata: { source: "agent_message_streaming" },
          streamId,
        },
        ts: Date.now(),
      });
      if (count < tokens.length) {
        this.later(run.id, STREAM_STEP_MS, step);
        return;
      }
      this.appendArtifact(run, "report", content);
      onComplete();
    };
    step();
  }

  private appendToolCall(run: DemoRun, tool: DemoToolSpec): void {
    const calls = this.toolCalls.get(run.id) ?? [];
    this.toolCalls.set(run.id, calls);
    const timestamp = now();
    calls.push({
      id: this.nextId++,
      runId: run.id,
      toolName: tool.toolName,
      status: "done",
      input: tool.input,
      output: tool.output,
      error: null,
      startedAt: timestamp,
      endedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    run.updatedAt = timestamp;
    this.push(CHANNELS.runs.eventPersisted, { runId: run.id, ts: Date.now() });
  }

  private finishAfterReport(run: DemoRun, report: string): void {
    this.later(run.id, REPLAY_STEP_MS, () => {
      if (run.status !== "running") return;
      this.streamReport(run, report, () => {
        this.later(run.id, REPLAY_STEP_MS, () => this.finishRun(run));
      });
    });
  }

  private finishRun(run: DemoRun): void {
    if (run.status !== "running") return;
    run.status = "succeeded";
    run.endedAt = now();
    run.updatedAt = now();
    this.clearTimers(run.id);
    this.push(CHANNELS.runs.statusChanged, {
      runId: run.id,
      status: "succeeded",
      ts: Date.now(),
    });
  }
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/\0]/g, "-").trim();
  return cleaned || "attachment";
}
