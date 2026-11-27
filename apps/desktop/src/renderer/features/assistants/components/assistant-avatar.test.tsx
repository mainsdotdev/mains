// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { ASSISTANT_AVATAR_SHAPES_BY_FAMILY, ASSISTANT_ROBOT_AVATARS, type AssistantAvatar as Avatar } from "@mains/contracts/assistants";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantMonogram } from "./assistant-monogram";
import { AssistantAvatarPicker } from "./assistant-avatar-picker";
import { nextRobotAmbientGesture, robotEntryGesture, sampleRobotGesture } from "../lib/assistant-robot-motion";
import * as renderer from "../lib/assistant-robot-renderer";

let observe: ReturnType<typeof vi.fn>, disconnect: ReturnType<typeof vi.fn>;
let intersection: IntersectionObserverCallback;
let hidden = false;
beforeEach(() => {
  hidden = false;
  observe = vi.fn(); disconnect = vi.fn();
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
});

describe("robot assistant avatars", () => {
  it("uses a single quick shake for input and spaces out autonomous idle sways", () => {
    expect(robotEntryGesture("waiting")).toBe("shake");
    expect(sampleRobotGesture("shake", 60, 1)?.yaw).toBeGreaterThan(0);
    expect(sampleRobotGesture("shake", 180, 1)?.yaw).toBeLessThan(0);
    expect(sampleRobotGesture("shake", 480, 1)).toBeUndefined();
    expect([0, 1, 2].map(tick => nextRobotAmbientGesture("idle", tick).gesture)).toEqual(["blink", "blink", "glance"]);
    expect(nextRobotAmbientGesture("idle", 2).delay).toBeGreaterThan(9000);
    expect(nextRobotAmbientGesture("waiting", 2).gesture).toBe("blink");
  });

  it.each(ASSISTANT_AVATAR_SHAPES_BY_FAMILY.robot)("renders a bundled thumbnail for %s in compact surfaces", shape => {
    const { container } = render(<AssistantAvatar avatar={{ shape, color: ASSISTANT_ROBOT_AVATARS[shape] }} working className="size-5" />);
    expect(container.querySelector("img")?.getAttribute("src")).toContain(`${shape}.webp`);
    expect(container.querySelector('[data-avatar-family="robot"][data-working="true"]')).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("shows a warning icon while waiting and an activity dot while working", () => {
    const avatar = { shape: "metal-ice", color: "cyan" } as const;
    const { container, rerender } = render(<AssistantAvatar avatar={avatar} robotState="waiting" />);
    const warning = () => container.querySelector("svg.assistant-robot-avatar__warning");
    const activity = () => container.querySelector(".assistant-robot-avatar__activity");
    expect(warning()).toBeTruthy();
    expect(activity()).toBeNull();

    rerender(<AssistantAvatar avatar={avatar} robotState="thinking" />);
    expect(warning()).toBeNull();
    expect(activity()).toBeTruthy();
  });

  it("offers only robot choices and remembers a selected variant when switching styles", () => {
    function Picker() {
      const [avatar, setAvatar] = useState<Avatar>({ shape: "sphere", color: "rose" });
      return <>
        <AssistantAvatarPicker avatar={avatar} onChange={setAvatar} seed="picker" compact />
        <output>{avatar.shape} {avatar.color}</output>
      </>;
    }
    render(<Picker />);
    const styles = within(screen.getByRole("radiogroup", { name: "Robot style" }));
    expect(styles.getAllByRole("radio").map(option => option.textContent)).toEqual(["Retro Terminal", "One-Eye Metal", "Specialists"]);
    expect(screen.queryByRole("radiogroup", { name: "Avatar color" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("sphere rose");
    for (const name of ["Retro Terminal", "One-Eye Metal"]) {
      fireEvent.click(styles.getByRole("radio", { name }));
      const variants = within(screen.getByRole("radiogroup", { name: "Robot variant" }));
      expect(variants.getAllByRole("radio")).toHaveLength(7);
    }
    fireEvent.click(screen.getByRole("radio", { name: "Bronze" }));
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("metal-bronze amber");
    fireEvent.click(styles.getByRole("radio", { name: "Retro Terminal" }));
    fireEvent.click(screen.getByRole("radio", { name: "One-Eye Metal" }));
    expect(screen.getByRole("radio", { name: "Bronze", checked: true })).toBeTruthy();
    fireEvent.click(styles.getByRole("radio", { name: "Specialists" }));
    const specialists = within(screen.getByRole("radiogroup", { name: "Robot variant" }));
    expect(specialists.getAllByRole("radio")).toHaveLength(16);
    expect(specialists.getByRole("radio", { name: "Travel Planner", checked: true })).toBeTruthy();
    fireEvent.click(specialists.getByRole("radio", { name: "Beach Palm" }));
    expect(screen.getByRole("status").textContent).toBe("specialist-beach-palm lime");
    fireEvent.click(styles.getByRole("radio", { name: "One-Eye Metal" }));
    fireEvent.click(styles.getByRole("radio", { name: "Specialists" }));
    expect(specialists.getByRole("radio", { name: "Beach Palm", checked: true })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Mosaic" })).toBeNull();
  });

  it("pages the Specialists variants in both directions and updates the overflow controls", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<AssistantAvatarPicker avatar={{ shape: "specialist-travel", color: ASSISTANT_ROBOT_AVATARS["specialist-travel"] }}
      onChange={vi.fn()} seed="picker" />);
    const variants = screen.getByRole("radiogroup", { name: "Robot variant" });
    const viewport = variants.closest<HTMLDivElement>(".overflow-x-auto")!;
    const viewportWidth = 480;
    const overflow = 384;
    Object.defineProperties(viewport, {
      clientWidth: { value: viewportWidth },
      scrollWidth: { value: viewportWidth + overflow },
      scrollBy: { value: ({ left = 0 }: ScrollToOptions) => {
        viewport.scrollLeft = Math.max(0, Math.min(overflow, viewport.scrollLeft + left));
        fireEvent.scroll(viewport);
      } },
    });

    const left = screen.getByRole("button", { name: "Scroll left" });
    const right = screen.getByRole("button", { name: "Scroll right" });
    fireEvent.scroll(viewport);
    expect(left.classList.contains("pointer-events-none")).toBe(true);
    expect(right.classList.contains("pointer-events-none")).toBe(false);
    fireEvent.click(right);
    expect(viewport.scrollLeft).toBe(overflow);
    expect(viewport.style.maskImage).toMatch(/to right, transparent, /);
    expect(left.classList.contains("pointer-events-none")).toBe(false);
    expect(right.classList.contains("pointer-events-none")).toBe(true);
    fireEvent.click(left);
    expect(viewport.scrollLeft).toBe(0);
    expect(right.classList.contains("pointer-events-none")).toBe(false);
  });

  it("renders different reactions for successive picker selections and starts the new avatar facing forward", async () => {
    vi.spyOn(Math, "random").mockReturnValue(.65);
    type Draw = NonNullable<ReturnType<typeof renderer.createRobotRenderer>>["draw"];
    const draw = vi.fn<Draw>();
    const create = vi.spyOn(renderer, "createRobotRenderer").mockReturnValue({ draw, dispose: vi.fn() });
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frame = fn; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { frame = undefined; });

    function Picker() {
      const [avatar, setAvatar] = useState<Avatar>({ shape: "terminal-amber", color: "amber" });
      return <AssistantAvatarPicker avatar={avatar} onChange={setAvatar} seed="picker" />;
    }
    const { container } = render(<Picker />);
    Object.defineProperty(container.querySelector("canvas")!, "clientWidth", { value: 112 });

    async function showPreview(shape: string) {
      intersection([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      await waitFor(() => {
        expect(create.mock.lastCall?.[1]).toBe(shape);
        expect(frame).toBeDefined();
      });
    }
    function advance(now: number) {
      const next = frame;
      frame = undefined;
      next?.(now);
      return draw.mock.lastCall?.[0];
    }

    await showPreview("terminal-amber");
    advance(0);
    expect(advance(395)?.roll).toBeGreaterThan(.05);
    expect(Math.abs(draw.mock.lastCall?.[0].accent ?? 0)).toBeGreaterThan(.5);
    expect(advance(425)?.roll).toBeLessThan(-.08);
    const preview = screen.getByRole("group", { name: "Amber robot preview" });
    for (let i = 0; i < 12; i++) fireEvent.keyDown(preview, { key: "ArrowRight" });
    for (let now = 440; now < 730; now += 16) advance(now);
    expect(draw.mock.lastCall?.[0].yaw).toBeGreaterThan(3);

    fireEvent.click(screen.getByRole("radio", { name: "Teal" }));
    await showPreview("terminal-teal");
    expect(advance(800)?.yaw).toBeCloseTo(.28);
    expect(Math.abs(advance(1255)?.roll ?? 0)).toBeGreaterThan(.15);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("mosaic assistant avatars", () => {
  it("retains the same tiles and two eyes when the assistant starts working", () => {
    const props = { name: "TestFlight", providerId: "codex", avatar: { shape: "cube", color: "rose" } as const, onClick: vi.fn() };
    const view = render(<AssistantMonogram {...props} />);
    const cells = [...view.container.querySelectorAll(".tool-square")];
    const eyes = [...view.container.querySelectorAll("[data-eye]")];
    expect(eyes).toHaveLength(2);
    expect(eyes.every(eye => eye.classList.contains("mosaic-avatar__eye"))).toBe(true);
    expect(view.container.querySelectorAll(".mosaic-avatar__tile--accent")).toHaveLength(3);
    view.rerender(<AssistantMonogram {...props} working />);
    expect([...view.container.querySelectorAll(".tool-square")]).toEqual(cells);
    expect([...view.container.querySelectorAll("[data-eye]")]).toEqual(eyes);
    expect(view.container.querySelector('[data-working="true"]')).toBeTruthy();
  });
  it.each([["badge-card", "badge"], ["felt-sprout", "felt"]] as const)("renders the %s finish and animates its own eyes", (shape, family) => {
    const { container } = render(<AssistantAvatar avatar={{ shape, color: "mint" }} working className="size-6" />);
    const avatar = container.firstElementChild!;
    expect(avatar.getAttribute("data-avatar-family")).toBe(family);
    expect(avatar.getAttribute("data-animated")).toBe("true");
    expect(avatar.querySelectorAll("[data-eye]")).toHaveLength(2);
    expect(avatar.querySelector(".material-avatar__finish")).toBeTruthy();
    expect(avatar.querySelector(".tool-square")).toBeNull();
  });
  it("pauses outside the viewport or in a hidden window and releases observation on unmount", () => {
    const view = render(<AssistantAvatar className="size-8" />);
    const avatar = view.container.firstElementChild!;
    expect(observe).toHaveBeenCalledWith(avatar);
    intersection([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(avatar.getAttribute("data-paused")).toBe("true");
    hidden = true;
    intersection([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    fireEvent(document, new Event("visibilitychange"));
    expect(avatar.getAttribute("data-paused")).toBe("true");
    hidden = false; fireEvent(document, new Event("visibilitychange"));
    expect(avatar.getAttribute("data-paused")).toBe("false");
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it("snaps pointer gaze to four directions without replacing tiles", () => {
    const view = render(<AssistantAvatar className="size-24" />);
    const avatar = view.container.firstElementChild as HTMLElement;
    vi.spyOn(avatar, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));
    const cells = [...avatar.querySelectorAll(".tool-square")];
    fireEvent(avatar, new MouseEvent("pointermove", { bubbles: true, clientX: 200, clientY: 50 }));
    expect(avatar.dataset.gaze).toBe("right");
    fireEvent(avatar, new MouseEvent("pointermove", { bubbles: true, clientX: 50, clientY: -200 }));
    expect(avatar.dataset.gaze).toBe("up");
    expect([...avatar.querySelectorAll(".tool-square")]).toEqual(cells);
    expect(avatar.querySelectorAll("[data-eye]")).toHaveLength(2);
    fireEvent.pointerOut(avatar);
    expect(avatar.dataset.gaze).toBeUndefined();
  });
});
