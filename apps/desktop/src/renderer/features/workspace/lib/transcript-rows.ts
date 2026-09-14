// ─────────────────────────────────────────────────────────────
// Transcript row + session-bar planning
//
// Pure (React-free) layout logic for the run transcript, extracted from
// workspace-events.tsx so it is testable through its interface rather than
// only by rendering. Two public functions:
//
//   • buildTurnRenderRows(groups) → how grouped events collapse into flat rows
//     and accordions (plan/media break out of the collapsed bucket).
//   • matchTurnsToGroups(groups, turns, …) → which group index each session
//     time bar attaches to.
//
// Everything else here is an internal seam (used by the module + its tests).
// ─────────────────────────────────────────────────────────────

// Import from the pure source module, not the `tool-call-group.tsx` back-compat
// re-export — going through the component would pull the whole React/UI tree
// (and its browser-global-touching deps) into this React-free module.
import { isPlanToolCallGroup, type EventGroup } from "./group-events";
import type { RunTurn } from "@/lib/redux/api";

export interface SessionInfo {
  elapsed: number;
  responseContent: string;
  turn?: RunTurn;
}

/** Join `content` from every `response` group in [fromIdx, toIdx] (inclusive, clamped). */
function collectResponseContent(
  groups: EventGroup[],
  fromIdx: number,
  toIdx: number,
): string {
  const parts: string[] = [];
  const end = Math.min(toIdx, groups.length - 1);
  for (let j = fromIdx; j <= end; j++) {
    if (groups[j]?.type === "response") {
      for (const event of groups[j].events) {
        if (event.content) parts.push(event.content);
      }
    }
  }
  return parts.join("\n\n");
}

/**
 * Match backend turns to event group indices.
 * For each completed turn, find the last event group whose endTime falls
 * within that turn's time range, or the closest group before the next turn.
 */
export function matchTurnsToGroups(
  groups: EventGroup[],
  turns: RunTurn[],
  runStartedAt?: Date,
  isRunCompleted?: boolean,
): Map<number, SessionInfo> {
  const result = new Map<number, SessionInfo>();

  if (turns.length === 0) {
    // Fallback: no turns from backend yet — compute from events like before
    return computeSessionTimesFromEvents(groups, runStartedAt, isRunCompleted);
  }

  // For each turn, find the group range and place the session bar
  let lastGroupIdx = 0;
  for (const turn of turns) {
    if (turn.status !== "completed" || !turn.elapsedMs || turn.elapsedMs <= 0) continue;

    // Find the best group index for this turn's end time
    const turnEndMs = turn.endedAt
      ? new Date(turn.endedAt).getTime()
      : null;

    let bestIdx = lastGroupIdx;
    if (turnEndMs) {
      // Timestamps from DB are in epoch seconds, but Date constructor handles both
      const endMs = turnEndMs < 1e12 ? turnEndMs * 1000 : turnEndMs;
      for (let i = lastGroupIdx; i < groups.length; i++) {
        const groupEndMs = new Date(groups[i].endTime).getTime();
        if (groupEndMs <= endMs) {
          bestIdx = i;
        } else {
          break;
        }
      }
    } else {
      // No endedAt — find next user-prompt or use last group
      for (let i = lastGroupIdx + 1; i < groups.length; i++) {
        const isUserPrompt =
          groups[i].type === "info" &&
          groups[i].events[0]?.metadata?.kind === "user-prompt";
        if (isUserPrompt) {
          bestIdx = i - 1;
          break;
        }
        bestIdx = i;
      }
    }

    // Skip if this group is a user-prompt itself
    const groupAtBest = groups[bestIdx];
    if (groupAtBest?.type === "info" && groupAtBest.events[0]?.metadata?.kind === "user-prompt") {
      if (bestIdx > 0) bestIdx--;
    }

    result.set(bestIdx, {
      elapsed: turn.elapsedMs,
      responseContent:
        turn.responseContent || collectResponseContent(groups, lastGroupIdx, bestIdx),
      turn,
    });

    lastGroupIdx = bestIdx + 1;
  }

  return result;
}

/**
 * Fallback: compute session times from events (for runs that don't have turns yet).
 */
