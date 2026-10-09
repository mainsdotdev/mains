// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { AgentMarkdown } from "./agent-markdown";
import {
  faviconUrlForHref,
  isRemoteImageSrc,
  MarkdownLink,
} from "./markdown-components";

const linkHarness = vi.hoisted(() => ({
  openLink: vi.fn(),
  openFile: vi.fn(),
  openHtmlFile: vi.fn(),
  signImage: vi.fn(),
}));

vi.mock("@/features/workspace/hooks/use-open-file-in-editor", () => ({
  useOpenFileInEditor: () => linkHarness.openFile,
}));
vi.mock("@/hooks/use-open-link", () => ({
  useOpenLink: () => linkHarness.openLink,
}));
vi.mock("@/hooks/use-browser-panel", () => ({
  useBrowserPanel: () => ({ openHtmlFile: linkHarness.openHtmlFile }),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { imageProxy: { sign: linkHarness.signImage } },
  });
});

function renderMarkdown(source: string, isStreaming = false) {
  return render(<AgentMarkdown isStreaming={isStreaming}>{source}</AgentMarkdown>);
}

// Only network URLs can act as exfiltration beacons — everything else
// (app schemes, data URIs, workspace paths) must keep loading directly.
describe("isRemoteImageSrc", () => {
  it.each([
    ["https://evil.example/x.png?d=secret", true],
    ["http://evil.example/x.png", true],
    ["mains-capture://shot-1.png", false],
    ["mains-img://proxy?url=…", false],
    ["data:image/png;base64,AAAA", false],
    ["/Users/me/project/diagram.png", false],
    ["./relative.png", false],
    ["", false],
    [undefined, false],
  ] as const)("%s → %s", (src, expected) => {
    expect(isRemoteImageSrc(src)).toBe(expected);
  });
});

describe("markdownComponents / images", () => {
  it("loads an encoded local image path through the signed image protocol", async () => {
    const signed = "mains-localimg://img/?path=preview&sig=test";
    linkHarness.signImage.mockResolvedValue({ success: true, data: signed });
    renderMarkdown(
      "![OkanBilal CV preview](/Users/example/Library/Application%20Support/mains/runs/run-1/work/okanbilal-cv-preview.png)",
    );

    await waitFor(() => {
      expect(linkHarness.signImage).toHaveBeenCalledWith(
        "/Users/example/Library/Application Support/mains/runs/run-1/work/okanbilal-cv-preview.png",
      );
      expect(screen.getByRole("img", { name: "OkanBilal CV preview" }).getAttribute("src"))
        .toBe("/__localimg?path=preview&sig=test");
    });
  });

  it("keeps remote images behind the load action", () => {
    renderMarkdown("![Remote preview](https://example.com/image.png?token=secret)");

    expect(screen.queryByRole("img", { name: "Remote preview" })).toBeNull();
    expect(linkHarness.signImage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /remote image from example.com/ }));
    expect(screen.getByRole("img", { name: "Remote preview" }).getAttribute("src"))
      .toContain(encodeURIComponent("https://example.com/image.png?token=secret"));
  });
});

