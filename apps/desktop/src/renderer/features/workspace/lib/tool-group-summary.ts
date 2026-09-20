// ─────────────────────────────────────────────────────────────
// Tool group summary
//
// One sentence for what a collapsed tool group did: "Edited a file, read
// files, ran commands". Pure and React-free, so it is testable through its
// interface rather than only by rendering `ToolCallGroup`.
//
// Two rules do the work:
//   • one clause per kind of work, counted across the whole group, so a
//     Bash → Edit → Bash run reads as two clauses, not three;
//   • clauses ordered by the registry's `rank`, not by when the call
//     happened, so the header stays still while the group streams in.
// ─────────────────────────────────────────────────────────────

import type { RunEvent } from "../types";
import { resolveTool } from "./resolve-tool";
import { PHRASES_BY_GROUP_KEY, VENDOR_PHRASE_RANK } from "./tool-registry";

const MAX_SUMMARY_CLAUSES = 3;

interface Clause {
  rank: number;
  /** First position in the group — the tie-break between equal ranks. */
  order: number;
  count: number;
  one: string;
  many: string;
}

/** "A", "A and B", "A, B and C" — the sentence lists integrations, not code. */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function capitalize(sentence: string): string {
  return sentence.length === 0
    ? sentence
    : sentence[0].toUpperCase() + sentence.slice(1);
}

/**
 * Summarize prepared tool-call events (see `prepareToolCalls`) as one
 * past-tense sentence. Returns "" for an empty list — the caller renders no
 * header at all in that case.
 */
export function summarizeToolCalls(events: RunEvent[]): string {
  const clauses = new Map<string, Clause>();
  // Vendors collapse into a single clause naming the integrations, because
  // "used the Linear integration, used the Gmail integration" is a list of
  // calls where the reader wants a list of systems.
  const vendorLabels = new Map<string, string>();
  let vendorCount = 0;
  let vendorOrder = Number.MAX_SAFE_INTEGER;

  events.forEach((event, index) => {
    const resolved = resolveTool(event.content);

    if (resolved.vendorId) {
      vendorLabels.set(resolved.vendorId, resolved.vendorLabel ?? resolved.groupLabel);
      vendorCount++;
      vendorOrder = Math.min(vendorOrder, index);
      return;
    }

    const existing = clauses.get(resolved.groupKey);
    if (existing) {
      existing.count++;
      return;
    }

    // No registered phrase: name the tool rather than dropping it from the
    // sentence. Reads as "… and used Glob" — duller, never wrong.
    const phrase = PHRASES_BY_GROUP_KEY[resolved.groupKey] ?? {
      one: `used ${resolved.groupLabel}`,
      many: `used ${resolved.groupLabel}`,
      rank: 70,
    };
    clauses.set(resolved.groupKey, {
      rank: phrase.rank,
      order: index,
      count: 1,
      one: phrase.one,
      many: phrase.many,
    });
  });

  const parts: Array<{ rank: number; order: number; text: string }> = [];

  if (vendorCount > 0) {
    const names = listNames([...vendorLabels.values()]);
    const noun = vendorLabels.size === 1 ? "integration" : "integrations";
    parts.push({
      rank: VENDOR_PHRASE_RANK,
      order: vendorOrder,
      text: `used the ${names} ${noun}`,
    });
  }

  for (const clause of clauses.values()) {
    parts.push({
      rank: clause.rank,
      order: clause.order,
      text: clause.count === 1 ? clause.one : clause.many,
    });
  }

  parts.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return capitalize(
    parts
      .slice(0, MAX_SUMMARY_CLAUSES)
      .map((part) => part.text)
      .join(", "),
  );
}
