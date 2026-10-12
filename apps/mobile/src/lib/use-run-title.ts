import { and, eq } from "drizzle-orm";
import { useCoalescedLiveQuery } from "@/db/use-coalesced-live-query";

import { useSession } from "@/backend/backend-session";
import { db } from "@/db/client";
import { runs } from "@/db/schema";

/** A run's title as the Mac has it so far — null until one has been generated. */
export function useRunTitle(runId: string): string | null {
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const query = useCoalescedLiveQuery(
    db
      .select({ title: runs.title })
      .from(runs)
      .where(and(eq(runs.backendId, backendId), eq(runs.id, runId)))
      .limit(1),
    runs,
    [backendId, runId],
  );
  return query.data[0]?.title?.trim() || null;
}
