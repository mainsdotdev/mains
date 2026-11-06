import { describe, expect, it } from "vitest";
import { readDocumentAnnotations, type AnnotatableDocumentType } from "@mains/contracts/document-annotations";
import { buildRunContextPayload } from "./run-context-payload";
import { composerAnnotationPrompt } from "./composer-message";
import { groupContextItems, withoutSubmittedContext, type ContextDocumentItem } from "./composer-context";

function annotation(documentType: AnnotatableDocumentType): ContextDocumentItem {
  return { kind: "document", id: "annotation-1", documentType, pageNumber: 2, filePath: `/work/document.${documentType}`, fileName: `document.${documentType}`,
    comment: "Rewrite this passage", screenshotData: "cGl4ZWxz", elements: [{ id: "text-1", type: "text", name: "Selected text", text: "selected passage",
      rect: { x: 0.1, y: 0.2, width: 0.4, height: 0.1 }, rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.05 }, { x: 0.1, y: 0.25, width: 0.2, height: 0.05 }],
      textAnchor: { startOffset: 7, endOffset: 23, before: "Before ", after: " after" } }] };
}
describe("shared document annotations", () => {
  it.each(["pptx", "pdf", "docx"] as const)("uses the common attachment and context flow for %s", (type) => {
    const item = annotation(type); const payload = buildRunContextPayload([item]);
    expect(payload.attachments?.[0]).toEqual({ name: "document-page-2-annotation-annotation-1.png", type: "image", data: "cGl4ZWxz", mimeType: "image/png" });
    expect(payload.initialContext[0].ref).toBe(`${item.filePath}#${type === "pptx" ? "slide" : "page"}=2`);
    expect(payload.initialContext[0].content).toContain("Before ");
    expect(payload.initialContext[0].metadata).toMatchObject({ source: "document", documentType: type, elements: item.elements });
    expect(payload.initialContext[0].metadata).not.toHaveProperty("screenshotData");
    expect(groupContextItems([item]).documentAnnotations).toEqual([item]);
    expect(composerAnnotationPrompt([item])).toBe(item.comment);
    expect(withoutSubmittedContext([item], [structuredClone(item)])).toEqual([]);
    expect(withoutSubmittedContext([{ ...item, comment: "Edited while sending" }], [item])).toHaveLength(1);
  });
  it("reads historical presentation metadata as a document annotation", () => {
    const { documentType: _type, pageNumber, ...item } = annotation("pptx");
    expect(readDocumentAnnotations([{ ...item, slideNumber: pageNumber }])[0]).toMatchObject({ documentType: "pptx", pageNumber: 2 });
  });
  it("ignores malformed document metadata and unsafe geometry", () => {
    expect(readDocumentAnnotations([{ ...annotation("pdf"), documentType: "html" }, { ...annotation("docx"), pageNumber: 0 },
      { ...annotation("pdf"), elements: [{ ...annotation("pdf").elements[0], rect: { x: Infinity } }] }])).toEqual([]);
  });
});
