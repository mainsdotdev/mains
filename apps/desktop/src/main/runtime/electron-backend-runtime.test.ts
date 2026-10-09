import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElectronBackendRuntime } from "./electron-backend-runtime";

const createFromBuffer = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({ app: {}, nativeImage: { createFromBuffer }, safeStorage: {}, shell: {}, powerSaveBlocker: {} }));
beforeEach(() => createFromBuffer.mockReset());

function bitmap(alpha: number) {
  return { isEmpty: () => false, getSize: () => ({ width: 256, height: 128 }),
    toBitmap: vi.fn(() => Buffer.from([20, 60, 90, alpha])),
    toPNG: vi.fn(() => Buffer.from("png")), toJPEG: vi.fn(() => Buffer.from("jpeg")) };
}

describe("Electron image previews", () => {
  it("resizes before inspecting transparency and preserves alpha as PNG", async () => {
    const scaled = bitmap(128);
    const resize = vi.fn(() => scaled);
    createFromBuffer.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 3000, height: 1500 }), resize });
    const preview = await createElectronBackendRuntime().imagePreview!.resize(Buffer.from("original"), 256, true);
    expect(resize).toHaveBeenCalledWith({ width: 256, height: 128, quality: "good" });
    expect(preview).toEqual({ bytes: Buffer.from("png"), mime: "image/png", width: 256, height: 128 });
    expect(scaled.toJPEG).not.toHaveBeenCalled();
  });

  it("keeps opaque previews compact, keeps chat JPEGs and never upscales", async () => {
    const source = bitmap(255);
    createFromBuffer.mockReturnValue(source);
    const codec = createElectronBackendRuntime().imagePreview!;
    expect(await codec.resize(Buffer.from("original"), 768, true)).toMatchObject({ mime: "image/jpeg", width: 256 });
    source.toBitmap.mockClear();
    expect(await codec.resize(Buffer.from("original"), 768)).toMatchObject({ mime: "image/jpeg" });
    expect(source.toBitmap).not.toHaveBeenCalled();
    expect(source.toJPEG).toHaveBeenCalledWith(82);
    createFromBuffer.mockReturnValue({ isEmpty: () => true });
    expect(await codec.resize(Buffer.from("invalid"), 256)).toBeNull();
  });
});
