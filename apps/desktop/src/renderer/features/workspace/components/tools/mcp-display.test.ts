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
  it("offers the app panel without embedding the provider UI or requiring JSON details to expand", () => {
    const openTool = vi.fn();
    render(
      createElement(McpAppToolOpenerProvider, { openTool }, createElement(McpDisplay, {
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
      })),
    );

    expect(screen.queryByTestId("mcp-app-host")).toBeNull();
    expect(openTool).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open Skyscanner flights search in app panel" }));
    expect(openTool).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1",
      app: expect.objectContaining({ resourceUri: "ui://widgets/flights.html", originCallId: "call-1" }) }));
  });

  it.each([
    ["pending call", undefined],
    ["missing connector link", {
      content: [{ type: "text", text: "Authentication was requested. Retry this tool call now." }],
      _meta: { _codex_apps: { connector_auth_failure: { is_auth_failure: true } } },
    }],
    ["provider error", {
      content: [{ type: "text", text: "Unable to process your transaction." }],
      structuredContent: { error_code: "INVALID_ARGUMENT" },
    }],
    ["MCP error", {
      content: [{ type: "text", text: "Search failed" }],
      isError: true,
    }],
  ])("does not open the MCP App for a %s", (_reason, output) => {
    render(createElement(McpDisplay, {
      displayName: "Turkish airlines searched flights",
      params: { from: "IST", to: "AMS" },
      output,
      runId: "run-1",
      mcpApp: flightApp,
    }));

    expect(screen.queryByTestId("mcp-app-host")).toBeNull();
    expect(screen.queryByRole("button", { name: /in app panel/ })).toBeNull();
    expect(screen.getByText("Turkish airlines searched flights")).toBeTruthy();
  });

  it("keeps a failed tool's response available in its details", () => {
    render(createElement(McpDisplay, {
      displayName: "Turkish airlines searched flights",
      params: { from: "IST", to: "AMS" },
      output: {
        content: [{ type: "text", text: "Unable to process your transaction." }],
        structuredContent: { error_code: "INVALID_ARGUMENT" },
      },
      runId: "run-1",
      mcpApp: flightApp,
    }));

    fireEvent.click(screen.getByRole("button", { name: /Turkish airlines searched flights/i }));
    expect(screen.getByText(/Unable to process your transaction/)).toBeTruthy();
    expect(screen.queryByTestId("mcp-app-host")).toBeNull();
    expect(screen.queryByRole("button", { name: /in app panel/ })).toBeNull();
  });

  it("waits for a successful call to finish before opening its app", () => {
    render(createElement(McpDisplay, {
      displayName: "Turkish airlines searched flights",
      params: { from: "IST", to: "AMS" },
      output: { structuredContent: { flights: [] } },
      status: "running",
      runId: "run-1",
      mcpApp: flightApp,
    }));

    expect(screen.queryByTestId("mcp-app-host")).toBeNull();
    expect(screen.queryByRole("button", { name: /in app panel/ })).toBeNull();
  });
});
