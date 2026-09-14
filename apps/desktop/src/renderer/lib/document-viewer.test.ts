import { describe, it, expect } from "vitest";
import {
  classifyDocType,
  isTextDocType,
  pickRenderer,
  shouldFallback,
  DOC_VIEWER_LABELS,
  isDocumentRenderImage,
} from "./document-viewer";

describe("classifyDocType", () => {
  it("classifies supported OOXML extensions", () => {
    expect(classifyDocType("report.docx")).toBe("docx");
    expect(classifyDocType("budget.xlsx")).toBe("xlsx");
    expect(classifyDocType("deck.pptx")).toBe("pptx");
  });

  it("is case-insensitive", () => {
    expect(classifyDocType("REPORT.DOCX")).toBe("docx");
    expect(classifyDocType("Deck.PptX")).toBe("pptx");
  });

  it("handles full absolute paths", () => {
    expect(classifyDocType("/Users/me/work/codex-use-cases.pptx")).toBe("pptx");
    expect(classifyDocType("~/Downloads/data.xlsx")).toBe("xlsx");
  });

  it("ignores query/hash suffixes (e.g. from a signed URL)", () => {
    expect(classifyDocType("file.docx?exp=123&sig=abc")).toBe("docx");
    expect(classifyDocType("file.pptx#section")).toBe("pptx");
  });

  it("returns null for legacy binary office formats", () => {
    expect(classifyDocType("old.doc")).toBeNull();
    expect(classifyDocType("old.xls")).toBeNull();
    expect(classifyDocType("old.ppt")).toBeNull();
  });

  it("classifies markdown", () => {
    expect(classifyDocType("notes.md")).toBe("md");
    expect(classifyDocType("NOTES.MD")).toBe("md");
    expect(classifyDocType("readme.markdown")).toBe("md");
    expect(classifyDocType("/tmp/runs/r1/work/plan.md")).toBe("md");
  });

  it("returns null for non-office files and edge cases", () => {
    expect(classifyDocType("image.png")).toBeNull();
    expect(classifyDocType("README")).toBeNull();
    expect(classifyDocType("")).toBeNull();
    expect(classifyDocType("archive.docx.zip")).toBeNull();
  });
});

describe("pickRenderer", () => {
  it("maps each doc type to its renderer key", () => {
    expect(pickRenderer("docx")).toBe("docx");
    expect(pickRenderer("xlsx")).toBe("xlsx");
    expect(pickRenderer("pptx")).toBe("pptx");
  });
});

describe("shouldFallback", () => {
  it("falls back when the renderer threw", () => {
    expect(shouldFallback({ threw: true, producedNodes: 5 })).toBe(true);
  });

  it("falls back when nothing was rendered", () => {
    expect(shouldFallback({ threw: false, producedNodes: 0 })).toBe(true);
  });

  it("does not fall back on a successful render", () => {
    expect(shouldFallback({ threw: false, producedNodes: 3 })).toBe(false);
  });
});

describe("isDocumentRenderImage", () => {
  const docs = [
    "/ws/outputs/documents/file-over-app-brief.docx",
    "/ws/outputs/documents/deck.pptx",
  ];

  it("returns false when the run produced no documents", () => {
    expect(isDocumentRenderImage("/ws/outputs/documents/anything.png", [])).toBe(false);
  });

  it("flags a png whose stem ends with a document extension", () => {
    expect(
      isDocumentRenderImage("/ws/outputs/documents/file-over-app-brief.docx.png", docs),
    ).toBe(true);
    expect(isDocumentRenderImage("/tmp/whatever/deck.pptx.png", docs)).toBe(true);
  });

  it("flags page renders living in a subdirectory of a document's folder", () => {
    expect(
      isDocumentRenderImage(
        "/ws/outputs/documents/rendered-file-over-app-brief/slide-01.png",
        docs,
      ),
    ).toBe(true);
    expect(
      isDocumentRenderImage("/ws/outputs/documents/rendered-deck/contact-sheet.png", docs),
    ).toBe(true);
  });

  it("leaves an intentional image in a sibling folder alone", () => {
    expect(isDocumentRenderImage("/ws/outputs/images/cat.png", docs)).toBe(false);
  });

  it("leaves an intentional image in the document's own folder alone", () => {
    // same dir as the doc, generic name → not a render byproduct
    expect(isDocumentRenderImage("/ws/outputs/documents/diagram.png", docs)).toBe(false);
  });
});

describe("DOC_VIEWER_LABELS", () => {
  it("has a human label for every doc type", () => {
    expect(DOC_VIEWER_LABELS.docx).toBeTruthy();
    expect(DOC_VIEWER_LABELS.xlsx).toBeTruthy();
    expect(DOC_VIEWER_LABELS.pptx).toBeTruthy();
  });
});

describe("isTextDocType", () => {
  it("separates the React-rendered formats from the shadow-DOM ones", () => {
    // The panel branches on this: text renders as React so it keeps the app's
    // theme, Office bytes go behind a shadow root.
    expect(isTextDocType("md")).toBe(true);
    expect(isTextDocType("docx")).toBe(false);
    expect(isTextDocType("xlsx")).toBe(false);
    expect(isTextDocType("pptx")).toBe(false);
  });
});
