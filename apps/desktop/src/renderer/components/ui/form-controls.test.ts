import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";
import { Slider } from "./slider";
import { Toggle } from "./toggle";

describe("accessible form controls", () => {
  it("keeps the native checkbox focusable without creating a nested label", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "label",
        null,
        createElement(Checkbox, {
          checked: true,
          name: "include-worktree",
          onChange: () => undefined,
        }),
        "Include worktree",
      ),
    );

    expect(markup.match(/<label/g)).toHaveLength(1);
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('name="include-worktree"');
    expect(markup).toContain("opacity-0");
    expect(markup).not.toContain('class="hidden"');
    expect(markup).toContain("peer-focus-visible:ring-2");
  });

  it("exposes toggle state, name, focus, and disabled semantics", () => {
    const markup = renderToStaticMarkup(
      createElement(Toggle, {
        enabled: true,
        onChange: () => undefined,
        disabled: true,
        "aria-label": "Allow web search",
      }),
    );

    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-label="Allow web search"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("focus-visible:ring-2");
  });

  it("gives the range an accessible formatted value and visible focus state", () => {
    const markup = renderToStaticMarkup(
      createElement(Slider, {
        value: 14,
        onChange: () => undefined,
        min: 10,
        max: 20,
        showValue: false,
        formatValue: (value) => `${value}px`,
        "aria-label": "Interface size",
      }),
    );

    expect(markup).toContain('type="range"');
    expect(markup).toContain('aria-label="Interface size"');
    expect(markup).toContain('aria-valuetext="14px"');
    expect(markup).toContain("has-focus-visible:ring-2");
    expect(markup).not.toContain("focus-within:ring-2");
  });
});
