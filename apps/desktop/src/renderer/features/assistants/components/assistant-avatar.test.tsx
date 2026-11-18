// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { ASSISTANT_AVATAR_SHAPES_BY_FAMILY, ASSISTANT_ROBOT_AVATARS, type AssistantAvatar as Avatar } from "@mains/contracts/assistants";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantMonogram } from "./assistant-monogram";
import { AssistantAvatarPicker } from "./assistant-avatar-picker";

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
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
});

describe("robot assistant avatars", () => {
  it.each(ASSISTANT_AVATAR_SHAPES_BY_FAMILY.robot)("renders a bundled thumbnail for %s in compact surfaces", shape => {
    const { container } = render(<AssistantAvatar avatar={{ shape, color: ASSISTANT_ROBOT_AVATARS[shape] }} working className="size-5" />);
    expect(container.querySelector("img")?.getAttribute("src")).toContain(`${shape}.webp`);
    expect(container.querySelector('[data-avatar-family="robot"][data-working="true"]')).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
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
    expect(styles.getAllByRole("radio").map(option => option.textContent)).toEqual(["Retro Terminal", "Clear Shell", "One-Eye Metal"]);
    expect(screen.queryByRole("radiogroup", { name: "Avatar color" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("sphere rose");
    for (const name of ["Retro Terminal", "Clear Shell", "One-Eye Metal"]) {
      fireEvent.click(styles.getByRole("radio", { name }));
      const variants = within(screen.getByRole("radiogroup", { name: "Robot variant" }));
      expect(variants.getAllByRole("radio")).toHaveLength(7);
    }
    fireEvent.click(screen.getByRole("radio", { name: "Bronze" }));
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("metal-bronze amber");
    fireEvent.click(screen.getByRole("radio", { name: "Clear Shell" }));
    fireEvent.click(screen.getByRole("radio", { name: "One-Eye Metal" }));
    expect(screen.getByRole("radio", { name: "Bronze", checked: true })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Mosaic" })).toBeNull();
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
