// @vitest-environment jsdom

import { createElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openFile, openDocument } = vi.hoisted(() => ({ openFile: vi.fn(), openDocument: vi.fn() }));
vi.mock("../hooks/use-open-file-in-editor", () => ({ useOpenFileInEditor: () => openFile }));
vi.mock("@/hooks/use-document-viewer", () => ({ useDocumentViewer: () => ({ open: openDocument }) }));
import { appApi } from "@/lib/transport";

import {
  PromptMarkdown,
  promptMessageMentionsFile,
} from "./prompt-markdown";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function Location() {
  const location = useLocation();
  return createElement("output", { "aria-label": "Location" }, location.pathname + location.search);
}

describe("PromptMarkdown", () => {
  it("opens a sent skill mention's Markdown document through the composer navigation", async () => {
    const path = "/Users/user/.claude/skills/frontend-design/SKILL.md";
    const checkPath = vi.spyOn(appApi.fileExplorer, "getPathInfo").mockResolvedValue({
      success: true, data: { exists: true, isFile: true, isDirectory: false },
    });
    render(createElement(MemoryRouter, null, createElement(PromptMarkdown, {
      skills: [{ name: "frontend-design", path }], providerId: "claude_code",
    }, "$frontend-design nedir bu")));

    fireEvent.click(screen.getByText("frontend-design"));
    await waitFor(() => expect(openDocument).toHaveBeenCalledExactlyOnceWith({ path, fileName: "SKILL.md", docType: "md" }));
    expect(checkPath).toHaveBeenCalledExactlyOnceWith(path);
    expect(openFile).not.toHaveBeenCalled();
  });

  it("activates a skill with the keyboard without submitting a form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    vi.spyOn(appApi.fileExplorer, "getPathInfo").mockResolvedValue({
      success: true, data: { exists: true, isFile: true, isDirectory: false },
    });
    render(createElement(MemoryRouter, null, createElement("form", { onSubmit },
      createElement(PromptMarkdown, { skills: [{ name: "design", path: "/skills/design/SKILL.md" }] }, "$design"))));

    await user.tab();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(openDocument).toHaveBeenCalledOnce());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("opens sent plugin mentions with their provider and exact plugin identity", () => {
    const pluginId = "gmail@market/place?version=1";
    render(createElement(MemoryRouter, { initialEntries: ["/code"] },
      createElement(PromptMarkdown, { skills: [{ name: "gmail", displayName: "Gmail", scope: "plugin", mentionPath: `plugin://${pluginId}` }], providerId: "codex" }, "$gmail"),
      createElement(Location)));

    fireEvent.click(screen.getByText("Gmail"));
    const target = new URL(screen.getByLabelText("Location").textContent!, "https://mains.local");
    expect(target.pathname).toBe("/plugins");
    expect(target.searchParams.get("plugin")).toBe(pluginId);
    expect(target.searchParams.get("provider")).toBe("codex");
    expect(openDocument).not.toHaveBeenCalled();
  });

  it("keeps mentions with no destination and computer app mentions inert", () => {
    render(createElement(MemoryRouter, null, createElement(PromptMarkdown, { skills: [
      { name: "missing" }, { name: "mac-app", displayName: "Raycast", scope: "computer", path: "/Applications/Raycast.app" },
    ] }, "$missing @Raycast")));
    fireEvent.click(screen.getByText("missing"));
    fireEvent.click(screen.getByText("Raycast"));
    expect(screen.queryByRole("button")).toBeNull();
    expect(openDocument).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });

  it("opens the source file of a sent code selection", () => {
    const path = "/workspace/hero.tsx";
    render(createElement(MemoryRouter, null, createElement(PromptMarkdown, null, `check @${path}#L12-18`)));
    fireEvent.click(screen.getByText("hero.tsx:12-18"));
    expect(openFile).toHaveBeenCalledExactlyOnceWith(path);
  });

  it("opens a sent file mention through the same editor navigation as the composer", () => {
    const path = "/workspace/components/bridge-hero-section.tsx";
    render(createElement(MemoryRouter, null, createElement(PromptMarkdown, {
      files: [{ fullPath: path, basename: "bridge-hero-section.tsx" }],
    }, `refactor @${path}`)));

    expect(screen.getByRole("button", { name: "bridge-hero-section.tsx" })).toBeTruthy();
    fireEvent.click(screen.getByText("bridge-hero-section.tsx"));
    expect(openFile).toHaveBeenCalledExactlyOnceWith(path);
  });

  it("opens a sent file mention with the keyboard without submitting a form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const path = "/workspace/hero.tsx";
    render(createElement(MemoryRouter, null, createElement("form", { onSubmit },
      createElement(PromptMarkdown, { files: [{ fullPath: path, basename: "hero.tsx" }] }, `refactor @${path}`))));

    await user.tab();
    await user.keyboard("{Enter}");
    expect(openFile).toHaveBeenCalledExactlyOnceWith(path);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps directory mentions inert", () => {
    const path = "/workspace/components";
    render(createElement(MemoryRouter, null, createElement(PromptMarkdown, {
      files: [{ fullPath: path, basename: "components", isDirectory: true }],
    }, `refactor @${path}`)));

    fireEvent.click(screen.getByText("components"));
    expect(screen.queryByRole("button")).toBeNull();
    expect(openFile).not.toHaveBeenCalled();
  });

  it("renders GFM tables and keeps composer context as chips", () => {
    const filePath = "/workspace/blog-page-client.tsx";
    const tick = String.fromCharCode(96);
    const source = [
      "| Priority | Recommendation |",
      "| --- | --- |",
      "| High | Use " +
        tick +
        "h1" +
        tick +
        " with $research and @" +
        filePath +
        " |",
    ].join("\n");

    const { container } = render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          PromptMarkdown,
          {
            skills: [{ name: "research", displayName: "Research" }],
            files: [{ fullPath: filePath, basename: "blog-page-client.tsx" }],
          },
          source,
        ),
      ),
    );

    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByText("Priority").tagName).toBe("TH");
    expect(screen.getByText("h1").tagName).toBe("CODE");
    expect(screen.getByTitle("Research")).not.toBeNull();
    expect(screen.getByTitle(filePath)).not.toBeNull();
  });

  it("leaves context-looking text literal inside code", () => {
    const tick = String.fromCharCode(96);
    const { container } = render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          PromptMarkdown,
          { skills: [{ name: "research", displayName: "Research" }] },
          tick + "$research" + tick,
        ),
      ),
    );

    expect(container.querySelector("code")?.textContent).toBe("$research");
    expect(screen.queryByTitle("Research")).toBeNull();
  });
});

describe("promptMessageMentionsFile", () => {
  it("distinguishes an inline file chip from a code selection", () => {
    const path = "/workspace/page.tsx";

    expect(promptMessageMentionsFile("Read @" + path, path)).toBe(true);
    expect(promptMessageMentionsFile("Read @" + path + "#L12", path)).toBe(
      false,
    );
  });
});
