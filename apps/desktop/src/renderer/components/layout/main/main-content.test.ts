// @vitest-environment jsdom

import { createElement, useMemo, type ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MainHeaderProvider, useSetMainHeader } from "@/hooks/use-main-header";
import { MainContent, getCollapsedHeaderPaddingLeft } from "./main-content";

vi.mock("@/lib/platform", () => ({
  useCapabilities: () => ({ windowChrome: true }),
}));

type MainContentProps = ComponentProps<typeof MainContent>;

const runHeader = createElement("button", null, "Selected run");

function RunContent({ expanded, collapsed }: { expanded: boolean; collapsed: boolean }) {
  useSetMainHeader(runHeader, true);
  // children goes in as createElement's third argument, which its typings don't count.
  const props: Omit<MainContentProps, "children"> = {
    marginLeft: collapsed ? "4rem" : "22rem",
    marginRight: "38rem",
    sidebarCollapsed: collapsed,
    headerHidden: expanded,
  };
  return createElement(
    MainContent,
    props as MainContentProps,
    createElement("div", null, "Run transcript"),
  );
}

function HeaderOwner({ label, pending }: { label: string; pending: boolean }) {
  const header = useMemo(() => pending ? null : createElement("button", null, label), [label, pending]);
  useSetMainHeader(header, true, pending);
  return null;
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
      const header = screen.getByText("Selected run").closest("[data-shell-header]")!;
      expect(getComputedStyle(header).visibility).toBe("hidden");
      expect(screen.queryByRole("button", { name: "Selected run" })).toBeNull();
    }

    view.rerender(content(false, true));
    const header = screen.getByText("Selected run").closest("[data-shell-header]")!;
    expect(getComputedStyle(header).visibility).toBe("visible");
    expect(screen.getByRole("button", { name: "Selected run" })).toBeTruthy();
  });
});

describe("MainContent during sidebar navigation", () => {
  it("keeps contextual actions in the main header while adjacent panels change its edge", () => {
    const actions = createElement("button", null, "Session details");
    const content = (right: string) => {
      const props: Omit<MainContentProps, "children"> = {
        marginLeft: "22rem",
        marginRight: right,
        headerActions: actions,
      };
      return createElement(MainHeaderProvider, null,
        createElement(HeaderOwner, { label: "Open chat", pending: false }),
        createElement(MainContent, props as MainContentProps, createElement("div", null, "Transcript")));
    };
    const view = render(content("0.375rem"));
    const session = screen.getByRole("button", { name: "Session details" });
    const header = session.closest("[data-shell-header]");
    for (const right of ["38rem", "45rem", "22rem", "0.375rem"]) {
      view.rerender(content(right));
      expect(screen.getByRole("button", { name: "Session details" })).toBe(session);
      expect(session.closest("[data-shell-header]")).toBe(header);
      expect(session.closest("main")).toBe(screen.getByRole("main"));
      expect(screen.getByRole("main").style.marginRight).toBe(right);
    }
  });

  it("preserves the tab and corner while loading, disables stale actions, and clears the header when its page leaves", () => {
    const content = (label: string, pending: boolean, showOwner = true) =>
      createElement(MainHeaderProvider, null,
        showOwner && createElement(HeaderOwner, { label, pending }),
        createElement(MainContent, { marginLeft: "22rem", marginRight: "0", sidebarCollapsed: false } as MainContentProps,
          createElement("div", null, "Transcript")));
    const view = render(content("First chat", true));
    expect(screen.queryByRole("button")).toBeNull();

    view.rerender(content("First chat", false));
    const tab = screen.getByRole("button", { name: "First chat" });
    const header = tab.closest("[data-shell-header]")!;
    const surface = document.querySelector("[data-main-content-surface]")!;
    view.rerender(content("Second chat", true));
    expect(screen.getByText("First chat")).toBe(tab);
    expect(tab.closest("[data-shell-header]")).toBe(header);
    expect(header.hasAttribute("inert")).toBe(true);
    expect(header.getAttribute("aria-busy")).toBe("true");
    expect(surface.classList.contains("rounded-tl-none")).toBe(true);

    view.rerender(content("Second chat", false));
    expect(screen.getByRole("button", { name: "Second chat" })).toBe(tab);
    expect(header.hasAttribute("inert")).toBe(false);
    expect(header.hasAttribute("aria-busy")).toBe(false);

    view.rerender(content("", true, false));
    expect(screen.queryByRole("button")).toBeNull();
    expect(surface.classList.contains("rounded-tl-none")).toBe(false);
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
