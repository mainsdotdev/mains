// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTransport } from "@/lib/transport/registry";
import type { Transport } from "@/lib/transport/types";
import { signLocalImage } from "@/lib/local-image-url";
import { useLocalImageUrl } from "./use-local-image-url";

const sign = vi.fn();
beforeEach(() => {
  setTransport({} as Transport);
  sign.mockReset();
  sign.mockImplementation(async (path: string, size?: number) => ({ success: true,
    data: `mains-localimg://img/?path=${encodeURIComponent(path)}&size=${size ?? "original"}&exp=${Date.now() + 3_600_000}&sig=test` }));
  Object.defineProperty(window, "api", { configurable: true, value: { imageProxy: { sign } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("sized local image URLs", () => {
  it("deduplicates signing per size and keeps the original URL separate", async () => {
    const { result, rerender } = renderHook(({ side }: { side?: 256 | 768 | 2048 }) => useLocalImageUrl("/tmp/photo.png", side),
      { initialProps: { side: 256 as 256 | 768 | 2048 | undefined } });
    await waitFor(() => expect(result.current).toContain("size=256"));
    await Promise.all([signLocalImage("/tmp/photo.png", 256), signLocalImage("/tmp/photo.png", 256)]);
    expect(sign).toHaveBeenCalledTimes(1);
    rerender({ side: 768 });
    await waitFor(() => expect(result.current).toContain("size=768"));
    rerender({ side: undefined });
    await waitFor(() => expect(result.current).toContain("size=original"));
    expect(sign).toHaveBeenCalledTimes(3);
    expect(sign).toHaveBeenLastCalledWith("/tmp/photo.png");
    expect(result.current).toMatch(/^\/__localimg\?/);
  });

  it("re-signs mounted images after changing backend and rejects late old-backend results", async () => {
    let finish: (value: unknown) => void = () => {};
    sign.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useLocalImageUrl("/tmp/photo.png", 768));
    act(() => setTransport({} as Transport));
    await waitFor(() => expect(result.current).toContain("size=768"));
    await act(async () => finish({ success: true, data: "mains-localimg://old-backend/" }));
    expect(result.current).not.toContain("old-backend");
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it("does not resize blob, data or remote proxy sources", () => {
    for (const src of ["blob:preview", "data:image/png;base64,eA==", "mains-img://img/?url=test"]) {
      const { result } = renderHook(() => useLocalImageUrl(src, 768));
      expect(result.current).toBe(src);
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it("refreshes browser pixels when the source version changes without re-signing", async () => {
    const { result, rerender } = renderHook(({ version }) => useLocalImageUrl("/tmp/photo.png", 768, version),
      { initialProps: { version: "first" } });
    await waitFor(() => expect(result.current).toContain("v=first"));
    const first = result.current;
    rerender({ version: "second" });
    expect(result.current).toContain("v=second");
    expect(result.current).not.toBe(first);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("renews signed URLs before long-lived lazy images expire", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLocalImageUrl("/tmp/photo.png", 768));
    await act(async () => {});
    const first = result.current;
    expect(first).toContain("size=768");
    await act(async () => { vi.advanceTimersByTime(3_600_000 - 30_000); });
    expect(sign).toHaveBeenCalledTimes(2);
    expect(result.current).toContain("size=768");
    expect(result.current).not.toBe(first);
  });
});
