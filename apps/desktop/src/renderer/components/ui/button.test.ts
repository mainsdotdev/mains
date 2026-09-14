import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("keeps focus and disabled affordances on the bare variant", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Button,
        { variant: "bare", disabled: true },
        "Custom action",
      ),
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain("disabled:opacity-50");
    expect(markup).toContain("disabled:cursor-not-allowed");
    expect(markup).not.toContain("px-3");
    expect(markup).not.toContain("rounded-xl");
  });

  it("retains the standard visual base for styled variants", () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { variant: "primary" }, "Save"),
    );

    expect(markup).toContain("px-3");
    expect(markup).toContain("rounded-xl");
    expect(markup).toContain("glass-primary");
  });

  it("exposes loading as a disabled busy state", () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { variant: "submit", isLoading: true }, "Save"),
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Loading...");
  });
});
