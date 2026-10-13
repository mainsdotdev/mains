// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpAppToolOpenerProvider } from "@/hooks/use-mcp-app-tool-opener";

vi.mock("./mcp-app-display", () => ({
  McpAppDisplay: ({ app }: { app: { resourceUri: string } }) =>
    createElement("div", { "data-testid": "mcp-app-host" }, app.resourceUri),
}));

import { McpDisplay } from "./mcp-display";

afterEach(cleanup);

const flightApp = {
  server: "codex_apps",
  tool: "turkish_airlines.search_flights",
  resourceUri: "ui://widget/flight-availability.html?v=5.3.0",
  originCallId: "call-1",
};

describe("McpDisplay", () => {
  it("opens a text-only app from an older Claude transcript without requiring structured content", () => {
    const output = [{ type: "text", text: "2026-10-12T14:59:37.924Z" }];
    const openTool = vi.fn();
    render(createElement(McpAppToolOpenerProvider, { openTool }, createElement(McpDisplay, {
      displayName: "Get Time", params: {}, output, runId: "run-1", mcpApp: flightApp,
    })));
    fireEvent.click(screen.getByRole("button", { name: "Open Get Time in app panel" }));
    expect(openTool).toHaveBeenCalledWith(expect.objectContaining({ output, app: flightApp }));
  });

  it("explains an omitted result without opening its app and keeps the available text readable", () => {
    render(
      createElement(McpDisplay, {
        displayName: "Flights",
        params: {},
        runId: "run-1",
        mcpApp: flightApp,
        output: {
          content: [{ type: "text", text: "Available flight summary" }],
          structuredContentOmitted: true,
          _meta: { secret: "private-bootstrap" },
        },
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("too large");
    expect(screen.queryByRole("button", { name: /in app panel/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Flights/ }));
    expect(screen.getByText("Available flight summary")).toBeTruthy();
    expect(screen.queryByText(/private-bootstrap/)).toBeNull();
  });

  it("shows an omission notice even when no text is left", () => {
    render(
      createElement(McpDisplay, {
        displayName: "Lookup",
        params: {},
        output: { content: [], structuredContentOmitted: true },
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("too large");
    expect(document.querySelector("pre")).toBeNull();
  });

  it("previews large surviving text and lets the user inspect all available text", () => {
    const text = "x".repeat(5_000) + "Available tail";
    render(
      createElement(McpDisplay, {
        displayName: "Lookup",
        params: {},
        output: { content: text, structuredContentOmitted: true },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Lookup/ }));
    expect(document.querySelector("pre")?.textContent).not.toContain(
      "Available tail",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show available text" }),
    );
    expect(document.querySelector("pre")?.textContent).toBe(text);
    expect(screen.getByRole("status").textContent).toContain("too large");
  });

  it.each([
    "Plain text result",
    [{ type: "text", text: "Block result" }],
    { content: "Envelope text" },
  ])("renders surviving MCP text in its original shape", (output) => {
    render(
      createElement(McpDisplay, { displayName: "Lookup", params: {}, output }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Lookup/ }));
    expect(document.querySelector("pre")?.textContent).toBe(
      typeof output === "string"
        ? output
        : Array.isArray(output)
          ? "Block result"
          : "Envelope text",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not confuse ordinary JSON data or nested markers with omitted result envelopes", () => {
    render(
      createElement(McpDisplay, {
        displayName: "Lookup",
        params: {},
        output: '{"structuredContentOmitted":true}',
      }),
    );
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Lookup/ }));
    expect(document.querySelector("pre")?.textContent).toContain(
      "structuredContentOmitted",
    );
  });

  it("offers the app panel without embedding the provider UI or requiring JSON details to expand", () => {
    const openTool = vi.fn();
    render(
      createElement(
        McpAppToolOpenerProvider,
        { openTool },
        createElement(McpDisplay, {
          displayName: "Skyscanner flights search",
          icon: createElement("span", null, "icon"),
          params: { origin: "TYO", destination: "SEL" },
          output: { structuredContent: { itineraries: [] } },
          runId: "run-1",
          mcpApp: {
            server: "codex_apps",
            tool: "skyscanner.search",
            resourceUri: "ui://widgets/flights.html",
            originCallId: "call-1",
          },
        }),
      ),
    );

    expect(screen.queryByTestId("mcp-app-host")).toBeNull();
    expect(openTool).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Skyscanner flights search in app panel",
      }),
    );
    expect(openTool).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        app: expect.objectContaining({
          resourceUri: "ui://widgets/flights.html",
          originCallId: "call-1",
        }),
      }),
    );
  });

  it.each([
    ["pending call", undefined],
    [
      "missing connector link",
      {
        content: [
          {
            type: "text",
            text: "Authentication was requested. Retry this tool call now.",
          },
        ],
        _meta: {
          _codex_apps: { connector_auth_failure: { is_auth_failure: true } },
        },
      },
    ],
    [
      "provider error",
      {
        content: [
          { type: "text", text: "Unable to process your transaction." },
        ],
        structuredContent: { error_code: "INVALID_ARGUMENT" },
      },
    ],
    [
      "MCP error",
      {
        content: [{ type: "text", text: "Search failed" }],
        isError: true,
      },
    ],
  ])("does not open the MCP App for a %s", (_reason, output) => {
    render(
      createElement(McpDisplay, {
        displayName: "Turkish airlines searched flights",
        params: { from: "IST", to: "AMS" },
        output,
        runId: "run-1",
        mcpApp: flightApp,
      }),
    );

    expect(screen.queryByTestId("mcp-app-host")).toBeNull();
    expect(screen.queryByRole("button", { name: /in app panel/ })).toBeNull();
    expect(screen.getByText("Turkish airlines searched flights")).toBeTruthy();
  });

  it("keeps a failed tool's response available in its details", () => {
    render(
      createElement(McpDisplay, {
        displayName: "Turkish airlines searched flights",
        params: { from: "IST", to: "AMS" },
        output: {
          content: [
            { type: "text", text: "Unable to process your transaction." },
          ],
          structuredContent: { error_code: "INVALID_ARGUMENT" },
        },
        runId: "run-1",
        mcpApp: flightApp,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /Turkish airlines searched flights/i,
      }),
    );
    expect(screen.getByText(/Unable to process your transaction/)).toBeTruthy();
    expect(screen.queryByTestId("mcp-app-host")).toBeNull();
    expect(screen.queryByRole("button", { name: /in app panel/ })).toBeNull();
  });

  it("waits for a successful call to finish before opening its app", () => {
    render(
      createElement(McpDisplay, {
        displayName: "Turkish airlines searched flights",
        params: { from: "IST", to: "AMS" },
        output: { structuredContent: { flights: [] } },
        status: "running",
        runId: "run-1",
        mcpApp: flightApp,
      }),
    );

    expect(screen.queryByTestId("mcp-app-host")).toBeNull();
    expect(screen.queryByRole("button", { name: /in app panel/ })).toBeNull();
  });
});
