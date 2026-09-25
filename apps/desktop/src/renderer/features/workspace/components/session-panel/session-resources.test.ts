import { describe, expect, it } from "vitest";
import type {
  RunArtifact,
  RunContext,
  RunOutputFile,
  ToolCall,
} from "@/lib/redux/api";
import { buildSessionResources } from "./session-resources";

const context = (overrides: Partial<RunContext>): RunContext => ({
  id: 1,
  runId: "run-1",
  kind: "file",
  ref: null,
  content: null,
  entityId: null,
  contentHash: null,
  metadata: null,
  createdAt: 1_000,
  ...overrides,
});

const artifact = (overrides: Partial<RunArtifact>): RunArtifact => ({
  id: 1,
  runId: "run-1",
  kind: "file",
  path: null,
  content: null,
  entityId: null,
  contentHash: null,
  metadata: null,
  createdAt: 1_000,
  ...overrides,
});

const toolCall = (overrides: Partial<ToolCall>): ToolCall => ({
  id: 1,
  accountId: "default",
  runId: "run-1",
  providerId: "codex",
  toolCallId: "call-1",
  parentToolCallId: null,
  toolName: "WebSearch",
  status: "done",
  input: null,
  output: null,
  error: null,
  startedAt: null,
  endedAt: null,
  latencyMs: null,
  costMicros: null,
  metadata: null,
  createdAt: 1_000,
  ...overrides,
});

const outputFile = (overrides: Partial<RunOutputFile>): RunOutputFile => ({
  fileName: "output.md",
  relativePath: "output.md",
  absolutePath: "/runs/run-1/work/output.md",
  size: 128,
  modifiedAt: 1_000,
  ...overrides,
});

