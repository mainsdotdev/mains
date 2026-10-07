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

  it.each(["@", "/"])("detects %s at the caret while editing a pasted list item", (trigger) => {
    const inputRef = createRef<RichInputFormHandle>();
    const onQueryChange = vi.fn();
    const onCaretContextChange = vi.fn();
    render(createElement(RichInputForm, {
      ref: inputRef,
      query: "",
      onQueryChange,
      onSubmit: vi.fn(),
      onCaretContextChange,
    }));
    const editor = screen.getByRole("textbox");
    pastePlainText(editor, "- First item\n- Last item");
    editor.focus();
    const item = editor.querySelectorAll("li")[1];
    const text = item.firstChild as Text;
    text.appendData(` ${trigger}hero`);
    const range = document.createRange();
    range.setStart(text, text.length);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.input(editor);

    const before = onCaretContextChange.mock.lastCall?.[0] as string;
    act(() => {
      expect(inputRef.current?.replaceTokenWithFileChip(trigger as "@" | "/", {
        path: "/repo/hero.tsx", basename: "hero.tsx",
      })).toBe(true);
    });
    expect(item.querySelector('[data-file-chip="true"]')).not.toBeNull();
    expect(onQueryChange).toHaveBeenLastCalledWith("- First item\n- Last item @/repo/hero.tsx\n\n");
    expect(before).toBe(`First item\nLast item ${trigger}hero`);
  });

  it.each([
    ["list", "- Last item"],
    ["heading", "## Title"],
    ["quote", "> Quoted text"],
    ["bold text", "**Bold text**"],
    ["inline code", "`example`"],
    ["code block", "```\nconst value = 1;\n```"],
  ])("continues outside the pasted %s with a working mention", (_kind, markdown) => {
    const inputRef = createRef<RichInputFormHandle>();
    const onQueryChange = vi.fn();
    const onCaretContextChange = vi.fn();
    render(createElement(RichInputForm, {
      ref: inputRef, query: "", onQueryChange, onSubmit: vi.fn(), onCaretContextChange,
    }));
    const editor = screen.getByRole("textbox");
    editor.focus();
    pastePlainText(editor, markdown);
    const selection = window.getSelection()!;
    const continuation = selection.anchorNode as HTMLElement;
    expect(continuation.parentElement).toBe(editor);
    expect(continuation.tagName).toBe("DIV");
    expect(selection.anchorOffset).toBe(0);

    const text = document.createTextNode("@hero");
    const range = selection.getRangeAt(0);
    range.insertNode(text);
    range.setStart(text, text.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.input(editor);
    expect(onCaretContextChange.mock.lastCall?.[0].match(/(?:^|\s)@(\S*)$/)?.[1]).toBe("hero");
    expect(onQueryChange).toHaveBeenLastCalledWith(`${markdown}\n\n@hero`);
    act(() => {
      expect(inputRef.current?.replaceTokenWithFileChip("@", {
        path: "/repo/hero.tsx", basename: "hero.tsx",
      })).toBe(true);
    });
    expect(continuation.querySelector('[data-file-chip="true"]')).not.toBeNull();
    expect(onQueryChange).toHaveBeenLastCalledWith(`${markdown}\n\n@/repo/hero.tsx `);
  });

  it("restores a focused Markdown draft with the caret on its ordinary continuation line", () => {
    const props = { onQueryChange: vi.fn(), onSubmit: vi.fn() };
    const view = render(createElement(RichInputForm, { ...props, query: "Draft" }));
    const editor = screen.getByRole("textbox");
    editor.focus();
    view.rerender(createElement(RichInputForm, { ...props, query: "- Restored item" }));
    expect(window.getSelection()?.anchorNode?.parentElement).toBe(editor);
    expect(window.getSelection()?.anchorNode).toBe(editor.lastChild);
    expect(window.getSelection()?.anchorOffset).toBe(0);
  });

  it("does not reopen a mention copied in the preceding block on the empty continuation line", () => {
    const onCaretContextChange = vi.fn();
    render(createElement(RichInputForm, {
      query: "", onQueryChange: vi.fn(), onSubmit: vi.fn(), onCaretContextChange,
    }));
    const editor = screen.getByRole("textbox");
    editor.focus();
    pastePlainText(editor, "- Message to @someone");
    expect(onCaretContextChange.mock.lastCall?.[0].match(/(?:^|\s)([/@#$])(\S*)$/)).toBeNull();
  });

  it.each([
    ["paragraph", "Paragraph **bold** @hero", "p"],
    ["heading", "## Title /hero", "h2"],
    ["quote", "> Quote @hero", "blockquote p"],
    ["bold text", "**Bold /hero**", "strong"],
    ["italic text", "## Note\n\n*Italic @hero*", "em"],
  ])("uses visible text for suggestions inside a %s", (_kind, markdown, selector) => {
    const onCaretContextChange = vi.fn();
    render(createElement(RichInputForm, {
      query: markdown, onQueryChange: vi.fn(), onSubmit: vi.fn(), onCaretContextChange,
    }));
    const editor = screen.getByRole("textbox");
    editor.focus();
    const text = editor.querySelector(selector)!.lastChild as Text;
    const range = document.createRange();
    range.setStart(text, text.length);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    act(() => document.dispatchEvent(new Event("selectionchange")));
    expect(onCaretContextChange.mock.lastCall?.[0].match(/(?:^|\s)([/@#$])(\S*)$/)?.[2]).toBe("hero");
  });
});

describe("RichInputForm file pasting", () => {
  it("hands pasted files to the attachment handler without inserting clipboard text", () => {
    const onQueryChange = vi.fn();
    const onPasteFiles = vi.fn(() => true);
    const image = new File(["image"], "screenshot.png", { type: "image/png" });
    const pdf = new File(["document"], "notes.pdf", { type: "application/pdf" });

    render(createElement(RichInputForm, {
      query: "Draft",
      onQueryChange,
      onSubmit: vi.fn(),
      onPasteFiles,
    }));

    const editor = screen.getByRole("textbox");
    placeCaretAtEnd(editor);
    fireEvent.paste(editor, {
      clipboardData: {
        files: [image, pdf],
        getData: () => "file paths should not appear in the prompt",
      },
    });

    expect(onPasteFiles).toHaveBeenCalledWith([image, pdf]);
    expect(onQueryChange).not.toHaveBeenCalled();
    expect(editor.textContent).toBe("Draft");
  });

  it("reads file clipboard items when the files list is empty", () => {
    const image = new File(["image"], "screenshot.png", { type: "image/png" });
    const onPasteFiles = vi.fn(() => true);

    render(createElement(RichInputForm, {
      query: "",
      onQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      onPasteFiles,
    }));

    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: {
        files: [],
        items: [{ kind: "file", getAsFile: () => image }],
        getData: () => "",
      },
    });

    expect(onPasteFiles).toHaveBeenCalledWith([image]);
  });
});

describe("RichInputForm file mentions", () => {
  it("restores a file chip when its context arrives after the draft text", () => {
    const path = "/repo/components/sections/hero-section.tsx";
    const file = { path, basename: "hero-section.tsx" };
    const query = `refactor @${path} `;
    const onCaretContextChange = vi.fn();
    const props = {
      query,
      onQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      onCaretContextChange,
    };

    const view = render(createElement(RichInputForm, {
      ...props,
      fileChipMap: new Map(),
    }));
    const editor = screen.getByRole("textbox");
    expect(editor.querySelector('[data-file-chip="true"]')).toBeNull();

    view.rerender(createElement(RichInputForm, {
      ...props,
      fileChipMap: new Map([[path, file]]),
    }));

    expect(editor.querySelector('[data-file-chip="true"]')?.getAttribute("data-file-path"))
      .toBe(path);
    editor.focus();
    placeCaretAtEnd(editor);
    act(() => document.dispatchEvent(new Event("selectionchange")));
    const textBeforeCaret = onCaretContextChange.mock.lastCall?.[0] as string;
    expect(textBeforeCaret.trim()).toBe("refactor");
    expect(textBeforeCaret).not.toContain("@");
  });

  it("does not turn an existing chip into a raw path while context switches", () => {
    const path = "/repo/hero-section.tsx";
    const props = {
      query: `refactor @${path} `,
      onQueryChange: vi.fn(),
      onSubmit: vi.fn(),
    };
    const view = render(createElement(RichInputForm, {
      ...props,
      fileChipMap: new Map([[path, { path, basename: "hero-section.tsx" }]]),
    }));
    const editor = screen.getByRole("textbox");
    expect(editor.querySelector('[data-file-chip="true"]')).not.toBeNull();

    view.rerender(createElement(RichInputForm, {
      ...props,
      fileChipMap: new Map(),
    }));

    expect(editor.querySelector('[data-file-chip="true"]')).not.toBeNull();
  });

  it("keeps the caret in place when editing removes a file chip", () => {
    const path = "/repo/hero-section.tsx";
    const fileChipMap = new Map([[path, { path, basename: "hero-section.tsx" }]]);
    function Harness() {
      const [query, setQuery] = useState(`refactor @${path} later`);
      return createElement(RichInputForm, {
        query,
        onQueryChange: setQuery,
        onSubmit: vi.fn(),
        fileChipMap,
      });
    }

    render(createElement(Harness));
    const editor = screen.getByRole("textbox");
    const leadingText = editor.firstChild as Text;
    editor.focus();
    const range = document.createRange();
    range.setStart(leadingText, 3);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => {
      editor.querySelector('[data-file-chip="true"]')?.remove();
      fireEvent.input(editor);
    });

    expect(selection.anchorNode).toBe(leadingText);
    expect(selection.anchorOffset).toBe(3);
  });

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

describe("RichInputForm Mac app mentions", () => {
  it("renders and serializes a selected app as @Name without the menu capability label", () => {
    const onQueryChange = vi.fn();
    const app = {
      name: "mac-app:com.raycast.macos",
      displayName: "Raycast",
      token: "@Raycast",
    };
    render(createElement(RichInputForm, {
      query: "@Raycast",
      onQueryChange,
      onSubmit: vi.fn(),
      skillChipMap: new Map([[app.token, app]]),
    }));

    const editor = screen.getByRole("textbox");
    const chip = editor.querySelector('[data-skill-chip="true"]');
    expect(chip?.textContent).toBe("Raycast");
    expect(chip?.getAttribute("data-skill-token")).toBe("@Raycast");

    pastePlainText(editor, " open settings");
    expect(onQueryChange).toHaveBeenLastCalledWith("@Raycast open settings");
  });
});

describe("RichInputForm mention navigation", () => {
  it("activates nested file and skill labels without changing or submitting the draft", () => {
    const onFileChipClick = vi.fn();
    const onSkillChipClick = vi.fn();
    const onQueryChange = vi.fn();
    const onSubmit = vi.fn();
    const path = "/repo/hero-section.tsx";
    const query = `refactor @${path} $gmail $apple-design`;
    render(createElement(RichInputForm, {
      query, onQueryChange, onSubmit, onFileChipClick, onSkillChipClick,
      fileChipMap: new Map([[path, { path, basename: "hero-section.tsx", clickable: true }]]),
      skillChipMap: new Map([
        ["$gmail", { name: "gmail", displayName: "Gmail", clickable: true }],
        ["$apple-design", { name: "apple-design", clickable: true }],
      ]),
    }));

    fireEvent.click(screen.getByText("hero-section.tsx"));
    fireEvent.click(screen.getByText("Gmail"));
    fireEvent.keyDown(screen.getByRole("link", { name: "apple-design" }), { key: "Enter" });
    expect(onFileChipClick).toHaveBeenCalledWith(path);
    expect(onSkillChipClick.mock.calls).toEqual([["gmail"], ["apple-design"]]);
    expect(onQueryChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.input(screen.getByRole("textbox"));
    expect(onQueryChange).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("keeps directories and mentions without a destination inert", () => {
    const onFileChipClick = vi.fn();
    const onSkillChipClick = vi.fn();
    render(createElement(RichInputForm, {
      query: "@/repo/apps $missing @Raycast",
      onQueryChange: vi.fn(), onSubmit: vi.fn(), onFileChipClick, onSkillChipClick,
      fileChipMap: new Map([["/repo/apps", {
        path: "/repo/apps", basename: "apps", isDirectory: true, clickable: true,
      }]]),
      skillChipMap: new Map([
        ["$missing", { name: "missing" }],
        ["@Raycast", { name: "mac-app:raycast", displayName: "Raycast", token: "@Raycast" }],
      ]),
    }));
    fireEvent.click(screen.getByText("apps"));
    fireEvent.click(screen.getByText("missing"));
    fireEvent.click(screen.getByText("Raycast"));
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(onFileChipClick).not.toHaveBeenCalled();
    expect(onSkillChipClick).not.toHaveBeenCalled();
  });

  it("also activates a mention inserted at the caret", () => {
    const ref = createRef<RichInputFormHandle>();
    const onSkillChipClick = vi.fn();
    render(createElement(RichInputForm, {
      ref, query: "@apple", onQueryChange: vi.fn(), onSubmit: vi.fn(), onSkillChipClick,
    }));
    const editor = screen.getByRole("textbox");
    editor.focus();
    placeCaretAtEnd(editor);
    act(() => {
      ref.current!.replaceTokenWithSkillChip("@", { name: "apple-design", clickable: true });
    });
    fireEvent.keyDown(screen.getByRole("link", { name: "apple-design" }), { key: " " });
    expect(onSkillChipClick).toHaveBeenCalledWith("apple-design");
  });
});
