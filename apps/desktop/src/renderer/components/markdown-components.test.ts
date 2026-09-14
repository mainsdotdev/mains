// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import { AgentMarkdown } from "./agent-markdown";
import { isRemoteImageSrc } from "./markdown-components";

vi.mock("@/features/workspace/hooks/use-open-file-in-editor", () => ({
  useOpenFileInEditor: () => vi.fn(),
}));

afterEach(cleanup);

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

describe("markdownComponents / code", () => {
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
