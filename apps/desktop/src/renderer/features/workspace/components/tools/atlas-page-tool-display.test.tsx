// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { mapToolCallToEvent } from "../../lib/run-event-mappers";
import { ToolCallItem } from "./tool-call-item";

vi.mock("../../hooks", () => ({ usePluginLogoMap: () => new Map(), renderPluginIcon: () => null, normalizeSlug: (name: string) => name }));
afterEach(cleanup);

const page = {
  item: { id: "page-1", title: "Project brief", version: 4 },
  revision: { markdown: "# Updated brief\n\nSaved content", blocks: [] },
};

it.each([
  ["AtlasReadPage", "inputText", "Read Atlas page", "Page read"],
  ["mcp__mains__AtlasReadPage", "text", "Read Atlas page", "Page read"],
  ["AtlasUpdatePage", "inputText", "Updated Atlas page", "Page saved"],
  ["mcp__mains__AtlasUpdatePage", "text", "Updated Atlas page", "Page saved"],
  ["AtlasCreatePage", "inputText", "Created Atlas page", "Page created"],
  ["mcp__mains__AtlasCreatePage", "text", "Created Atlas page", "Page created"],
])("renders domain fields and page content for %s", (toolName, type, label, outcome) => {
  const read = toolName.endsWith("ReadPage");
  const create = toolName.endsWith("CreatePage");
  const input = read ? { pageId: "page-1" } : create
    ? { title: "New project", markdown: "Submitted content" }
    : { pageId: "page-1", expectedVersion: 3, markdown: "Submitted content" };
  const event = mapToolCallToEvent({ id: 1, runId: "run-1", toolName, status: "done",
    input: JSON.stringify(input), output: JSON.stringify([{ type, text: JSON.stringify(page) }]) })!;
  const { container } = render(<ToolCallItem event={event} isCompact={false} />);

  expect(screen.getByText("Project brief")).toBeTruthy();
  expect(screen.getByText(!read && !create ? "v3 → v4" : "v4")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Output" })).toBeNull();
  fireEvent.click(screen.getByText(label));
  const request = within(screen.getByRole("region", { name: "Input" }));
  const result = within(screen.getByRole("region", { name: "Output" }));
  expect(request.getByText(create ? "Title" : "Page ID")).toBeTruthy();
  if (!read) expect(request.getByText("Submitted content")).toBeTruthy();
  if (!read && !create) {
    expect(request.getByText("Expected version")).toBeTruthy();
    expect(request.getByText("v3")).toBeTruthy();
  }
  expect(result.getByText(outcome)).toBeTruthy();
  expect(result.getByRole("heading", { name: "Updated brief" })).toBeTruthy();
  expect(result.getByText("Saved content")).toBeTruthy();
  expect(container.querySelector("pre")).toBeNull();
  expect(container.textContent).not.toContain("inputText");
  expect(container.textContent).not.toContain("expectedVersion");
});

it.each([
  ["direct Page result", page],
  ["JSON Page result", JSON.stringify(page)],
  ["MCP envelope", { content: [{ type: "text", text: JSON.stringify(page) }] }],
  ["dynamic result envelope", { contentItems: [{ type: "inputText", text: JSON.stringify(page) }] }],
  ["structured result", { content: [{ type: "text", text: "Completed" }], structuredContent: page }],
])("recognizes the Page in a %s", (_shape, output) => {
  const event = mapToolCallToEvent({ id: 4, toolName: "AtlasReadPage", status: "done", input: { pageId: "page-1" }, output })!;
  render(<ToolCallItem event={event} isCompact={false} />);
  expect(screen.getByText("Project brief")).toBeTruthy();
  fireEvent.click(screen.getByText("Read Atlas page"));
  expect(screen.getByText("Page read")).toBeTruthy();
  expect(screen.getByText("Saved content")).toBeTruthy();
});

it("shows input during an active update and keeps compact headers readable", () => {
  const event = mapToolCallToEvent({ id: 2, toolName: "AtlasUpdatePage", status: "running", input: { pageId: "page-1", expectedVersion: 3 } })!;
  const { container } = render(<ToolCallItem event={event} isCompact />);
  expect(container.textContent).toContain("Updating Atlas page");
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("Expected version")).toBeTruthy();
  expect(screen.getByText("page-1")).toBeTruthy();
  expect(screen.queryByText("Output")).toBeNull();
  expect(screen.queryByText("Page saved")).toBeNull();
});

