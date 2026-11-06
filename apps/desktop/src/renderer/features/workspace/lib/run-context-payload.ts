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
  type ContextAppshotItem,
  type ContextBrowserItem,
  type ContextCodeItem,
  type ContextDocumentItem,
  type ContextPresentationItem,
  type ContextItem,
} from "./composer-context";
import { mcpAppContextPayload } from "./mcp-app-context";
import type { BrowserSelectionElement } from "../../../../shared/browser-annotation";
import { browserAnnotationAttachmentName } from "@mains/contracts/browser-annotations";
import { presentationAnnotationAttachmentName } from "@mains/contracts/presentation-annotations";
import { documentAnnotationAttachmentName, documentAnnotationPageLabel, readDocumentAnnotations } from "@mains/contracts/document-annotations";

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
  contextFiles?: Array<{ path: string; type?: "file" | "directory" }>;
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
    mentionPath?: string;
    displayName?: string;
    description?: string;
    shortDescription?: string;
    iconSmall?: string;
    iconLarge?: string;
    brandColor?: string;
    scope?: string;
  }>;
}

/** Appshots carry the captured pixels plus a bounded accessibility snapshot. */
function appshotsToPayload(appshots: readonly ContextAppshotItem[]): {
  attachments: Attachments;
  initialContext: InitialContextItem[];
} {
  const attachments: Attachments = [];
  const initialContext: InitialContextItem[] = [];

  for (const appshot of appshots) {
    const slug = `${appshot.appName}-${appshot.windowTitle || "window"}`
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 80);
    attachments.push({
      name: `lens-${slug || "window"}-${appshot.id.slice(0, 6)}.png`,
      type: "image",
      sourcePath: appshot.screenshotPath,
      mimeType: appshot.screenshotMimeType,
    });

    const content = [
      `Lens capture from ${appshot.appName}`,
      appshot.windowTitle ? `Window: ${appshot.windowTitle}` : null,
      `Captured: ${appshot.timestamp}`,
      appshot.accessibilityText
        ? `Accessible interface text:\n${appshot.accessibilityText}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
    initialContext.push({
      kind: "selection",
      ref: `${appshot.appName}${
        appshot.windowTitle ? ` — ${appshot.windowTitle}` : ""
      }`,
      content,
      metadata: {
        source: "appshot",
        id: appshot.id,
        appName: appshot.appName,
        bundleIdentifier: appshot.bundleIdentifier,
        windowTitle: appshot.windowTitle,
        timestamp: appshot.timestamp,
        accessibilityStatus: appshot.accessibilityStatus,
        accessibilityTruncated: appshot.accessibilityTruncated,
      },
    });
  }
  return { attachments, initialContext };
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

/** Preserve each selected element's own component and source identity. */
function describeBrowserElement(element: BrowserSelectionElement): string {
  return [
    `Element: ${element.componentName ? `<${element.componentName}>` : element.tagName}`,
    `Selector: ${element.selector}`,
    element.sourceFile ? `Source file: ${element.sourceFile}` : null,
    element.text ? `Visible text: ${element.text}` : null,
  ].filter(Boolean).join("\n");
}

/** Screenshots are attachments; comments and DOM details are selection context. */
function browserSelectionsToPayload(selections: readonly ContextBrowserItem[]): {
  attachments: Attachments;
  initialContext: InitialContextItem[];
} {
  const attachments: Attachments = [];
  const initialContext: InitialContextItem[] = [];

  for (const sel of selections) {
    const isAnnotation = !!sel.elements?.length;
    const host = (() => {
      try {
        return new URL(sel.url).hostname;
      } catch {
        return "page";
      }
    })();
    const slug = (isAnnotation ? "annotation" : sel.componentName || sel.tagName || "element")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .toLowerCase();

    if (sel.screenshotPath) {
      attachments.push({
        name: isAnnotation ? browserAnnotationAttachmentName(sel) : `browser-${host}-${slug}-${sel.id.slice(0, 6)}.png`,
        type: "image",
        sourcePath: sel.screenshotPath,
        mimeType: sel.screenshotMimeType || "image/png",
      });
    }
    const content = [
      isAnnotation
        ? `Browser annotation: ${sel.elements!.length} selected item${sel.elements!.length === 1 ? "" : "s"}`
        : `Browser selection: ${sel.componentName ? `<${sel.componentName}>` : sel.tagName}`,
      `URL: ${sel.url}`,
      sel.title ? `Page title: ${sel.title}` : null,
      sel.comment ? `User comment: ${sel.comment}` : null,
      isAnnotation
        ? sel.elements!.map((element, index) =>
          `\nSelected item ${index + 1}\n${describeBrowserElement(element)}`).join("\n")
        : describeBrowserElement(sel),
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
        ...(isAnnotation ? { elements: sel.elements, comment: sel.comment } : {}),
      },
    });
  }
  return { attachments, initialContext };
}

/** All rendered documents share one payload; old unsent presentation items retain their capture names. */
function documentAnnotationsToPayload(items: readonly (ContextDocumentItem | ContextPresentationItem)[]): {
  attachments: Attachments; initialContext: InitialContextItem[];
} {
  const attachments: Attachments = [];
  const initialContext: InitialContextItem[] = [];
  for (const item of items) {
    const annotation = readDocumentAnnotations([item])[0];
    if (!annotation) continue;
    attachments.push({ name: item.kind === "presentation" ? presentationAnnotationAttachmentName(item) : documentAnnotationAttachmentName(item),
      type: "image", data: item.screenshotData, mimeType: "image/png" });
    initialContext.push({
      kind: "selection" as const,
      ref: `${annotation.filePath}#${annotation.documentType === "pptx" ? "slide" : "page"}=${annotation.pageNumber}`,
      content: [
        `Document annotation on ${annotation.filePath} (${annotation.documentType}), ${documentAnnotationPageLabel(annotation)}.`,
        `User comment: ${annotation.comment}`,
        "Selected items (bounds are fractions of the rendered page, independent of preview zoom):",
        ...annotation.elements.map((element, index) => [
          `${index + 1}. ${element.type}: ${element.name}`,
          element.sourcePart ? `Source part: ${element.sourcePart}${element.shapeId ? `; shape id: ${element.shapeId}` : ""}` : null,
          element.text ? `Text: ${element.text}` : null,
          element.selector ? `Rendered block: ${element.selector}` : null,
          element.textAnchor ? `Text anchor: ${JSON.stringify(element.textAnchor)}` : null,
          `Bounds: ${JSON.stringify(element.rect)}`,
        ].filter(Boolean).join("\n")),
        "Use the original document to make changes. Page bounds describe the captured preview; text and nearby context identify the passage if pagination changes.",
      ].join("\n"),
      metadata: { source: "document", ...annotation },
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
 * own file attachments; Appshot and browser screenshots are appended so a run
 * sees one attachment list.
 */
export function buildRunContextPayload(
  items: readonly ContextItem[] | undefined,
  uploads?: Attachments,
): RunContextPayload {
  const {
    files,
    issues,
    signals,
    skills,
    browserSelections,
    appshots,
    codeSelections,
    reviewComments,
    documentAnnotations,
    mcpApps,
  } = groupContextItems(items ?? []);

  const capturedWindows = appshotsToPayload(appshots);
  const browser = browserSelectionsToPayload(browserSelections);
  const documents = documentAnnotationsToPayload(documentAnnotations);
  const apps = mcpAppContextPayload(mcpApps);
  const initialContext = [
    ...capturedWindows.initialContext,
    ...browser.initialContext,
    ...documents.initialContext,
    ...codeSelectionsToContext(codeSelections),
    ...reviewComments.map(({ kind: _kind, ...comment }) => ({
      kind: "selection" as const,
      ref: `${comment.absolutePath}#${comment.side === "deletions" ? "L" : "R"}${comment.lineNumber}${comment.endLineNumber && comment.endLineNumber !== comment.lineNumber ? `-${comment.endLineNumber}` : ""}`,
      content: [
        `Review comment on ${comment.filePath} (${comment.side === "deletions" ? "old" : "new"} version, ${comment.endLineNumber && comment.endLineNumber !== comment.lineNumber ? `lines ${comment.lineNumber}-${comment.endLineNumber}` : `line ${comment.lineNumber}`}):`,
        `Code: ${comment.lineText}`,
        `User comment: ${comment.comment}`,
      ].join("\n"),
      metadata: { source: "review", ...comment },
    })),
    ...apps.initialContext,
  ];

  return {
    attachments: orUndefined([
      ...(uploads ?? []),
      ...capturedWindows.attachments,
      ...browser.attachments,
      ...documents.attachments,
      ...apps.attachments,
    ]),
    initialContext,
    contextIssues: orUndefined(
      issues.map((i) => ({
        provider: i.provider,
        number: i.number,
        title: i.title,
        body: i.body,
      })),
    ),
    contextFiles: orUndefined(
      files.map((f) => ({ path: f.fullPath, type: f.type })),
    ),
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
        mentionPath: s.mentionPath,
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
