import { describe, expect, it, vi } from "vitest";
import { createVoicePreviewAudioMeter } from "./voice-preview-audio";

function setup(state: AudioContextState = "running", resume?: () => Promise<void>) {
  let amplitude = 0;
  const audio = { paused: false, ended: false, play: vi.fn(), pause: vi.fn() };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const analyser = {
    fftSize: 0, connect: vi.fn(), disconnect: vi.fn(),
    getFloatTimeDomainData: (samples: Float32Array) => samples.fill(amplitude),
  };
  const context = {
    state, destination: {},
    resume: vi.fn(resume ?? (async () => { context.state = "running"; })),
    close: vi.fn(async () => { context.state = "closed"; }),
    createMediaElementSource: vi.fn(() => source),
    createAnalyser: vi.fn(() => analyser),
  };
  const meter = createVoicePreviewAudioMeter(audio as unknown as HTMLAudioElement, () => context as unknown as AudioContext);
  function advance(from: number, until: number) {
    for (let time = from; time < until; time += 1000 / 60) meter.read(time);
    return { ...meter.read(until) };
  }
  return { audio, source, analyser, context, meter, advance, volume: (value: number) => { amplitude = value; } };
}

describe("voice preview audio analysis", () => {
  it("follows syllables, responds to quiet speech and eases back to idle during silence", () => {
    const h = setup();
    h.volume(0.004);
    expect(h.advance(0, 150).output).toBeGreaterThan(0.15);
    h.volume(0.08);
    const first = h.meter.read(150 + 1000 / 60).output;
    const speaking = h.advance(180, 350).output;
    expect(speaking).toBeGreaterThan(first);
    expect(speaking).toBeGreaterThan(0.85);
    h.volume(0.001);
    const settling = h.meter.read(450).output;
    expect(settling).toBeGreaterThan(0);
    expect(settling).toBeLessThan(speaking);
    expect(h.advance(450 + 1000 / 60, 1400)).toEqual({ input: 0, output: expect.any(Number) });
    expect(h.meter.read(1416).output).toBeLessThan(speaking * 0.05);
    h.meter.dispose();
  });

  it("analyzes the playing element with one audible output and no second playback", () => {
    const h = setup();
    expect(h.context.createMediaElementSource).toHaveBeenCalledWith(h.audio);
    expect(h.source.connect.mock.calls).toEqual([[h.context.destination], [h.analyser]]);
    expect(h.analyser.connect).not.toHaveBeenCalled();
    expect(h.audio.play).not.toHaveBeenCalled();
    expect(h.audio.pause).not.toHaveBeenCalled();
    h.meter.dispose();
  });

  it("immediately clears stale levels on pause/end and releases its graph once", () => {
    const h = setup();
    h.volume(0.08);
    expect(h.advance(0, 300).output).toBeGreaterThan(0.8);
    h.audio.paused = true;
    expect(h.meter.read(400)).toEqual({ input: 0, output: 0 });
    h.audio.paused = false;
    expect(h.meter.read(450).output).toBeGreaterThan(0);
    h.audio.ended = true;
    expect(h.meter.read(500)).toEqual({ input: 0, output: 0 });
    h.meter.dispose();
    h.meter.dispose();
    expect(h.source.disconnect).toHaveBeenCalledOnce();
    expect(h.analyser.disconnect).toHaveBeenCalledOnce();
    expect(h.context.close).toHaveBeenCalledOnce();
    expect(h.meter.read(600)).toEqual({ input: 0, output: 0 });
  });

  it("waits for a running context before rerouting sound", async () => {
    let resume!: () => void;
    const pending = new Promise<void>((resolve) => { resume = resolve; });
    const h = setup("suspended", () => pending);
    expect(h.context.resume).toHaveBeenCalledOnce();
    expect(h.context.createMediaElementSource).not.toHaveBeenCalled();
    h.volume(0.08);
    expect(h.meter.read(0)).toEqual({ input: 0, output: 0 });
    h.context.state = "running";
    resume();
    await pending;
    expect(h.context.createMediaElementSource).toHaveBeenCalledOnce();
    expect(h.advance(100, 400).output).toBeGreaterThan(0.8);
    h.meter.dispose();
  });

  it("does not attach a late graph after stopping during context resume", async () => {
    let resume!: () => void;
    const pending = new Promise<void>((resolve) => { resume = resolve; });
    const h = setup("suspended", () => pending);
    h.meter.dispose();
    h.context.state = "running";
    resume();
    await pending;
    expect(h.context.createMediaElementSource).not.toHaveBeenCalled();
    expect(h.context.createAnalyser).not.toHaveBeenCalled();
    expect(h.context.close).toHaveBeenCalledOnce();
    expect(h.meter.read(300)).toEqual({ input: 0, output: 0 });
  });

  it("leaves native playback intact if Web Audio is absent or resume is rejected", async () => {
    const silent = createVoicePreviewAudioMeter({} as HTMLAudioElement, () => { throw new Error("Unsupported"); });
    expect(silent.read(0)).toEqual({ input: 0, output: 0 });
    expect(() => silent.dispose()).not.toThrow();
    const h = setup("suspended", () => Promise.reject(new Error("Unavailable")));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.context.createMediaElementSource).not.toHaveBeenCalled();
    expect(h.context.close).toHaveBeenCalledOnce();
    expect(h.meter.read(0)).toEqual({ input: 0, output: 0 });
    expect(h.audio.pause).not.toHaveBeenCalled();
    h.meter.dispose();
    expect(h.context.close).toHaveBeenCalledOnce();
  });
});
