// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolCollapse } from "./_shared";

afterEach(cleanup);

describe("ToolCollapse", () => {
  it("defers collapsed content until its first expansion, then retains it", async () => {
    let mounts = 0;
    function ExpensiveBody() {
      mounts++;
      return createElement("div", { "data-testid": "body" }, "body");
    }

    const body = createElement(ExpensiveBody);
    const collapse = (isExpanded: boolean) => {
      const props: Parameters<typeof ToolCollapse>[0] = {
        isExpanded,
        children: body,
      };
      return createElement(ToolCollapse, props);
    };
    const view = render(collapse(false));

    expect(view.queryByTestId("body")).toBeNull();
    expect(mounts).toBe(0);

    view.rerender(collapse(true));
    await waitFor(() => expect(view.getByTestId("body")).toBeTruthy());
    expect(mounts).toBe(1);

    view.rerender(collapse(false));
    expect(view.getByTestId("body")).toBeTruthy();
    expect(mounts).toBe(1);
  });
});