describe("buildSessionResources", () => {
  it("projects collection, editor, and browser context with provenance", () => {
    const result = buildSessionResources({
      context: [
        context({
          id: 1,
          ref: "/collections/source-1/content.pdf",
          metadata: { origin: "collection-source", sourceName: "brief.pdf" },
        }),
        context({
          id: 2,
          kind: "selection",
          ref: "/repo/src/app.ts#L4-L8",
          metadata: {
            source: "editor",
            filePath: "/repo/src/app.ts",
            fileName: "app.ts",
            startLine: 4,
            endLine: 8,
          },
        }),
        context({
          id: 3,
          kind: "selection",
          ref: "https://example.com/guide",
          metadata: {
            source: "browser",
            url: "https://example.com/guide",
            title: "Example guide",
          },
        }),
      ],
      artifacts: [],
      toolCalls: [],
    });

    expect(result.sources.map((item) => [item.title, item.badge])).toEqual([
      ["brief.pdf", "Project"],
      ["app.ts", "You"],
      ["Example guide", "Browser"],
    ]);
  });

  it("recovers attachments and structured context from persisted prompt artifacts", () => {
    const result = buildSessionResources({
      context: [],
      artifacts: [
        artifact({
          kind: "user-prompt" as RunArtifact["kind"],
          metadata: {
            source: "user",
            attachments: [
              {
                name: "research.pdf",
                type: "document",
                mimeType: "application/pdf",
                path: "/tmp/research.pdf",
              },
              {
                name: "reference.png",
                type: "image",
                mimeType: "image/png",
                captureName: "capture.png",
              },
            ],
            files: [{ path: "/repo/README.md", type: "file" }],
            issues: [{ provider: "github", number: 42, title: "Broken flow" }],
            signals: [{ source: "sentry", level: "error", title: "Crash loop" }],
          },
        }),
      ],
      toolCalls: [],
    });

    expect(result.sources.map((item) => item.title)).toEqual([
      "research.pdf",
      "reference.png",
      "README.md",
      "#42 Broken flow",
      "Crash loop",
    ]);
    expect(result.sources[1]?.target).toEqual({
      type: "image",
      value: "mains-capture://cap/capture.png",
    });
  });

  it("groups search queries and lists only URLs a web tool actually received", () => {
    const result = buildSessionResources({
      context: [],
      artifacts: [],
      toolCalls: [
        toolCall({ id: 1, input: { query: "first query" } }),
        toolCall({
          id: 2,
          toolName: "web.run",
          input: {
            search_query: [{ q: "second query" }],
            open: [{ ref_id: "https://example.com/docs" }],
          },
        }),
        toolCall({ id: 3, status: "error", input: { url: "https://ignored.dev" } }),
      ],
    });

    expect(result.sources.map((item) => item.title)).toEqual([
      "example.com/docs",
      "Web research",
    ]);
    expect(result.sources[1]?.badge).toBe("2 searches");
  });

  it("collects links shared in prompts and assistant messages", () => {
    const result = buildSessionResources({
      context: [],
      artifacts: [
        artifact({
          id: 1,
          kind: "user-prompt" as RunArtifact["kind"],
          content: "Use https://example.com/brief.pdf.",
          createdAt: 1_000,
        }),
        artifact({
          id: 2,
          kind: "report",
          content:
            "See [the guide](https://docs.example.com/guide_(new)) and https://example.com/brief.pdf",
          metadata: { source: "assistant.message" },
          createdAt: 2_000,
        }),
        artifact({
          id: 3,
          kind: "report",
          content: "Internal log with https://ignored.dev",
          metadata: { source: "tool.output" },
          createdAt: 3_000,
        }),
      ],
      toolCalls: [],
    });

    expect(result.sources.map((item) => [item.title, item.badge])).toEqual([
      ["docs.example.com/guide_(new)", "Chat"],
      ["example.com/brief.pdf", "Chat"],
    ]);
  });

  it("lists only prompt plugins that were actually used by MCP calls", () => {
    const result = buildSessionResources({
      context: [],
      artifacts: [
        artifact({
          kind: "user-prompt" as RunArtifact["kind"],
          metadata: {
            source: "user",
            skills: [
              {
                name: "app-gmail",
                displayName: "Gmail",
                scope: "plugin",
                iconSmall: "https://example.com/gmail.png",
                brandColor: "#ea4335",
              },
              {
                name: "app-notion",
                displayName: "Notion",
                scope: "plugin",
              },
              {
                name: "frontend-design",
                displayName: "Frontend Design",
                scope: "user",
              },
            ],
          },
        }),
      ],
      toolCalls: [
        toolCall({
          id: 1,
          toolName: "mcp__codex_apps__gmail.get_profile",
          createdAt: 2_000,
        }),
        toolCall({
          id: 2,
          toolName: "mcp__codex_apps__gmail.search_emails",
          createdAt: 3_000,
        }),
        toolCall({
          id: 3,
          toolName: "mcp__codex_apps__notion.search",
          status: "canceled",
          createdAt: 4_000,
        }),
        toolCall({ id: 4, toolName: "mcp__mains__get_context" }),
      ],
    });

    expect(result.plugins).toEqual([
      {
        id: "plugin-gmail",
        slug: "gmail",
        title: "Gmail",
        iconSource: "https://example.com/gmail.png",
        brandColor: "#ea4335",
        callCount: 2,
        createdAt: 3_000_000,
      },
    ]);
  });

  it("keeps outputs separate, dedupes paths, and hides document render previews", () => {
    const result = buildSessionResources({
      context: [],
      toolCalls: [],
      artifacts: [
        artifact({ id: 1, kind: "document", path: "/out/report.docx" }),
        artifact({ id: 2, kind: "image", path: "/out/report.docx.png" }),
        artifact({ id: 3, kind: "file", path: "/out/data.csv", createdAt: 2_000 }),
        artifact({ id: 4, kind: "file", path: "/out/data.csv", createdAt: 3_000 }),
        artifact({ id: 5, kind: "document", path: "/draft/summary.pdf", createdAt: 4_000 }),
        artifact({ id: 6, kind: "document", path: "/final/summary.pdf", createdAt: 5_000 }),
        artifact({ id: 7, kind: "image", path: "/final/summary.pdf.png", createdAt: 6_000 }),
      ],
    });

    expect(result.sources).toEqual([]);
    expect(result.deliverables.map((item) => item.title)).toEqual([
      "summary.pdf",
      "data.csv",
      "report.docx",
    ]);
    expect(result.deliverables[0]?.target).toEqual({
      type: "file",
      value: "/final/summary.pdf",
    });
  });

  it("adds visible execution files as deliverables and keeps explicit artifacts authoritative", () => {
    const result = buildSessionResources({
      context: [],
      toolCalls: [],
      artifacts: [
        artifact({
          id: 1,
          kind: "document",
          path: "/artifacts/report.md",
          createdAt: 5_000,
        }),
      ],
      outputFiles: [
        outputFile({
          fileName: "report.md",
          absolutePath: "/runs/run-1/work/report.md",
          relativePath: "report.md",
          modifiedAt: 6_000_000,
        }),
        outputFile({
          fileName: "chart.png",
          absolutePath: "/runs/run-1/work/chart.png",
          relativePath: "chart.png",
          modifiedAt: 4_000_000,
        }),
        outputFile({
          fileName: "slides.pptx",
          absolutePath: "/runs/run-1/work/slides.pptx",
          relativePath: "slides.pptx",
          modifiedAt: 3_000_000,
        }),
        outputFile({
          fileName: "slides.pptx.png",
          absolutePath: "/runs/run-1/work/slides.pptx.png",
          relativePath: "slides.pptx.png",
          modifiedAt: 3_500_000,
        }),
      ],
    });

    expect(result.deliverables.map((item) => item.title)).toEqual([
      "report.md",
      "chart.png",
      "slides.pptx",
    ]);
    expect(result.deliverables[0]?.target).toEqual({
      type: "file",
      value: "/artifacts/report.md",
    });
    expect(result.deliverables[1]?.target?.type).toBe("image");
  });

  it("collapses document revisions and hides generated sidecars from a presentation bundle", () => {
    const result = buildSessionResources({
      context: [],
      toolCalls: [],
      artifacts: [],
      outputFiles: [
        outputFile({
          fileName: "mains_pitch_deck.pptx",
          relativePath: "build/preview/mains_pitch_deck.pptx",
          absolutePath: "/runs/run-1/work/build/preview/mains_pitch_deck.pptx",
          modifiedAt: 1_000,
        }),
        outputFile({
          fileName: "mains-pitch-deck.pptx",
          relativePath: "mains-pitch-deck.pptx",
          absolutePath: "/runs/run-1/work/mains-pitch-deck.pptx",
          modifiedAt: 7_000,
        }),
        outputFile({
          fileName: "mains_pitch_deck.pdf",
          relativePath: "build/preview/mains_pitch_deck.pdf",
          absolutePath: "/runs/run-1/work/build/preview/mains_pitch_deck.pdf",
          modifiedAt: 2_000,
        }),
        outputFile({
          fileName: "mains-pitch-deck.pdf",
          relativePath: "mains-pitch-deck.pdf",
          absolutePath: "/runs/run-1/work/mains-pitch-deck.pdf",
          modifiedAt: 6_000,
        }),
        outputFile({
          fileName: "mains_pitch_deck.fodp",
          relativePath: "build/mains_pitch_deck.fodp",
          absolutePath: "/runs/run-1/work/build/mains_pitch_deck.fodp",
          modifiedAt: 3_000,
        }),
        outputFile({
          fileName: "mains-pitch-deck.svg",
          relativePath: "build/mains-pitch-deck.svg",
          absolutePath: "/runs/run-1/work/build/mains-pitch-deck.svg",
          modifiedAt: 4_000,
        }),
        outputFile({
          fileName: "mains-pitch-deck.html",
          relativePath: "build/mains-pitch-deck.html",
          absolutePath: "/runs/run-1/work/build/mains-pitch-deck.html",
          modifiedAt: 5_000,
        }),
      ],
    });

    expect(result.deliverables.map((item) => item.title)).toEqual([
      "mains-pitch-deck.pptx",
      "mains-pitch-deck.pdf",
    ]);
  });
});
