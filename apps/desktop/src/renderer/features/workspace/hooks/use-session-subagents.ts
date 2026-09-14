import { useMemo } from "react";
import { useGetToolCallsByRunQuery } from "@/lib/redux/api";
import {
  selectSessionSubagents,
  type SessionSubagent,
} from "../lib/select-subagents";
import { useRunEventRefetch } from "./use-run-event-refetch";

/**
 * THE owner of "which subagents does this run have" — the subagent panel and
 * the app shell both derive from this one query subscription + selector, so
 * layout (content inset) and the box itself can never disagree.
 */
export function useSessionSubagents(runId: string | null): SessionSubagent[] {
  const { data: toolCalls, refetch } = useGetToolCallsByRunQuery(runId!, {
    skip: !runId,
    refetchOnMountOrArgChange: true,
  });
  // A live run patches subagent metadata onto tool calls continuously —
  // refresh off the persisted-event signal instead of polling.
  useRunEventRefetch(runId, refetch);
  return useMemo(() => selectSessionSubagents(toolCalls ?? []), [toolCalls]);
}

/**
 * Boolean-only subscription for the app shell's layout math. `selectFromResult`
 * narrows the subscription to the answer itself, so the shell re-renders when
 * the answer FLIPS — not on every subagent tool-call update mid-run.
 */
export function useHasSessionSubagents(runId: string | null): boolean {
  const { hasSubagents } = useGetToolCallsByRunQuery(runId!, {
    skip: !runId,
    selectFromResult: ({ data }) => ({
      hasSubagents: selectSessionSubagents(data ?? []).length > 0,
    }),
  });
  return hasSubagents;
}
