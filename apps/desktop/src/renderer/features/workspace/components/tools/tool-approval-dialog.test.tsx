// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolApprovalRequest } from "../../hooks/use-tool-approval";

vi.mock("../../hooks", () => ({
  usePluginLogoMap: () => new Map(), renderPluginIcon: () => null, normalizeSlug: (value: string) => value,
}));
vi.mock("./_shared", () => ({
  ToolDiffBody: ({ patch }: { patch: string }) => <pre data-testid="approval-diff">{patch}</pre>,
}));
import { ToolApprovalDialog } from "./tool-approval-dialog";

const schema = {
  type: "object",
  properties: {
    calendar: { type: "string", title: "Calendar", oneOf: [{ const: "work", title: "Work calendar" }, { const: "home", title: "Home calendar" }], default: "work" },
    seats: { type: "integer", title: "Seats", minimum: 1, maximum: 5, default: 2 },
    notify: { type: "boolean", title: "Notify", default: true },
    people: { type: "array", title: "People", items: { anyOf: [{ const: "okan", title: "Okan" }, { const: "alex", title: "Alex" }] }, minItems: 1, maxItems: 2, default: ["okan"] },
  },
  required: ["calendar", "seats", "people"],
};

function request(requestedSchema: Record<string, unknown> = schema, requestId = "form-1"): ToolApprovalRequest {
  return {
    requestId, runId: "run-1", toolName: "Calendar", serverName: "Calendar", kind: "elicitation",
    elicitationMode: "form", question: "Choose the event details.", requestedSchema, timestamp: 1,
  };
}

afterEach(cleanup);

describe("Copilot tool approval presentation", () => {
  function toolRequest(overrides: Partial<ToolApprovalRequest> = {}): ToolApprovalRequest {
    return { requestId: "tool-1", runId: "run-1", kind: "tool_approval", toolName: "Edit", timestamp: 1, ...overrides };
  }

  it("renders a native file permission as a file and diff with a clear question and intention", () => {
    render(<ToolApprovalDialog request={toolRequest({ question: "Allow editing this file?", description: "Update file",
      toolInput: { file_path: "/workspace/components/hero-section.tsx", diff: "--- a/hero-section.tsx\n+++ b/hero-section.tsx\n@@ -1,1 +1,1 @@\n-old\n+new" } })}
      onRespond={vi.fn()} variant="copilot" />);
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByText("Allow editing this file?")).toBeTruthy();
    expect(screen.getByText("Update file")).toBeTruthy();
    expect(screen.getByText("hero-section.tsx")).toBeTruthy();
    expect(screen.getByTestId("approval-diff").textContent).toContain("-old\n+new");
    expect(screen.queryByText("Kind")).toBeNull();
    expect(screen.queryByText("Tool Call Id")).toBeNull();
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
  });

  it("recognizes a legacy bracketed permission name without cutting it at the colon", () => {
    render(<ToolApprovalDialog request={toolRequest({ toolName: "[permission:write]", toolInput: { kind: "write", toolCallId: "internal",
      intention: "Update file", fileName: "/workspace/hero-section.tsx", diff: "@@ -1,1 +1,1 @@\n-old\n+new" } })} onRespond={vi.fn()} variant="copilot" />);
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByText("Allow Edit?")).toBeTruthy();
    expect(screen.getByTestId("approval-diff")).toBeTruthy();
    expect(screen.queryByText("internal")).toBeNull();
    expect(screen.queryByText("Tool Call Id")).toBeNull();
  });

  it("shows a skill name directly without a JSON dump and preserves the approval decision", async () => {
    const onRespond = vi.fn();
    render(<ToolApprovalDialog request={toolRequest({ toolName: "skill", toolInput: { skill: "frontend-design" } })} onRespond={onRespond} variant="copilot" />);
    expect(screen.getByText("frontend-design")).toBeTruthy();
    expect(screen.queryByText(/"skill"/)).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Allow" }));
    expect(onRespond).toHaveBeenCalledExactlyOnceWith("tool-1", true, undefined);
  });

  it.each(["websearch", "web_search", "WebSearch"])("shows the query for %s without a JSON dump", (toolName) => {
    const query = "Cursor TypeScript SDK official agent SDK cursor-agent ACP TypeScript SDK npm 2026";
    render(<ToolApprovalDialog request={toolRequest({ toolName, toolInput: { args: JSON.stringify({ query }) } })}
      onRespond={vi.fn()} variant="copilot" />);
    expect(screen.getByText("Search query")).toBeTruthy();
    expect(screen.getByText(query)).toBeTruthy();
    expect(screen.queryByText(/"query"/)).toBeNull();
  });

  it("keeps the complete search query and site filters readable", () => {
    const query = `${"official agent SDK documentation ".repeat(12)}permissions and streaming`;
    render(<ToolApprovalDialog request={toolRequest({ toolName: "WebSearch", toolInput: {
      query, allowed_domains: ["docs.github.com", "github.com"], blocked_domains: ["example.com"],
    } })} onRespond={vi.fn()} variant="claude" />);
    expect(screen.getByText(query)).toBeTruthy();
    expect(screen.getByText("Only these sites")).toBeTruthy();
    expect(screen.getByText("docs.github.com")).toBeTruthy();
    expect(screen.getByText("github.com")).toBeTruthy();
    expect(screen.getByText("Excluded sites")).toBeTruthy();
    expect(screen.getByText("example.com")).toBeTruthy();
  });

  it("renders the complete command with its directory and keeps warnings visible", () => {
    render(<ToolApprovalDialog request={toolRequest({ toolName: "Bash", question: "Allow running this command?",
      description: "Needs network access", toolInput: { command: "cd src && npm test > results.txt", cwd: "/workspace" } })} onRespond={vi.fn()} variant="copilot" />);
    expect(screen.getByText("cd src && npm test > results.txt")).toBeTruthy();
    expect(screen.getByText("/workspace")).toBeTruthy();
    expect(screen.getByText("Needs network access")).toBeTruthy();
  });

  it("shows an actual MCP action title, owning server and input values", () => {
    render(<ToolApprovalDialog request={toolRequest({ toolName: "mcp__calendar__create_event", header: "Create calendar event",
      question: "Allow Create calendar event?", description: "MCP server: calendar", toolInput: { title: "Team sync" } })} onRespond={vi.fn()} variant="copilot" />);
    expect(screen.getByText("Create calendar event")).toBeTruthy();
    expect(screen.getByText("MCP server: calendar")).toBeTruthy();
    expect(screen.getByText("Team sync")).toBeTruthy();
  });

  it("shows MCP message and URL inputs without confusing them with the approval question", () => {
    render(<ToolApprovalDialog request={toolRequest({ toolName: "mcp__calendar__send_invite", question: "Allow sending this invite?",
      toolInput: { _meta: { tool_params_display: [{ display_name: "Message", value: "Meeting invite" },
        { display_name: "Url", value: "https://calendar.test" }] } } })} onRespond={vi.fn()} variant="copilot" />);
    expect(screen.getByText("Allow sending this invite?")).toBeTruthy();
    expect(screen.getByText("Meeting invite")).toBeTruthy();
    expect(screen.getByText("https://calendar.test")).toBeTruthy();
  });
});

