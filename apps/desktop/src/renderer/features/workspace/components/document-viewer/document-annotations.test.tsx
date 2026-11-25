// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import type { DocumentAnnotationSurface } from "../../lib/document-selection";
import type { ContextItem } from "../../lib/composer-context";

const mocks = vi.hoisted(() => ({ key: "chat-a", dispatch: vi.fn(), capture: vi.fn(), revision: 0, items: [] as ContextItem[] }));
vi.mock("@/lib/local-document-url", () => ({ localDocumentUrlRevision: () => mocks.revision, subscribeLocalDocumentUrls: () => () => {} }));
vi.mock("@/lib/redux/hooks", () => ({ useAppDispatch: () => mocks.dispatch,
  useAppSelector: (select: (state: any) => unknown) => select({ workspace: { composerContextKey: mocks.key, composerContextReady: true, contextItems: mocks.items } }) }));
vi.mock("../../lib/document-capture", () => ({ captureDocumentPage: mocks.capture }));
import { DocumentAnnotations } from "./document-annotations";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) });
let surface: DocumentAnnotationSurface;
let nodes: HTMLElement[];
const doc = { fileName: "deck.pptx", path: "/work/deck.pptx", docType: "pptx" as const };
beforeEach(() => {
  mocks.key = "chat-a"; mocks.revision = 0; mocks.dispatch.mockReset(); mocks.capture.mockReset().mockResolvedValue("cGl4ZWxz");
  mocks.items = [];
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
  it.each(["pdf", "docx", "pptx"] as const)("keeps unsent %s annotations on the document until the composer releases them", async (docType) => {
    const document = { path: `/work/document.${docType}`, fileName: `document.${docType}`, docType };
    const view = render(<DocumentAnnotations surface={surface} doc={document} onExit={vi.fn()} />);
    fireEvent.click(nodes[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Rewrite this passage" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledOnce());
    mocks.items = [mocks.dispatch.mock.calls[0][0].payload.item];
    view.rerender(<DocumentAnnotations surface={surface} doc={document} onExit={vi.fn()} />);
    expect(screen.queryByRole("dialog", { name: "Annotate document" })).toBeNull();
    const mark = screen.getByRole("group", { name: "Pending edit 1: Rewrite this passage" });
    expect(mark.querySelector('[data-document-draft-outline]')?.getAttribute("style")).toContain("left: 100px");
    view.rerender(<DocumentAnnotations surface={surface} doc={document} active={false} onExit={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Pending edit 1: Rewrite this passage" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(nodes[0].hasAttribute("tabindex")).toBe(false);
    mocks.items = mocks.items.map((item) => ({ ...item, comment: "Edited in composer" } as ContextItem));
    view.rerender(<DocumentAnnotations surface={surface} doc={document} active={false} />);
    expect(screen.getByRole("group", { name: "Pending edit 1: Edited in composer" })).toBeTruthy();
    view.rerender(<DocumentAnnotations surface={surface} doc={{ ...document, path: "/work/other" }} active={false} />);
    expect(screen.queryByRole("group", { name: /Pending edit/ })).toBeNull();
    view.rerender(<DocumentAnnotations surface={surface} doc={document} active={false} />);
    expect(screen.getByRole("group", { name: /Pending edit 1/ })).toBeTruthy();
    mocks.items = [];
    view.rerender(<DocumentAnnotations surface={surface} doc={document} active={false} />);
    expect(screen.queryByRole("group", { name: /Pending edit/ })).toBeNull();
  });

  it("keeps pending text line boxes aligned after zoom, scrolling and text-node replacement", async () => {
    const document = { path: "/work/a.pdf", fileName: "a.pdf", docType: "pdf" as const };
    mocks.items = [{ kind: "document", id: "pending", documentType: "pdf", filePath: document.path, fileName: document.fileName,
      pageNumber: 1, comment: "Rewrite", screenshotData: "pixels", elements: [{ id: "text", name: "Text", type: "text", text: "Passage",
        rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
        rects: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.1 }, { x: 0.1, y: 0.2, width: 0.2, height: 0.1 }] }] }];
    render(<DocumentAnnotations surface={surface} doc={document} active={false} />);
    const marks = () => Array.from(screen.getByRole("group", { name: "Pending edit 1: Rewrite" }).querySelectorAll<HTMLElement>("[data-document-draft-outline]"));
    expect(marks()).toHaveLength(2);
    expect(marks()[0].style.width).toBe("300px");
    const page = surface.pages()[0];
    page.getBoundingClientRect = () => rect(0, -100, 2000, 1200);
    nodes.forEach((node) => node.remove());
    fireEvent.scroll(surface.viewport);
    await waitFor(() => expect(marks()[0].style.width).toBe("600px"));
    expect(marks()[0].style.left).toBe("200px");
    expect(marks()[0].style.top).toBe("20px");
    expect(marks()[1].style.top).toBe("140px");
    page.getBoundingClientRect = () => rect(0, -400, 2000, 1200);
    fireEvent.scroll(surface.viewport);
    await waitFor(() => expect(screen.queryByRole("group", { name: /Pending edit/ })).toBeNull());
  });

  it.each(["surface", "backend"])("retires selection when the %s changes at the same document path", (boundary) => {
    const view = render(<DocumentAnnotations surface={surface} doc={doc} onExit={vi.fn()} />);
    fireEvent.click(nodes[0]);
    if (boundary === "backend") mocks.revision++;
    view.rerender(<DocumentAnnotations surface={boundary === "surface" ? { ...surface } : surface} doc={doc} onExit={vi.fn()} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it("delivers a late capture to its original document without clearing the replacement draft", async () => {
    let finish!: (value: string) => void;
    mocks.capture.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<DocumentAnnotations surface={surface} doc={doc} onExit={vi.fn()} />);
    fireEvent.click(nodes[0]); fireEvent.change(screen.getByRole("textbox"), { target: { value: "Original comment" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    const replacement = { ...doc, path: "/docs/replacement.pptx", fileName: "replacement.pptx" };
    view.rerender(<DocumentAnnotations surface={surface} doc={replacement} onExit={vi.fn()} />);
    fireEvent.click(nodes[1]); fireEvent.change(screen.getByRole("textbox"), { target: { value: "Replacement comment" } });
    await act(async () => { finish("original pixels"); });
    expect(mocks.dispatch.mock.calls[0][0].payload).toMatchObject({ key: "chat-a", item: { filePath: doc.path, comment: "Original comment", screenshotData: "original pixels" } });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Replacement comment");
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledTimes(2));
    expect(mocks.dispatch.mock.calls[1][0].payload.item).toMatchObject({ filePath: replacement.path, comment: "Replacement comment" });
  });
  it("admits one capture when activation events arrive before React updates busy state", async () => {
    let finish!: (data: string) => void;
    mocks.capture.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<StrictMode><DocumentAnnotations surface={surface} doc={doc} onExit={vi.fn()} /></StrictMode>);
    fireEvent.click(nodes[0]);
    const button = screen.getByRole("button", { name: "Add to chat" });
    act(() => { button.click(); button.click(); });
    expect(mocks.capture).toHaveBeenCalledOnce();
    await act(async () => { finish("pixels"); });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });
  it("clears selected targets and comments when the document changes within the same chat", () => {
    const view = render(<DocumentAnnotations surface={surface} doc={doc} onExit={vi.fn()} />);
    fireEvent.click(nodes[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Old document comment" } });
    view.rerender(<DocumentAnnotations surface={surface} doc={{ ...doc, path: "/work/other.pptx", fileName: "other.pptx" }} onExit={vi.fn()} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.capture).not.toHaveBeenCalled();
    fireEvent.click(nodes[1]);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });
  it("switches selection modes with the shared selector and keyboard navigation", () => {
    render(<DocumentAnnotations surface={surface} doc={doc} onExit={vi.fn()} />);
    const items = screen.getByRole("radio", { name: "Select items" });
    const area = screen.getByRole("radio", { name: "Select area" });
    expect(items.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(area);
    expect(area.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Drag to select an area/)).toBeTruthy();
    fireEvent.keyDown(area, { key: "ArrowLeft" });
    expect(items.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Click a text box, image or shape/)).toBeTruthy();
  });

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
    expect(screen.getByRole("radio", { name: "Select area" }).hasAttribute("disabled")).toBe(true);
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
