// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ fetch: vi.fn(), docx: vi.fn(), revision: 0 }));
vi.mock("@/lib/local-document-url", () => ({ fetchLocalDocument: native.fetch,
  localDocumentUrlRevision: () => native.revision, subscribeLocalDocumentUrls: () => () => {} }));
vi.mock("./renderers/render-docx", () => ({ renderDocx: native.docx }));
vi.mock("./document-annotations", () => ({ DocumentAnnotations: ({ active }: { active: boolean }) => <div data-testid="annotation-layer" data-active={active} /> }));
vi.mock("./document-fallback", () => ({ DocumentFallback: () => <div role="alert">Unavailable</div> }));
import { DocumentRenderHost } from "./document-render-host";
const doc = { path: "/docs/a.docx", fileName: "a.docx", docType: "docx" as const };
const controller = () => ({ destroy: vi.fn(), setZoom: vi.fn(), annotationSurface: {} });
beforeEach(() => {
  native.fetch.mockReset().mockImplementation(async () => new Response(new Uint8Array([1])));
  native.docx.mockReset(); native.revision = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Office render lifetime", () => {
  it("disposes a late old controller without destroying or overwriting its replacement", async () => {
    const old = controller(), current = controller();
    let finish!: (value: ReturnType<typeof controller>) => void;
    native.docx.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockImplementationOnce(async (_bytes, wrapper: HTMLElement) => { wrapper.textContent = "Current document"; return current; });
    const view = render(<DocumentRenderHost doc={doc} zoom={1} />);
    await waitFor(() => expect(native.docx).toHaveBeenCalledTimes(1));
    view.rerender(<DocumentRenderHost doc={{ ...doc, path: "/docs/b.docx", fileName: "b.docx" }} zoom={1.5} />);
    await waitFor(() => expect(screen.queryByText("Loading document…")).toBeNull());
    await act(async () => { finish(old); });
    expect(old.destroy).toHaveBeenCalledOnce(); expect(current.destroy).not.toHaveBeenCalled();
    const host = view.container.querySelector(".isolate")!;
    expect(host.shadowRoot?.textContent).toContain("Current document");
    expect(current.setZoom).toHaveBeenLastCalledWith(1.5);
    expect(screen.getByTestId("annotation-layer").getAttribute("data-active")).toBe("false");
    view.unmount(); expect(current.destroy).toHaveBeenCalledOnce(); expect(old.destroy).toHaveBeenCalledOnce();
  });
  it("disposes the native controller immediately when an empty render fails", async () => {
    const ctl = controller(); native.docx.mockResolvedValue(ctl);
    const view = render(<DocumentRenderHost doc={doc} zoom={1} />);
    await screen.findByRole("alert");
    expect(ctl.destroy).toHaveBeenCalledOnce();
    view.unmount();
    expect(ctl.destroy).toHaveBeenCalledOnce();
  });
});
