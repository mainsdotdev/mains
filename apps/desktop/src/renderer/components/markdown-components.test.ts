// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { AgentMarkdown } from "./agent-markdown";
import {
  faviconUrlForHref,
  isRemoteImageSrc,
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

function renderMarkdown(source: string) {
  return render(createElement(AgentMarkdown, null, source));
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

describe("markdownComponents / links", () => {
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
