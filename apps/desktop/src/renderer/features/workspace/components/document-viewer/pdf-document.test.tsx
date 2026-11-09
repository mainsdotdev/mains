// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ fetch: vi.fn(), getDocument: vi.fn(), revision: 0, textCancel: vi.fn(),
  visible: [] as Array<(entries: { isIntersecting: boolean }[]) => void> }));
vi.mock("@/lib/local-document-url", () => ({ fetchLocalDocument: native.fetch,
  localDocumentUrlRevision: () => native.revision, subscribeLocalDocumentUrls: () => () => {} }));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: native.getDocument,
  TextLayer: class { textDivs: HTMLElement[] = []; render = async () => {}; cancel = native.textCancel; } }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?worker", () => ({ default: class {} }));
vi.mock("./document-annotations", () => ({ DocumentAnnotations: () => null }));
vi.mock("./document-fallback", () => ({ DocumentFallback: ({ doc }: { doc: { fileName: string } }) => <div role="alert">{doc.fileName}</div> }));
import { PdfDocument } from "./pdf-document";

const doc = { path: "/docs/a.pdf", fileName: "a.pdf", docType: "pdf" as const };
function page() { return { getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale, scale, userUnit: 1 }),
  render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })), streamTextContent: vi.fn() }; }
beforeEach(() => {
  native.fetch.mockReset().mockImplementation(async () => new Response(new Uint8Array([1])));
  native.getDocument.mockReset(); native.revision = 0; native.visible = []; native.textCancel.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { native.visible.push(callback); }
    observe() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(824);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("PDF document lifetime", () => {
  it("keeps the newest zoom render and releases canvas/text layers when a page leaves the viewport", async () => {
    const p = page(), oldCancel = vi.fn(), newCancel = vi.fn(), destroy = vi.fn();
    let oldReady!: () => void, newReady!: () => void;
    p.render.mockReturnValueOnce({ promise: new Promise<void>((resolve) => { oldReady = resolve; }), cancel: oldCancel })
      .mockReturnValueOnce({ promise: new Promise<void>((resolve) => { newReady = resolve; }), cancel: newCancel });
    native.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: vi.fn(async () => p) }), destroy });
    const view = render(<PdfDocument doc={doc} zoom={1} />);
    await screen.findByLabelText("Page 1");
    act(() => native.visible[0]([{ isIntersecting: true }]));
    await waitFor(() => expect(p.render).toHaveBeenCalledTimes(1));
    view.rerender(<PdfDocument doc={doc} zoom={2} />);
    await waitFor(() => expect(p.render).toHaveBeenCalledTimes(2));
    expect(oldCancel).toHaveBeenCalledOnce();
    await act(async () => { newReady(); });
    const newest = screen.getByLabelText("Page 1").querySelector("canvas");
    expect(newest?.width).toBe(1600);
    await act(async () => { oldReady(); });
    expect(screen.getByLabelText("Page 1").querySelector("canvas")).toBe(newest);
    act(() => native.visible[0]([{ isIntersecting: false }]));
    expect(screen.getByLabelText("Page 1").childNodes).toHaveLength(0);
    expect(newCancel).toHaveBeenCalledOnce(); expect(native.textCancel).toHaveBeenCalledTimes(2);
    view.unmount(); expect(destroy).toHaveBeenCalledOnce();
  });
  it("releases text rendering even when canvas cancellation throws during close", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = page(), cancel = vi.fn(() => { throw new Error("Native canvas cancellation failed"); });
    let finish!: () => void;
    p.render.mockReturnValue({ promise: new Promise<void>((resolve) => { finish = resolve; }), cancel });
    native.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: vi.fn(async () => p) }), destroy: vi.fn() });
    const view = render(<PdfDocument doc={doc} zoom={1} />);
    await screen.findByLabelText("Page 1");
    act(() => native.visible[0]([{ isIntersecting: true }]));
    await waitFor(() => expect(p.render).toHaveBeenCalledOnce());
    try {
      expect(() => view.unmount()).not.toThrow();
      expect(cancel).toHaveBeenCalledOnce();
      expect(native.textCancel).toHaveBeenCalledOnce();
    } finally { await act(async () => { finish(); }); }
  });
  it("does not request pages from a loading task resolved after close", async () => {
    let finish!: (value: unknown) => void;
    const destroy = vi.fn(), getPage = vi.fn(async () => page());
    native.getDocument.mockReturnValue({ promise: new Promise((resolve) => { finish = resolve; }), destroy });
    const view = render(<PdfDocument doc={doc} zoom={1} />);
    await waitFor(() => expect(native.getDocument).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => { finish({ numPages: 1, getPage }); });
    expect(getPage).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });
  it("hides the previous document while a replacement source is loading", async () => {
    native.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: vi.fn(async () => page()) }), destroy: vi.fn() });
    const view = render(<PdfDocument doc={doc} zoom={1} />);
    await screen.findByLabelText("Page 1");
    let finish!: (value: Response) => void;
    native.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    view.rerender(<PdfDocument doc={{ ...doc, path: "/docs/b.pdf", fileName: "b.pdf" }} zoom={1} />);
    expect(screen.queryByLabelText("Page 1")).toBeNull();
    expect(screen.getByText("Loading document…")).toBeTruthy();
    await act(async () => { finish(new Response(new Uint8Array([2]))); });
    await screen.findByLabelText("Page 1");
  });
});
