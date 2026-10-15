// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { resetTransport, setTransport } from "@/lib/transport/registry";
import type { Transport } from "@/lib/transport/types";
import { useAtlasFilePath } from "./use-atlas-file-path";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/transport", () => ({ appApi: { atlas: { resolveFile: mocks.resolve } } }));
afterEach(() => { cleanup(); resetTransport(); vi.clearAllMocks(); });
it("resolves again on backend switches even when both hosts use the same storage paths", async () => {
  const replies: ((value: unknown) => void)[] = [];
  mocks.resolve.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
  setTransport({} as Transport);
  const { result } = renderHook(() => useAtlasFilePath("account", "image", "/data/atlas/files/image.png"));
  await waitFor(() => expect(replies).toHaveLength(1));
  act(() => setTransport({} as Transport));
  await waitFor(() => expect(replies).toHaveLength(2));
  await act(async () => { replies[0]({ success: true, data: "/cache/from-A.png" }); });
  expect(result.current).toBe("/data/atlas/files/image.png");
  await act(async () => { replies[1]({ success: true, data: "/cache/from-B.png" }); });
  expect(result.current).toBe("/cache/from-B.png");
});
