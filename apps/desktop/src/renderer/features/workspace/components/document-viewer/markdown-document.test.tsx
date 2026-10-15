// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readFileText: vi.fn(), signImage: vi.fn() }));
vi.mock("@/lib/transport", () => ({ appApi: { fileExplorer: { readFileText: mocks.readFileText } } }));
vi.mock("@/features/workspace/hooks/use-open-file-in-editor", () => ({ useOpenFileInEditor: () => vi.fn() }));
vi.mock("@/hooks/use-open-link", () => ({ useOpenLink: () => vi.fn() }));
vi.mock("@/hooks/use-browser-panel", () => ({ useBrowserPanel: () => ({ openHtmlFile: vi.fn() }) }));
import { MarkdownDocument } from "./markdown-document";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signImage.mockResolvedValue({ success: true, data: "mains-localimg://img/?path=readme-logo&sig=test" });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { imageProxy: { sign: mocks.signImage } },
  });
});
afterEach(cleanup);

function show(content: string, { path = "/skills/apple-design/SKILL.md", docType = "md" }: { path?: string; docType?: "md" | "txt" } = {}) {
  mocks.readFileText.mockResolvedValue({ success: true, data: { content, isBinary: false } });
  return render(<MarkdownDocument path={path} docType={docType} />);
}

describe("Markdown document metadata display", () => {
  it("resolves UNC document images through the signed path after the load action", async () => {
    show("# Shared report\n\n![Chart](../images/chart.png)", { path: "\\\\server\\share\\docs\\report.md" });
    const load = await screen.findByRole("button", { name: /remote image from server/ });
    expect(mocks.signImage).not.toHaveBeenCalled();
    expect(screen.queryByRole("img", { name: "Chart" })).toBeNull();
    fireEvent.click(load);
    await waitFor(() => expect(mocks.signImage).toHaveBeenCalledWith("\\\\server\\share\\images\\chart.png"));
    expect(screen.queryByRole("button", { name: /remote image from/ })).toBeNull();
  });
  it("preserves literal percent escapes in relative Windows image filenames", async () => {
    show("# Percent report\n\n![Chart](./images/chart%2520.png)", { path: "C:\\Test%20 User\\report.md" });
    await waitFor(() => expect(mocks.signImage).toHaveBeenCalledWith("C:/Test%20 User/images/chart%20.png"));
  });
  it("resolves relative images from a Windows document path", async () => {
    show("# Windows report\n\n![Chart](./images/chart.png)", { path: "C:\\Test User\\report.md" });
    await waitFor(() => expect(mocks.signImage).toHaveBeenCalledWith("C:/Test User/images/chart.png"));
  });
  it("shows metadata in a definition list, followed by the document's own heading", async () => {
    show("---\nname: apple-design\ndescription: Apple's approach to fluid interfaces.\n---\n\n# Apple Design\n\nThe core idea.\n\n---\n\nMore content.");
    const metadata = await screen.findByRole("region", { name: "Metadata" });
    expect(within(metadata).getByText("name").tagName).toBe("DT");
    expect(within(metadata).getByText("apple-design").tagName).toBe("DD");
    expect(within(metadata).getByText("Apple's approach to fluid interfaces.").tagName).toBe("DD");
    expect(screen.getByRole("heading", { name: "Apple Design", level: 1 })).toBeTruthy();
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(screen.getByText("More content.")).toBeTruthy();
    expect(mocks.readFileText).toHaveBeenCalledWith({ filePath: "/skills/apple-design/SKILL.md" });
  });

  it("renders metadata as plain text, retaining malformed YAML without interpreting HTML", async () => {
    show('---\ndescription: "unclosed <img src=x onerror=alert(1)>\n---\n# Body');
    const metadata = await screen.findByRole("region", { name: "Metadata" });
    expect(metadata.querySelector("pre")?.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(metadata.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { name: "Body", level: 1 })).toBeTruthy();
  });

  it("keeps Markdown without frontmatter unchanged", async () => {
    show("# Plain document\n\nNormal paragraph.");
    await screen.findByRole("heading", { name: "Plain document", level: 1 });
    expect(screen.queryByRole("region", { name: "Metadata" })).toBeNull();
    expect(screen.getByText("Normal paragraph.")).toBeTruthy();
  });
});

