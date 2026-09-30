// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MainHeaderProvider, useSetMainHeader } from "@/hooks/use-main-header";
import { MainContent, getCollapsedHeaderPaddingLeft } from "./main-content";

vi.mock("@/lib/platform", () => ({
  useCapabilities: () => ({ windowChrome: true }),
}));

const runHeader = createElement("button", null, "Selected run");

function RunContent({ expanded, collapsed }: { expanded: boolean; collapsed: boolean }) {
  useSetMainHeader(runHeader, true);
  return createElement(MainContent, {
    marginLeft: collapsed ? "4rem" : "22rem",
    marginRight: "38rem",
    sidebarCollapsed: collapsed,
    browserOpen: true,
    headerHidden: expanded,
  }, createElement("div", null, "Run transcript"));
}

beforeEach(() => {
  vi.stubGlobal("api", { app: { onFullscreenChange: () => () => {} } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MainContent under the expanded browser", () => {
  it("keeps the run header invisible throughout sidebar toggles and restores it with the panel", () => {
    const content = (expanded: boolean, collapsed: boolean) =>
      createElement(MainHeaderProvider, null, createElement(RunContent, { expanded, collapsed }));
    const view = render(content(true, false));

    for (const collapsed of [false, true, false, true]) {
      view.rerender(content(true, collapsed));
      const header = screen.getByText("Selected run").parentElement!;
      expect(getComputedStyle(header).visibility).toBe("hidden");
      expect(screen.queryByRole("button", { name: "Selected run" })).toBeNull();
    }

    view.rerender(content(false, true));
    const header = screen.getByText("Selected run").parentElement!;
    expect(getComputedStyle(header).visibility).toBe("visible");
    expect(screen.getByRole("button", { name: "Selected run" })).toBeTruthy();
  });
});

describe("getCollapsedHeaderPaddingLeft", () => {
  it("reserves only the toggle after the mode picker moved into the sidebar", () => {
    expect(getCollapsedHeaderPaddingLeft(true, true, false)).toBe("4.5rem");
    expect(getCollapsedHeaderPaddingLeft(true, false, false)).toBe("3rem");
    expect(getCollapsedHeaderPaddingLeft(true, true, true)).toBe("3rem");
  });

  it("adds no header inset while the sidebar is open", () => {
    expect(getCollapsedHeaderPaddingLeft(false, true, false)).toBeUndefined();
  });
});
