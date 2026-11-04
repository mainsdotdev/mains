import { describe, expect, it } from "vitest";
import { hexColor, labelColorMap, priorityFromName, PRIORITY } from "./sync.issue-display";

describe("priorityFromName", () => {
  it.each([
    ["Highest", PRIORITY.urgent],
    ["Blocker", PRIORITY.urgent],
    ["High", PRIORITY.high],
    ["Major", PRIORITY.high],
    ["Medium", PRIORITY.medium],
    ["Low", PRIORITY.low],
    ["Lowest", PRIORITY.low],
    ["Trivial", PRIORITY.low],
  ])("reads %s onto the shared scale", (name, level) => {
    expect(priorityFromName(name)).toBe(level);
  });

  it("has no priority without a recognisable name", () => {
    expect(priorityFromName(null)).toBe(PRIORITY.none);
    expect(priorityFromName("Whenever")).toBe(PRIORITY.none);
  });
});

describe("hexColor", () => {
  it("normalizes hex with or without '#', short or long", () => {
    expect(hexColor("#5E6AD2")).toBe("#5e6ad2");
    expect(hexColor("d73a4a")).toBe("#d73a4a");
    expect(hexColor("#fa0")).toBe("#ffaa00");
  });

  it("resolves Trello and Asana palette names, shades included", () => {
    expect(hexColor("green")).toBe("#4bce97");
    expect(hexColor("green_dark")).toBe("#4bce97");
    expect(hexColor("dark-pink")).toBe("#fc91ad");
    expect(hexColor("hot-pink")).toBe("#ea4e9d");
  });

  it("drops anything else", () => {
    expect(hexColor(null)).toBeNull();
    expect(hexColor("none")).toBeNull();
    expect(hexColor("url(evil)")).toBeNull();
  });
});

describe("labelColorMap", () => {
  it("keeps only labels with a usable color", () => {
    expect(
      labelColorMap([
        { name: "Bug", color: "ef4444" },
        { name: "Feature", color: "purple" },
        { name: "Plain", color: null },
        { name: "", color: "#000000" },
      ]),
    ).toEqual({ Bug: "#ef4444", Feature: "#9f8fef" });
  });
});
