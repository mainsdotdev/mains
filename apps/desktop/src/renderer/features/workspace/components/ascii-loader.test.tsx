// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RunEvent } from "../types";
import { selectActiveTool } from "../lib/select-active-tool";
import { AsciiLoader } from "./ascii-loader";

afterEach(cleanup);

function tool(toolName: string, input: unknown): RunEvent {
  return { id: "tool-1", type: "tool_call", content: `${toolName}:`, timestamp: new Date(),
    metadata: { toolName, status: "running", input } };
}

describe("AsciiLoader activity", () => {
  it("shows the active file read ahead of thinking, then falls back when the call completes", () => {
    const active = tool("Read", { file_path: "/Users/example/project/AGENTS.md" });
    const view = render(<AsciiLoader activeTool={selectActiveTool([active])} thinkingText="**Analyzing requirements**" />);
    expect(screen.getByText("Reading AGENTS.md")).toBeTruthy();
    expect(screen.queryByText("Analyzing requirements")).toBeNull();

    const completed = { ...active, metadata: { ...active.metadata, status: "done" } };
    view.rerender(<AsciiLoader activeTool={selectActiveTool([completed])} thinkingText="**Analyzing requirements**" />);
    expect(screen.queryByText("Reading AGENTS.md")).toBeNull();
    expect(screen.getByText("Analyzing requirements")).toBeTruthy();
  });

  it("uses the shared alias classification for serialized provider inputs", () => {
    render(<AsciiLoader activeTool={tool("read_file", JSON.stringify({ path: "/Users/example/project/my_file_name.ts" }))} />);
    expect(screen.getByText("Reading my_file_name.ts")).toBeTruthy();
  });

  it("shows the command being run", () => {
    render(<AsciiLoader activeTool={tool("Bash", { command: "npm test" })} />);
    expect(screen.getByText("Running npm test")).toBeTruthy();
  });

  it("keeps MCP activity readable through the shared tool registry", () => {
    render(<AsciiLoader activeTool={tool("mcp__linear__list_issues", { query: "Open bugs" })} />);
    expect(screen.getByText("Linear listing issues Open bugs")).toBeTruthy();
  });
});