function computeSessionTimesFromEvents(
  groups: EventGroup[],
  runStartedAt?: Date,
  isRunCompleted?: boolean,
): Map<number, SessionInfo> {
  const result = new Map<number, SessionInfo>();
  let turnStartMs: number | null = runStartedAt
    ? new Date(runStartedAt).getTime()
    : null;
  let turnStartIdx = 0;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const isUserPrompt =
      group.type === "info" &&
      group.events[0]?.metadata?.kind === "user-prompt";
    const isStatus =
      group.type === "info" && group.events[0]?.type === "status";

    if (isUserPrompt && turnStartMs !== null && i > 0) {
      const prevGroup = groups[i - 1];
      const prevIsPromptOrStatus =
        prevGroup.type === "info" &&
        (prevGroup.events[0]?.metadata?.kind === "user-prompt" ||
          prevGroup.events[0]?.type === "status");
      if (!prevIsPromptOrStatus) {
        const elapsed =
          new Date(prevGroup.endTime).getTime() - turnStartMs;
        if (elapsed > 0) {
          result.set(i - 1, {
            elapsed,
            responseContent: collectResponseContent(groups, turnStartIdx, i - 1),
          });
        }
      }
    }

    if (isUserPrompt || isStatus) {
      turnStartMs = new Date(group.startTime).getTime();
      turnStartIdx = i;
    }
  }

  if (isRunCompleted && turnStartMs !== null && groups.length > 0) {
    const lastIdx = groups.length - 1;
    const lastGroup = groups[lastIdx];
    const lastIsPromptOrStatus =
      lastGroup.type === "info" &&
      (lastGroup.events[0]?.metadata?.kind === "user-prompt" ||
        lastGroup.events[0]?.type === "status");
    if (!lastIsPromptOrStatus) {
      const elapsed = new Date(lastGroup.endTime).getTime() - turnStartMs;
      if (elapsed > 0) {
        result.set(lastIdx, {
          elapsed,
          responseContent: collectResponseContent(groups, turnStartIdx, lastIdx),
        });
      }
    }
  }

  return result;
}

export function isUserPromptGroup(g: EventGroup): boolean {
  return g.type === "info" && g.events[0]?.metadata?.kind === "user-prompt";
}

function expandIndexRange(r: { start: number; end: number }): number[] {
  const out: number[] = [];
  for (let i = r.start; i <= r.end; i++) out.push(i);
  return out;
}

/** Total tool_call events in grouped UI ranges (collapsed accordion preview). */
function countToolCallsInRanges(groups: EventGroup[], ranges: number[][]): number {
  let n = 0;
  for (const range of ranges) {
    for (const i of range) {
      const g = groups[i];
      if (g?.type !== "tool_calls") continue;
      for (const ev of g.events) {
        if (ev.type === "tool_call") n++;
      }
    }
  }
  return n;
}

function formatAccordionToolSummary(total: number): string {
  if (total <= 0) return "";
  return total === 1 ? "1 tool call" : `${total} tool calls`;
}

/**
 * Within one agent turn (content after a user message until the next user message),
 * split into: optional non-response prefix chunks, then segments each starting with a response
 * artifact and running until the next response (tools, status, suggestions, etc. stay attached).
 */
function partitionAgentTurn(
  groups: EventGroup[],
  turnStart: number,
  turnEnd: number,
): { prefix: Array<{ start: number; end: number }>; segments: Array<{ start: number; end: number }> } {
  const prefix: Array<{ start: number; end: number }> = [];
  const segments: Array<{ start: number; end: number }> = [];
  let i = turnStart;
  while (i <= turnEnd) {
    if (groups[i].type !== "response") {
      const pStart = i;
      while (i <= turnEnd && groups[i].type !== "response") i++;
      prefix.push({ start: pStart, end: i - 1 });
      continue;
    }
    const segStart = i;
    let segEnd = i;
    i++;
    while (i <= turnEnd && groups[i].type !== "response") {
      segEnd = i;
      i++;
    }
    segments.push({ start: segStart, end: segEnd });
  }
  return { prefix, segments };
}

export type TurnRenderRow =
  | { kind: "flat"; indices: number[] }
  | {
      kind: "accordion";
      previousSegments: number[][];
      /** Plan tool groups — pulled out of `previousSegments` so they stay outside the collapsed bucket. */
      planBreakoutIndices: number[];
      /**
       * Groups whose output is the turn's deliverable — generated media, plus
       * file writes in modes that say so. Kept visible rather than folded into
       * the collapsed bucket.
       */
      messageBreakoutIndices: number[];
      lastSegment: number[];
      previousMessageCount: number;
      previousToolSummary: string;
    };

