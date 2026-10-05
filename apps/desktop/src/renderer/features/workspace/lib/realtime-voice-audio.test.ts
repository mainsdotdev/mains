import { describe, expect, it, vi } from "vitest";
import { createRealtimeVoiceAudioMeter } from "./realtime-voice-audio";

function setup() {
  const track = { enabled: true, stop: vi.fn() };
  const input = { getAudioTracks: () => [track] } as unknown as MediaStream;
  const output = { getAudioTracks: () => [track] } as unknown as MediaStream;
  const channels: Array<{ amplitude: number; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const analysers: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
  const context = {
    state: "suspended", destination: {},
    resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: vi.fn(() => {
      const channel = { amplitude: 0, connect: vi.fn(), disconnect: vi.fn() };
      channels.push(channel);
      return channel;
    }),
    createAnalyser: vi.fn(() => {
      const channel = channels.at(-1)!;
      const analyser = { fftSize: 0, disconnect: vi.fn(),
        getFloatTimeDomainData: (samples: Float32Array) => samples.fill(channel.amplitude) };
      analysers.push(analyser);
      return analyser;
    }),
  };
  const meter = createRealtimeVoiceAudioMeter(() => context as unknown as AudioContext);
  meter.setInput(input);
  meter.setOutput(output);
  function advance(from: number, until: number, step = 1000 / 60) {
    for (let time = from; time <= until; time += step) meter.read(time);
    return { ...meter.read(until) };
  }
  return { meter, input, output, track, context, channels, analysers, advance };
}

describe("voice animation audio analysis", () => {
  it("responds to quiet speech and follows syllables rather than holding the last sentence's volume", () => {
    const h = setup();
    h.channels[1].amplitude = 0.004;
    expect(h.advance(0, 150).output).toBeGreaterThan(0.15);
    h.channels[1].amplitude = 0.08;
    const speaking = h.advance(150 + 1000 / 60, 350).output;
    expect(speaking).toBeGreaterThan(0.85);
    h.channels[1].amplitude = 0;
    expect(h.advance(350 + 1000 / 60, 850).output).toBeLessThan(speaking * 0.15);
    h.meter.dispose();
  });

  it("gates room noise while independently responding to assistant speech", () => {
    const h = setup();
    h.channels[0].amplitude = 0.001;
    h.channels[1].amplitude = 0.08;
    const levels = h.advance(0, 1000);
    expect(levels.input).toBe(0);
    expect(levels.output).toBeGreaterThan(0.65);
    expect(levels.output).toBeLessThanOrEqual(1);
    h.meter.dispose();
  });

  it("eases into speech and settles gradually after silence without frame-rate dependence", () => {
    const h = setup();
    h.channels[0].amplitude = 0.166;
    const first = h.meter.read(0).input;
    const speaking = h.advance(1000 / 60, 300).input;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.35);
    expect(speaking).toBeGreaterThan(0.85);
    h.channels[0].amplitude = 0;
    const settling = h.meter.read(400).input;
    expect(settling).toBeGreaterThan(0.5);
    expect(settling).toBeLessThan(speaking);
    expect(h.advance(400 + 1000 / 60, 2500).input).toBeLessThan(0.06);
    h.meter.dispose();

    const faster = setup();
    const slower = setup();
    faster.channels[0].amplitude = slower.channels[0].amplitude = 0.1;
    expect(faster.advance(0, 1000, 1000 / 60).input)
      .toBeCloseTo(slower.advance(0, 1000, 1000 / 30).input, 3);
    faster.meter.dispose();
    slower.meter.dispose();
  });

  it("silences the mic visual immediately on mute while the assistant still reacts", () => {
    const h = setup();
    h.channels[0].amplitude = h.channels[1].amplitude = 0.1;
    h.advance(0, 500);
    h.meter.setMuted(true);
    expect(h.meter.read(600).input).toBe(0);
    expect(h.meter.read(600).output).toBeGreaterThan(0.7);
    h.meter.setMuted(false);
    expect(h.meter.read(700).input).toBeGreaterThan(0);
    // Analysis never changes tracks or routes a second copy to speakers.
    expect(h.track.enabled).toBe(true);
    expect(h.track.stop).not.toHaveBeenCalled();
    for (const channel of h.channels) {
      expect(channel.connect).toHaveBeenCalledOnce();
      expect(channel.connect).not.toHaveBeenCalledWith(h.context.destination);
    }
    h.meter.dispose();
  });

  it("disconnects replaced branches and closes analysis once without stopping shared tracks", () => {
    const h = setup();
    h.meter.setOutput(h.output);
    expect(h.channels[1].disconnect).toHaveBeenCalledOnce();
    expect(h.analysers[1].disconnect).toHaveBeenCalledOnce();
    h.meter.dispose();
    h.meter.dispose();
    expect(h.context.close).toHaveBeenCalledOnce();
    for (const channel of h.channels) expect(channel.disconnect).toHaveBeenCalledOnce();
    expect(h.meter.read(1000)).toEqual({ input: 0, output: 0 });
    h.meter.setInput(h.input);
    expect(h.context.createMediaStreamSource).toHaveBeenCalledTimes(3);
    expect(h.track.stop).not.toHaveBeenCalled();
  });

  it("degrades to idle visuals when Web Audio or a source is unavailable", () => {
    const meter = createRealtimeVoiceAudioMeter(() => { throw new Error("Web Audio unavailable"); });
    expect(meter.read(0)).toEqual({ input: 0, output: 0 });
    expect(() => meter.dispose()).not.toThrow();
    const h = setup();
    h.context.createMediaStreamSource.mockImplementationOnce(() => { throw new Error("Stream unavailable"); });
    expect(() => h.meter.setInput(h.input)).not.toThrow();
    expect(h.meter.read(0).input).toBe(0);
    h.meter.dispose();
  });
});
