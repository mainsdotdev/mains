// ─────────────────────────────────────────────────────────────
// Run Writeback - Persists WorkRunEvents into the database
// ─────────────────────────────────────────────────────────────

import { RunArtifactKind, runsService } from "../../modules/runs";
import { toolsService } from "../../modules/tools";
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
}

/**
 * Creates a writeback handler that persists WorkRunEvents to the database.
 * Maintains an in-memory Map for tool call correlation.
 *
 * Correlation order on tool_call end:
 *  (1) DB lookup by (runId + toolCallId) when toolCallId exists
 *  (2) in-memory Map (pendingToolCalls)
 *  (3) DB lookup of open row by (runId + toolName)
 */
export function createRunWriteback(config: RunWritebackConfig): RunWriteback {
  const { accountId, providerId, runId } = config;

  // Map<toolCallKey, dbRowId> for correlating tool_call start/end events
  const pendingToolCalls = new Map<string, number>();

  function extractToolCallIds(meta?: Record<string, unknown> | null): {
    toolCallId: string | null;
    parentToolCallId: string | null;
  } {
    if (!meta) return { toolCallId: null, parentToolCallId: null };

    const toolCallId =
      (typeof meta.toolCallId === "string" && meta.toolCallId) ||
      (typeof (meta as any).tool_call_id === "string" &&
        (meta as any).tool_call_id) ||
      (typeof meta.id === "string" && meta.id) ||
      null;

    const parentToolCallId =
      (typeof (meta as any).parentToolCallId === "string" &&
        (meta as any).parentToolCallId) ||
      (typeof (meta as any).parent_tool_call_id === "string" &&
        (meta as any).parent_tool_call_id) ||
      null;

    return { toolCallId, parentToolCallId };
  }

  /**
   * Generate a stable key for tool call correlation.
   * Prefers provider's toolCallId, falls back to composite key.
   */
  function getToolCallKey(event: WorkRunEvent & { type: "tool_call" }): string {
    const meta =
      (event.metadata as Record<string, unknown> | undefined) ?? undefined;
    const { toolCallId } = extractToolCallIds(meta);

    if (toolCallId) return toolCallId;

    // Fallback: composite key using runId:toolName:startedAt
    const startedAt = event.startedAt ?? Date.now();
    return `${runId}:${event.toolName}:${startedAt}`;
  }

  /**
   * Find a pending tool call key by toolName when exact key match fails.
   */
  function findPendingToolCallByName(toolName: string): string | undefined {
    for (const key of pendingToolCalls.keys()) {
      if (key.includes(`:${toolName}:`) || key === toolName) return key;
    }
    return undefined;
  }

  async function handleEvent(event: WorkRunEvent): Promise<void> {
    try {
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
          break;
        }

        case "tool_call": {
          const meta =
            (event.metadata as Record<string, unknown> | undefined) ??
            undefined;
          const phase = (meta?.phase as string | undefined) ?? undefined;
          const { toolCallId, parentToolCallId } = extractToolCallIds(meta);

          if (phase === "start") {
            const createdId = await toolsService.createToolCall({
              accountId,
              runId,
              providerId,
              toolName: event.toolName,
              toolCallId,
              parentToolCallId,
              status: "running",
              input: event.input,
            });

            const key = getToolCallKey(event);
            pendingToolCalls.set(key, createdId);

            await toolsService.updateToolCall(createdId, {
              startedAt: event.startedAt
                ? new Date(event.startedAt)
                : new Date(),
              metadata: meta,
            });
            break;
          }

          if (phase === "end" || phase === "complete") {
            let dbRowId: number | null = null;

            if (toolCallId) {
              dbRowId = await toolsService.findToolCallRowId(
                runId,
                toolCallId,
              );
            }

            if (!dbRowId) {
              const key = getToolCallKey(event);
              const mapped = pendingToolCalls.get(key);
              if (mapped) {
                dbRowId = mapped;
                pendingToolCalls.delete(key);
              } else {
                const fallbackKey = findPendingToolCallByName(event.toolName);
                if (fallbackKey) {
                  const mapped2 = pendingToolCalls.get(fallbackKey);
                  if (mapped2) {
                    dbRowId = mapped2;
                    pendingToolCalls.delete(fallbackKey);
                  }
                }
              }
            }

            if (!dbRowId) {
              dbRowId = await toolsService.findOpenToolCallRowId(
                runId,
                event.toolName,
              );
            }

            const latencyMs =
              event.startedAt && event.endedAt
                ? event.endedAt - event.startedAt
                : undefined;

            if (dbRowId) {
              await toolsService.updateToolCall(dbRowId, {
                status: event.error ? "error" : "done",
                output: (event.output ?? undefined) as
                  | Record<string, unknown>
                  | undefined,
                error: event.error,
                endedAt: event.endedAt ? new Date(event.endedAt) : new Date(),
                latencyMs,
                metadata: meta, // ✅ burada yaz
              });
            } else {
              const createdId = await toolsService.createToolCall({
                accountId,
                runId,
                providerId,
                toolName: event.toolName,
                toolCallId,
                parentToolCallId,
                status: event.error ? "error" : "done",
                input: event.input,
              });

              await toolsService.updateToolCall(createdId, {
                output: (event.output ?? undefined) as
                  | Record<string, unknown>
                  | undefined,
                error: event.error,
                startedAt: event.startedAt
                  ? new Date(event.startedAt)
                  : undefined,
                endedAt: event.endedAt ? new Date(event.endedAt) : new Date(),
                latencyMs,
                metadata: meta,
              });
            }

            break;
          }

          // No phase specified → complete record
          const createdId = await toolsService.createToolCall({
            accountId,
            runId,
            providerId,
            toolName: event.toolName,
            toolCallId,
            parentToolCallId,
            status: event.error ? "error" : "done",
            input: event.input,
          });

          await toolsService.updateToolCall(createdId, {
            output: (event.output ?? undefined) as
              | Record<string, unknown>
              | undefined,
            error: event.error,
            startedAt: event.startedAt
              ? new Date(event.startedAt)
              : undefined,
            endedAt: event.endedAt ? new Date(event.endedAt) : new Date(),
            metadata: meta,
          });

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
    } catch (error) {
      console.error(
        `[RunWriteback] Error handling ${event.type} event for run ${runId}:`,
        error,
      );
    }
  }

  return {
    handleEvent,
    getPendingToolCallCount: () => pendingToolCalls.size,
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").substring(0, 16);
}
