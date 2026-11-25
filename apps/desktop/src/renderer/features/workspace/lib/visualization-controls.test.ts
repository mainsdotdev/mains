import { describe, expect, it } from "vitest";
import { parseVisualizationControls } from "@mains/contracts/visualization";
import { visualizationDesignPrompt } from "./visualization-controls";

const snapshot = { language: "en", previewing: false, carousels: [], groups: [{ id: "group", label: "Player", visible: true,
  controls: [{ id: "radius", label: "Radius", type: "range", value: 12, initialValue: 8, min: 0, max: 40, step: 1 }] }] };

describe("visualization catalog boundary", () => {
  it("accepts valid catalogs, strips undeclared fields and keeps prompts bound to the exact source file", () => {
    const parsed = parseVisualizationControls({ ...snapshot, arbitrary: "ignored" })!;
    expect(parsed).toEqual(snapshot);
    expect(visualizationDesignPrompt("/designs/player.html", parsed)).toContain("File: /designs/player.html");
    expect(visualizationDesignPrompt("/designs/player.html", parsed)).toContain("Radius: 8 → 12");
  });
  it.each([
    { ...snapshot, groups: Array(65).fill(snapshot.groups[0]) },
    { ...snapshot, groups: [snapshot.groups[0], snapshot.groups[0]] },
    { ...snapshot, groups: [{ ...snapshot.groups[0], controls: [{ ...snapshot.groups[0].controls[0], value: Infinity }] }] },
    { ...snapshot, groups: [{ ...snapshot.groups[0], controls: [{ ...snapshot.groups[0].controls[0], step: -1 }] }] },
    { ...snapshot, carousels: [{ id: "c", label: "Designs", previousLabel: "Back", nextLabel: "Next", selectedId: "unknown", variants: [{ id: "a", label: "A" }] }] },
    { ...snapshot, groups: [{ ...snapshot.groups[0], controls: [{ id: "s", label: "Style", type: "select", value: "missing", initialValue: "a", options: [{ label: "A", value: "a" }] }] }] },
  ])("rejects malformed, ambiguous or oversized iframe data", (value) => {
    expect(parseVisualizationControls(value)).toBeNull();
  });
});
