/**
 * Turns the composer's attached context into the shape `runs:execute` and
 * `runs:continue` take.
 *
 * Both operations built this inline and independently, ~30 duplicated lines
 * each, with the six context arrays arriving as positional parameters in two
 * *different* orders. One builder over one `ContextItem[]` removes both the
 * duplication and the ordering hazard, and makes the mapping testable without a
 * run.
 */

import {
  groupContextItems,
  type ContextBrowserItem,
  type ContextCodeItem,
  type ContextItem,
} from "./composer-context";

export type Attachments = Array<{
  name: string;
  type: string;
  data?: string;
  sourcePath?: string;
  mimeType: string;
}>;

export type InitialContextItem = {
  kind: "file" | "diff" | "selection" | "note";
  ref?: string;
  content?: string;
  metadata?: Record<string, unknown>;
};

export interface RunContextPayload {
  attachments?: Attachments;
  initialContext: InitialContextItem[];
  contextIssues?: Array<{
    provider: string;
    number?: number | null;
    title: string;
    body?: string | null;
  }>;
  contextFiles?: Array<{ path: string }>;
  contextSignals?: Array<{
    source: string;
    level: string;
    category: string;
    title: string;
    body?: string | null;
    stackTrace?: string | null;
    eventCount?: number;
  }>;
  contextSkills?: Array<{
    name: string;
    path?: string;
    displayName?: string;
    description?: string;
    shortDescription?: string;
    iconSmall?: string;
    iconLarge?: string;
    brandColor?: string;
    scope?: string;
  }>;
}

/** Build "selection" context items from editor code selections. */
function codeSelectionsToContext(
  selections: readonly ContextCodeItem[],
): InitialContextItem[] {
  return selections.map((sel) => {
    const range =
      sel.startLine === sel.endLine
        ? `line ${sel.startLine}`
        : `lines ${sel.startLine}-${sel.endLine}`;
    // Matches the inline chip token (`@<path>#L<range>`) so the mention in the
    // message and the `[selection: ...]` context header refer to the same thing.
    const refRange =
      sel.startLine === sel.endLine
        ? `L${sel.startLine}`
        : `L${sel.startLine}-${sel.endLine}`;
    return {
      kind: "selection" as const,
      ref: `${sel.filePath}#${refRange}`,
      content: `Code selection from ${sel.filePath} (${range}):\n\n${sel.text}`,
      metadata: {
        source: "editor",
        id: sel.id,
        filePath: sel.filePath,
        fileName: sel.fileName,
        startLine: sel.startLine,
        endLine: sel.endLine,
      },
    };
  });
}

/**
 * Build attachments + initialContext from browser selections. Screenshots go as
 * image attachments; structural data goes as "selection" context items.
 */
function browserSelectionsToPayload(selections: readonly ContextBrowserItem[]): {
  attachments: Attachments;
  initialContext: InitialContextItem[];
} {
  const attachments: Attachments = [];
  const initialContext: InitialContextItem[] = [];

  for (const sel of selections) {
    const host = (() => {
      try {
        return new URL(sel.url).hostname;
      } catch {
        return "page";
      }
    })();
    const slug = (sel.componentName || sel.tagName || "element")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .toLowerCase();

    if (sel.screenshotPath) {
      attachments.push({
        name: `browser-${host}-${slug}-${sel.id.slice(0, 6)}.png`,
        type: "image",
        sourcePath: sel.screenshotPath,
        mimeType: sel.screenshotMimeType || "image/png",
      });
    }
    if (sel.surroundingScreenshotPath) {
      attachments.push({
        name: `browser-${host}-${slug}-${sel.id.slice(0, 6)}-context.png`,
        type: "image",
        sourcePath: sel.surroundingScreenshotPath,
        mimeType: sel.screenshotMimeType || "image/png",
      });
    }

    const content = [
      `Browser selection: ${sel.componentName ? `<${sel.componentName}>` : sel.tagName}`,
      `URL: ${sel.url}`,
      sel.title ? `Page title: ${sel.title}` : null,
      `Selector: ${sel.selector}`,
      sel.sourceFile ? `Source file: ${sel.sourceFile}` : null,
      sel.text ? `Visible text: ${sel.text}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    initialContext.push({
      kind: "selection",
      ref: sel.url,
      content,
      metadata: {
        source: "browser",
        id: sel.id,
        url: sel.url,
        title: sel.title,
        selector: sel.selector,
        tagName: sel.tagName,
        styles: sel.styles,
        rect: sel.rect,
        pageRect: sel.pageRect,
        componentName: sel.componentName,
        sourceFile: sel.sourceFile,
        timestamp: sel.timestamp,
      },
    });
  }
  return { attachments, initialContext };
}

/** Empty groups are sent as `undefined` rather than `[]` — the run payload
 *  treats every context field as optional, and omitting them keeps the wire
 *  payload (and the persisted run context) free of empty noise. */
function orUndefined<T>(list: T[]): T[] | undefined {
  return list.length > 0 ? list : undefined;
}

/**
 * Project the composer's context onto a run payload. `uploads` are the user's
 * own file attachments; browser screenshots are appended to them so a run sees
 * one attachment list.
 */
export function buildRunContextPayload(
  items: readonly ContextItem[] | undefined,
  uploads?: Attachments,
): RunContextPayload {
  const { files, issues, signals, skills, browserSelections, codeSelections } =
    groupContextItems(items ?? []);

  const browser = browserSelectionsToPayload(browserSelections);
  const initialContext = [
    ...browser.initialContext,
    ...codeSelectionsToContext(codeSelections),
  ];

  return {
    attachments: orUndefined([...(uploads ?? []), ...browser.attachments]),
    initialContext,
    contextIssues: orUndefined(
      issues.map((i) => ({
        provider: i.provider,
        number: i.number,
        title: i.title,
        body: i.body,
      })),
    ),
    contextFiles: orUndefined(files.map((f) => ({ path: f.fullPath }))),
    contextSignals: orUndefined(
      signals.map((s) => ({
        source: s.source,
        level: s.level,
        category: s.category,
        title: s.title,
        body: s.body,
        stackTrace: s.stackTrace,
        eventCount: s.eventCount,
      })),
    ),
    contextSkills: orUndefined(
      skills.map((s) => ({
        name: s.name,
        path: s.path,
        displayName: s.displayName,
        description: s.description,
        shortDescription: s.shortDescription,
        iconSmall: s.iconSmall,
        iconLarge: s.iconLarge,
        brandColor: s.brandColor,
        scope: s.scope,
      })),
    ),
  };
}