it("shows a rejected update without claiming it was saved", () => {
  const event = mapToolCallToEvent({ id: 3, toolName: "mcp__mains__AtlasUpdatePage", status: "error",
    input: { pageId: "page-1", expectedVersion: 2 }, output: [{ type: "text", text: "Page changed elsewhere" }] })!;
  render(<ToolCallItem event={event} isCompact={false} />);
  fireEvent.click(screen.getByText("Page update failed"));
  expect(screen.getByText("Error")).toBeTruthy();
  expect(screen.getByText("Page changed elsewhere")).toBeTruthy();
  expect(screen.getByText("Expected version")).toBeTruthy();
  expect(screen.queryByText("Page saved")).toBeNull();
  expect(screen.queryByText("Updated Atlas page")).toBeNull();
});

it("recognizes an MCP error envelope even when persisted status says done", () => {
  const event = mapToolCallToEvent({ id: 3, toolName: "mcp__mains__AtlasCreatePage", status: "done",
    input: { title: "New project" }, output: { isError: true, content: [{ type: "text", text: "Page creation rejected" }] } })!;
  render(<ToolCallItem event={event} isCompact />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("Error")).toBeTruthy();
  expect(screen.getByText("Page creation rejected")).toBeTruthy();
  expect(screen.queryByText("Page created")).toBeNull();
});

it("renders BlockNote input as readable nested content instead of encoded JSON", () => {
  const blocks = [
    { type: "heading", content: [{ type: "text", text: "Release plan" }] },
    { type: "checkListItem", props: { checked: true }, content: [{ type: "text", text: "Ship feature" }], children: [
      { type: "paragraph", content: [{ type: "link", content: [{ type: "text", text: "Follow up" }] }] },
    ] },
    { type: "table", content: { rows: [{ cells: [[{ type: "text", text: "Owner" }], [{ type: "text", text: "Okan" }]] }] } },
    { type: "file", props: { name: "Launch.pdf", url: "atlas-file://file-1" } },
  ];
  const event = mapToolCallToEvent({ id: 5, toolName: "AtlasUpdatePage", status: "running",
    input: { pageId: "page-1", expectedVersion: 3, blocksJson: JSON.stringify(blocks) } })!;
  const { container } = render(<ToolCallItem event={event} isCompact />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("Release plan")).toBeTruthy();
  expect(screen.getByText("Ship feature")).toBeTruthy();
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText("Follow up")).toBeTruthy();
  expect(screen.getByText("Owner · Okan")).toBeTruthy();
  expect(screen.getByText("Launch.pdf")).toBeTruthy();
  expect(container.textContent).not.toContain("blocksJson");
  expect(container.textContent).not.toContain('"type"');
});

it("keeps a title-only rename distinct from replacing the page with empty content", () => {
  const event = mapToolCallToEvent({ id: 6, toolName: "AtlasUpdatePage", status: "running",
    input: { pageId: "page-1", expectedVersion: 3, title: "Renamed page" } })!;
  render(<ToolCallItem event={event} isCompact />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("New title")).toBeTruthy();
  expect(screen.queryByText("Empty page")).toBeNull();
  expect(screen.queryByText("Content")).toBeNull();
});

it("bounds long page content until explicitly expanded", () => {
  const output = { ...page, revision: { markdown: `${"Long paragraph. ".repeat(500)}\n\nLast paragraph`, blocks: [] } };
  const event = mapToolCallToEvent({ id: 7, toolName: "AtlasReadPage", status: "done", input: { pageId: "page-1" }, output })!;
  render(<ToolCallItem event={event} isCompact />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.queryByText("Last paragraph")).toBeNull();
  fireEvent.click(screen.getByText("Show full content"));
  expect(screen.getByText("Last paragraph")).toBeTruthy();
});

it("reveals additional blocks and long block text on explicit expansion", () => {
  const blocks = Array.from({ length: 30 }, (_, index) => ({ type: "paragraph",
    content: [{ type: "text", text: index === 0 ? `${"Long block. ".repeat(200)}Last sentence` : `Paragraph ${index}` }] }));
  const event = mapToolCallToEvent({ id: 8, toolName: "AtlasCreatePage", status: "running",
    input: { title: "New page", blocksJson: JSON.stringify(blocks) } })!;
  const { container } = render(<ToolCallItem event={event} isCompact />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.queryByText("Paragraph 29")).toBeNull();
  expect(container.textContent).not.toContain("Last sentence");
  fireEvent.click(screen.getByText("Show full content"));
  expect(screen.getByText("Paragraph 29")).toBeTruthy();
  expect(container.textContent).toContain("Last sentence");
});

it("keeps canceled operations distinct from saved pages", () => {
  const event = mapToolCallToEvent({ id: 9, toolName: "AtlasUpdatePage", status: "canceled",
    input: { pageId: "page-1", expectedVersion: 3 } })!;
  render(<ToolCallItem event={event} isCompact />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("Operation canceled")).toBeTruthy();
  expect(screen.queryByText("Page saved")).toBeNull();
});
