// @vitest-environment jsdom

import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";

import { CuaReplDisplay } from "./cua-repl-display";

/** The envelope the computer-use REPL actually returns (see tool_calls rows). */
const OUTPUT = {
  content: [
    { type: "text", text: 'Window: "Tokyo Running Guide.docx", App: LibreOffice.' },
    { type: "image", data: "AAAA", mimeType: "image/png" },
  ],
  structuredContent: null,
  _meta: { "codex/nodeReplExecutionDurationMs": 666 },
};

describe("CuaReplDisplay", () => {
  it("prints the step's own title rather than the tool name", () => {
    render(
      createElement(CuaReplDisplay, {
        params: { title: "Checking the revised layout", code: "await office.click(24);" },
        output: OUTPUT,
      }),
    );

    expect(screen.getByText("Checking the revised layout")).toBeTruthy();
  });

  it("renders the screenshot the generic MCP display drops", async () => {
    render(
      createElement(CuaReplDisplay, {
        params: { title: "Checking the revised layout", code: "await office.click(24);" },
        output: OUTPUT,
      }),
    );

    // Collapsed rows never build the quarter-megabyte data URL.
    expect(screen.queryByRole("img")).toBeNull();

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("falls back to the code when a step carries no title", () => {
    render(
      createElement(CuaReplDisplay, {
        params: { code: "office = await cua.getApp('LibreOffice');" },
        output: { content: [{ type: "text", text: "ok" }] },
      }),
    );

    expect(
      screen.getByText("office = await cua.getApp('LibreOffice');"),
    ).toBeTruthy();
  });

  it("has nothing to expand when the step returned nothing", () => {
    render(
      createElement(CuaReplDisplay, {
        params: { title: "Opening the guide" },
        output: undefined,
      }),
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Opening the guide")).toBeTruthy();
  });
});
