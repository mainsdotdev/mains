/**
 * Everything the composer can attach to the next message, as one tagged union.
 *
 * The six kinds — files, issues, signals, skills, browser selections, code
 * selections — are one concept ("what this message carries besides its text"),
 * but they used to be six state fields, six add/remove/clear reducer triplets,
 * and six props threaded down the page. Nothing forced them to stay in step, so
 * they drifted: the browser-selection type existed in two copies and the second
 * one had already lost `scroll`, `viewport`, and `devicePixelRatio`.
 *
 * The `kind` tag is intersected onto each payload rather than wrapping it, so an
 * item still reads as the thing it is (`item.title`, `item.fullPath`) and a
 * `ContextIssueItem` stays assignable to `ContextIssue`.
 *
 * React-free on purpose: the slice, the run payload builder, and the composer
 * hook all read the same identity rules from here.
 */

import type { FileNode } from "@/features/workspace/types/file-explorer";

export interface ContextIssue {
  entityId: string;
  title: string;
  body: string | null;
  provider: string;
  number: number | null;
  labels: string | null;
}

export interface ContextSignal {
  entityId: string;
  title: string;
  body: string | null;
  source: string;
  level: string;
  category: string;
  stackTrace: string | null;
  eventCount: number;
}

export interface ContextSkill {
  name: string;
  path?: string;
  description?: string;
  displayName?: string;
  shortDescription?: string;
  iconSmall?: string;
  iconLarge?: string;
  brandColor?: string;
  scope?: string;
}

export interface ContextCodeSelection {
  id: string;
  /** Absolute path of the file the selection was made in. */
  filePath: string;
  /** Basename shown on the chip. */
  fileName: string;
  /** 1-based inclusive line range. */
  startLine: number;
  endLine: number;
  text: string;
}

export interface ContextBrowserSelection {
  id: string;
  url: string;
  title: string;
  selector: string;
  tagName: string;
  text: string;
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  pageRect: { x: number; y: number; width: number; height: number };
  scroll: { x: number; y: number };
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  componentName?: string;
  sourceFile?: string;
  timestamp: string;
  /** Absolute path to the PNG on disk (main-process userData/browser-captures). */
  screenshotPath?: string;
  /** Basename used for `mains-capture://<name>` in `<img src>`. */
  screenshotCaptureName?: string;
  surroundingScreenshotPath?: string;
  surroundingScreenshotCaptureName?: string;
  screenshotMimeType: string;
}

export type ContextFileItem = { kind: "file" } & FileNode;
export type ContextIssueItem = { kind: "issue" } & ContextIssue;
export type ContextSignalItem = { kind: "signal" } & ContextSignal;
export type ContextSkillItem = { kind: "skill" } & ContextSkill;
export type ContextBrowserItem = { kind: "browser" } & ContextBrowserSelection;
export type ContextCodeItem = { kind: "code" } & ContextCodeSelection;

export type ContextItem =
  | ContextFileItem
  | ContextIssueItem
  | ContextSignalItem
  | ContextSkillItem
  | ContextBrowserItem
  | ContextCodeItem;

export type ContextKind = ContextItem["kind"];

/**
 * The handle an item is removed by. It differs per kind because each kind
 * arrives from somewhere different: a file from the explorer is its path, a
 * tracker issue is its entity id, a skill is its name, and the two selection
 * kinds carry a uuid minted where they were captured.
 */
export function contextItemKey(item: ContextItem): string {
  switch (item.kind) {
    case "file":
      return item.fullPath;
    case "issue":
    case "signal":
      return item.entityId;
    case "skill":
      return item.name;
    case "browser":
    case "code":
      return item.id;
  }
}

/**
 * Whether an incoming item is already in context. Every kind but `code` answers
 * that with its removal key; a code selection's uuid is minted fresh on each
 * capture, so what makes two of them the same is the span they cover.
 */
export function isSameContextItem(a: ContextItem, b: ContextItem): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "code" && b.kind === "code") {
    return (
      a.filePath === b.filePath &&
      a.startLine === b.startLine &&
      a.endLine === b.endLine &&
      a.text === b.text
    );
  }
  return contextItemKey(a) === contextItemKey(b);
}

/** Read-only by contract: these are views onto store state, never buffers. */
export interface GroupedContext {
  readonly files: readonly ContextFileItem[];
  readonly issues: readonly ContextIssueItem[];
  readonly signals: readonly ContextSignalItem[];
  readonly skills: readonly ContextSkillItem[];
  readonly browserSelections: readonly ContextBrowserItem[];
  readonly codeSelections: readonly ContextCodeItem[];
}

type MutableGroupedContext = {
  -readonly [K in keyof GroupedContext]: Array<GroupedContext[K][number]>;
};

/**
 * The steady state is "nothing attached", and returning fresh empty arrays for
 * it would invalidate every memo downstream on each unrelated change. One
 * shared instance keeps that case identity-stable.
 */
const EMPTY_GROUPED: GroupedContext = Object.freeze({
  files: [],
  issues: [],
  signals: [],
  skills: [],
  browserSelections: [],
  codeSelections: [],
});

/**
 * Split the flat list into per-kind views. The composer needs them separated —
 * a skill chip, a file chip, and a code chip are different UI — while the run
 * payload and the slice work off the flat list. Insertion order is preserved
 * within each kind.
 */
export function groupContextItems(items: readonly ContextItem[]): GroupedContext {
  if (items.length === 0) return EMPTY_GROUPED;
  const grouped: MutableGroupedContext = {
    files: [],
    issues: [],
    signals: [],
    skills: [],
    browserSelections: [],
    codeSelections: [],
  };
  for (const item of items) {
    switch (item.kind) {
      case "file":
        grouped.files.push(item);
        break;
      case "issue":
        grouped.issues.push(item);
        break;
      case "signal":
        grouped.signals.push(item);
        break;
      case "skill":
        grouped.skills.push(item);
        break;
      case "browser":
        grouped.browserSelections.push(item);
        break;
      case "code":
        grouped.codeSelections.push(item);
        break;
    }
  }
  return grouped;
}
