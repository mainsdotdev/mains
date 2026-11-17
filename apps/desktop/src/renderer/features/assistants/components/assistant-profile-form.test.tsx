// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantTeam } from "@mains/contracts/assistants";
import { AssistantProfileForm } from "./assistant-profile-form";
const mocks = vi.hoisted(() => ({ create: vi.fn(), createTeam: vi.fn(), teams: [] as AssistantTeam[] }));
vi.mock("@/lib/redux/api", () => ({
  useGetSpacesQuery: () => ({ data: [{ id: "codex", accountId: "account", providerId: "codex", mode: "developer", isArchived: false }] }),
  useGetProviderModelsQuery: () => ({ currentData: [{ id: "model", displayName: "Test model", supportedEffortLevels: ["low", "medium", "high"] }], isFetching: false }),
}));
vi.mock("@/lib/redux/api/assistantsApi", () => ({
  useCreateAssistantMutation: () => [mocks.create, { isLoading: false }],
  useCreateAssistantTeamMutation: () => [mocks.createTeam, { isLoading: false }],
  useAssistantOverviewQuery: () => ({ currentData: { teams: mocks.teams }, isFetching: false, refetch: vi.fn() }),
}));
beforeEach(() => {
  mocks.create.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ id: "created-assistant" }) });
  mocks.createTeam.mockReset().mockImplementation((input: { accountId: string; name: string }) => ({ unwrap: () => Promise.resolve({ ...input, id: "new-team", createdAt: new Date(0) }) }));
  mocks.teams = [
    { id: "mains", accountId: "account", name: "Mains", createdAt: new Date(0) },
    { id: "website", accountId: "account", name: "Website", createdAt: new Date(0) },
  ];
});
afterEach(cleanup);

async function fillProfile(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Name"), "Trip planner");
  await user.type(screen.getByLabelText("What should this assistant help with?"), "Plan practical trips");
  await user.type(screen.getByLabelText("Instructions"), "Ask about dates and budget.");
}

describe("assistant creation", () => {
  it("keeps all six avatar shapes and model settings while assigning the default team", async () => {
    const user = userEvent.setup(), created = vi.fn();
    render(<AssistantProfileForm accountId="account" onCreated={created} onClose={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(14);
    expect(screen.queryByLabelText("Workspace")).toBeNull();
    expect(screen.getByRole("button", { name: "Team" }).textContent).toContain("Mains");
    await user.click(screen.getByRole("radio", { name: "Flower" }));
    await user.click(screen.getByRole("radio", { name: "Rose" }));
    await fillProfile(user);
    await user.click(screen.getByRole("button", { name: /Test model.*Medium/i }));
    await user.click(screen.getByRole("menuitemradio", { name: "Test model" }));
    await user.click(screen.getByRole("menuitemradio", { name: /^high$/i }));
    await user.click(screen.getByRole("button", { name: "Create assistant" }));
    await waitFor(() => expect(created).toHaveBeenCalledWith("created-assistant"));
    expect(mocks.create).toHaveBeenCalledWith({ accountId: "account", teamId: "mains", spaceId: "codex", name: "Trip planner", description: "Plan practical trips", instructions: "Ask about dates and budget.", model: "model", effort: "high", avatar: { shape: "flower", color: "rose" } });
  });

  it("creates the assistant in an existing selected team", async () => {
    const user = userEvent.setup();
    render(<AssistantProfileForm accountId="account" onCreated={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Team" }));
    await user.click(await screen.findByRole("option", { name: "Website" }));
    await fillProfile(user);
    await user.click(screen.getByRole("button", { name: "Create assistant" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ teamId: "website" })));
  });

  it("creates and selects a team inline before the overview refresh arrives", async () => {
    const user = userEvent.setup();
    render(<AssistantProfileForm accountId="account" onCreated={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "New team" }));
    expect((screen.getByRole("button", { name: "Create assistant" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Team name"), "Launch team{Enter}");
    await waitFor(() => expect(mocks.createTeam).toHaveBeenCalledWith({ accountId: "account", name: "Launch team" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Team" }).textContent).toContain("Launch team"));
    expect(mocks.create).not.toHaveBeenCalled();
    await fillProfile(user);
    await user.click(screen.getByRole("button", { name: "Create assistant" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ teamId: "new-team" })));
  });

  it("keeps a failed team name available for retry without creating an assistant", async () => {
    mocks.createTeam.mockReturnValueOnce({ unwrap: () => Promise.reject(new Error("Could not create team")) });
    const user = userEvent.setup();
    render(<AssistantProfileForm accountId="account" onCreated={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "New team" }));
    await user.type(screen.getByLabelText("Team name"), "Launch team");
    await user.click(screen.getByRole("button", { name: "Create team" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not create team");
    expect((screen.getByLabelText("Team name") as HTMLInputElement).value).toBe("Launch team");
    expect(mocks.create).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Team" }).textContent).toContain("Launch team"));
  });

  it("lets a fresh account create its first assistant with the automatic Mains team", async () => {
    mocks.teams = [];
    const user = userEvent.setup();
    render(<AssistantProfileForm accountId="account" onCreated={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Team" }).textContent).toContain("Mains");
    await fillProfile(user);
    await user.click(screen.getByRole("button", { name: "Create assistant" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("teamId");
  });
});