describe("markdownComponents / code", () => {
  it("shows a color swatch beside an exact HEX code in an assistant table", () => {
    const { container } = renderMarkdown(
      "| Palet | Renkler |\n|---|---|\n| Sakura | `#FEF4F4` → `#F5B1AA` → `#E9546B` |",
    );

    const code = screen.getByText("#FEF4F4");
    expect(code.tagName).toBe("CODE");
    const swatch = container.querySelector('[aria-label="#FEF4F4 color swatch"]');
    expect(swatch).not.toBeNull();
    expect((swatch as HTMLElement).style.backgroundColor).toBe("rgb(254, 244, 244)");
    expect(container.querySelectorAll('[aria-label$="color swatch"]')).toHaveLength(3);
  });

  it("does not decorate non-colors or HEX values inside fenced code", () => {
    const { container } = renderMarkdown(
      "`#FEF4F4-extra` and `#abc`\n\n```css\ncolor: #FEF4F4;\n```",
    );
    expect(container.querySelector('[aria-label$="color swatch"]')).toBeNull();
  });

  it("keeps assistant tables light, with row separators instead of a full grid", () => {
    const { container } = renderMarkdown("| Palet | Renk |\n|---|---|\n| Sakura | `#FEF4F4` |");
    expect(container.querySelector("table")?.parentElement?.className).not.toContain("border border-");
    expect(container.querySelector("th")?.className).not.toContain("border-r");
    expect(container.querySelector("tbody tr")?.className).toContain("border-b");
  });

  it("renders a fence with no language as a block, not a row of inline pills", () => {
    // react-markdown only sets `language-*` when the fence names one, so a bare
    // ``` block and an inline span carry identical props. Reading the parent
    // instead is what keeps an ASCII diagram from rendering as inline code.
    const { container } = renderMarkdown("```\nKaos\n└── Gaia\n```");

    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    const code = pre?.querySelector("code");
    expect(code?.className).not.toContain("rounded");
    expect(code?.textContent).toContain("└── Gaia");
  });

  it("keeps the horizontal scroll on the box, not on the code", () => {
    // A line wider than the column has to slide inside the surface; when the
    // inner element scrolled, the long line ran out past the rounded corner.
    const { container } = renderMarkdown("```\n" + "x".repeat(400) + "\n```");

    const pre = container.querySelector("pre");
    expect(pre?.className).toContain("overflow-x-auto");
    expect(pre?.querySelector("code")?.className).not.toContain("overflow-x");
  });

  it("still renders a fence with a language as a block", () => {
    const { container } = renderMarkdown("```ts\nconst a = 1;\n```");

    expect(container.querySelector("pre code")?.textContent).toContain(
      "const a = 1;",
    );
  });

  it("keeps inline code as a pill", () => {
    renderMarkdown("A sentence with `inline` code.");

    const code = screen.getByText("inline");
    expect(code.tagName).toBe("CODE");
    expect(code.closest("pre")).toBeNull();
    expect(code.className).toContain("rounded");
  });
});

describe("assistant markdown / math", () => {
  it.each([
    ["bracket", String.raw`\[`, String.raw`\]`],
    ["dollar", "$$\n", "\n$$"],
  ])("waits for the closing %s delimiter at every streamed character", (_format, open, close) => {
    const prose = String.raw`Energy decreases; velocity is \(u\).` + "\n\n";
    const equation = open + String.raw`\frac{d}{dt}\left(\frac12\int |u|^2\right)=-\nu\int |\nabla u|^2` + close;
    const view = renderMarkdown(prose, true);

    for (let end = open.length; end < equation.length; end++) {
      view.rerender(<AgentMarkdown isStreaming>{prose + equation.slice(0, end)}</AgentMarkdown>);

      expect(view.container.textContent).toContain("Energy decreases; velocity is");
      expect(view.container.querySelectorAll(".katex")).toHaveLength(1);
      expect(view.container.querySelector(".katex-error")).toBeNull();
    }

    view.rerender(<AgentMarkdown isStreaming>{prose + equation}</AgentMarkdown>);
    expect(view.container.querySelector(".katex-display")).not.toBeNull();
    expect(view.container.querySelector(".katex-error")).toBeNull();

    view.rerender(<AgentMarkdown>{prose + equation}</AgentMarkdown>);
    expect(view.container.querySelector(".katex-display")).not.toBeNull();
  });

  it("keeps completed equations visible while the next equation streams", () => {
    const { container } = renderMarkdown("$$\nx^2\n$$\n\nNext equation:\n\n$$\nx^3", true);

    expect(container.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(container.textContent).toContain("Next equation:");
  });

  it.each([
    ["> $$\n> \\frac{1}{", "\n> 2}\n> $$"],
    ["- $$\n  \\frac{1}{", "\n  2}\n  $$"],
    ["$$$\n\\frac{1}{2}\n$$", "$"],
    ["$$\nx^2\n    $$", "\n$$"],
  ])("uses the actual closing math fence inside Markdown containers: %s", (partial, remainder) => {
    const view = renderMarkdown(partial, true);
    expect(view.container.querySelector(".katex")).toBeNull();
    expect(view.container.querySelector(".katex-error")).toBeNull();

    view.rerender(<AgentMarkdown isStreaming>{partial + remainder}</AgentMarkdown>);
    // Some pending bodies contain literal dollars; a real fence still ends
    // the wait and lets KaTeX report any error in the completed expression.
    expect(view.container.querySelector(".katex, .katex-error")).not.toBeNull();
  });

  it("preserves the usual rendering after a stream ends without a closing fence", () => {
    const view = renderMarkdown("$$\nx^2", true);
    expect(view.container.querySelector(".katex")).toBeNull();

    view.rerender(<AgentMarkdown>{"$$\nx^2"}</AgentMarkdown>);
    expect(view.container.querySelector(".katex-display")).not.toBeNull();
  });

  it("typesets bracket-delimited display LaTeX instead of exposing its source", () => {
    const { container } = renderMarkdown(
      String.raw`\[\rho\left(\frac{\partial \mathbf{u}}{\partial t}\right)=-\nabla p\]`,
    );

    const displayMath = container.querySelector(".katex-display");
    expect(displayMath).not.toBeNull();
    expect(container.querySelector(".katex-html")?.textContent).toContain("ρ");
    expect(displayMath?.parentElement?.classList.contains("text-primary-900")).toBe(true);
    expect(displayMath?.parentElement?.classList.contains("dark:text-primary-100")).toBe(true);
  });

  it("typesets parenthesis-delimited inline LaTeX inside prose", () => {
    const { container } = renderMarkdown(
      String.raw`Velocity \(\mathbf{u}\) and density \(\rho\).`,
    );

    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelector(".katex-display")).toBeNull();
  });

  it("leaves LaTeX delimiters literal inside code", () => {
    const { container } = renderMarkdown(
      [
        "Inline `" + String.raw`\(x\)` + "` and fenced:",
        "",
        "```",
        String.raw`\[y\]`,
        "```",
      ].join("\n"),
    );

    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("pre code")?.textContent).toContain("\\[y\\]");
  });
});

