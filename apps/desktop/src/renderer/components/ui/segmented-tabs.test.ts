import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getNextSegmentedValue,
  SegmentedTabs,
} from "./segmented-tabs";

const OPTIONS = [
  { value: "summary", label: "Summary" },
  { value: "code", label: "Code" },
] as const;

describe("SegmentedTabs", () => {
  it("renders a named tablist with roving focus and panel linkage", () => {
    const markup = renderToStaticMarkup(
      createElement(SegmentedTabs, {
        id: "pr-view",
        value: "summary",
        onChange: () => undefined,
        options: OPTIONS,
        panelId: "pr-panel",
        "aria-label": "Pull request view",
      }),
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Pull request view"');
    expect(markup).toContain('aria-orientation="horizontal"');
    expect(markup).toContain('id="pr-view-summary-tab"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-controls="pr-panel"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("focus-visible:ring-2");
    expect(markup).not.toContain("focus-visible:ring-0");
  });

  it("uses radio semantics for filter and setting selectors", () => {
    const markup = renderToStaticMarkup(
      createElement(SegmentedTabs, {
        value: "code",
        onChange: () => undefined,
        options: OPTIONS,
        semantics: "radiogroup",
        "aria-label": "Result type",
      }),
    );

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('role="radio"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).not.toContain('aria-selected="true"');
  });

  it("wraps arrow navigation and supports Home and End", () => {
    const values = OPTIONS.map((option) => option.value);

    expect(getNextSegmentedValue(values, "summary", "ArrowLeft")).toBe("code");
    expect(getNextSegmentedValue(values, "code", "ArrowRight")).toBe("summary");
    expect(getNextSegmentedValue(values, "summary", "ArrowUp")).toBe("code");
    expect(getNextSegmentedValue(values, "code", "ArrowDown")).toBe("summary");
    expect(getNextSegmentedValue(values, "code", "Home")).toBe("summary");
    expect(getNextSegmentedValue(values, "summary", "End")).toBe("code");
  });
});
