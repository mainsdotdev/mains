// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolApprovalRequest } from "../../hooks/use-tool-approval";

vi.mock("../../hooks", () => ({
  usePluginLogoMap: () => new Map(), renderPluginIcon: () => null, normalizeSlug: (value: string) => value,
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
