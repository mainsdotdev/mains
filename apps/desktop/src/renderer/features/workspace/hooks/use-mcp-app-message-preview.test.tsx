// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useMcpAppMessagePreview } from "./use-mcp-app-message-preview";

afterEach(cleanup);

it.each(["confirm", "dismiss", "abort"] as const)("ignores an old review's %s after its owner and request are replaced", async (receipt) => {
  const h = renderHook(({ owner }) => useMcpAppMessagePreview(owner), { initialProps: { owner: "first-owner" } });
  const signal = new AbortController();
  let first!: Promise<string | null>;
  act(() => { first = h.result.current.review("First request", false, signal.signal); });
  const old = h.result.current;
  h.rerender({ owner: "next-owner" });
  expect(await first).toBe(null);
  let second!: Promise<string | null>;
  act(() => { second = h.result.current.review("Second request", true); });
  const id = h.result.current.preview!.id;
  act(() => {
    if (receipt === "confirm") old.confirm("Stale approval");
    else if (receipt === "dismiss") old.dismiss();
    else signal.abort();
  });
  expect(h.result.current.preview).toMatchObject({ id, ownerKey: "next-owner", text: "Second request" });
  act(() => h.result.current.confirm("  Current approval  "));
  expect(await second).toBe("Current approval");
  expect(h.result.current.preview).toBe(null);
});

it("accepts review after StrictMode replay and refuses callbacks after unmount", async () => {
  const h = renderHook(() => useMcpAppMessagePreview("owner"), {
    wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
  });
  let first!: Promise<string | null>;
  act(() => { first = h.result.current.review("A mounted review", false); });
  expect(h.result.current.preview?.text).toBe("A mounted review");
  const old = h.result.current;
  h.unmount();
  expect(await first).toBe(null);
  expect(await old.review("Do not reopen a retired owner", false)).toBe(null);
});
