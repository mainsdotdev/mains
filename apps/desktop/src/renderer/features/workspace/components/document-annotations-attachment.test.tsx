// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentAnnotation } from "@mains/contracts/document-annotations";
vi.mock("../hooks/use-composer-context", () => ({ useComposerContext: vi.fn() }));
import { DocumentAnnotationsAttachment } from "./document-annotations-attachment";

const annotation: DocumentAnnotation = {
  id: "annotation-1", fileName: "deck.pptx", filePath: "/work/deck.pptx", documentType: "pptx", pageNumber: 5, comment: "Make this clearer",
  elements: [{ id: "shape-42", name: "Procedure", type: "text", text: "First item", rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.5 } }],
};
afterEach(cleanup);
describe("presentation annotation attachments", () => {
  it("shows slide context and saves or removes the requested draft", async () => {
    const update = vi.fn(); const remove = vi.fn();
    render(<DocumentAnnotationsAttachment annotations={[annotation]} onUpdate={update} onRemove={remove} />);
    fireEvent.click(screen.getByRole("button", { name: "1 document annotation" }));
    expect(await screen.findByText("deck.pptx · Slide 5")).toBeTruthy();
    expect(screen.getByText("First item")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit document annotation 1" }));
    const input = screen.getByRole("textbox", { name: "Comment for document annotation 1" });
    fireEvent.change(input, { target: { value: "  New comment  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(update).toHaveBeenCalledExactlyOnceWith(annotation.id, "New comment");
    fireEvent.click(screen.getByRole("button", { name: "Delete document annotation 1" }));
    expect(remove).toHaveBeenCalledExactlyOnceWith(annotation.id);
  });
  it("keeps sent annotations read-only", async () => {
    render(<DocumentAnnotationsAttachment annotations={[annotation]} />);
    fireEvent.click(screen.getByRole("button", { name: "1 document annotation" }));
    expect(await screen.findByText(annotation.comment)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit document annotation 1" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete document annotation 1" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "1 document annotation" }).getAttribute("aria-expanded")).toBe("false");
  });
});
