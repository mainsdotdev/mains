import { describe, expect, it } from "vitest";
import { readDocumentAnnotations } from "@mains/contracts/document-annotations";
import { buildRunContextPayload } from "./run-context-payload";
import { composerAnnotationPrompt } from "./composer-message";
import { groupContextItems, withoutSubmittedContext, type ContextPresentationItem } from "./composer-context";

const annotation: ContextPresentationItem = {
  kind: "presentation", id: "selection-1", filePath: "/work/deck.pptx", fileName: "deck.pptx", slideNumber: 5,
  comment: "Make this clearer", screenshotData: "cGl4ZWxz",
  elements: [{ id: "element-1", type: "text", name: "Procedure", text: "First item", shapeId: "42",
    sourcePart: "ppt/slides/slide9.xml", rect: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 } }],
};
describe("presentation annotation context", () => {
  it("sends source identity and normalized geometry with a separate screenshot attachment", () => {
    const payload = buildRunContextPayload([annotation]);
    expect(payload.attachments).toEqual([{ name: "presentation-slide-5-annotation-selection-1.png", type: "image", mimeType: "image/png", data: annotation.screenshotData }]);
    const context = payload.initialContext[0];
    expect(context.ref).toBe("/work/deck.pptx#slide=5");
    expect(context.content).toContain("shape id: 42");
    expect(context.content).toContain(annotation.comment);
    expect(context.metadata).not.toHaveProperty("screenshotData");
    const { kind: _kind, screenshotData: _data, ...savedAnnotation } = annotation;
    expect(readDocumentAnnotations([context.metadata])).toEqual(readDocumentAnnotations([savedAnnotation]));
    expect(composerAnnotationPrompt([annotation])).toBe(annotation.comment);
    expect(groupContextItems([annotation]).documentAnnotations).toEqual([annotation]);
  });
  it("consumes only the submitted version, preserving edits made during a send", () => {
    expect(withoutSubmittedContext([annotation], [structuredClone(annotation)])).toEqual([]);
    const edited = { ...annotation, comment: "A newer comment" };
    expect(withoutSubmittedContext([edited], [annotation])).toEqual([edited]);
  });
  it("ignores malformed persisted selections", () => {
    expect(readDocumentAnnotations([{ ...annotation, slideNumber: 0 }, { ...annotation, elements: [{ ...annotation.elements[0], rect: { x: NaN } }] }])).toEqual([]);
  });
});
