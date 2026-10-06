import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, vi } from "vitest";
import {
  attachmentPromptParts,
  adoptConfig,
  createLogger,
  safeJson,
  extractArtifactsFromToolOutput,
  formatContextSection,
  formatIssuesSection,
  formatFilesSection,
  appendPromptSections,
  emitUserPromptArtifact,
  resolveCatalogDefaultId,
  DEFAULT_ALLOWED_TOOLS,
  ALLOWED_TOOLS_SET,
  toolWrites,
} from "./adapter.shared";

describe("attachmentPromptParts", () => {
  it("reads prepared text without changing the durable original", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-prepared-"));
    const sourcePath = path.join(directory, "notes.txt");
    try {
      fs.writeFileSync(sourcePath, "Important note");
      const result = attachmentPromptParts([{ attachmentId: "text-id", sourcePath, name: "notes.txt", type: "document", mimeType: "text/plain", byteSize: 14 }]);
      expect(result.savedPaths).toEqual([]);
      expect(result.inlineTexts).toEqual(["[Attached document: notes.txt]\nImportant note"]);
      expect(fs.readFileSync(sourcePath, "utf8")).toBe("Important note");
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});

describe("resolveCatalogDefaultId", () => {
  const catalog = ["auto", "gpt-6", "claude-sonnet-9"];

  it("honors a configured default that the catalog still offers", () => {
    expect(resolveCatalogDefaultId(catalog, "gpt-6", ["auto"])).toBe("gpt-6");
  });

  it("falls through to the driver's preference when the pin aged out", () => {
    // The rotation case: the id the user pinned months ago is gone.
    expect(resolveCatalogDefaultId(catalog, "gpt-5.4", ["auto"])).toBe("auto");
  });

  it("falls through to the first catalog entry when nothing preferred is offered", () => {
    expect(resolveCatalogDefaultId(["gpt-6", "gpt-6-mini"], "gpt-5.4", ["auto"])).toBe(
      "gpt-6",
    );
    expect(resolveCatalogDefaultId(catalog, undefined)).toBe("auto");
  });

  it("walks preferences in order and skips empty entries", () => {
    expect(resolveCatalogDefaultId(catalog, null, ["", "nope", "gpt-6", "auto"])).toBe(
      "gpt-6",
    );
  });

  it("returns undefined for an empty catalog", () => {
    expect(resolveCatalogDefaultId([], "gpt-6", ["auto"])).toBeUndefined();
  });
});

describe("createLogger", () => {
  it("creates logger with info, warn, error methods", () => {
    const logger = createLogger("[TEST]");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("logs with prefix", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("[PREFIX]");
    logger.info("hello", "world");
    expect(spy).toHaveBeenCalledWith("[PREFIX]", "hello", "world");
    spy.mockRestore();
  });

  it("warns with prefix", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createLogger("[W]");
    logger.warn("warning");
    expect(spy).toHaveBeenCalledWith("[W]", "warning");
    spy.mockRestore();
  });

  it("errors with prefix", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger("[E]");
    logger.error("err");
    expect(spy).toHaveBeenCalledWith("[E]", "err");
    spy.mockRestore();
  });
});

describe("DEFAULT_ALLOWED_TOOLS / ALLOWED_TOOLS_SET", () => {
  it("includes core tools", () => {
    expect(DEFAULT_ALLOWED_TOOLS).toContain("Bash");
    expect(DEFAULT_ALLOWED_TOOLS).toContain("Read");
    expect(DEFAULT_ALLOWED_TOOLS).toContain("Glob");
    expect(DEFAULT_ALLOWED_TOOLS).toContain("Grep");
  });

  it("ALLOWED_TOOLS_SET matches array length", () => {
    expect(ALLOWED_TOOLS_SET.size).toBe(DEFAULT_ALLOWED_TOOLS.length);
  });

  it("ALLOWED_TOOLS_SET contains all array items", () => {
    for (const tool of DEFAULT_ALLOWED_TOOLS) {
      expect(ALLOWED_TOOLS_SET.has(tool)).toBe(true);
    }
  });
});

describe("adoptConfig", () => {
  it("keeps the same object reference so existing holders see the update", () => {
    const config = { planMode: true, defaultModel: "gpt-5.6" };
    const holder = config;

    adoptConfig(config, { planMode: false, defaultModel: "gpt-5.6" });

    expect(holder).toBe(config);
    expect(holder.planMode).toBe(false);
  });

  it("drops keys the new config no longer carries", () => {
    const config: Record<string, unknown> = { planMode: true, effortLevel: "high" };

    adoptConfig(config, { planMode: false });

    expect(config).toEqual({ planMode: false });
  });
});

describe("safeJson", () => {
  it("serializes a simple object", () => {
    expect(safeJson({ a: 1 })).toBe('{"a":1}');
  });

  it("serializes a string", () => {
    expect(safeJson("hello")).toBe('"hello"');
  });

  it("serializes null", () => {
    expect(safeJson(null)).toBe("null");
  });

  it("handles circular reference by returning string representation", () => {
    const obj: any = {};
    obj.self = obj;
    const result = safeJson(obj);
    expect(result).toBe("[object Object]");
  });
});

describe("extractArtifactsFromToolOutput", () => {
  it("extracts artifact from Write tool with path", () => {
    const result = extractArtifactsFromToolOutput("Write", {
      path: "/tmp/file.ts",
      content: "const x = 1;",
    });
    expect(result).toHaveLength(1);
    const evt = result[0] as any;
    expect(evt.type).toBe("artifact");
    expect(evt.kind).toBe("file");
    expect(evt.path).toBe("/tmp/file.ts");
    expect(evt.content).toBe("const x = 1;");
  });

  it("extracts artifact from create_file tool", () => {
    const result = extractArtifactsFromToolOutput("create_file", {
      path: "/tmp/new.ts",
    });
    expect(result).toHaveLength(1);
    expect((result[0] as any).kind).toBe("file");
  });

  it("extracts artifact using file_path fallback", () => {
    const result = extractArtifactsFromToolOutput("write_file", {
      file_path: "/tmp/alt.ts",
      content: "data",
    });
    expect(result).toHaveLength(1);
    expect((result[0] as any).path).toBe("/tmp/alt.ts");
  });

  it("returns empty array for non-file tools", () => {
    const result = extractArtifactsFromToolOutput("Bash", { output: "ok" });
    expect(result).toHaveLength(0);
  });

  it("returns empty for Write tool with no path", () => {
    const result = extractArtifactsFromToolOutput("Write", { output: "ok" });
    expect(result).toHaveLength(0);
  });

  it("extracts patch from apply_patch tool", () => {
    const result = extractArtifactsFromToolOutput("apply_patch", {
      patch: "diff --git a/foo",
      path: "/file.ts",
    });
    expect(result).toHaveLength(1);
    const evt = result[0] as any;
    expect(evt.kind).toBe("patch");
    expect(evt.content).toBe("diff --git a/foo");
    expect(evt.path).toBe("/file.ts");
  });

  it("extracts patch from apply_diff tool using diff key", () => {
    const result = extractArtifactsFromToolOutput("apply_diff", {
      diff: "some diff content",
    });
    expect(result).toHaveLength(1);
    const evt = result[0] as any;
    expect(evt.kind).toBe("patch");
    expect(evt.content).toBe("some diff content");
  });

  it("returns empty for patch tool with no patch data", () => {
    const result = extractArtifactsFromToolOutput("apply_patch", {});
    expect(result).toHaveLength(0);
  });

  it("handles undefined output", () => {
    const result = extractArtifactsFromToolOutput("Edit", undefined);
    expect(result).toHaveLength(0);
  });
});

describe("formatContextSection", () => {
  it("formats single context item with ref", () => {
    const result = formatContextSection([
      { kind: "file", ref: "src/main.ts", content: "const x = 1;" },
    ]);
    expect(result).toContain("[file: src/main.ts]");
    expect(result).toContain("const x = 1;");
  });

  it("formats context item without ref", () => {
    const result = formatContextSection([
      { kind: "note", content: "remember this" },
    ]);
    expect(result).toContain("[note]");
    expect(result).toContain("remember this");
  });

  it("formats context item without content", () => {
    const result = formatContextSection([{ kind: "diff", ref: "abc123" }]);
    expect(result).toContain("(no content)");
  });

  it("separates multiple items with ---", () => {
    const result = formatContextSection([
      { kind: "file", ref: "a.ts", content: "a" },
      { kind: "file", ref: "b.ts", content: "b" },
    ]);
    expect(result).toContain("---");
    expect(result).toContain("[file: a.ts]");
    expect(result).toContain("[file: b.ts]");
  });

  it("returns empty string for empty array", () => {
    expect(formatContextSection([])).toBe("");
  });
});

describe("formatIssuesSection", () => {
  it("formats issue with provider and number", () => {
    const result = formatIssuesSection([
      { provider: "github", number: 42, title: "Fix bug", body: "Details here" },
    ]);
    expect(result).toContain("[GITHUB #42] Fix bug");
    expect(result).toContain("Details here");
  });

  it("formats issue without number", () => {
    const result = formatIssuesSection([
      { provider: "linear", title: "Add feature" },
    ]);
    expect(result).toContain("[LINEAR] Add feature");
  });

  it("excludes body when includeBody is false", () => {
    const result = formatIssuesSection(
      [{ provider: "github", number: 1, title: "Title", body: "Secret body" }],
      false,
    );
    expect(result).toContain("[GITHUB #1] Title");
    expect(result).not.toContain("Secret body");
  });

  it("handles null body", () => {
    const result = formatIssuesSection([
      { provider: "jira", title: "No body", body: null },
    ]);
    expect(result).toBe("[JIRA] No body");
  });

  it("separates multiple issues with ---", () => {
    const result = formatIssuesSection([
      { provider: "github", title: "One" },
      { provider: "linear", title: "Two" },
    ]);
    expect(result).toContain("---");
  });
});

describe("formatFilesSection", () => {
  it("formats file paths as list", () => {
    const result = formatFilesSection([
      { path: "src/a.ts" },
      { path: "src/b.ts" },
    ]);
    expect(result).toBe("- src/a.ts\n- src/b.ts");
  });

  it("returns empty string for empty array", () => {
    expect(formatFilesSection([])).toBe("");
  });
});

describe("appendPromptSections", () => {
  it("returns prompt unchanged when no options provided", () => {
    const result = appendPromptSections("Base prompt", {});
    expect(result).toBe("Base prompt");
  });

  it("appends context issues section", () => {
    const result = appendPromptSections("Do work", {
      contextIssues: [{ provider: "github", number: 1, title: "Fix it" }],
    });
    expect(result).toContain("Do work");
    expect(result).toContain("Context issues:");
    expect(result).toContain("[GITHUB #1] Fix it");
  });

  it("does not append a context files section (files arrive inline as @<path>)", () => {
    const result = appendPromptSections("Do work @src/a.ts", {
      contextFiles: [{ path: "src/a.ts" }],
    });
    expect(result).not.toContain("Context files");
    expect(result).toBe("Do work @src/a.ts");
  });

  it("skips empty issues array", () => {
    const result = appendPromptSections("Prompt", {
      contextIssues: [],
    });
    expect(result).toBe("Prompt");
  });

  it("respects includeIssueBody=false", () => {
    const result = appendPromptSections("Work", {
      contextIssues: [{ provider: "github", title: "T", body: "Body text" }],
      includeIssueBody: false,
    });
    expect(result).not.toContain("Body text");
  });
});

describe("emitUserPromptArtifact", () => {
  it("emits artifact event with correct type", async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    await emitUserPromptArtifact(onEvent, "Hello world");
    expect(onEvent).toHaveBeenCalledOnce();
    const event = onEvent.mock.calls[0][0];
    expect(event.type).toBe("artifact");
    expect(event.kind).toBe("user-prompt");
    expect(event.content).toBe("Hello world");
  });

  it("persists compact descriptors for images, documents and inline text", async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const attachments = [
      { name: "Blueprint.pdf", type: "document" as const, mimeType: "application/pdf" },
      { name: "notes.txt", type: "document" as const, mimeType: "text/plain" },
      { name: "img.png", type: "image" as const, mimeType: "image/png" },
    ].map((value, index) => ({ ...value, attachmentId: `attachment-${index}`, sourcePath: `/durable/${index}/${value.name}`, byteSize: 100 }));
    await emitUserPromptArtifact(onEvent, "content", { attachments, runId: "run" });
    expect(onEvent.mock.calls[0][0].metadata.attachments).toEqual(attachments.map(({ sourcePath: _path, ...descriptor }) => descriptor));
    const encoded = JSON.stringify(onEvent.mock.calls[0][0]);
    expect(encoded).not.toContain("/durable/");
    expect(encoded).not.toContain("dataUrl");
  });

  it("persists per-prompt browser annotation groups without unrelated context or DOM styling", async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    await emitUserPromptArtifact(onEvent, "deneme", {
      context: [
        { kind: "selection", metadata: { source: "browser", id: "first", url: "https://mains.dev", comment: "Bunlar nedir", elements: [
          { tagName: "section", selector: "#intro", text: "Introduction", styles: { color: "red" } },
          { tagName: "a", selector: "#link", componentName: "Link" },
        ] } },
        { kind: "selection", metadata: { source: "editor", elements: [{ tagName: "div", selector: "main" }] } },
        { kind: "selection", metadata: { source: "browser", tagName: "body", selector: "body" } },
        { kind: "selection", metadata: { source: "browser", id: "second", url: "https://docs.mains.dev", comment: "İkinci yorum", elements: [
          { tagName: "div", selector: "#card", text: "Card" },
        ] } },
      ],
    });
    const event = onEvent.mock.calls[0][0];
    expect(event.content).toBe("deneme");
    expect(event.metadata.browserAnnotations).toEqual([
      { id: "first", url: "https://mains.dev", comment: "Bunlar nedir", elements: [
        { tagName: "section", selector: "#intro", text: "Introduction" },
        { tagName: "a", selector: "#link", componentName: "Link" },
      ] },
      { id: "second", url: "https://docs.mains.dev", comment: "İkinci yorum", elements: [{ tagName: "div", selector: "#card", text: "Card" }] },
    ]);
  });

  it("persists review comments with both diff side and original code, excluding malformed context", async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const comment = { id: "comment", workspaceId: "ws", filePath: "a.ts", absolutePath: "/repo/a.ts", side: "deletions",
      lineNumber: 7, lineText: "oldCode", patchId: "patch", comment: "Keep this behavior" };
    await emitUserPromptArtifact(onEvent, "Address comments", { context: [
      { kind: "selection", metadata: { source: "review", ...comment } },
      { kind: "selection", metadata: { source: "review", ...comment, lineNumber: -1 } },
      { kind: "selection", metadata: { source: "editor", ...comment } },
    ] });
    expect(onEvent.mock.calls[0][0].metadata.reviewComments).toEqual([comment]);
  });

  it("includes issues and files metadata", async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    await emitUserPromptArtifact(onEvent, "content", {
      contextIssues: [{ provider: "github", title: "Bug" }],
      contextFiles: [{ path: "src/main.ts" }],
    });
    const event = onEvent.mock.calls[0][0];
    expect(event.metadata.issues).toHaveLength(1);
    expect(event.metadata.files).toHaveLength(1);
  });
});

