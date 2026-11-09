// @vitest-environment jsdom
import { type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ok } from "@mains/contracts/service-response";
import { useWindowRequests } from "./use-window-requests";

const native = vi.hoisted(() => ({
  consume: vi.fn(), ping: undefined as (() => void) | undefined,
  loaded: true, windowChrome: true,
  jump: vi.fn(), newChat: vi.fn(), openWorkspace: vi.fn(), off: vi.fn(),
}));
vi.mock("@/hooks/use-active-space", () => ({ useActiveSpace: () => ({ isLoaded: native.loaded }) }));
vi.mock("@/lib/platform", () => ({ useCapabilities: () => ({ windowChrome: native.windowChrome }) }));
vi.mock("@/features/workspace/hooks/use-jump-to-run", () => ({ useJumpToRun: () => native.jump }));
vi.mock("@/features/command-menu/use-command-navigation", () => ({ useCommandNavigation: () => ({ newChat: native.newChat, openWorkspace: native.openWorkspace }) }));

beforeEach(() => {
  native.newChat.mockReset(); native.jump.mockReset(); native.openWorkspace.mockReset();
  native.consume.mockReset().mockResolvedValue(ok(null));
  native.off.mockReset(); native.loaded = true; native.windowChrome = true;
  vi.stubGlobal("api", { app: { consumeWindowRequest: native.consume, onWindowRequest: (callback: () => void) => {
    native.ping = callback; return native.off;
  } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function view() {
  return renderHook(() => { useWindowRequests(); return useLocation().pathname; }, {
    wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>,
  });
}

it("does not navigate from a consumed request received after the collector unmounted", async () => {
  let finish!: (value: ReturnType<typeof ok>) => void;
  native.consume.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const h = view();
  await waitFor(() => expect(native.consume).toHaveBeenCalledOnce());
  h.unmount();
  await act(async () => { finish(ok({ kind: "newChat" })); });
  expect(native.newChat).not.toHaveBeenCalled();
  expect(native.off).toHaveBeenCalledOnce();
});

it("coalesces notification bursts while a consume is pending and delivers in order", async () => {
  let finish!: (value: ReturnType<typeof ok>) => void;
  native.consume.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(ok({ kind: "navigate", path: "/pulse" }));
  const h = view();
  await waitFor(() => expect(native.consume).toHaveBeenCalledOnce());
  act(() => { for (let i = 0; i < 10; i++) native.ping!(); });
  expect(native.consume).toHaveBeenCalledOnce();
  await act(async () => { finish(ok({ kind: "navigate", path: "/settings" })); });
  expect(h.result.current).toBe("/pulse");
  expect(native.consume).toHaveBeenCalledTimes(2);
});

it("keeps its pending receipt through callback changes and uses the latest navigation action", async () => {
  let finish!: (value: ReturnType<typeof ok>) => void;
  native.consume.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const h = view();
  await waitFor(() => expect(native.consume).toHaveBeenCalledOnce());
  const previous = native.newChat;
  native.newChat = vi.fn();
  h.rerender();
  await act(async () => { finish(ok({ kind: "newChat" })); });
  expect(previous).not.toHaveBeenCalled();
  expect(native.newChat).toHaveBeenCalledOnce();
  expect(native.consume).toHaveBeenCalledOnce();
  expect(native.off).not.toHaveBeenCalled();
});

it.each(["spaces", "web"])("waits for native capability and loaded spaces (%s)", async (gate) => {
  if (gate === "spaces") native.loaded = false;
  else native.windowChrome = false;
  const h = view();
  await act(async () => {});
  expect(native.consume).not.toHaveBeenCalled();
  if (gate === "spaces") {
    native.loaded = true; h.rerender();
    await waitFor(() => expect(native.consume).toHaveBeenCalledOnce());
  }
});

it("retries a rejected consume on the next ping", async () => {
  native.consume.mockRejectedValueOnce(new Error("Renderer loading"))
    .mockResolvedValueOnce(ok({ kind: "navigate", path: "/pulse" }));
  const h = view();
  await waitFor(() => expect(native.consume).toHaveBeenCalledOnce());
  await act(async () => { native.ping!(); });
  expect(h.result.current).toBe("/pulse");
  expect(native.consume).toHaveBeenCalledTimes(2);
});
