// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  PromptMarkdown,
  promptMessageMentionsFile,
} from "./prompt-markdown";

afterEach(cleanup);

describe("PromptMarkdown", () => {
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
        PromptMarkdown,
        {
          skills: [{ name: "research", displayName: "Research" }],
          files: [{ fullPath: filePath, basename: "blog-page-client.tsx" }],
        },
        source,
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
        PromptMarkdown,
        { skills: [{ name: "research", displayName: "Research" }] },
        tick + "$research" + tick,
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
