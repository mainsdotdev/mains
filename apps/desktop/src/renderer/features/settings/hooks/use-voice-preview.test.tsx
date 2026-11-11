// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useVoicePreview } from "./use-voice-preview";
let nextPlay: (() => Promise<void>) | undefined;
class PreviewAudio extends EventTarget {
  static all: PreviewAudio[] = [];
  src: string; paused = true; ended = false;
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn(); removeAttribute = vi.fn((name: string) => { if (name === "src") this.src = ""; });
  play: ReturnType<typeof vi.fn>;
  constructor(src: string) {
    super(); this.src = src; const effect = nextPlay; nextPlay = undefined;
    this.play = vi.fn(() => { this.paused = false; return effect ? effect() : Promise.resolve(); }); PreviewAudio.all.push(this);
  }
}
class Context {
  static all: Context[] = [];
  state = "running"; destination = {};
  source = { connect: vi.fn(), disconnect: vi.fn() };
  analyser = { fftSize: 0, disconnect: vi.fn(), getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.08) };
  close = vi.fn(async () => { this.state = "closed"; }); resume = vi.fn(async () => { this.state = "running"; });
  createMediaElementSource = vi.fn(() => this.source); createAnalyser = vi.fn(() => this.analyser);
  constructor() { Context.all.push(this); }
}
const Wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
beforeEach(() => { PreviewAudio.all = []; Context.all = []; nextPlay = undefined; vi.stubGlobal("Audio", PreviewAudio); vi.stubGlobal("AudioContext", Context); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("turns a synchronous play failure into a retryable error and releases the acquired sample", () => {
  nextPlay = () => { throw new Error("Playback unavailable"); };
  const view = renderHook(useVoicePreview, { wrapper: Wrapper });
  act(() => { expect(() => view.result.current.play("cove")).not.toThrow(); });
  expect(view.result.current.playingVoice).toBeNull(); expect(view.result.current.error).toContain("Unable to play");
  expect(PreviewAudio.all[0].pause).toHaveBeenCalledOnce(); expect(PreviewAudio.all[0].src).toBe(""); expect(Context.all[0].close).toHaveBeenCalledOnce();
});

it("releases the remaining graph and media resources when one native cleanup throws", () => {
  const view = renderHook(useVoicePreview, { wrapper: Wrapper }); act(() => { view.result.current.play("cove"); });
  Context.all[0].source.disconnect.mockImplementationOnce(() => { throw new Error("Already detached"); });
  act(() => { expect(() => view.result.current.play("maple")).not.toThrow(); });
  expect(Context.all[0].analyser.disconnect).toHaveBeenCalledOnce(); expect(Context.all[0].close).toHaveBeenCalledOnce();
  expect(PreviewAudio.all[0].src).toBe(""); expect(PreviewAudio.all[0].load).toHaveBeenCalledOnce();
  expect(view.result.current.playingVoice).toBe("maple"); expect(PreviewAudio.all[1].play).toHaveBeenCalledOnce();
});

it("preserves native playback and releases analysis when context resume throws synchronously", () => {
  vi.stubGlobal("AudioContext", vi.fn(function () {
    const context = new Context(); context.state = "suspended";
    context.resume.mockImplementationOnce(() => { throw new Error("Resume unavailable"); }); return context;
  }));
  const view = renderHook(useVoicePreview, { wrapper: Wrapper });
  act(() => { view.result.current.play("cove"); });
  expect(PreviewAudio.all[0].play).toHaveBeenCalledOnce(); expect(view.result.current.error).toBeNull();
  expect(Context.all[0].close).toHaveBeenCalledOnce(); expect(Context.all[0].createMediaElementSource).not.toHaveBeenCalled();
  expect(view.result.current.getAudioLevels(0)).toEqual({ input: 0, output: 0 });
});

it("stays silent on mount and does not acquire media through callbacks retained after unmount", () => {
  const view = renderHook(useVoicePreview, { wrapper: Wrapper }); const previous = view.result.current;
  expect(PreviewAudio.all).toHaveLength(0); view.unmount();
  act(() => { previous.play("cove"); previous.stop(); });
  expect(PreviewAudio.all).toHaveLength(0); expect(Context.all).toHaveLength(0);
  expect(previous.getAudioLevels(100)).toEqual({ input: 0, output: 0 });
});
it("binds cancellation to its attempt even after playing away and back to the same voice", () => {
  const view = renderHook(useVoicePreview, { wrapper: Wrapper }); let cancel!: () => void;
  act(() => { cancel = view.result.current.play("cove"); view.result.current.play("maple"); view.result.current.play("cove"); cancel(); });
  expect(view.result.current.playingVoice).toBe("cove"); expect(PreviewAudio.all).toHaveLength(3);
  expect(PreviewAudio.all[0].pause).toHaveBeenCalledOnce(); expect(PreviewAudio.all[1].pause).toHaveBeenCalledOnce(); expect(PreviewAudio.all[2].pause).not.toHaveBeenCalled();
});
it("ignores an old play rejection and terminal events while a replacement owns playback", async () => {
  let reject!: (error: Error) => void;
  nextPlay = () => new Promise<void>((_resolve, fail) => { reject = fail; });
  const view = renderHook(useVoicePreview, { wrapper: Wrapper }); act(() => { view.result.current.play("cove"); });
  const previous = PreviewAudio.all[0]; act(() => { view.result.current.play("maple"); });
  await act(async () => { reject(new Error("Old rejection")); previous.dispatchEvent(new Event("error")); previous.dispatchEvent(new Event("ended")); });
  expect(view.result.current).toMatchObject({ playingVoice: "maple", error: null }); expect(PreviewAudio.all[1].pause).not.toHaveBeenCalled(); expect(Context.all[1].close).not.toHaveBeenCalled();
});
it.each(["stop", "ended", "error"])("releases one media graph after %s and stays silent through duplicate terminals", async (terminal) => {
  const view = renderHook(useVoicePreview, { wrapper: Wrapper }); const read = view.result.current.getAudioLevels;
  act(() => { view.result.current.play("cove"); }); expect(read(100).output).toBeGreaterThan(0);
  await act(async () => {
    if (terminal === "stop") view.result.current.stop(); else PreviewAudio.all[0].dispatchEvent(new Event(terminal));
    PreviewAudio.all[0].dispatchEvent(new Event("ended")); PreviewAudio.all[0].dispatchEvent(new Event("error")); view.result.current.stop();
  });
  expect(view.result.current.getAudioLevels).toBe(read); expect(read(200)).toEqual({ input: 0, output: 0 });
  expect(PreviewAudio.all[0].pause).toHaveBeenCalledOnce(); expect(PreviewAudio.all[0].load).toHaveBeenCalledOnce(); expect(Context.all[0].close).toHaveBeenCalledOnce();
});
it("returns a retryable error for a missing sample without acquiring another audio graph", () => {
  const view = renderHook(useVoicePreview, { wrapper: Wrapper });
  act(() => { view.result.current.play("cove"); view.result.current.play("future-voice"); });
  expect(view.result.current).toMatchObject({ playingVoice: null, error: "No preview is available for this voice." }); expect(PreviewAudio.all).toHaveLength(1);
  act(() => { view.result.current.play("maple"); }); expect(view.result.current).toMatchObject({ playingVoice: "maple", error: null });
});
it("handles failed media construction and allows retry without restarting the hook", () => {
  vi.stubGlobal("Audio", vi.fn(function () { throw new Error("No media support"); }));
  const view = renderHook(useVoicePreview, { wrapper: Wrapper }); act(() => { view.result.current.play("cove"); });
  expect(view.result.current.error).toContain("Unable to play"); expect(Context.all).toHaveLength(0);
  vi.stubGlobal("Audio", PreviewAudio); act(() => { view.result.current.play("cove"); }); expect(view.result.current.playingVoice).toBe("cove");
});
