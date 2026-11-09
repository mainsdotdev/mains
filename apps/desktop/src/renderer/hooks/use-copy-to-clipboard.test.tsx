// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCopyToClipboard } from "./use-copy-to-clipboard";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

it("keeps the latest copy feedback when an earlier clipboard write fails late", async () => {
  vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => {});
  const earlier = deferred<void>(), latest = deferred<void>();
  const writeText = vi.fn().mockReturnValueOnce(earlier.promise).mockReturnValueOnce(latest.promise);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const onSuccess = vi.fn(), onError = vi.fn();
  const view = renderHook(() => useCopyToClipboard({ onSuccess, onError }));
  let first!: Promise<boolean>, second!: Promise<boolean>;
  act(() => { first = view.result.current.copy("Earlier"); second = view.result.current.copy("Latest"); });
  await act(async () => { latest.resolve(); await second; });
  await act(async () => { earlier.reject(new Error("Earlier denied")); await first; });
  expect(view.result.current.status).toBe("copied");
  expect(onSuccess).toHaveBeenCalledExactlyOnceWith("Latest"); expect(onError).not.toHaveBeenCalled();
});

it("keeps a successful native copy successful when its feedback callback throws", async () => {
  vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  const onError = vi.fn();
  const view = renderHook(() => useCopyToClipboard({ onSuccess: () => { throw new Error("Feedback failed"); }, onError }));
  await act(async () => { await expect(view.result.current.copy("Copied text")).resolves.toBe(true); });
  expect(view.result.current.isCopied).toBe(true); expect(onError).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1500)); expect(view.result.current.status).toBe("idle");
});

it("retires pending results and timers on reset and unmount", async () => {
  vi.useFakeTimers();
  const first = deferred<void>(), second = deferred<void>();
  const writeText = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const onSuccess = vi.fn(); const view = renderHook(() => useCopyToClipboard({ onSuccess }));
  let copying!: Promise<boolean>;
  act(() => { copying = view.result.current.copy("Before reset"); view.result.current.reset(); });
  await act(async () => { first.resolve(); expect(await copying).toBe(true); });
  expect(view.result.current.status).toBe("idle"); expect(onSuccess).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  act(() => { copying = view.result.current.copy("Before unmount"); });
  const savedCopy = view.result.current.copy; view.unmount();
  await act(async () => { second.resolve(); expect(await copying).toBe(true); });
  expect(onSuccess).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  await expect(savedCopy("After unmount")).resolves.toBe(false); expect(writeText).toHaveBeenCalledTimes(2);
});

it("starts native writes in the gesture and gives only the newest success one feedback deadline", async () => {
  vi.useFakeTimers();
  const first = deferred<void>(), second = deferred<void>();
  const writeText = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const onSuccess = vi.fn(); const view = renderHook(() => useCopyToClipboard({ onSuccess, feedbackDuration: 400 }));
  let one!: Promise<boolean>, two!: Promise<boolean>;
  act(() => { one = view.result.current.copy("First"); two = view.result.current.copy("Second"); expect(writeText).toHaveBeenCalledTimes(2); });
  await act(async () => { second.resolve(); await two; });
  act(() => vi.advanceTimersByTime(200));
  await act(async () => { first.resolve(); await one; });
  expect(onSuccess).toHaveBeenCalledExactlyOnceWith("Second"); expect(vi.getTimerCount()).toBe(1);
  act(() => vi.advanceTimersByTime(200)); expect(view.result.current.status).toBe("idle");
});

it("uses the latest committed callbacks and survives Strict Mode setup replay", async () => {
  vi.useFakeTimers();
  const written = deferred<void>(); const writeText = vi.fn().mockReturnValue(written.promise);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const original = vi.fn(), latest = vi.fn();
  const view = renderHook(({ onSuccess, feedbackDuration }) => useCopyToClipboard({ onSuccess, feedbackDuration }), {
    initialProps: { onSuccess: original, feedbackDuration: 1500 }, wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
  });
  let copying!: Promise<boolean>; act(() => { copying = view.result.current.copy("Text"); });
  view.rerender({ onSuccess: latest, feedbackDuration: 300 });
  await act(async () => { written.resolve(); await copying; });
  expect(original).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledWith("Text");
  act(() => vi.advanceTimersByTime(300)); expect(view.result.current.status).toBe("idle");
});

it("honors a callback's reentrant reset without leaving a feedback timer", async () => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  const reset = vi.fn(); const view = renderHook(() => useCopyToClipboard({ onSuccess: () => reset() }));
  reset.mockImplementation(() => view.result.current.reset());
  await act(async () => { await view.result.current.copy("Text"); });
  expect(view.result.current.status).toBe("idle"); expect(vi.getTimerCount()).toBe(0);
});

it("handles unavailable or synchronously failing native writes, and permits explicit retry", async () => {
  vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  const onError = vi.fn(); const view = renderHook(() => useCopyToClipboard({ onError }));
  await act(async () => { expect(await view.result.current.copy("")).toBe(false); }); expect(onError).not.toHaveBeenCalled();
  await act(async () => { expect(await view.result.current.copy("Unavailable")).toBe(false); });
  expect(view.result.current.isError).toBe(true); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Clipboard API not available" }));
  const writeText = vi.fn().mockImplementationOnce(() => { throw new Error("Denied"); }).mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await act(async () => { expect(await view.result.current.copy("Denied")).toBe(false); });
  await act(async () => { expect(await view.result.current.copy("Retry")).toBe(true); });
  expect(view.result.current.isCopied).toBe(true); expect(vi.getTimerCount()).toBe(1);
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
});
