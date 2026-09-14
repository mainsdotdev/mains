import { describe, it, expect } from "vitest";
import {
  contextItemKey,
  groupContextItems,
  isSameContextItem,
  type ContextBrowserItem,
  type ContextCodeItem,
  type ContextFileItem,
  type ContextIssueItem,
  type ContextItem,
  type ContextSignalItem,
  type ContextSkillItem,
} from "./composer-context";

const file = (fullPath: string): ContextFileItem => ({
  kind: "file",
  name: fullPath.split("/").pop() ?? fullPath,
  fullPath,
  type: "file",
});

const issue = (entityId: string): ContextIssueItem => ({
  kind: "issue",
  entityId,
  title: "An issue",
  body: null,
  provider: "github",
  number: 1,
  labels: null,
});

const signal = (entityId: string): ContextSignalItem => ({
  kind: "signal",
  entityId,
  title: "A signal",
  body: null,
  source: "sentry",
  level: "error",
  category: "exception",
  stackTrace: null,
  eventCount: 3,
});

const skill = (name: string): ContextSkillItem => ({ kind: "skill", name });

const browser = (id: string): ContextBrowserItem => ({
  kind: "browser",
  id,
  url: "https://example.com/app",
  title: "App",
  selector: "div > button",
  tagName: "button",
  text: "Save",
  styles: {},
  rect: { x: 0, y: 0, width: 10, height: 10 },
  pageRect: { x: 0, y: 0, width: 10, height: 10 },
  scroll: { x: 0, y: 0 },
  viewport: { width: 800, height: 600 },
  devicePixelRatio: 2,
  timestamp: "2026-01-01T00:00:00Z",
  screenshotMimeType: "image/png",
});

const code = (
  overrides: Partial<ContextCodeItem> = {},
): ContextCodeItem => ({
  kind: "code",
  id: "uuid-1",
  filePath: "/repo/src/index.ts",
  fileName: "index.ts",
  startLine: 10,
  endLine: 20,
  text: "const a = 1;",
  ...overrides,
});

describe("contextItemKey", () => {
  it("uses the identity each kind actually arrives with", () => {
    expect(contextItemKey(file("/repo/a.ts"))).toBe("/repo/a.ts");
    expect(contextItemKey(issue("ent-1"))).toBe("ent-1");
    expect(contextItemKey(signal("ent-2"))).toBe("ent-2");
    expect(contextItemKey(skill("commit-helper"))).toBe("commit-helper");
    expect(contextItemKey(browser("sel-1"))).toBe("sel-1");
    expect(contextItemKey(code({ id: "sel-2" }))).toBe("sel-2");
  });
});

describe("isSameContextItem", () => {
  it("never matches across kinds, even on an equal key", () => {
    expect(isSameContextItem(issue("ent-1"), signal("ent-1"))).toBe(false);
  });

  it("matches same-kind items by their removal key", () => {
    expect(isSameContextItem(file("/repo/a.ts"), file("/repo/a.ts"))).toBe(true);
    expect(isSameContextItem(file("/repo/a.ts"), file("/repo/b.ts"))).toBe(false);
    expect(isSameContextItem(skill("s"), skill("s"))).toBe(true);
  });

  it("compares code selections by span, not by their freshly-minted uuid", () => {
    // Same span captured twice — different uuid each time, still one selection.
    expect(isSameContextItem(code({ id: "a" }), code({ id: "b" }))).toBe(true);
    // A different span from the same file is a different selection.
    expect(isSameContextItem(code(), code({ startLine: 11 }))).toBe(false);
    expect(isSameContextItem(code(), code({ text: "const a = 2;" }))).toBe(false);
  });
});

describe("groupContextItems", () => {
  it("returns one shared instance when nothing is attached", () => {
    // Identity-stable so downstream memos don't churn on unrelated renders.
    expect(groupContextItems([])).toBe(groupContextItems([]));
  });

  it("splits by kind and preserves insertion order within each", () => {
    const items: ContextItem[] = [
      file("/repo/b.ts"),
      issue("ent-1"),
      file("/repo/a.ts"),
      browser("sel-1"),
      skill("s"),
      signal("ent-2"),
      code(),
    ];
    const grouped = groupContextItems(items);

    expect(grouped.files.map((f) => f.fullPath)).toEqual([
      "/repo/b.ts",
      "/repo/a.ts",
    ]);
    expect(grouped.issues).toHaveLength(1);
    expect(grouped.signals).toHaveLength(1);
    expect(grouped.skills).toHaveLength(1);
    expect(grouped.browserSelections).toHaveLength(1);
    expect(grouped.codeSelections).toHaveLength(1);
  });
});
