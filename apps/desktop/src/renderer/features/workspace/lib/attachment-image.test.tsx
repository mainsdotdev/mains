// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/transport/registry", () => ({ getTransport: () => transport, onTransportChange: vi.fn() }));
import { clearAttachmentImageCache, loadAttachmentImage, useAttachmentImage } from "./attachment-image";

let created = vi.fn((_blob?: Blob | MediaSource) => "");
let revoked = vi.fn((_url: string) => {});
beforeEach(() => {
  created = vi.fn((_blob?: Blob | MediaSource) => `blob:preview-${created.mock.calls.length}`);
  revoked = vi.fn((_url: string) => {});
  const OriginalURL = URL;
  vi.stubGlobal("URL", class extends OriginalURL {
    static createObjectURL = created;
    static revokeObjectURL = revoked;
  });
  transport.invoke.mockReset().mockResolvedValue({ success: true, data: { mime: "image/jpeg", base64: "eA==", width: 256, height: 128 } });
});
afterEach(() => { cleanup(); clearAttachmentImageCache(); vi.unstubAllGlobals(); });

describe("attachment pixel lifetime", () => {
  it("coalesces thumbnail requests and revokes unused entries when the LRU fills", async () => {
    const [first, duplicate] = await Promise.all([loadAttachmentImage("run", "first"), loadAttachmentImage("run", "first")]);
    expect(first.src).toBe(duplicate.src); expect(transport.invoke).toHaveBeenCalledOnce();
    first.release(); duplicate.release();
    for (let i = 0; i < 64; i++) (await loadAttachmentImage("run", `next-${i}`)).release();
    expect(revoked).toHaveBeenCalledWith(first.src);
    expect(first.isActive()).toBe(false);
  });

  it("releases expanded previews immediately and drops all URLs on a backend swap", async () => {
    const thumbnail = await loadAttachmentImage("run", "image");
    const expanded = await loadAttachmentImage("run", "image", 1600);
    expanded.release(); expanded.release();
    expect(revoked).toHaveBeenCalledExactlyOnceWith(expanded.src);
    expect(thumbnail.isActive()).toBe(true);
    clearAttachmentImageCache();
    expect(thumbnail.isActive()).toBe(false);
    expect(revoked).toHaveBeenCalledWith(thumbnail.src);
    thumbnail.release();
  });

  it("rejects a response that belongs to the previous backend", async () => {
    let resolve!: (value: unknown) => void;
    transport.invoke.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = loadAttachmentImage("run", "image");
    clearAttachmentImageCache();
    resolve({ success: true, data: { mime: "image/jpeg", base64: "eA==" } });
    await expect(pending).rejects.toThrow("Backend changed");
    expect(created).not.toHaveBeenCalled();
  });

  it("loads only near the viewport and removes pixels while offscreen", async () => {
    let intersect!: (values: Array<{ isIntersecting: boolean }>) => void;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: typeof intersect) { intersect = callback; }
      observe() {} disconnect() {}
    });
    function Tile() {
      const image = useAttachmentImage("run", "image");
      return <div ref={image.observe}>{image.src && <img src={image.src} alt="attachment" />}</div>;
    }
    render(<Tile />);
    expect(transport.invoke).not.toHaveBeenCalled();
    act(() => intersect([{ isIntersecting: true }]));
    await screen.findByRole("img");
    act(() => intersect([{ isIntersecting: false }]));
    expect(screen.queryByRole("img")).toBeNull();
    act(() => intersect([{ isIntersecting: true }]));
    await waitFor(() => expect(screen.getByRole("img")).toBeTruthy());
    expect(transport.invoke).toHaveBeenCalledOnce();
  });
});
