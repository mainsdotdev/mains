// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu } from "./dropdown-menu";
import Select from "./select";

afterEach(cleanup);

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("Select inside DropdownMenu", () => {
  it("keeps the parent menu open while choosing from the portaled listbox", () => {
    const onClose = vi.fn();
    const onChange = vi.fn();

    render(
      createElement(
        DropdownMenu,
        {
          isOpen: true,
          position: { x: 16, y: 16 },
          onClose,
          "aria-label": "Browser menu",
        },
        createElement(Select, {
          value: "all-time",
          options: [
            { value: "last-hour", label: "Last hour" },
            { value: "all-time", label: "All time" },
          ],
          onChange,
          "aria-label": "Browsing data time range",
        }),
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Browsing data time range" }),
    );
    const option = screen.getByRole("option", { name: "Last hour" });
    fireEvent.mouseDown(option);
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith("last-hour");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("menu", { name: "Browser menu" })).toBeTruthy();
  });

  it("shows an option's full description on hover", async () => {
    const description =
      "Use the standard style, overriding saved Claude Code styles.";

    render(
      createElement(Select, {
        value: "",
        options: [
          { value: "", label: "Use Claude Code settings" },
          { value: "default", label: "Default (standard)", description },
        ],
        onChange: vi.fn(),
        "aria-label": "Output style",
        showOptionDescriptionTooltip: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Output style" }));
    fireEvent.mouseEnter(screen.getByRole("option", { name: /Default/ }));

    expect((await screen.findByRole("tooltip")).textContent).toBe(description);
  });
});
