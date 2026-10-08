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

const runHeader =createElement("button", null, "Selected run");

function RunContent({ expanded, collapsed }: { expanded: boolean; collapsed: boolean }) {
  useSetMainHeader(runHeader, true);
  // children goes in as createElement's third argument, which its typings don't count.
  const props: Omit<MainContentProps, "children"> = {
    marginLeft: collapsed ? "4rem" : "22rem",
    marginRight: "38rem",
    sidebarCollapsed: collapsed,
    browserOpen: true,
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

describe("MainContent during sidebar navigation", () => {
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
    const header = tab.parentElement!;
    const surface = document.querySelector("[data-main-content-surface]")!;
    view.rerender(content("Second chat", true));
    expect(screen.getByText("First chat")).toBe(tab);
    expect(tab.parentElement).toBe(header);
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

describe("MainContent status bar placement", () => {
  it("keeps the footer outside the clipped route surface and removes its space when hidden", () => {
    const content = (visible: boolean) => createElement(MainContent, {
      marginLeft: "22rem", marginRight: "0",
      footer: visible ? createElement("footer", { "aria-label": "Application status" }, "Context 42%") : null,
    } as MainContentProps, createElement("div", null, "Chat panel"));
    const view = render(content(true));
    const surface = document.querySelector("[data-main-content-surface]")!;
    const footer = screen.getByRole("contentinfo", { name: "Application status" });
    expect(surface.contains(footer)).toBe(false);
    expect(surface.nextElementSibling).toBe(footer);
    expect(footer.parentElement).toBe(surface.parentElement);
    view.rerender(content(false));
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(surface.nextElementSibling).toBeNull();
  });
});
