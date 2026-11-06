// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentAnnotationSurface } from "../../lib/document-selection";

const mocks = vi.hoisted(() => ({ key: "chat-a", dispatch: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/redux/hooks", () => ({ useAppDispatch: () => mocks.dispatch,
  useAppSelector: (select: (state: any) => unknown) => select({ workspace: { composerContextKey: mocks.key, composerContextReady: true } }) }));
vi.mock("../../lib/document-capture", () => ({ captureDocumentPage: mocks.capture }));
import { DocumentAnnotations } from "./document-annotations";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) });
let surface: DocumentAnnotationSurface;
let nodes: HTMLElement[];
const doc = { fileName: "deck.pptx", path: "/work/deck.pptx", docType: "pptx" as const };
beforeEach(() => {
  mocks.key = "chat-a"; mocks.dispatch.mockReset(); mocks.capture.mockReset().mockResolvedValue("cGl4ZWxz");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const scroller = document.createElement("div"); scroller.className = "pptx-stage-scroller";
  scroller.getBoundingClientRect = () => rect(0, 0, 1000, 600);
  const root = document.createElement("div"); scroller.append(root); document.body.append(scroller);
  const slide = document.createElement("div"); root.append(slide); slide.getBoundingClientRect = () => rect(0, 0, 1000, 600);
  nodes = [document.createElement("div"), document.createElement("div")];
  nodes.forEach((node, index) => { node.textContent = `Text ${index}`; node.getBoundingClientRect = () => rect(100 + index * 400, 60, 300, 200); slide.append(node); });
  surface = { root, viewport: scroller, pages: () => [slide], textSelection: false, targets: new Map(nodes.map((node, index) => [node, {
    node, page: slide, pageNumber: 1, element: { id: `shape-${index}`, type: "text", name: `Text box ${index}`, text: node.textContent!, rect: { x: 0, y: 0, width: 0, height: 0 } },
  }])) };
});
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("presentation annotation interaction", () => {
  it("selects whole objects, groups a comment, and adds a captured selection to its composer", async () => {
    render(<DocumentAnnotations surface={surface} doc={doc} onExit={vi.fn()} />);
    fireEvent.click(nodes[0]); fireEvent.click(nodes[1]);
    expect(screen.getByText("Slide 1 · 2 selected items")).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "Document annotation comment" });
    fireEvent.change(input, { target: { value: "  Make these clearer  " } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(mocks.capture).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce());
    expect(mocks.dispatch.mock.calls[0][0].payload).toMatchObject({ key: "chat-a", item: {
      kind: "document", documentType: "pptx", filePath: doc.path, pageNumber: 1, comment: "Make these clearer", screenshotData: "cGl4ZWxz",
      elements: [expect.objectContaining({ id: "shape-0", rect: { x: 0.1, y: 0.1, width: 0.3, height: 1 / 3 } }), expect.objectContaining({ id: "shape-1" })],
    } });
  });
  it("retains the draft on capture failure and allows a retry", async () => {
    mocks.capture.mockRejectedValueOnce(new Error("Could not capture this slide"));
    render(<DocumentAnnotations surface={surface} doc={doc} onExit={vi.fn()} />);
    fireEvent.click(nodes[0]); fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add to chat" }).hasAttribute("disabled")).toBe(false));
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce());
  });
  it("keeps an in-flight capture with its original chat and clears selection on retargeting", async () => {
    let finish!: (data: string) => void;
    mocks.capture.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<DocumentAnnotations surface={surface} doc={doc} onExit={vi.fn()} />);
    fireEvent.click(nodes[0]); fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    mocks.key = "chat-b";
    view.rerender(<DocumentAnnotations surface={surface} doc={doc} onExit={vi.fn()} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    finish("pixels");
    await waitFor(() => expect(mocks.dispatch.mock.calls[0][0].payload.key).toBe("chat-a"));
  });
  it("supports keyboard selection, Escape, and restores the document's normal interaction", () => {
    const exit = vi.fn();
    const view = render(<DocumentAnnotations surface={surface} doc={doc} onExit={exit} />);
    expect(nodes[0].getAttribute("role")).toBe("button");
    fireEvent.keyDown(nodes[0], { key: "Enter" });
    expect(screen.getByRole("textbox")).toBeTruthy();
    const composerInput = document.createElement("textarea"); document.body.append(composerInput);
    fireEvent.keyDown(composerInput, { key: "Escape" });
    expect(exit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Document annotation comment" }), { key: "Escape" });
    expect(exit).toHaveBeenCalledOnce();
    view.unmount();
    expect(nodes[0].hasAttribute("tabindex")).toBe(false);
    expect(nodes[0].hasAttribute("role")).toBe(false);
  });
});
