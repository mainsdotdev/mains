import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DropdownMenuItem, DropdownMenuSub } from "./dropdown-menu";
import DropdownWrapper from "./dropdown-wrapper";
import Select from "./select";

describe("accessible select and dropdown primitives", () => {
  it("exposes the Select trigger as a named listbox controller", () => {
    const markup = renderToStaticMarkup(
      createElement(Select, {
        value: "medium",
        options: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
        ],
        onChange: () => undefined,
        "aria-label": "Effort",
      }),
    );

    expect(markup).toContain('aria-label="Effort"');
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("aria-controls=");
    expect(markup).not.toContain('role="option"');
  });

  it("removes a closed DropdownWrapper and its controls from the DOM", () => {
    const markup = renderToStaticMarkup(
      createElement(
        DropdownWrapper,
        { isOpen: false },
        createElement("button", null, "Hidden action"),
      ),
    );

    expect(markup).toBe("");
  });

  it("allows popovers to override menu semantics", () => {
    const markup = renderToStaticMarkup(
      createElement(
        DropdownWrapper,
        {
          isOpen: true,
          role: "dialog",
          "aria-label": "Filters",
        },
        createElement("span", null, "Filter controls"),
      ),
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="Filters"');
  });

  it("gives menu items and submenu triggers the correct roles and states", () => {
    const itemMarkup = renderToStaticMarkup(
      createElement(
        DropdownMenuItem,
        { onClick: () => undefined, selected: true },
        "By project",
      ),
    );
    const submenuMarkup = renderToStaticMarkup(
      createElement(
        DropdownMenuSub,
        { label: "Open with" },
        createElement("span", null, "Finder"),
      ),
    );

    expect(itemMarkup).toContain('role="menuitemradio"');
    expect(itemMarkup).toContain('aria-checked="true"');
    expect(itemMarkup).toContain('tabindex="-1"');
    expect(submenuMarkup).toContain('role="menuitem"');
    expect(submenuMarkup).toContain('aria-haspopup="menu"');
    expect(submenuMarkup).toContain('aria-expanded="false"');
  });
});
