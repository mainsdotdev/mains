// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSpeechRecognition } from "./use-speech-recognition";
class Recognition {
  static all: Recognition[] = [];
  continuous = true; interimResults = false; lang = "";
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  constructor() { Recognition.all.push(this); }
}
const Wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
beforeEach(() => { Recognition.all = []; vi.stubGlobal("SpeechRecognition", Recognition); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("ignores already queued transcripts and native callbacks after the hook unmounts", () => {
  const onTranscript = vi.fn(); const view = renderHook(() => useSpeechRecognition(onTranscript), { wrapper: Wrapper });
  act(() => { view.result.current.toggle(); }); const native = Recognition.all.at(-1)!;
  const result = native.onresult!, started = native.onstart!, ended = native.onend!;
  view.unmount();
  act(() => { started(); result({ results: [[{ transcript: "obsolete text" }]] }); ended(); });
  expect(onTranscript).not.toHaveBeenCalled();
});

it("cancels a pending start without starting twice or accepting a late start/transcript", () => {
  const onTranscript = vi.fn(); const view = renderHook(() => useSpeechRecognition(onTranscript), { wrapper: Wrapper });
  act(() => { view.result.current.toggle(); view.result.current.toggle(); });
  const native = Recognition.all.at(-1)!;
  expect(native.start).toHaveBeenCalledOnce();
  expect(native.abort).toHaveBeenCalledOnce();
  act(() => { native.onstart?.(); native.onresult?.({ results: [[{ transcript: "canceled text" }]] }); });
  expect(view.result.current.isRecording).toBe(false); expect(onTranscript).not.toHaveBeenCalled();
});

it("releases a failed native start before allowing an explicit retry", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("SpeechRecognition", vi.fn(function () { return new Recognition(); }).mockImplementationOnce(function () {
    const native = new Recognition(); native.start.mockImplementationOnce(() => { throw new Error("Start unavailable"); }); return native;
  }));
  const view = renderHook(() => useSpeechRecognition(vi.fn()), { wrapper: Wrapper });
  act(() => { view.result.current.toggle(); });
  expect(Recognition.all[0].abort).toHaveBeenCalledOnce(); expect(view.result.current.isRecording).toBe(false);
  act(() => { view.result.current.toggle(); Recognition.all.at(-1)!.onstart?.(); });
  expect(Recognition.all).toHaveLength(2); expect(view.result.current.isRecording).toBe(true);
});

it("stays idle on mount and delivers interim text to the latest callback without restarting", () => {
  const first = vi.fn(), latest = vi.fn();
  const view = renderHook(({ callback }) => useSpeechRecognition(callback), { initialProps: { callback: first }, wrapper: Wrapper });
  expect(Recognition.all).toHaveLength(0);
  act(() => { view.result.current.toggle(); }); const native = Recognition.all[0];
  expect(native).toMatchObject({ continuous: false, interimResults: true, lang: "en-US" });
  expect(view.result.current.isRecording).toBe(false);
  act(() => { native.onstart?.(); }); expect(view.result.current.isRecording).toBe(true);
  view.rerender({ callback: latest });
  act(() => { native.onresult?.({ results: [[{ transcript: "interim text" }]] }); });
  expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledWith("interim text");
  expect(native.start).toHaveBeenCalledOnce(); expect(Recognition.all).toHaveLength(1);
});
it("preserves a graceful stop's final transcript and retires subsequent duplicate callbacks", () => {
  const transcript = vi.fn(); const view = renderHook(() => useSpeechRecognition(transcript), { wrapper: Wrapper });
  act(() => { view.result.current.toggle(); }); const native = Recognition.all[0];
  act(() => { native.onstart?.(); }); const result = native.onresult!, ended = native.onend!;
  act(() => { view.result.current.toggle(); view.result.current.toggle(); });
  expect(native.stop).toHaveBeenCalledOnce(); expect(view.result.current.isRecording).toBe(true);
  act(() => { result({ results: [[{ transcript: "final text" }]] }); ended(); result({ results: [[{ transcript: "obsolete" }]] }); ended(); });
  expect(transcript.mock.calls).toEqual([["final text"]]); expect(view.result.current.isRecording).toBe(false);
});
it("does not let an errored recognizer's late end or result affect its replacement", () => {
  const transcript = vi.fn(); const view = renderHook(() => useSpeechRecognition(transcript), { wrapper: Wrapper });
  act(() => { view.result.current.toggle(); }); const previous = Recognition.all[0];
  const ended = previous.onend!, result = previous.onresult!;
  act(() => { previous.onstart?.(); previous.onerror?.(); view.result.current.toggle(); });
  const current = Recognition.all[1]; act(() => { current.onstart?.(); ended(); result({ results: [[{ transcript: "old" }]] }); });
  expect(view.result.current.isRecording).toBe(true); expect(transcript).not.toHaveBeenCalled();
  act(() => { current.onresult?.({ results: [[{ transcript: "current" }]] }); }); expect(transcript).toHaveBeenCalledWith("current");
});
it("retains a failed graceful stop for retry rather than acquiring another recognizer", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const view = renderHook(() => useSpeechRecognition(vi.fn()), { wrapper: Wrapper }); act(() => { view.result.current.toggle(); });
  const native = Recognition.all[0]; act(() => { native.onstart?.(); });
  native.stop.mockImplementationOnce(() => { throw new Error("Stop unavailable"); });
  act(() => { view.result.current.toggle(); }); expect(view.result.current.isRecording).toBe(true);
  act(() => { view.result.current.toggle(); }); expect(native.stop).toHaveBeenCalledTimes(2); expect(Recognition.all).toHaveLength(1);
  act(() => { native.onend?.(); view.result.current.toggle(); }); expect(Recognition.all).toHaveLength(2);
});
it("falls back to native stop when aborting a pending start fails", () => {
  const view = renderHook(() => useSpeechRecognition(vi.fn()), { wrapper: Wrapper }); act(() => { view.result.current.toggle(); });
  const native = Recognition.all[0]; native.abort.mockImplementationOnce(() => { throw new Error("Abort unavailable"); });
  act(() => { view.result.current.toggle(); }); expect(native.abort).toHaveBeenCalledOnce(); expect(native.stop).toHaveBeenCalledOnce();
  act(() => { native.onstart?.(); }); expect(view.result.current.isRecording).toBe(false);
});
it("still attempts native stop during disposal if abort throws", () => {
  const view = renderHook(() => useSpeechRecognition(vi.fn()), { wrapper: Wrapper }); act(() => { view.result.current.toggle(); });
  const native = Recognition.all[0]; native.abort.mockImplementationOnce(() => { throw new Error("Abort unavailable"); });
  expect(() => view.unmount()).not.toThrow(); expect(native.stop).toHaveBeenCalledOnce();
});
it("keeps unsupported browsers idle and supports the legacy recognizer", () => {
  vi.stubGlobal("SpeechRecognition", undefined); vi.stubGlobal("webkitSpeechRecognition", undefined);
  const unsupported = renderHook(() => useSpeechRecognition(vi.fn()), { wrapper: Wrapper }); act(() => { unsupported.result.current.toggle(); });
  expect(unsupported.result.current.isRecording).toBe(false); expect(Recognition.all).toHaveLength(0); unsupported.unmount();
  vi.stubGlobal("webkitSpeechRecognition", Recognition);
  const legacy = renderHook(() => useSpeechRecognition(vi.fn()), { wrapper: Wrapper }); act(() => { legacy.result.current.toggle(); Recognition.all[0].onstart?.(); });
  expect(legacy.result.current.isRecording).toBe(true);
});
it("handles recognizer construction failure inside the explicit start and keeps retry available", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("SpeechRecognition", vi.fn(function () { throw new Error("Unavailable"); }));
  const view = renderHook(() => useSpeechRecognition(vi.fn()), { wrapper: Wrapper });
  act(() => { expect(() => view.result.current.toggle()).not.toThrow(); }); expect(view.result.current.isRecording).toBe(false);
  expect(console.error).toHaveBeenCalledOnce();
});
