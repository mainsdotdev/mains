import type { WorkRunEvent } from "../../../shared/adapter.types";
import { runsRepo } from "./runs.repo";
import type { RunArtifactKind } from "./runs.dto";
import { createHash } from "node:crypto";

const pendingInputs = new Map<string, Promise<boolean>>();

/** ACK, echo and uncertain-delivery recovery share one existing artifact row. */
export async function insertRunInputArtifact(
  runId: string,
  event: Extract<WorkRunEvent, { type: "artifact" }>,
): Promise<boolean> {
  const id = event.kind === "user-prompt" && typeof event.metadata?.clientUserMessageId === "string"
    ? event.metadata.clientUserMessageId
    : undefined;
  const key = id ? JSON.stringify([runId, id]) : undefined;
  if (key && pendingInputs.has(key)) {
    await pendingInputs.get(key);
    return false;
  }
  const insert = (async () => {
    if (id && (await runsRepo.findArtifactsByRun(runId)).some((artifact) => artifact.metadata?.clientUserMessageId === id)) {
      return false;
    }
    await runsRepo.insertArtifact({
      runId,
      kind: event.kind as RunArtifactKind,
      path: event.path,
      content: event.content,
      metadata: event.metadata,
      contentHash: event.content ? createHash("sha256").update(event.content).digest("hex") : undefined,
    });
    return true;
  })();
  if (key) pendingInputs.set(key, insert);
  try {
    return await insert;
  } finally {
    if (key) pendingInputs.delete(key);
  }
}
