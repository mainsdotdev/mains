// @vitest-environment jsdom

import { createElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Run, RunEvent } from "../types";
import {
  BrowserChatOverlay,
  browserChatRunStatus,
  browserChatSize,
  browserChatTransition,
} from "./browser-chat-overlay";

const run: Run = {
  id: "run-1",
  goal: "Review this page",
  providerId: "codex",
  status: "running",
};

const event = (
  id: string,
  content: string,
  kind: string,
  metadata: Record<string, unknown> = {},
): RunEvent => ({
  id,
  type: "artifact",
  content,
  timestamp: new Date(),
  metadata: { kind, ...metadata },
});

describe("browser chat overlay", () => {
  it("keeps one surface mounted while switching between input, details, and icon", () => {
    const onMinimize = vi.fn();
    const onShowDetails = vi.fn();
    const composer = createElement("div", null, "Composer");
    const { rerender } = render(createElement(BrowserChatOverlay, {
      run,
      mode: "input",
      onShowDetails,
      onMinimize,
      composer,
    }));
    const surface = screen.getByTestId("browser-chat-surface");
    const composerNode = screen.getByText("Composer");
    expect(surface.getAttribute("data-state")).toBe("input");
    expect(screen.getByText("Composer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show chat" })).toBeNull();
    rerender(createElement(BrowserChatOverlay, {
      run,
      mode: "details",
      onShowDetails,
      onMinimize,
      composer,
    }));
    expect(screen.getByRole("region", { name: "Selected chat" })).toBe(surface);
    expect(surface.getAttribute("data-state")).toBe("details");
    fireEvent.click(screen.getByRole("button", { name: "Minimize chat" }));
    expect(onMinimize).toHaveBeenCalledOnce();
    rerender(createElement(BrowserChatOverlay, {
      run,
      mode: "icon",
      onShowDetails,
      onMinimize,
      composer,
    }));
    expect(screen.getByTestId("browser-chat-surface")).toBe(surface);
    expect(surface.getAttribute("data-state")).toBe("icon");
    expect(screen.getByText("Composer")).toBe(composerNode);
    expect(composerNode.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Show chat" }));
    expect(onShowDetails).toHaveBeenCalledOnce();
    rerender(createElement(BrowserChatOverlay, {
      run,
      mode: "details",
      onShowDetails,
      onMinimize,
      composer,
    }));
    expect(screen.getByTestId("browser-chat-surface")).toBe(surface);
    rerender(createElement(BrowserChatOverlay, {
      run,
      mode: "input",
      onShowDetails,
      onMinimize,
      composer,
    }));
    expect(screen.getByTestId("browser-chat-surface")).toBe(surface);
    expect(surface.getAttribute("data-state")).toBe("input");
    expect(screen.getByText("Composer")).toBe(composerNode);
  });

  it("keeps the transcript mounted when a minimize transition is reversed", () => {
    const props = {
      run,
      mode: "details" as const,
      onShowDetails: vi.fn(),
      onMinimize: vi.fn(),
      composer: createElement("div", null, "Composer"),
      children: createElement("div", null, "Transcript"),
    };
    const { rerender } = render(createElement(BrowserChatOverlay, props));
    const transcript = screen.getByText("Transcript");
    const composer = screen.getByText("Composer");

    rerender(createElement(BrowserChatOverlay, { ...props, mode: "icon" }));
    expect(screen.getByText("Transcript")).toBe(transcript);
    expect(screen.getByText("Composer")).toBe(composer);

    rerender(createElement(BrowserChatOverlay, props));
    expect(screen.getByText("Transcript")).toBe(transcript);
    expect(screen.getByText("Composer")).toBe(composer);
  });

  it("uses the same width for the input and details while details grow to half the stage height", () => {
    const stage = { width: 1200, height: 800 };
    expect(browserChatSize("input", stage)).toEqual({ width: 540, height: 48 });
    expect(browserChatSize("input", stage, 76)).toEqual({ width: 540, height: 76 });
    expect(browserChatSize("details", stage)).toEqual({ width: 540, height: 400 });
    expect(browserChatSize("details", stage, 76)).toEqual({ width: 540, height: 428 });
    expect(browserChatSize("icon", stage)).toEqual({ width: 48, height: 48 });
    expect(browserChatSize("input", { width: 520, height: 800 }).width).toBe(
      browserChatSize("details", { width: 520, height: 800 }).width,
    );
  });

  it("measures a wrapped composer and keeps the transcript above it", async () => {
    const observers: Array<{ callback: ResizeObserverCallback; target?: Element }> = [];
    class ResizeObserverStub {
      readonly entry: (typeof observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback };
        observers.push(this.entry);
      }
      observe(target: Element) { this.entry.target = target; }
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const onComposerHeightChange = vi.fn();
    const props = {
      run,
      mode: "input" as const,
      onShowDetails: vi.fn(),
      onMinimize: vi.fn(),
      onComposerHeightChange,
      composer: createElement("div", null, "Composer"),
      children: createElement("div", null, "Transcript"),
    };
    const { rerender, unmount } = render(createElement(BrowserChatOverlay, props));
    const composer = screen.getByText("Composer").parentElement!;
    expect(composer.parentElement?.style.borderRadius).toBe("28px");
    vi.spyOn(composer, "getBoundingClientRect").mockReturnValue({ height: 76 } as DOMRect);
    const observer = observers.find((entry) => entry.target === composer);
    expect(observer).toBeDefined();
    act(() => observer?.callback([], {} as ResizeObserver));
    expect(onComposerHeightChange).toHaveBeenLastCalledWith(76);
    expect(composer.parentElement?.style.borderRadius).toBe("28px");

    rerender(createElement(BrowserChatOverlay, { ...props, mode: "details" }));
    await waitFor(() => {
      expect(screen.getByText("Transcript").parentElement?.style.paddingBottom).toBe("76px");
    });
    unmount();
    vi.unstubAllGlobals();
  });

  it("grows and shrinks vertically at a constant rate while retaining the icon spring", () => {
    expect(browserChatTransition("input", "details", false)).toMatchObject({
      type: "tween",
      ease: "linear",
    });
    expect(browserChatTransition("details", "input", false)).toMatchObject({
      type: "tween",
      ease: "linear",
    });
    expect(browserChatTransition("icon", "details", false)).toMatchObject({
      type: "spring",
    });
    expect(browserChatTransition("input", "details", true)).toEqual({
      duration: 0,
    });
  });

  it("shows live activity in the compact composer without exposing prompts or subagent output", () => {
    const events = [
      event("a", "I will inspect the page", "response"),
      event("b", "Subagent details", "response", { isFromSubagent: true }),
      event("c", "Please review this", "user-prompt"),
      event("d", "Checking  the  layout now\n", "thinking", { streaming: true }),
    ];
    const timedRun = { ...run, startedAt: new Date(0) };
    expect(browserChatRunStatus(events, timedRun, 14_000)).toBe("Working for 14s · Checking the layout now");
    expect(browserChatRunStatus([], timedRun, 14_000)).toBe("Working for 14s");
    expect(browserChatRunStatus([events[0]], timedRun, 14_000)).toBe("Working for 14s");
    expect(browserChatRunStatus([], { ...run, status: "queued" }, 14_000)).toBe("Queued · Review this page");
    expect(browserChatRunStatus(events, { ...run, status: "queued", title: "Review" }, 14_000)).toBe("Queued · Review");
    expect(browserChatRunStatus(events, { ...run, status: "succeeded" }, 14_000)).toBeNull();
    const liveReport = event("e", "First step\nReading hero-section.tsx", "report", { streaming: true });
    expect(browserChatRunStatus([...events, liveReport], timedRun, 14_000))
      .toBe("Working for 14s · Reading hero-section.tsx");
  });

  it("shows the ASCII spinner in the minimized icon only while the selected run is active", () => {
    const props = {
      mode: "icon" as const,
      onShowDetails: vi.fn(),
      onMinimize: vi.fn(),
    };
    const { rerender } = render(createElement(BrowserChatOverlay, { ...props, run }));
    const button = screen.getByRole("button", { name: "Show chat" });
    expect(button.querySelector(".tool-square")).toBeTruthy();

    rerender(createElement(BrowserChatOverlay, { ...props, run: { ...run, status: "queued" } }));
    expect(button.querySelector(".circle-dot")).toBeTruthy();

    rerender(createElement(BrowserChatOverlay, { ...props, run: { ...run, status: "succeeded" } }));
    expect(button.querySelector(".tool-square, .circle-dot")).toBeNull();
    expect(button.querySelector("svg")).toBeTruthy();
  });

  it("keeps the minimized button visible and clickable when a run finishes", async () => {
    const onShowDetails = vi.fn();
    const props = {
      mode: "details" as const,
      onShowDetails,
      onMinimize: vi.fn(),
      composer: createElement("div", null, "Composer"),
    };
    const { rerender } = render(createElement(BrowserChatOverlay, { ...props, run }));

    rerender(createElement(BrowserChatOverlay, { ...props, mode: "icon", run }));
    const button = screen.getByRole("button", { name: "Show chat" });
    await waitFor(() => {
      expect(button.querySelector(".tool-square")).toBeTruthy();
      expect(Number.parseFloat(button.parentElement!.parentElement!.style.opacity)).toBeGreaterThan(0.99);
    }, { timeout: 2000 });

    rerender(createElement(BrowserChatOverlay, {
      ...props,
      mode: "icon",
      run: { ...run, status: "succeeded" },
    }));

    await waitFor(() => {
      expect(button.querySelector("svg")).toBeTruthy();
      expect(button.querySelector(".tool-square")).toBeNull();
    }, { timeout: 2000 });
    fireEvent.click(button);
    expect(onShowDetails).toHaveBeenCalledOnce();
    rerender(createElement(BrowserChatOverlay, { ...props, mode: "icon", run: null }));
    expect(button.querySelector("svg")).toBeTruthy();
    fireEvent.click(screen.getByTestId("browser-chat-surface"));
    expect(onShowDetails).toHaveBeenCalledTimes(2);
  });

  it("uses the run title for the icon tooltip and New run when no title exists", async () => {
    const props = {
      mode: "icon" as const,
      onShowDetails: vi.fn(),
      onMinimize: vi.fn(),
    };
    const { rerender } = render(createElement(BrowserChatOverlay, {
      ...props,
      run: { ...run, title: "Hello Greeting" },
    }));
    const button = screen.getByRole("button", { name: "Show chat" });
    fireEvent.mouseEnter(button);
    await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("Hello Greeting"));

    rerender(createElement(BrowserChatOverlay, { ...props, run: null }));
    await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("New run"));
  });

});
