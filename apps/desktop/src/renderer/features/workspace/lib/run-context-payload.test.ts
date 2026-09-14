import { describe, it, expect } from "vitest";
import { buildRunContextPayload } from "./run-context-payload";
import type {
  ContextBrowserItem,
  ContextCodeItem,
  ContextItem,
} from "./composer-context";

const browserSel = (
  overrides: Partial<ContextBrowserItem> = {},
): ContextBrowserItem => ({
  kind: "browser",
  id: "abcdef123456",
  url: "https://example.com/dashboard",
  title: "Dashboard",
  selector: "main > div > button.save",
  tagName: "button",
  text: "Save",
  styles: { color: "red" },
  rect: { x: 1, y: 2, width: 3, height: 4 },
  pageRect: { x: 1, y: 2, width: 3, height: 4 },
  scroll: { x: 0, y: 0 },
  viewport: { width: 1280, height: 800 },
  devicePixelRatio: 2,
  timestamp: "2026-01-01T00:00:00Z",
  screenshotMimeType: "image/png",
  ...overrides,
});

const codeSel = (overrides: Partial<ContextCodeItem> = {}): ContextCodeItem => ({
  kind: "code",
  id: "sel-1",
  filePath: "/repo/src/index.ts",
  fileName: "index.ts",
  startLine: 10,
  endLine: 12,
  text: "const a = 1;",
  ...overrides,
});

describe("buildRunContextPayload", () => {
  it("omits every context field when nothing is attached", () => {
    const payload = buildRunContextPayload(undefined);
    expect(payload).toEqual({
      attachments: undefined,
      initialContext: [],
      contextIssues: undefined,
      contextFiles: undefined,
      contextSignals: undefined,
      contextSkills: undefined,
    });
  });

  it("keeps the user's uploads even with no context attached", () => {
    const uploads = [{ name: "a.png", type: "image", mimeType: "image/png" }];
    expect(buildRunContextPayload([], uploads).attachments).toEqual(uploads);
  });

  it("projects files, issues, signals and skills onto their wire shapes", () => {
    const items: ContextItem[] = [
      { kind: "file", name: "a.ts", fullPath: "/repo/a.ts", type: "file" },
      {
        kind: "issue",
        entityId: "ent-1",
        title: "Bug",
        body: "details",
        provider: "github",
        number: 7,
        labels: "p1",
      },
      {
        kind: "signal",
        entityId: "ent-2",
        title: "Crash",
        body: null,
        source: "sentry",
        level: "error",
        category: "exception",
        stackTrace: "at foo()",
        eventCount: 12,
      },
      { kind: "skill", name: "reviewer", scope: "project" },
    ];
    const payload = buildRunContextPayload(items);

    expect(payload.contextFiles).toEqual([{ path: "/repo/a.ts" }]);
    // `labels` and `entityId` are composer-only — they don't cross to the run.
    expect(payload.contextIssues).toEqual([
      { provider: "github", number: 7, title: "Bug", body: "details" },
    ]);
    expect(payload.contextSignals).toEqual([
      {
        source: "sentry",
        level: "error",
        category: "exception",
        title: "Crash",
        body: null,
        stackTrace: "at foo()",
        eventCount: 12,
      },
    ]);
    expect(payload.contextSkills?.[0]).toMatchObject({
      name: "reviewer",
      scope: "project",
    });
  });

  it("turns a code selection into a `selection` item whose ref matches its chip token", () => {
    const [item] = buildRunContextPayload([codeSel()]).initialContext;
    expect(item.kind).toBe("selection");
    expect(item.ref).toBe("/repo/src/index.ts#L10-12");
    expect(item.content).toContain("lines 10-12");
    expect(item.metadata).toMatchObject({ source: "editor", id: "sel-1" });
  });

  it("collapses a single-line selection's range in both the ref and the prose", () => {
    const [item] = buildRunContextPayload([
      codeSel({ startLine: 5, endLine: 5 }),
    ]).initialContext;
    expect(item.ref).toBe("/repo/src/index.ts#L5");
    expect(item.content).toContain("line 5");
  });

  it("appends browser screenshots to the user's uploads as image attachments", () => {
    const uploads = [{ name: "mine.png", type: "image", mimeType: "image/png" }];
    const payload = buildRunContextPayload(
      [
        browserSel({
          screenshotPath: "/caps/el.png",
          surroundingScreenshotPath: "/caps/ctx.png",
        }),
      ],
      uploads,
    );

    expect(payload.attachments).toHaveLength(3);
    expect(payload.attachments?.[0]).toBe(uploads[0]);
    expect(payload.attachments?.slice(1).map((a) => a.sourcePath)).toEqual([
      "/caps/el.png",
      "/caps/ctx.png",
    ]);
    // Named by host + element + a slice of the selection id.
    expect(payload.attachments?.[1].name).toBe(
      "browser-example.com-button-abcdef.png",
    );
  });

  it("describes a browser selection without a screenshot as context only", () => {
    const payload = buildRunContextPayload([browserSel()]);
    expect(payload.attachments).toBeUndefined();
    expect(payload.initialContext).toHaveLength(1);
    expect(payload.initialContext[0].content).toContain(
      "URL: https://example.com/dashboard",
    );
    expect(payload.initialContext[0].metadata).toMatchObject({
      source: "browser",
      selector: "main > div > button.save",
    });
  });

  it("orders browser context ahead of code selections", () => {
    const payload = buildRunContextPayload([codeSel(), browserSel()]);
    expect(payload.initialContext.map((c) => c.metadata?.source)).toEqual([
      "browser",
      "editor",
    ]);
  });
});