describe("MCP form approval dialog", () => {
  it("fills defaults, shows titled choices and sends typed values with a multiple selection", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<ToolApprovalDialog request={request()} onRespond={onRespond} variant="codex" />);
    expect((screen.getByRole("combobox", { name: "Calendar" }) as HTMLSelectElement).value).toBe("work");
    expect((screen.getByRole("spinbutton", { name: "Seats" }) as HTMLInputElement).value).toBe("2");
    expect((screen.getByRole("checkbox", { name: "Okan" }) as HTMLInputElement).checked).toBe(true);
    await user.selectOptions(screen.getByRole("combobox", { name: "Calendar" }), "home");
    await user.click(screen.getByRole("checkbox", { name: "Notify" }));
    await user.click(screen.getByRole("checkbox", { name: "Alex" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onRespond).toHaveBeenCalledExactlyOnceWith("form-1", true, JSON.stringify({ calendar: "home", seats: 2, notify: false, people: ["okan", "alex"] }));
  });

  it("keeps the form open and names a constraint error until the value is corrected", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<ToolApprovalDialog request={request()} onRespond={onRespond} />);
    const seats = screen.getByRole("spinbutton", { name: "Seats" });
    await user.clear(seats);
    await user.type(seats, "1.5");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a whole number.");
    expect(seats.getAttribute("aria-invalid")).toBe("true");
    expect(onRespond).not.toHaveBeenCalled();
    await user.clear(seats);
    await user.type(seats, "3");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onRespond).toHaveBeenCalledOnce();
  });

  it("requires text and lets the user correct it before submission", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<ToolApprovalDialog request={request({ properties: { title: { type: "string", title: "Title" } }, required: ["title"] })} onRespond={onRespond} />);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByRole("alert").textContent).toBe("This field is required.");
    expect(onRespond).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Team sync");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onRespond).toHaveBeenCalledExactlyOnceWith("form-1", true, '{"title":"Team sync"}');
  });

  it.each(["Decline", "Cancel"])("sends the user's %s decision without form content", async (button) => {
    const onRespond = vi.fn();
    render(<ToolApprovalDialog request={request()} onRespond={onRespond} />);
    await userEvent.setup().click(screen.getByRole("button", { name: button }));
    expect(onRespond.mock.calls).toEqual([button === "Cancel" ? ["form-1", false, "cancel"] : ["form-1", false]]);
  });

  it("blocks unsupported fields instead of submitting a deceptively empty answer", () => {
    const onRespond = vi.fn();
    render(<ToolApprovalDialog request={request({ properties: { settings: { type: "object", title: "Settings" } }, required: ["settings"] })} onRespond={onRespond} />);
    expect(screen.getByRole("alert").textContent).toContain("Settings");
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("starts a subsequent request with its own defaults and no previous field state", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    const { rerender } = render(<ToolApprovalDialog request={request()} onRespond={onRespond} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Calendar" }), "home");
    await user.clear(screen.getByRole("spinbutton", { name: "Seats" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    rerender(<ToolApprovalDialog request={request(schema, "form-2")} onRespond={onRespond} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("combobox", { name: "Calendar" }) as HTMLSelectElement).value).toBe("work");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onRespond).toHaveBeenCalledExactlyOnceWith("form-2", true, JSON.stringify({ calendar: "work", seats: 2, notify: true, people: ["okan"] }));
  });
});
