// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { CodexVoiceSettings } from "./codex-voice-settings";

const mocks = vi.hoisted(() => ({
  orb: vi.fn((_props: { getAudioLevels(time: number): { input: number; output: number }; orbStyle?: string; color?: string }) => null),
}));
vi.mock("../../workspace/components/voice-orb", () => ({ VoiceOrb: mocks.orb }));

let audio: PreviewAudio[];
let nextPlay: Promise<void> | undefined;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

class PreviewAudio extends EventTarget {
  src: string;
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => { if (name === "src") this.src = ""; });
  play: ReturnType<typeof vi.fn>;

  constructor(src: string) {
    super();
    this.src = src;
    const pending = nextPlay;
    nextPlay = undefined;
    this.play = vi.fn(() => pending ?? Promise.resolve());
    audio.push(this);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  audio = [];
  nextPlay = undefined;
  vi.stubGlobal("Audio", PreviewAudio);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

function props(): ComponentProps<typeof CodexVoiceSettings> {
  return {
    config: {},
    catalog: { voices: ["cove", "maple", "juniper"], defaultVoice: "cove" },
    loading: false, updating: false,
    onUpdate: vi.fn(async () => true), onRetry: vi.fn(),
  };
}

async function chooseVoice(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Voice" })); });
  await act(async () => { fireEvent.click(screen.getByRole("option", { name })); });
}

describe("Codex voice preview", () => {
  it.each([["Sphere", "sphere"], ["Aurora", "aurora"]] as const)("saves %s and updates the preview while retaining its current playback", async (label, orbStyle) => {
    const options = props();
    const view = render(<CodexVoiceSettings {...options} />);
    expect(mocks.orb.mock.calls.at(-1)![0].orbStyle).toBe("cloud");
    fireEvent.click(screen.getByRole("button", { name: "Preview Cove voice" }));
    const read = mocks.orb.mock.calls.at(-1)![0].getAudioLevels;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Orb style" })); });
    await act(async () => { fireEvent.click(screen.getByRole("option", { name: label })); });
    expect(options.onUpdate).toHaveBeenCalledExactlyOnceWith({ voiceOrbStyle: orbStyle });
    view.rerender(<CodexVoiceSettings {...options} config={{ voiceOrbStyle: orbStyle, voiceOrbColor: "amber" }} />);
    expect(mocks.orb.mock.calls.at(-1)![0].orbStyle).toBe(orbStyle);
    expect(mocks.orb.mock.calls.at(-1)![0].color).toBe("amber");
    expect(mocks.orb.mock.calls.at(-1)![0].getAudioLevels).toBe(read);
    expect(audio).toHaveLength(1);
    expect(audio[0].pause).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop voice preview" })).toBeTruthy();
  });

  it("does not play on mount, persisted settings refresh, or orb color changes", () => {
    const options = props();
    const view = render(<CodexVoiceSettings {...options} />);
    view.rerender(<CodexVoiceSettings {...options} loading />);
    view.rerender(<CodexVoiceSettings {...options} config={{ realtimeVoice: "maple", voiceOrbColor: "rose" }} />);
    expect(audio).toHaveLength(0);
    expect(options.onUpdate).not.toHaveBeenCalled();
  });

  it("plays a selected voice immediately while its preference is still being saved", async () => {
    let save!: (saved: boolean) => void;
    const options = props();
    options.onUpdate = vi.fn(() => new Promise<boolean>((resolve) => { save = resolve; }));
    const view = render(<CodexVoiceSettings {...options} />);
    await chooseVoice("Maple");
    expect(audio).toHaveLength(1);
    expect(audio[0].src).toContain("maple.en.wav");
    expect(audio[0].play).toHaveBeenCalledOnce();
    expect(options.onUpdate).toHaveBeenCalledWith({ realtimeVoice: "maple" });
    expect(screen.getByRole("button", { name: "Stop voice preview" })).toBeTruthy();
    await act(async () => save(true));
    view.rerender(<CodexVoiceSettings {...options} config={{ realtimeVoice: "maple" }} />);
    expect(audio).toHaveLength(1);
    expect(audio[0].pause).not.toHaveBeenCalled();
  });

  it("replaces a sample and ignores a late rejection or event from the old one", async () => {
    let reject!: (reason: Error) => void;
    nextPlay = new Promise<void>((_, rejectPlay) => { reject = rejectPlay; });
    render(<CodexVoiceSettings {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview Cove voice" }));
    const first = audio[0];
    await chooseVoice("Maple");
    expect(first.pause).toHaveBeenCalledOnce();
    expect(first.src).toBe("");
    expect(first.load).toHaveBeenCalledOnce();
    expect(audio[1].play).toHaveBeenCalledOnce();
    await act(async () => {
      reject(new Error("Aborted by new selection"));
      first.dispatchEvent(new Event("error"));
      first.dispatchEvent(new Event("ended"));
    });
    expect(audio[1].pause).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop voice preview" })).toBeTruthy();
    expect(screen.queryByText(/Unable to play/)).toBeNull();
  });

  it("stops and releases playback on request and when leaving settings", () => {
    const view = render(<CodexVoiceSettings {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview Cove voice" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop voice preview" }));
    expect(audio[0].pause).toHaveBeenCalledOnce();
    expect(audio[0].src).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Preview Cove voice" }));
    view.unmount();
    expect(audio[0].pause).toHaveBeenCalledOnce();
    expect(audio[1].pause).toHaveBeenCalledOnce();
    expect(audio[1].src).toBe("");
    expect(audio[1].load).toHaveBeenCalledOnce();
  });

  it("returns to replay when a sample ends and can play again", () => {
    render(<CodexVoiceSettings {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview Cove voice" }));
    act(() => audio[0].dispatchEvent(new Event("ended")));
    fireEvent.click(screen.getByRole("button", { name: "Preview Cove voice" }));
    expect(audio).toHaveLength(2);
    expect(audio[1].play).toHaveBeenCalledOnce();
  });

  it.each(["rejected", "media error"])("shows a retryable preview error after %s", async (failure) => {
    if (failure === "rejected") nextPlay = Promise.reject(new Error("Playback unavailable"));
    render(<CodexVoiceSettings {...props()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview Cove voice" }));
      if (failure === "media error") audio[0].dispatchEvent(new Event("error"));
    });
    expect(screen.getByText("Unable to play this voice preview. Try again.")).toBeTruthy();
    expect(audio[0].pause).toHaveBeenCalledOnce();
    expect(audio[0].src).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Preview Cove voice" }));
    expect(audio[1].play).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Unable to play/)).toBeNull();
  });

  it("stops the selected sample if saving the preference fails", async () => {
    const options = props();
    options.onUpdate = vi.fn(async () => false);
    render(<CodexVoiceSettings {...options} />);
    await chooseVoice("Maple");
    expect(audio[0].play).toHaveBeenCalledOnce();
    expect(audio[0].pause).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Preview Cove voice" })).toBeTruthy();
  });

  it("still saves new server voices when no bundled preview exists", async () => {
    const options = props();
    options.catalog!.voices.push("future");
    const view = render(<CodexVoiceSettings {...options} />);
    await chooseVoice("Future");
    expect(options.onUpdate).toHaveBeenCalledWith({ realtimeVoice: "future" });
    expect(audio).toHaveLength(0);
    view.rerender(<CodexVoiceSettings {...options} config={{ realtimeVoice: "future" }} />);
    expect((screen.getByRole("button", { name: "Preview Future voice" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("No preview is available for this voice.")).toBeTruthy();
  });

  it("feeds actual preview volume to the orb without per-frame renders and clears it on stop", async () => {
    let amplitude = 0;
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const analyser = { fftSize: 0, disconnect: vi.fn(), getFloatTimeDomainData: (samples: Float32Array) => samples.fill(amplitude) };
    const context = {
      state: "running", destination: {}, close: vi.fn(async () => {}),
      createMediaElementSource: vi.fn(() => source), createAnalyser: vi.fn(() => analyser),
    };
    vi.stubGlobal("AudioContext", vi.fn(function () { return context; }));
    const options = props();
    const view = render(<CodexVoiceSettings {...options} />);
    const read = mocks.orb.mock.calls.at(-1)![0].getAudioLevels;
    expect(read(0)).toEqual({ input: 0, output: 0 });
    await chooseVoice("Maple");
    amplitude = 0.08;
    const renders = mocks.orb.mock.calls.length;
    const first = read(0).output;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.35);
    expect(read(100).output).toBeGreaterThan(first);
    expect(mocks.orb.mock.calls).toHaveLength(renders);
    expect(context.createMediaElementSource).toHaveBeenCalledWith(audio[0]);
    view.rerender(<CodexVoiceSettings {...options} config={{ realtimeVoice: "maple", voiceOrbColor: "rose" }} />);
    expect(mocks.orb.mock.calls.at(-1)![0].getAudioLevels).toBe(read);
    expect(context.createMediaElementSource).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Stop voice preview" }));
    expect(read(200)).toEqual({ input: 0, output: 0 });
    expect(context.close).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(analyser.disconnect).toHaveBeenCalledOnce();
  });
});
