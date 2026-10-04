// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceOrb } from "./voice-orb";

const mocks = vi.hoisted(() => ({
  reducedMotion: false,
  createRenderer: vi.fn(),
  readPalette: vi.fn(() => [[1, 0, 0], [1, 0.5, 0.5], [1, 1, 1], [1, 0.8, 0.5], [0.6, 0.7, 1]]),
}));
vi.mock("@/hooks/use-prefers-reduced-motion", () => ({ usePrefersReducedMotion: () => mocks.reducedMotion }));
vi.mock("../lib/voice-orb-renderer", () => ({
  createVoiceOrbRenderer: mocks.createRenderer, readVoiceOrbPalette: mocks.readPalette,
}));

let hidden: boolean;
let nextFrame: number;
let frames: Map<number, FrameRequestCallback>;
let intersections: Array<(entries: Array<{ isIntersecting: boolean }>) => void>;
let renderers: Array<{ draw: ReturnType<typeof vi.fn>; setPalette: ReturnType<typeof vi.fn>; setStyle: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>;
const getAudioLevels = vi.fn(() => ({ input: 0.4, output: 0.6 }));

beforeEach(() => {
  vi.clearAllMocks();
  getAudioLevels.mockReturnValue({ input: 0.4, output: 0.6 });
  mocks.reducedMotion = false;
  hidden = false;
  nextFrame = 0;
  frames = new Map();
  intersections = [];
  renderers = [];
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => { frames.set(++nextFrame, callback); return nextFrame; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id) => frames.delete(id)));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { intersections.push(callback); }
    observe() {} disconnect() {}
  });
  mocks.createRenderer.mockImplementation(() => {
    const renderer = { draw: vi.fn(), setPalette: vi.fn(), setStyle: vi.fn(), dispose: vi.fn() };
    renderers.push(renderer);
    return renderer;
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function frame(time: number) {
  const pending = [...frames.values()];
  frames.clear();
  act(() => { for (const callback of pending) callback(time); });
}

describe("voice orb animation lifetime", () => {
  it("starts an already-selected Aurora preview with the Aurora renderer", () => {
    render(<VoiceOrb active getAudioLevels={getAudioLevels} orbStyle="aurora" color="mint" />);
    expect(mocks.createRenderer.mock.calls[0][2]).toBe("aurora");
    frame(0);
    expect(renderers[0].draw).toHaveBeenCalledOnce();
  });

  it.each(["sphere", "aurora"] as const)("switches to %s and back without replacing the shader or resetting its audio-driven flow", async (orbStyle) => {
    const view = render(<VoiceOrb active getAudioLevels={getAudioLevels} />);
    frame(0);
    frame(16);
    const flow = renderers[0].draw.mock.calls.at(-1)![0];
    await act(async () => { view.rerender(<VoiceOrb active getAudioLevels={getAudioLevels} orbStyle={orbStyle} color="amber" />); });
    expect(view.container.querySelector(".voice-orb")?.getAttribute("data-orb-style")).toBe(orbStyle);
    expect(renderers[0].setStyle).toHaveBeenLastCalledWith(orbStyle);
    expect(mocks.createRenderer).toHaveBeenCalledOnce();
    expect(renderers[0].dispose).not.toHaveBeenCalled();
    frame(32);
    const fasterFlow = renderers[0].draw.mock.calls.at(-1)![0];
    expect(fasterFlow - flow).toBeGreaterThan(flow * 1.5);
    await act(async () => { view.rerender(<VoiceOrb active getAudioLevels={getAudioLevels} orbStyle="cloud" />); });
    expect(renderers[0].setStyle).toHaveBeenLastCalledWith("cloud");
    expect(mocks.createRenderer).toHaveBeenCalledOnce();
    frame(48);
    expect(renderers[0].draw.mock.calls.at(-1)![0] - fasterFlow).toBeCloseTo(flow);
  });

  it.each(["sphere", "aurora"] as const)("uses the latest %s style on visibility return and GPU restoration", async (orbStyle) => {
    const view = render(<VoiceOrb active getAudioLevels={getAudioLevels} />);
    hidden = true;
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => { view.rerender(<VoiceOrb active getAudioLevels={getAudioLevels} orbStyle={orbStyle} />); });
    expect(renderers[0].setStyle).not.toHaveBeenCalled();
    hidden = false;
    fireEvent(document, new Event("visibilitychange"));
    expect(renderers[0].setStyle).toHaveBeenLastCalledWith(orbStyle);
    const canvas = view.container.querySelector("canvas")!;
    fireEvent(canvas, new Event("webglcontextlost", { cancelable: true }));
    await act(async () => { view.rerender(<VoiceOrb active getAudioLevels={getAudioLevels} orbStyle="cloud" />); });
    await act(async () => { view.rerender(<VoiceOrb active getAudioLevels={getAudioLevels} orbStyle={orbStyle} />); });
    fireEvent(canvas, new Event("webglcontextrestored"));
    expect(mocks.createRenderer.mock.calls.at(-1)![2]).toBe(orbStyle);
    expect(renderers[0].dispose).toHaveBeenCalledOnce();
  });

  it("changes colors without replacing its shader, then restores theme tokens", async () => {
    const view = render(<VoiceOrb active getAudioLevels={getAudioLevels} />);
    frame(0);
    frame(16);
    const orb = view.container.querySelector(".voice-orb") as HTMLElement;
    const flow = renderers[0].draw.mock.calls.at(-1)![0];
    await act(async () => {
      view.rerender(<VoiceOrb active getAudioLevels={getAudioLevels} color="rose" />);
    });
    expect(orb.style.getPropertyValue("--color-voice-orb-deep")).toBe("#dc435c");
    expect(orb.style.getPropertyValue("--color-voice-orb-secondary")).toBe("#f3b878");
    expect(mocks.createRenderer).toHaveBeenCalledOnce();
    expect(renderers[0].setPalette).toHaveBeenCalled();
    expect(renderers[0].dispose).not.toHaveBeenCalled();
    frame(32);
    expect(renderers[0].draw.mock.calls.at(-1)![0]).toBeGreaterThan(flow);
    await act(async () => {
      view.rerender(<VoiceOrb active getAudioLevels={getAudioLevels} color="theme" />);
    });
    expect(orb.style.getPropertyValue("--color-voice-orb-deep")).toBe("");
    expect(orb.style.getPropertyValue("--color-voice-orb-secondary")).toBe("");
    expect(orb.style.getPropertyValue("--color-voice-orb-tertiary")).toBe("");
    expect(renderers[0].setPalette).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["cloud", "input"], ["cloud", "output"], ["sphere", "input"], ["sphere", "output"],
    ["aurora", "input"], ["aurora", "output"],
  ] as const)("makes quiet %s %s speech noticeably faster than idle without jumping position", (orbStyle, channel) => {
    getAudioLevels.mockReturnValue({ input: 0, output: 0 });
    render(<VoiceOrb active getAudioLevels={getAudioLevels} orbStyle={orbStyle} />);
    frame(0);
    frame(50);
    const renderer = renderers[0];
    const restingFlow = renderer.draw.mock.calls.at(-1)![0];
    getAudioLevels.mockReturnValue({ input: 0, output: 0, [channel]: 0.2 });
    frame(50);
    expect(renderer.draw.mock.calls.at(-1)![0]).toBe(restingFlow);
    frame(100);
    const speechStep = renderer.draw.mock.calls.at(-1)![0] - restingFlow;
    expect(speechStep).toBeGreaterThan(restingFlow * 2.5);
  });

  it("pauses when hidden or offscreen, resumes without a time jump, and releases drawing on stop", () => {
    const view = render(<VoiceOrb active getAudioLevels={getAudioLevels} />);
    frame(0);
    frame(16);
    const renderer = renderers[0];
    const flow = renderer.draw.mock.calls.at(-1)![0];
    expect(flow).toBeGreaterThan(0);
    hidden = true;
    fireEvent(document, new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    const samples = getAudioLevels.mock.calls.length;
    frame(5000);
    expect(getAudioLevels).toHaveBeenCalledTimes(samples);
    hidden = false;
    fireEvent(document, new Event("visibilitychange"));
    expect(renderer.setPalette).toHaveBeenCalled();
    frame(6000);
    expect(renderer.draw.mock.calls.at(-1)![0]).toBe(flow);
    act(() => intersections[0]([{ isIntersecting: false }]));
    expect(frames.size).toBe(0);
    act(() => intersections[0]([{ isIntersecting: true }]));
    expect(frames.size).toBe(1);
    view.rerender(<VoiceOrb active={false} getAudioLevels={getAudioLevels} />);
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    view.unmount();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it.each(["cloud", "sphere", "aurora"] as const)("uses static %s artwork with reduced motion and releases animation when the preference changes", (orbStyle) => {
    mocks.reducedMotion = true;
    const view = render(<VoiceOrb active getAudioLevels={getAudioLevels} orbStyle={orbStyle} />);
    expect(view.container.querySelector(".voice-orb")?.getAttribute("data-orb-style")).toBe(orbStyle);
    expect(mocks.createRenderer).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    mocks.reducedMotion = false;
    view.rerender(<VoiceOrb active getAudioLevels={getAudioLevels} orbStyle={orbStyle} />);
    expect(mocks.createRenderer).toHaveBeenCalledOnce();
    expect(mocks.createRenderer.mock.calls[0][2]).toBe(orbStyle);
    mocks.reducedMotion = true;
    view.rerender(<VoiceOrb active getAudioLevels={getAudioLevels} orbStyle={orbStyle} />);
    expect(renderers[0].dispose).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it("falls back during GPU context loss and rebuilds its resources after restoration", () => {
    const view = render(<VoiceOrb active getAudioLevels={getAudioLevels} />);
    const canvas = view.container.querySelector("canvas")!;
    frame(0);
    const lost = new Event("webglcontextlost", { cancelable: true });
    fireEvent(canvas, lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(renderers[0].dispose).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    fireEvent(canvas, new Event("webglcontextrestored"));
    expect(mocks.createRenderer).toHaveBeenCalledTimes(2);
    frame(16);
    expect(renderers[1].draw).toHaveBeenCalledOnce();
    view.unmount();
    expect(renderers[1].dispose).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });
});
