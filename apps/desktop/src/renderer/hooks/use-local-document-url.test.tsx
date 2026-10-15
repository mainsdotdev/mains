// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTransport } from "@/lib/transport/registry";
import type { Transport } from "@/lib/transport/types";
import { fetchLocalDocument, signLocalDocument } from "@/lib/local-document-url";
import { useLocalDocumentUrl } from "./use-local-document-url";

const sign = vi.fn();
beforeEach(() => {
  setTransport({} as Transport);
  sign.mockReset();
  sign.mockImplementation(async (path: string) => ({ success: true,
    data: `mains-localdoc://doc/?path=${encodeURIComponent(path)}&exp=${Date.now() + 3_600_000}&sig=test` }));
  Object.defineProperty(window, "api", { configurable: true, value: { documents: { sign } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("local document URLs", () => {
  it("re-signs a rejected URL once and never loops on repeated 403 responses", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchLocalDocument("/tmp/rejected.docx")).rejects.toThrow("could not be opened");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sign).toHaveBeenCalledTimes(2);
  });
  it("recovers one rejected signature and explains an oversized document", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response("bytes"))
      .mockResolvedValueOnce(new Response(null, { status: 413 }));
    vi.stubGlobal("fetch", fetch);
    expect(await (await fetchLocalDocument("/tmp/recovery.docx")).text()).toBe("bytes");
    await expect(fetchLocalDocument("/tmp/large.pptx")).rejects.toThrow("25 MiB inline preview limit");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("deduplicates signing and renews expired entries when reopening", async () => {
    vi.useFakeTimers();
    const first = await signLocalDocument("/tmp/expiry.docx");
    await signLocalDocument("/tmp/expiry.docx");
    expect(sign).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_600_001);
    expect(await signLocalDocument("/tmp/expiry.docx")).not.toBe(first);
    expect(sign).toHaveBeenCalledTimes(2);
  });
  it("switches mounted documents to the current backend and rejects late results", async () => {
    let finish: (value: unknown) => void = () => {};
    sign.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useLocalDocumentUrl("/tmp/backend.pptx"));
    act(() => setTransport({} as Transport));
    await waitFor(() => expect(result.current).toContain("sig=test"));
    await act(async () => finish({ success: true, data: "mains-localdoc://old-backend/" }));
    expect(result.current).not.toContain("old-backend");
    expect(sign).toHaveBeenCalledTimes(2);
  });
});
