// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { installOverlayFrameClock } from "@/lib/overlay-test-fixtures";
import { TurnRail, visibleTurnMarkerGroupIds } from "./turn-rail";

const positions = [
  { groupId: "first", top: 100 },
  { groupId: "second", top: 400 },
  { groupId: "third", top: 900 },
];

describe("visibleTurnMarkerGroupIds", () => {
  it("keeps the turn active while its reply occupies the viewport", () => {
    expect([...visibleTurnMarkerGroupIds(positions, 500, 800, 1_400)]).toEqual([
      "second",
    ]);
  });

  it("marks adjacent turns when the viewport crosses their boundary", () => {
    expect([...visibleTurnMarkerGroupIds(positions, 350, 450, 1_400)]).toEqual([
      "first",
      "second",
    ]);
  });

  it("uses the content end as the final turn boundary", () => {
    expect([
      ...visibleTurnMarkerGroupIds(positions, 1_100, 1_300, 1_400),
    ]).toEqual(["third"]);
  });
});

it("reuses turn offsets on viewport resize and remeasures when the content reflows", () => {
  const transcript = document.createElement("div");
  const content = document.createElement("div");
  transcript.append(content);
  let height = 100;
  Object.defineProperties(transcript, {
    clientHeight: { get: () => height },
    scrollHeight: { value: 500 },
  });
  const offsets = [0, 100, 260, 400];
  const markers = offsets.map((_, index) => {
    const row = document.createElement("div");
    row.dataset.groupIndex = String(index);
    vi.spyOn(row, "getBoundingClientRect").mockImplementation(
      () => ({ top: offsets[index] - transcript.scrollTop }) as DOMRect,
    );
    content.append(row);
    return { index, groupId: String(index), prompt: `Turn ${index + 1}`, reply: "" };
  });
  const findPositions = vi.spyOn(transcript, "querySelectorAll");
  let resize!: (entries: Pick<ResizeObserverEntry, "target">[]) => void;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: typeof resize) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  const frames = installOverlayFrameClock();
  try {
    render(createElement(TurnRail, { markers, transcriptRef: { current: transcript }, onSelect() {} }));
    act(() => frames.flush());
    expect(findPositions).toHaveBeenCalledTimes(1);
    const second = screen.getByRole("button", { name: "Turn 2" });
    expect(second.hasAttribute("aria-current")).toBe(false);

    height = 180;
    act(() => {
      resize([{ target: transcript }]);
      frames.flush();
    });
    expect(second.getAttribute("aria-current")).toBe("location");
    expect(findPositions).toHaveBeenCalledTimes(1);

    offsets[1] = 220;
    act(() => {
      resize([{ target: content }]);
      frames.flush();
    });
    expect(second.hasAttribute("aria-current")).toBe(false);
    expect(findPositions).toHaveBeenCalledTimes(2);
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});
