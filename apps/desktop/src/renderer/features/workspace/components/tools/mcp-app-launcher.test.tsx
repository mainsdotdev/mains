// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpAppToolOpen } from "@mains/contracts/mcp-apps";
import { McpAppToolOpenerProvider } from "@/hooks/use-mcp-app-tool-opener";

vi.mock("./mcp-app-display", () => ({ McpAppDisplay: () => <iframe title="Inline app" /> }));
import { McpAppLauncher } from "./mcp-app-launcher";

const result: McpAppToolOpen = {
  runId: "run-1", title: "Open MagicPath", input: { projectId: "project-1" },
  app: { server: "codex_apps", tool: "magicpath.open", resourceUri: "ui://magicpath",
    appName: "MagicPath", connectorId: "magicpath", linkId: "account-1", originCallId: "call-1" },
  output: { content: [], structuredContent: { projectId: "project-1" } },
};

afterEach(cleanup);
describe("MCP app transcript launchers", () => {
  it("uses an opener from another renderer without embedding the app in the transcript", () => {
    const openTool = vi.fn();
    render(<McpAppToolOpenerProvider openTool={openTool}><McpAppLauncher {...result} icon={<svg aria-hidden />} /></McpAppToolOpenerProvider>);
    expect(document.querySelector("iframe")).toBeNull();
    expect(openTool).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open MagicPath in app panel" }));
    expect(openTool).toHaveBeenCalledWith(result);
  });

  it("never falls back to an inline iframe when no app opener is available", () => {
    render(<McpAppLauncher {...result} />);
    expect(document.querySelector("iframe")).toBeNull();
    expect((screen.getByRole("button", { name: "Open MagicPath in app panel" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
