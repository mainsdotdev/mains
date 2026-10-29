import { and, eq, inArray } from "drizzle-orm";
import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";

import { backendSession, useSession } from "@/backend/backend-session";
import { db } from "@/db/client";
import { runArtifacts, runOutputs, runs } from "@/db/schema";
import { useCoalescedLiveQuery } from "@/db/use-coalesced-live-query";
import { hasRunOutputs } from "../lib/output-presence";

/** Both conversation toolbars follow actual outputs, never prompt attachments. */
export function useRunHasOutputs(runId: string): boolean {
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const connected = session.connection.kind === "connected";
  const focused = useIsFocused();
  const scope = JSON.stringify([backendId, runId]);
  const run = useCoalescedLiveQuery(db.select({ backendId: runs.backendId, runId: runs.id, status: runs.status }).from(runs)
    .where(and(eq(runs.backendId, backendId), eq(runs.id, runId))).limit(1), runs, [backendId, runId]);
  const cached = useCoalescedLiveQuery(db.select({ backendId: runOutputs.backendId, runId: runOutputs.runId }).from(runOutputs)
    .where(and(eq(runOutputs.backendId, backendId), eq(runOutputs.runId, runId))).limit(1), runOutputs, [backendId, runId]);
  const delivered = useCoalescedLiveQuery(db.select({ backendId: runArtifacts.backendId, runId: runArtifacts.runId, id: runArtifacts.id }).from(runArtifacts)
    .where(and(eq(runArtifacts.backendId, backendId), eq(runArtifacts.runId, runId), inArray(runArtifacts.kind, ["document", "file", "image", "visualization"])))
    .orderBy(runArtifacts.id), runArtifacts, [backendId, runId]);
  const outputRevision = delivered.data.filter((row) => row.backendId === backendId && row.runId === runId).map((row) => row.id).join(",");
  const status = run.data[0]?.backendId === backendId && run.data[0]?.runId === runId ? run.data[0].status : undefined;
  const cachedHasOutputs = cached.data.some((row) => row.backendId === backendId && row.runId === runId);
  const [answer, setAnswer] = useState<{ scope: string; hasOutputs: boolean } | null>(null);

  // A completed turn can select new files. Recheck on delivery/status/focus/reconnect,
  // never on streaming updates; only descriptors are read, with no file bytes.
  useEffect(() => {
    if (!focused || !connected || !backendId || !runId || !status) return;
    let active = true;
    const current = () => active && backendSession.getSnapshot().backend?.backendId === backendId;
    void hasRunOutputs((offset) => {
      if (!current()) return Promise.reject(new Error("The connected computer changed"));
      return backendSession.listRunOutputs({ runId, offset });
    }, current).then((hasOutputs) => {
      if (current()) setAnswer({ scope, hasOutputs });
    }).catch(() => { /* Retain known output metadata when offline or on an older backend. */ });
    return () => { active = false; };
  }, [backendId, connected, focused, outputRevision, runId, scope, status]);

  if (!backendId || !runId || !status) return false;
  return answer?.scope === scope ? answer.hasOutputs : cachedHasOutputs;
}
