// @vitest-environment jsdom

import { createElement, type ComponentProps } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolCollapse } from "./_shared";

afterEach(cleanup);

describe("ToolCollapse", () => {
  it("keeps body decoration inside the zero-height clipping grid", () => {
    const props = {
      isExpanded: false,
      className: "rounded-md border",
    } as ComponentProps<typeof ToolCollapse>;
    const { container } = render(
      createElement(
        ToolCollapse,
        props,
        createElement("div", null, "details"),
      ),
    );

    const outer = container.firstElementChild as HTMLElement;
    const clipper = outer.firstElementChild as HTMLElement;
    const body = clipper.firstElementChild as HTMLElement;

    expect(outer.className).toContain("overflow-hidden");
    expect(clipper.className).toContain("min-h-0 overflow-hidden");
    expect(clipper.className).not.toContain("border");
    expect(body.className).toContain("rounded-md border");
  });
});
