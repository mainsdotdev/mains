import { and, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";

import { useSession } from "@/backend/backend-session";
import { db } from "@/db/client";
import { runs } from "@/db/schema";

/** A run's title as the Mac has it so far — null until one has been generated. */
export function useRunTitle(runId: string): string | null {
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const query = useLiveQuery(
    db
      .select({ title: runs.title })
      .from(runs)
      .where(and(eq(runs.backendId, backendId), eq(runs.id, runId)))
      .limit(1),
    [backendId, runId],
  );
  return query.data[0]?.title?.trim() || null;
}
