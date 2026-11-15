// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantMonogram } from "./assistant-monogram";

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
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("particle assistant avatars", () => {
  it("retains the same two eye particles when the assistant starts working", () => {
    const props = { name: "TestFlight", providerId: "codex", avatar: { shape: "cube", color: "rose" } as const, onClick: vi.fn() };
    const view = render(<AssistantMonogram {...props} />);
    const svg = view.container.querySelector("svg");
    const eyes = [...view.container.querySelectorAll("[data-eye]")];
    expect(eyes).toHaveLength(2);
    expect(eyes.every(eye => eye.parentElement?.parentElement?.hasAttribute("data-particle-id"))).toBe(true);
    view.rerender(<AssistantMonogram {...props} working />);
    expect(view.container.querySelector("svg")).toBe(svg);
    expect([...view.container.querySelectorAll("[data-eye]")]).toEqual(eyes);
    expect(view.container.querySelector('[data-working="true"]')).toBeTruthy();
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
  it("bounds pointer gaze without changing particle identities", () => {
    const view = render(<AssistantAvatar className="size-24" />);
    const avatar = view.container.firstElementChild as HTMLElement;
    vi.spyOn(avatar, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));
    fireEvent(avatar, new MouseEvent("pointermove", { bubbles: true, clientX: 200, clientY: -200 }));
    expect(avatar.style.getPropertyValue("--avatar-look-x")).toBe("2px");
    expect(avatar.style.getPropertyValue("--avatar-look-y")).toBe("-1.5px");
    expect(avatar.querySelectorAll("[data-eye]")).toHaveLength(2);
    fireEvent.pointerOut(avatar);
    expect(avatar.style.getPropertyValue("--avatar-look-x")).toBe("");
  });
});
