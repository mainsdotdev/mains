// ─────────────────────────────────────────────────────────────
// Run Writeback - Persists WorkRunEvents into the database
// ─────────────────────────────────────────────────────────────

import { RunArtifactKind, createReportProjection, createToolCallProjection, runsService } from "../../modules/runs";
import type { WorkRunEvent } from "../../modules/providers/adapters";
import { createHash } from "crypto";

export interface RunWritebackConfig {
  accountId: string;
  providerId: string;
  runId: string;
}

export interface RunWriteback {
  handleEvent: (event: WorkRunEvent) => Promise<void>;
  getPendingToolCallCount: () => number;
  finish(status: "succeeded" | "failed" | "canceled"): Promise<void>;
}

/** Legacy dispatcher adapter; correlation and transition rules belong to runs. */
export function createRunWriteback(config: RunWritebackConfig): RunWriteback {
  const { providerId, runId } = config;
  const tools = createToolCallProjection({ ...config, recordOrphans: true });
  const reports = createReportProjection();
  let accepting = true;
  let tail = Promise.resolve();
  let finishing: Promise<void> | undefined;

  async function persist(event: WorkRunEvent): Promise<void> {
    switch (event.type) {
      case "log": {
        await runsService.addArtifact({
          runId,
          kind: "log",
          content: event.message,
          metadata: {
            level: event.level ?? "info",
            ts: event.ts ?? Date.now(),
            providerId,
          },
        });
        break;
      }

      case "artifact": {
        if (reports.completed(event)) break;
        const contentHash = event.content
          ? hashContent(event.content)
          : undefined;
        await runsService.addArtifact({
          runId,
          kind: event.kind as RunArtifactKind,
          path: event.path,
          content: event.content,
          contentHash,
          metadata: event.metadata,
        });
        reports.commit(event);
        break;
      }

      case "tool_call": {
        await tools.project(event);
        break;
      }
      case "task":
      case "subagent": {
        await tools.projectLifecycle(event);
        break;
      }
      case "status": {
        // Status changes are logged but run status is managed by dispatcher
        console.log(
          `[RunWriteback] Run ${runId} status event: ${event.status}`,
        );
        break;
      }
    }
  }

  function handleEvent(event: WorkRunEvent): Promise<void> {
    if (!accepting) return Promise.resolve();
    if (event.type === "artifact" && event.ephemeral) {
      reports.stream(event, null);
      return Promise.resolve();
    }
    if (event.type === "artifact") event = reports.prepare(event);
    const result = tail.then(() => persist(event)).catch((error) => {
      console.error(
        `[RunWriteback] Error handling ${event.type} event for run ${runId}:`,
        error,
      );
    });
    tail = result;
    return result;
  }

  return {
    handleEvent,
    getPendingToolCallCount: tools.pendingCount,
    finish(status) {
      if (finishing) return finishing;
      accepting = false;
      finishing = tail.then(async () => {
        let failure: unknown;
        for (const report of reports.pending()) {
          try {
            await persist(reports.prepare({ ...report, ephemeral: false, metadata: {
              ...report.metadata, streaming: false, interrupted: status !== "succeeded",
            } }));
          } catch (error) { failure ??= error; }
        }
        await tools.settle(status);
        if (failure) throw failure;
      });
      return finishing;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").substring(0, 16);
}