function groupHasMediaArtifact(g: EventGroup): boolean {
  return g.events.some(
    (e) =>
      e.type === "artifact" &&
      (
        e.metadata?.kind === "image" ||
        e.metadata?.kind === "image_generation" ||
        e.metadata?.kind === "document"
      ),
  );
}

/** Linear plan: every group index appears exactly once, in order. */
export interface TurnRenderOptions {
  /**
   * Extra groups to keep out of the collapsed bucket, beyond plans and media.
   *
   * Injected rather than decided here: what counts as a deliverable is a
   * question about tool vocabulary and the active mode, and this module is the
   * layout plan — React-free, and deliberately ignorant of both.
   */
  isDeliverableGroup?: (group: EventGroup) => boolean;
}

export function buildTurnRenderRows(
  groups: EventGroup[],
  options: TurnRenderOptions = {},
): TurnRenderRow[] {
  const rows: TurnRenderRow[] = [];
  let idx = 0;
  while (idx < groups.length) {
    if (isUserPromptGroup(groups[idx])) {
      rows.push({ kind: "flat", indices: [idx] });
      idx++;
      continue;
    }
    const turnStart = idx;
    while (idx < groups.length && !isUserPromptGroup(groups[idx])) idx++;
    const turnEnd = idx - 1;
    if (turnStart > turnEnd) continue;

    const { prefix, segments } = partitionAgentTurn(groups, turnStart, turnEnd);
    const prefixIndices = prefix.flatMap(expandIndexRange);

    if (segments.length === 0) {
      for (const p of prefix) {
        rows.push({ kind: "flat", indices: expandIndexRange(p) });
      }
      continue;
    }

    if (segments.length === 1) {
      rows.push({
        kind: "flat",
        indices: [...prefixIndices, ...expandIndexRange(segments[0]!)],
      });
      continue;
    }

    // Accordion only merges groups that start with `response`; tool blocks before the first
    // reply were emitted as separate "prefix" rows. Fold them into the first collapsed chunk.
    const prevRanges = segments.slice(0, -1).map(expandIndexRange);
    if (prefixIndices.length > 0) {
      prevRanges[0] = [...prefixIndices, ...prevRanges[0]!];
    }

    // Plan (PlanDisplay) must stay out of the collapsed region so Apply / Dismiss stay usable.
    // Image/document artifacts also stay outside — generated media shouldn't be hidden behind the accordion.
    const planBreakout: number[] = [];
    const messageBreakout: number[] = [];
    for (const range of prevRanges) {
      for (const gIdx of range) {
        const g = groups[gIdx]!;
        if (isPlanToolCallGroup(g)) {
          planBreakout.push(gIdx);
        } else if (groupHasMediaArtifact(g) || options.isDeliverableGroup?.(g)) {
          messageBreakout.push(gIdx);
        }
      }
    }
    planBreakout.sort((a, b) => a - b);
    messageBreakout.sort((a, b) => a - b);
    const breakoutSet = new Set([...planBreakout, ...messageBreakout]);
    const filteredPrevRanges = prevRanges
      .map((range) => range.filter((gIdx) => !breakoutSet.has(gIdx)))
      .filter((range) => range.length > 0);

    if (filteredPrevRanges.length === 0) {
      rows.push({
        kind: "flat",
        indices: [
          ...messageBreakout,
          ...planBreakout,
          ...expandIndexRange(segments[segments.length - 1]!),
        ],
      });
      continue;
    }

    const toolTotal = countToolCallsInRanges(groups, filteredPrevRanges);
    let visibleMessageCount = 0;
    for (const range of filteredPrevRanges) {
      for (const gIdx of range) {
        if (groups[gIdx]?.type === "response") visibleMessageCount++;
      }
    }
    rows.push({
      kind: "accordion",
      previousSegments: filteredPrevRanges,
      planBreakoutIndices: planBreakout,
      messageBreakoutIndices: messageBreakout,
      lastSegment: expandIndexRange(segments[segments.length - 1]!),
      previousMessageCount: visibleMessageCount,
      previousToolSummary: formatAccordionToolSummary(toolTotal),
    });
  }
  return rows;
}
