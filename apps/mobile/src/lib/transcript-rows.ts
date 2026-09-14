import type { TranscriptItem } from "./transcript";

/**
 * How a turn's items collapse into rows — the phone's port of the desktop's
 * `buildTurnRenderRows` (`features/workspace/lib/transcript-rows.ts`).
 *
 * The rule, unchanged: a user prompt is its own row; everything up to the next
 * prompt is one agent turn; that turn is cut into *segments*, each starting at
 * an assistant message and running until the next one. One segment stays flat.
 * Two or more, and every segment but the last folds behind a single
 * "2 messages · 6 tool calls" line — the run's answer is what you land on, and
 * the work that produced it is one tap away.
 *
 * Two of the desktop's carve-outs have no counterpart here and are not ported:
 * its plan groups break out of the fold so Apply / Dismiss stay reachable (the
 * phone answers plans through the pending-approval card in the footer, which is
 * outside the transcript entirely), and its media groups break out so generated
 * images aren't hidden (blobs never sync to the phone). What *does* break out is
 * the phone's own equivalent: `note` items, which carry run errors — an error
 * folded behind an accordion is an error nobody reads.
 */

export type TurnRow =
  | { key: string; kind: "flat"; items: TranscriptItem[] }
  | {
      key: string;
      kind: "accordion";
      /** Everything before the final segment — what the header collapses. */
      previous: TranscriptItem[];
      /**
       * Pulled out of `previous` and always shown: notes, which carry errors,
       * and images — the desktop's media break-out, so a picture the agent
       * made is never behind a fold.
       */
      breakout: TranscriptItem[];
      /** The last segment: the turn's closing message and its trailing work. */
      last: TranscriptItem[];
      /** Counts for the header, over `previous` only. */
      messageCount: number;
      toolSummary: string;
    };

interface Range {
  start: number;
  end: number;
}

function expand(items: TranscriptItem[], range: Range): TranscriptItem[] {
  return items.slice(range.start, range.end + 1);
}

/**
 * Within one agent turn: an optional non-response prefix, then segments each
 * beginning at a response and running until the next one (tool blocks and notes
 * stay attached to the message they followed).
 */
function partitionAgentTurn(
  items: TranscriptItem[],
  turnStart: number,
  turnEnd: number,
): { prefix: Range[]; segments: Range[] } {
  const prefix: Range[] = [];
  const segments: Range[] = [];
  let i = turnStart;

  while (i <= turnEnd) {
    if (items[i].kind !== "response") {
      const start = i;
      while (i <= turnEnd && items[i].kind !== "response") i++;
      prefix.push({ start, end: i - 1 });
      continue;
    }
    const start = i;
    let end = i;
    i++;
    while (i <= turnEnd && items[i].kind !== "response") {
      end = i;
      i++;
    }
    segments.push({ start, end });
  }

  return { prefix, segments };
}

function countToolCalls(items: TranscriptItem[]): number {
  let n = 0;
  for (const item of items) {
    if (item.kind === "tools") n += item.calls.length;
  }
  return n;
}

function toolSummaryLabel(total: number): string {
  if (total <= 0) return "";
  return total === 1 ? "1 tool call" : `${total} tool calls`;
}

/** The header's own words — the desktop's, verbatim. */
export function accordionLabel(messageCount: number, toolSummary: string): string {
  const messageLabel =
    messageCount === 0 ? "" : messageCount === 1 ? "1 message" : `${messageCount} messages`;
  const parts = [messageLabel, toolSummary].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "tool calls";
}

export function buildTurnRows(items: TranscriptItem[]): TurnRow[] {
  const rows: TurnRow[] = [];
  let idx = 0;

  while (idx < items.length) {
    if (items[idx].kind === "prompt") {
      rows.push({ key: `flat-${items[idx].key}`, kind: "flat", items: [items[idx]] });
      idx++;
      continue;
    }

    const turnStart = idx;
    while (idx < items.length && items[idx].kind !== "prompt") idx++;
    const turnEnd = idx - 1;
    if (turnStart > turnEnd) continue;

    const { prefix, segments } = partitionAgentTurn(items, turnStart, turnEnd);
    const prefixItems = prefix.flatMap((r) => expand(items, r));

    // No assistant message in this turn — nothing to fold behind.
    if (segments.length === 0) {
      for (const range of prefix) {
        const chunk = expand(items, range);
        rows.push({ key: `flat-${chunk[0].key}`, kind: "flat", items: chunk });
      }
      continue;
    }

    if (segments.length === 1) {
      const only = [...prefixItems, ...expand(items, segments[0])];
      rows.push({ key: `flat-${only[0].key}`, kind: "flat", items: only });
      continue;
    }

    // Tool work that ran before the first reply was emitted as its own prefix
    // chunk; fold it into what the accordion collapses.
    const previousAll = [
      ...prefixItems,
      ...segments.slice(0, -1).flatMap((r) => expand(items, r)),
    ];
    const last = expand(items, segments[segments.length - 1]);

    const breakout = previousAll.filter(
      (item) => item.kind === "note" || item.kind === "images" || item.kind === "subagents",
    );
    const previous = previousAll.filter(
      (item) => item.kind !== "note" && item.kind !== "images" && item.kind !== "subagents",
    );

    // Everything before the last segment was a note — there is nothing left to
    // collapse, so the turn is flat after all.
    if (previous.length === 0) {
      const flat = [...breakout, ...last];
      rows.push({ key: `flat-${flat[0].key}`, kind: "flat", items: flat });
      continue;
    }

    rows.push({
      key: `acc-${previous[0].key}`,
      kind: "accordion",
      previous,
      breakout,
      last,
      messageCount: previous.filter((item) => item.kind === "response").length,
      toolSummary: toolSummaryLabel(countToolCalls(previous)),
    });
  }

  return rows;
}
