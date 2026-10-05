// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readFileText: vi.fn() }));
vi.mock("@/lib/transport", () => ({ appApi: { fileExplorer: { readFileText: mocks.readFileText } } }));
import { MarkdownDocument } from "./markdown-document";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function show(content: string) {
  mocks.readFileText.mockResolvedValue({ success: true, data: { content, isBinary: false } });
  return render(<MarkdownDocument path="/skills/apple-design/SKILL.md" />);
}

describe("Markdown document metadata display", () => {
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
