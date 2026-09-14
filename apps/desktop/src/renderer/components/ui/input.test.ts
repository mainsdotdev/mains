import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input, NativeSelect, Textarea } from "./input";
import { describe, expect, it } from "vitest";

describe("form control primitives", () => {
  it("uses the standard glass treatment without imposing a minimum width", () => {
    const markup = renderToStaticMarkup(createElement(Input));

    expect(markup).toContain("glass-input");
    expect(markup).toContain("min-w-0");
    expect(markup).not.toContain("min-w-60");
  });

  it("leaves surface and layout styling to bare consumers", () => {
    const markup = renderToStaticMarkup(
      createElement(Textarea, { variant: "bare", className: "resize-none" }),
    );

    expect(markup).not.toContain("glass-input");
    expect(markup).not.toContain("min-h-16");
    expect(markup).toContain("resize-none");
  });

  it("exposes invalid state to assistive technology", () => {
    const markup = renderToStaticMarkup(createElement(Input, { hasError: true }));

    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain("[--glass-rim:var(--color-danger)]");
  });

  it("provides a distinctly named native select primitive", () => {
    const markup = renderToStaticMarkup(
      createElement(
        NativeSelect,
        { defaultValue: "one" },
        createElement("option", { value: "one" }, "One"),
      ),
    );

    expect(markup).toContain("<select");
    expect(markup).toContain("glass-input");
  });
});