describe("toolWrites", () => {
  it("names the file an edit tool wrote, whatever the provider calls it", () => {
    expect(toolWrites("Edit", { file_path: "/repo/a.ts" })).toEqual({
      paths: ["/repo/a.ts"],
      unnamed: false,
    });
    expect(toolWrites("NotebookEdit", { notebook_path: "nb.ipynb" }).paths).toEqual([
      "nb.ipynb",
    ]);
    // Codex fileChange rows and copilot's lowercase tools carry `path`.
    expect(toolWrites("Delete", { path: "gone.ts" }).paths).toEqual(["gone.ts"]);
    expect(toolWrites("create", { path: "new.ts" }).paths).toEqual(["new.ts"]);
  });

  it("reads every file out of an apply_patch envelope", () => {
    const envelope = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "@@",
      "-old",
      "+new",
      "*** Move to: src/b.ts",
      "*** Add File: src/c.ts",
      "+hello",
      "*** Delete File: src/d.ts",
      "*** End Patch",
    ].join("\n");
    expect(toolWrites("apply_patch", envelope)).toEqual({
      paths: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      unnamed: false,
    });
  });

  it("treats a shell, or a writing tool that names nothing, as unnamed writes", () => {
    expect(toolWrites("Bash", { command: "npm run format" })).toEqual({
      paths: [],
      unnamed: true,
    });
    expect(toolWrites("apply_patch", {})).toEqual({ paths: [], unnamed: true });
    expect(toolWrites("Write", {})).toEqual({ paths: [], unnamed: true });
  });

  it("reports nothing for tools that only read", () => {
    const none = { paths: [], unnamed: false };
    expect(toolWrites("Read", { file_path: "a.ts" })).toEqual(none);
    expect(toolWrites("Grep", { pattern: "x" })).toEqual(none);
    expect(toolWrites("str_replace_editor", { command: "view", path: "a.ts" })).toEqual(none);
  });
});