describe("assistant markdown / streaming links", () => {
  it.each([
    "[Terence Tao’s explanation](https://terrytao.wordpress.com/notes)",
    "[Hou [and] Yu’s **lecture notes**](https://example.com/notes)",
    "[Notes with `array[i]`](https://example.com/notes)",
    "[Notes with `array[i]extra`](https://example.com/notes)",
    "[Notes](https://example.com/notes_(draft))",
    String.raw`[Notes](https://example.com/notes\(draft\))`,
    '[Notes](https://example.com/notes "A title with (parentheses)")',
    "[Notes](https://example.com/Tao's_notes)",
  ])("withholds the whole link at every character boundary: %s", (link) => {
    const prose = "A **complete** sentence &amp; `literal`. ";
    const view = renderMarkdown(prose, true);
    const firstWord = view.container.querySelector(".stream-word");

    for (let end = 1; end < link.length; end++) {
      view.rerender(<AgentMarkdown isStreaming>{prose + link.slice(0, end)}</AgentMarkdown>);
      expect(view.container.textContent?.trimEnd()).toBe("A complete sentence & literal.");
      expect(view.container.querySelector("a, img")).toBeNull();
      expect(view.container.querySelector(".stream-word")).toBe(firstWord);
    }

    view.rerender(<AgentMarkdown isStreaming>{prose + link}</AgentMarkdown>);
    expect(view.container.querySelector("a")).not.toBeNull();
    expect(view.container.textContent).not.toContain("](https:");
  });

  it("waits for the whole angle-delimited file path and keeps its open action", () => {
    const prose = "Open ";
    const link = '[Document](</Users/example/My notes (draft).md> "The (draft)")';
    const view = renderMarkdown(prose, true);
    for (let end = 1; end < link.length; end++) {
      view.rerender(<AgentMarkdown isStreaming>{prose + link.slice(0, end)}</AgentMarkdown>);
      expect(view.container.textContent?.trimEnd()).toBe("Open");
      expect(screen.queryByRole("button")).toBeNull();
    }
    view.rerender(<AgentMarkdown isStreaming>{prose + link}</AgentMarkdown>);
    fireEvent.click(screen.getByText("Document").closest("button")!);
    expect(linkHarness.openFile).toHaveBeenCalledWith("/Users/example/My notes (draft).md");
  });

  it.each([
    ["> Quote &amp; [Notes](https://example.com/notes", "Quote &"],
    ["- List [Notes](https://example.com/notes", "List"],
    ["# Heading [Notes](https://example.com/notes", "Heading"],
    ["| Item |\n| --- |\n| Table [Notes](https://example.com/notes", "ItemTable"],
    ["> Quote [Notes\n> continued](https://example.com/notes", "Quote"],
  ])("buffers links inside Markdown containers: %s", (partial, visible) => {
    const view = renderMarkdown(partial, true);
    expect(view.container.textContent?.replace(/\s+/g, " ").trim()).toBe(visible);
    expect(view.container.querySelector("a")).toBeNull();

    view.rerender(<AgentMarkdown isStreaming>{partial + ")"}</AgentMarkdown>);
    expect(view.container.querySelector("a")).not.toBeNull();
  });

  it("keeps completed links and equations visible while the next link streams", () => {
    const prefix = "[First](https://example.com/first)\n\n$$\nx^2\n$$\n\nNext ";
    const view = renderMarkdown(prefix + "[Second](https://example.com/sec", true);
    expect(screen.getByRole("link", { name: "First" })).not.toBeNull();
    expect(view.container.querySelectorAll("a")).toHaveLength(1);
    expect(view.container.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(view.container.textContent).toContain("Next");
    expect(view.container.textContent).not.toContain("Second");

    view.rerender(<AgentMarkdown isStreaming>{prefix + "[Second](https://example.com/second) done."}</AgentMarkdown>);
    expect(view.container.querySelectorAll("a")).toHaveLength(2);
    expect(view.container.textContent).toContain("done.");
  });

  it("leaves code, literal brackets and earlier unfinished prose alone", () => {
    const source = "Literal [note] remains and &#91;entity bracket. `code [x](url`\n\n```md\n[Example](unfinished\n```\n\nEarlier [unfinished\n\nCurrent prose.";
    const view = renderMarkdown(source, true);
    expect(view.container.textContent).toContain("Literal [note] remains and [entity bracket.");
    expect(view.container.querySelector("code")?.textContent).toBe("code [x](url");
    expect(view.container.querySelector("pre code")?.textContent).toContain("[Example](unfinished");
    expect(view.container.textContent).toContain("Earlier [unfinished");
    expect(view.container.textContent).toContain("Current prose.");
  });

  it("preserves the usual Markdown rendering when a stream ends mid-link", () => {
    const source = "Text [unfinished](https://example.com/notes";
    const view = renderMarkdown(source, true);
    expect(view.container.textContent?.trimEnd()).toBe("Text");

    view.rerender(<AgentMarkdown>{source}</AgentMarkdown>);
    expect(view.container.textContent).toBe(source);
  });
});

describe("assistant markdown / streaming fade", () => {
  it("retains previous word spans while new words arrive and removes them when settled", () => {
    const view = renderMarkdown("Hello wo", true);
    const words = [...view.container.querySelectorAll(".stream-word")];
    expect(words.map((word) => word.textContent)).toEqual(["Hello ", "wo"]);

    view.rerender(<AgentMarkdown isStreaming>{"Hello world again"}</AgentMarkdown>);
    const updatedWords = [...view.container.querySelectorAll(".stream-word")];
    expect(updatedWords[0]).toBe(words[0]);
    expect(updatedWords[1]).toBe(words[1]);
    expect(updatedWords[1].textContent).toBe("world ");
    expect(updatedWords[2].textContent).toBe("again");

    view.rerender(<AgentMarkdown>{"Hello world again"}</AgentMarkdown>);
    expect(view.container.querySelector(".stream-word")).toBeNull();
    expect(view.container.textContent).toBe("Hello world again");
  });

  it("preserves Markdown styling and leaves code and typeset math outside the word fade", () => {
    const view = renderMarkdown(String.raw`Hello **bold text**, \(x^2\), and ` + "`literal code`.", true);
    expect(view.container.querySelector("strong")?.textContent).toBe("bold text");
    expect(view.container.querySelector("strong .stream-word")).not.toBeNull();
    expect(view.container.querySelector("code")?.textContent).toBe("literal code");
    expect(view.container.querySelector("code .stream-word")).toBeNull();
    expect(view.container.querySelector(".katex")).not.toBeNull();
    expect(view.container.querySelector(".katex .stream-word")).toBeNull();
  });

  it("fades table content without wrapping structural whitespace in spans", () => {
    const { container } = renderMarkdown("| Item |\n| --- |\n| Table content |", true);
    expect(container.querySelector("table > span, thead > span, tbody > span, tr > span")).toBeNull();
    expect(container.querySelector("td .stream-word")?.textContent).toBe("Table ");
  });
});

describe("markdownComponents / links", () => {
  it.each([
    "/atlas/page-1",
    "#/atlas/page-1",
    "http://localhost:5173/#/atlas/page-1",
  ])("opens Page reference %s through internal navigation", (href) => {
    renderMarkdown(`[Created Page](${href})`);
    const link = screen.getByRole("link", { name: "Created Page" });

    fireEvent.click(link);

    expect(linkHarness.openLink).toHaveBeenCalledWith(href);
    expect(linkHarness.openFile).not.toHaveBeenCalled();
    expect(linkHarness.openHtmlFile).not.toHaveBeenCalled();
    expect(link.querySelector("img")).toBeNull();
  });

  it("also opens Page references in document markdown", () => {
    render(<MarkdownLink href="/atlas/page-1">Related Page</MarkdownLink>);
    fireEvent.click(screen.getByRole("link", { name: "Related Page" }));
    expect(linkHarness.openLink).toHaveBeenCalledWith("/atlas/page-1");
    expect(linkHarness.openFile).not.toHaveBeenCalled();
  });

  it("opens generated HTML in the browser panel instead of the editor", () => {
    linkHarness.openHtmlFile.mockResolvedValue(undefined);
    renderMarkdown(
      "[dosyayı aç](</Users/example/Application Support/mains/runs/run-1/work/palet.html>)",
    );

    fireEvent.click(screen.getByText("dosyayı aç").closest("button")!);

    expect(linkHarness.openHtmlFile).toHaveBeenCalledWith(
      "/Users/example/Application Support/mains/runs/run-1/work/palet.html",
    );
    expect(linkHarness.openFile).not.toHaveBeenCalled();
  });

  it("decodes spaces in a Collection source file link before opening it", () => {
    renderMarkdown(
      "[Blueprint.pdf](/Users/example/Application%20Support/mains/runs/run-1/work/collection-sources/source-1/content.pdf)",
    );

    fireEvent.click(screen.getByText("Blueprint.pdf").closest("button")!);

    expect(linkHarness.openFile).toHaveBeenCalledWith(
      "/Users/example/Application Support/mains/runs/run-1/work/collection-sources/source-1/content.pdf",
    );
  });

  it("decodes reserved characters in a cited file path before opening it", () => {
    renderMarkdown(
      "[Recipe #1 (draft).pdf](/Users/example/Application%20Support/Recipe%20%231%20%28draft%29.pdf)",
    );

    fireEvent.click(screen.getByText("Recipe #1 (draft).pdf").closest("button")!);

    expect(linkHarness.openFile).toHaveBeenCalledWith(
      "/Users/example/Application Support/Recipe #1 (draft).pdf",
    );
  });

  it("derives favicon requests from the origin only", () => {
    expect(
      faviconUrlForHref(
        "https://user:secret@news.ycombinator.com/item?id=49717558#top",
      ),
    ).toBe("https://news.ycombinator.com/favicon.ico");
    expect(faviconUrlForHref("mailto:hello@example.com")).toBeNull();
    expect(faviconUrlForHref("#footnote-1")).toBeNull();
    expect(faviconUrlForHref("not a url")).toBeNull();
  });

  it("uses Figma's declared icon for Figma links without matching lookalike hosts", () => {
    expect(faviconUrlForHref("https://www.figma.com/design/file?node-id=1:2"))
      .toBe("https://static.figma.com/app/icon/2/favicon.png");
    expect(faviconUrlForHref("https://figma.com/file/abc"))
      .toBe("https://static.figma.com/app/icon/2/favicon.png");
    expect(faviconUrlForHref("https://www.figma.com.evil.example/design/file"))
      .toBe("https://www.figma.com.evil.example/favicon.ico");
  });

  it("keeps a long external URL inline with the surrounding prompt text", () => {
    const url =
      "https://www.nair.sh/guides-and-opinions/communicating-your-expertise/why-senior-developers-fail-to-communicate-their-expertise";
    renderMarkdown(`[${url}](${url}) Could you give me a summary?`);

    const link = screen.getByRole("link", { name: url });
    expect(link.tagName).toBe("A");
    expect(link.className).toContain("wrap-break-word");
    expect(link.parentElement?.tagName).toBe("P");
    expect(link.parentElement?.textContent).toBe(
      `${url} Could you give me a summary?`,
    );
    expect(link.querySelector("img")?.getAttribute("src")).toContain(
      encodeURIComponent("https://www.nair.sh/favicon.ico"),
    );
  });

  it("opens assistant web links through the in-app browser flow", () => {
    const url = "https://news.ycombinator.com/item?id=49717558";
    renderMarkdown(`[Top comment thread](${url})`);

    fireEvent.click(screen.getByRole("link", { name: "Top comment thread" }));

    expect(linkHarness.openLink).toHaveBeenCalledWith(url);
  });
});

describe("markdownComponents / task lists", () => {
  it("draws GFM checkboxes without leaving the bullet behind", () => {
    const { container } = renderMarkdown("- [x] done\n- [ ] todo");

    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.className).toContain("list-none");
    }
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });
});