describe("Markdown document HTML", () => {
  it("renders a README's centered HTML header and resolves its sized logo beside the document", async () => {
    const { container } = show('<div align="center">\n<a href="https://example.com"><img src="icon.png" width="100" height="100" alt="Mains" /></a>\n<p><h3><b>Mains</b></h3></p>\n<p>Home for agents</p>\n</div>\n\n# Install');

    await screen.findByRole("heading", { name: "Mains", level: 3 });
    await waitFor(() => {
      expect(mocks.signImage).toHaveBeenCalledWith("/skills/apple-design/icon.png");
      const logo = screen.getByRole("img", { name: "Mains" });
      expect(logo.getAttribute("src")).toBe("/__localimg?path=readme-logo&sig=test");
      expect(logo.getAttribute("width")).toBe("100");
      expect(logo.getAttribute("height")).toBe("100");
    });
    expect(container.querySelector('div[align="center"]')?.textContent).toContain("Home for agents");
    expect(screen.getByRole("heading", { name: "Install", level: 1 })).toBeTruthy();
    expect(container.textContent).not.toContain('<div align="center">');
  });

  it("strips executable HTML, event handlers and unsafe URLs", async () => {
    const { container } = show('<div onclick="alert(1)" style="position:fixed">Safe HTML</div>\n<script>alert("unsafe")</script>\n<iframe src="https://example.com"></iframe>\n<a href="javascript:alert(1)">Unsafe link</a>\n<img src="javascript:alert(1)" onerror="alert(1)">');

    await screen.findByText("Safe HTML");
    expect(container.querySelector("script, iframe, [onclick], [onerror], [style]")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.textContent).not.toContain('alert("unsafe")');
    expect(mocks.signImage).not.toHaveBeenCalled();
  });

  it.each(["https://example.com/badge.png", "//example.com/badge.png"])(
    "keeps HTML images behind the existing load action: %s", async (src) => {
      const { container } = show(`<picture><source srcset="https://example.com/ungated.png"><img src="${src}" width="100" alt="Remote badge"></picture>`);

      const load = await screen.findByRole("button", { name: /remote image from example.com/ });
      expect(container.querySelector("img, source")).toBeNull();
      expect(mocks.signImage).not.toHaveBeenCalled();
      fireEvent.click(load);
      expect(screen.getByRole("img", { name: "Remote badge" }).getAttribute("src"))
        .toContain(encodeURIComponent("https://example.com/badge.png"));
    },
  );

  it("keeps fenced HTML as code", async () => {
    const { container } = show('```html\n<div align="center">Example</div>\n```');
    await screen.findByText('<div align="center">Example</div>');
    expect(container.querySelector("pre code")?.textContent).toContain('<div align="center">Example</div>');
    expect(container.querySelector('div[align="center"]')).toBeNull();
  });

  it("resolves parent-relative, encoded images in folders with spaces and hashes", async () => {
    show('![Logo mark](../assets/Logo%20mark.png)', { path: "/workspace/Project #1/docs/README.md" });
    await screen.findByRole("img", { name: "Logo mark" });
    expect(mocks.signImage).toHaveBeenCalledWith("/workspace/Project #1/assets/Logo mark.png");
  });

  it("keeps HTML literal in text documents", async () => {
    const source = '<div align="center">Text example</div>';
    const { container } = show(source, { path: "/workspace/example.txt", docType: "txt" });
    await screen.findByText(source);
    expect(container.querySelector('div[align="center"]')).toBeNull();
  });

  it("keeps GFM footnote references working after HTML sanitization prefixes their IDs", async () => {
    show('Read this[^1].\n\n[^1]: Footnote.');
    const note = await screen.findByText("Footnote.");
    const target = note.closest("li")!;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    fireEvent.click(screen.getByRole("link", { name: "1" }));
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });
});
