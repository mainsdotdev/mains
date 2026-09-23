// @vitest-environment jsdom

import { createElement, createRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RichInputForm, type RichInputFormHandle } from "./rich-input-form";

afterEach(cleanup);

function placeCaretAtEnd(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  if (!selection) throw new Error("Selection API is unavailable");
  selection.removeAllRanges();
  selection.addRange(range);
}

function pastePlainText(element: HTMLElement, text: string) {
  placeCaretAtEnd(element);
  fireEvent.paste(element, {
    clipboardData: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
}

function hasDirectFormattingNewline(element: ParentNode): boolean {
  return Array.from(element.childNodes).some(
    (node) =>
      node.nodeType === Node.TEXT_NODE &&
      /^\s+$/.test(node.textContent ?? "") &&
      /[\r\n]/.test(node.textContent ?? ""),
  );
}

describe("RichInputForm Markdown editing", () => {
  it("renders a contextual icon as part of the empty placeholder", () => {
    render(
      createElement(RichInputForm, {
        query: "",
        onQueryChange: vi.fn(),
        onSubmit: vi.fn(),
        placeholder: "Ask in Work",
        placeholderIcon: createElement("span", {
          "data-testid": "project-placeholder-icon",
        }),
      }),
    );

    expect(screen.getByText("Ask in Work")).toBeTruthy();
    expect(screen.getByTestId("project-placeholder-icon")).toBeTruthy();
  });

  it("renders pasted Markdown in the editable surface and serializes it for sending", () => {
    const onQueryChange = vi.fn();
    const tick = String.fromCharCode(96);
    const markdown = [
      "| Priority | Evidence |",
      "| --- | --- |",
      "| High | Use " + tick + "h1" + tick + " |",
    ].join("\n");

    render(
      createElement(RichInputForm, {
        query: "",
        onQueryChange,
        onSubmit: vi.fn(),
      }),
    );

    const editor = screen.getByRole("textbox");
    pastePlainText(editor, markdown);

    expect(editor.querySelector("table")).not.toBeNull();
    expect(screen.getByText("Priority").tagName).toBe("TH");
    expect(screen.getByText("h1").tagName).toBe("CODE");
    expect(onQueryChange).toHaveBeenLastCalledWith(markdown + "\n\n");

    const priority = screen.getByText("High");
    priority.textContent = "Medium";
    fireEvent.input(editor);
    expect(onQueryChange).toHaveBeenLastCalledWith(
      markdown.replace("High", "Medium") + "\n\n",
    );
  });

  it("renders an externally supplied Markdown query without a preview mode", () => {
    const markdown = [
      "## Review",
      "",
      "- First item",
      "",
      "- Second item",
      "",
      "Following paragraph",
    ].join("\n");

    render(
      createElement(RichInputForm, {
        query: markdown,
        onQueryChange: vi.fn(),
        onSubmit: vi.fn(),
      }),
    );

    const editor = screen.getByRole("textbox");
    expect(screen.getByRole("heading", { name: "Review" }).tagName).toBe("H2");
    expect(editor.querySelectorAll("li")).toHaveLength(2);
    expect(hasDirectFormattingNewline(editor)).toBe(false);
    expect(hasDirectFormattingNewline(editor.querySelector("ul")!)).toBe(false);
    for (const item of editor.querySelectorAll("li")) {
      expect(hasDirectFormattingNewline(item)).toBe(false);
    }
  });

  it("keeps pasted Markdown images inert inside the composer", () => {
    const onQueryChange = vi.fn();
    const markdown = "![Private diagram](https://example.com/private.png)";

    render(
      createElement(RichInputForm, {
        query: "",
        onQueryChange,
        onSubmit: vi.fn(),
      }),
    );

    const editor = screen.getByRole("textbox");
    pastePlainText(editor, markdown);

    expect(editor.querySelector("img")).toBeNull();
    expect(
      editor.querySelector('[data-markdown-image-src="https://example.com/private.png"]'),
    ).not.toBeNull();
    expect(onQueryChange).toHaveBeenLastCalledWith(markdown + "\n\n");
  });
});

describe("RichInputForm file mentions", () => {
  it.each([
    { path: "/repo/apps", basename: "apps", isDirectory: true },
    { path: "/repo/app.tsx", basename: "app.tsx", isDirectory: false },
  ])("does not offer suggestions when the caret is immediately after $basename", (file) => {
    const inputRef = createRef<RichInputFormHandle>();
    const onCaretContextChange = vi.fn();
    function Harness() {
      const [query, setQuery] = useState("@apps");
      return createElement(RichInputForm, {
        ref: inputRef,
        query,
        onQueryChange: setQuery,
        onSubmit: vi.fn(),
        onCaretContextChange,
        fileChipMap: new Map([[file.path, file]]),
      });
    }
    render(createElement(Harness));
    const editor = screen.getByRole("textbox");
    editor.focus();
    const textNode = editor.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => {
      expect(inputRef.current?.replaceTokenWithFileChip("@", file)).toBe(true);
    });
    const chip = editor.querySelector('[data-file-chip="true"]');
    expect(chip).not.toBeNull();
    const afterChip = document.createRange();
    afterChip.setStartAfter(chip!);
    afterChip.collapse(true);
    selection.removeAllRanges();
    selection.addRange(afterChip);
    act(() => document.dispatchEvent(new Event("selectionchange")));
    expect(onCaretContextChange).toHaveBeenLastCalledWith(" ");
  });
});
