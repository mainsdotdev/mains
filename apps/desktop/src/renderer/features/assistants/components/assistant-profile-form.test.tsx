// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantProfileForm } from "./assistant-profile-form";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/redux/api", () => ({
  useGetSpacesQuery: () => ({ data: [{ id: "codex", accountId: "account", providerId: "codex", mode: "developer", isArchived: false }] }),
  useGetProviderModelsQuery: () => ({ currentData: [{ id: "model", displayName: "Test model", supportedEffortLevels: ["low", "medium", "high"] }], isFetching: false }),
}));
vi.mock("@/lib/redux/api/assistantsApi", () => ({ useCreateAssistantMutation: () => [mocks.create, { isLoading: false }] }));
beforeEach(() => { mocks.create.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ id: "created-assistant" }) }); });
afterEach(cleanup);
describe("assistant creation", () => {
  it("offers exactly two shapes and eight colors with desktop controls and no workspace/team selection", async () => {
    const user = userEvent.setup(), created = vi.fn();
    render(<AssistantProfileForm accountId="account" onCreated={created} onClose={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(10);
    expect(screen.queryByLabelText("Workspace")).toBeNull();
    expect(screen.queryByLabelText("Team")).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Cube" }));
    await user.click(screen.getByRole("radio", { name: "Rose" }));
    await user.type(screen.getByLabelText("Name"), "Trip planner");
    await user.type(screen.getByLabelText("What should this assistant help with?"), "Plan practical trips");
    await user.type(screen.getByLabelText("Instructions"), "Ask about dates and budget.");
    await user.click(screen.getByRole("button", { name: /Test model.*Medium/i }));
    await user.click(screen.getByRole("menuitemradio", { name: "Test model" }));
    await user.click(screen.getByRole("menuitemradio", { name: /^high$/i }));
    await user.click(screen.getByRole("button", { name: "Create assistant" }));
    await waitFor(() => expect(created).toHaveBeenCalledWith("created-assistant"));
    expect(mocks.create).toHaveBeenCalledWith({ accountId: "account", spaceId: "codex", name: "Trip planner", description: "Plan practical trips", instructions: "Ask about dates and budget.", model: "model", effort: "high", avatar: { shape: "cube", color: "rose" } });
  });
});
