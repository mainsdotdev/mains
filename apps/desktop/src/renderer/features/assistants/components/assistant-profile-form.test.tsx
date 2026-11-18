// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantTeam } from "@mains/contracts/assistants";
import { AssistantProfileForm } from "./assistant-profile-form";
const mocks = vi.hoisted(() => ({ create: vi.fn(), createTeam: vi.fn(), teams: [] as AssistantTeam[] }));
vi.mock("@/lib/redux/api", () => ({
  useGetProvidersQuery: () => ({ data: [{ id: "codex", isEnabled: true }] }),
  useGetSpacesQuery: () => ({ data: [{ id: "codex", accountId: "account", providerId: "codex", mode: "developer", isArchived: false }] }),
  useGetProviderModelsQuery: () => ({ currentData: [{ id: "model", displayName: "Test model", supportedEffortLevels: ["low", "medium", "high"] }], isFetching: false }),
}));
vi.mock("@/lib/redux/api/assistantsApi", () => ({
  useCreateAssistantMutation: () => [mocks.create, { isLoading: false }],
  useCreateAssistantTeamMutation: () => [mocks.createTeam, { isLoading: false }],
  useAssistantOverviewQuery: () => ({ currentData: { teams: mocks.teams }, isFetching: false, refetch: vi.fn() }),
}));
beforeEach(() => {
  mocks.create.mockReset().mockImplementation(({ teamId }: { teamId: string | null }) =>
    ({ unwrap: () => Promise.resolve({ id: "created-assistant", teamId }) }));
  mocks.createTeam.mockReset().mockImplementation((input: { accountId: string; name: string }) => ({ unwrap: () => Promise.resolve({ ...input, id: "new-team", createdAt: new Date(0) }) }));
  mocks.teams = [
    { id: "mains", accountId: "account", name: "Mains", createdAt: new Date(0) },
    { id: "website", accountId: "account", name: "Website", createdAt: new Date(0) },
  ];
});
afterEach(cleanup);

async function fillProfile(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Name"), "Trip planner");
}

describe("assistant creation", () => {
  it("offers the mosaic shapes and saves the Mains shape independently of color and model settings", async () => {
    const user = userEvent.setup(), created = vi.fn();
    render(<AssistantProfileForm accountId="account" onCreated={created} onClose={vi.fn()} />);
    const shapes = within(screen.getByRole("radiogroup", { name: "Avatar shape" }));
    expect(shapes.getAllByRole("radio").map(option => option.getAttribute("aria-label"))).toEqual([
      "Steps", "Sphere", "Block", "Flower", "Weave", "Lantern", "Arch", "Kite", "Swallow", "Mains",
    ]);
    expect(within(screen.getByRole("radiogroup", { name: "Avatar color" })).getAllByRole("radio")).toHaveLength(8);
    expect(screen.queryByLabelText("Workspace")).toBeNull();
    expect(screen.queryByLabelText("Instructions")).toBeNull();
    expect(screen.getByRole("button", { name: "Team" }).textContent).toContain("No team");
    await user.click(shapes.getByRole("radio", { name: "Mains" }));
    await user.click(screen.getByRole("radio", { name: "Rose" }));
    await fillProfile(user);
    await user.click(screen.getByRole("button", { name: /Test model.*Medium/i }));
    await user.click(screen.getByRole("menuitemradio", { name: "Test model" }));
    await user.click(screen.getByRole("menuitemradio", { name: /^high$/i }));
    await user.click(screen.getByRole("button", { name: "Create mate" }));
    await waitFor(() => expect(created).toHaveBeenCalledWith("created-assistant", null));
    expect(mocks.create).toHaveBeenCalledWith({ accountId: "account", teamId: null, spaceId: "codex", name: "Trip planner", profileSetup: true, model: "model", effort: "high", avatar: { shape: "mains", color: "rose" } });
  });

  it("creates the assistant in an existing selected team", async () => {
    const user = userEvent.setup();
    render(<AssistantProfileForm accountId="account" onCreated={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Team" }));
    await user.click(await screen.findByRole("option", { name: "Website" }));
    await fillProfile(user);
    await user.click(screen.getByRole("button", { name: "Create mate" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ teamId: "website" })));
  });

  it("switches avatar styles by keyboard and remembers the shape and color across families", async () => {
    const user = userEvent.setup();
    render(<AssistantProfileForm accountId="account" onCreated={vi.fn()} onClose={vi.fn()} />);
    const styles = within(screen.getByRole("radiogroup", { name: "Avatar style" }));
    const shapes = within(screen.getByRole("radiogroup", { name: "Avatar shape" }));
    styles.getByRole("radio", { name: "Mosaic" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(styles.getByRole("radio", { name: "Badge" })).toBe(document.activeElement);
    expect(shapes.getAllByRole("radio").map(option => option.getAttribute("aria-label"))).toEqual(["Card", "Pin", "Shield", "Ticket"]);
    await user.click(shapes.getByRole("radio", { name: "Ticket" }));
    await user.click(screen.getByRole("radio", { name: "Mint" }));
    await user.click(styles.getByRole("radio", { name: "Felt" }));
    expect(shapes.getAllByRole("radio").map(option => option.getAttribute("aria-label"))).toEqual(["Sprout", "Pebble", "Cloud", "Bloom"]);
    await user.click(shapes.getByRole("radio", { name: "Cloud" }));
    await user.click(styles.getByRole("radio", { name: "Badge" }));
    expect(shapes.getByRole("radio", { name: "Ticket", checked: true })).toBeTruthy();
    await user.click(styles.getByRole("radio", { name: "Felt" }));
    expect(shapes.getByRole("radio", { name: "Cloud", checked: true })).toBeTruthy();
    await fillProfile(user);
    await user.click(screen.getByRole("button", { name: "Create mate" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ avatar: { shape: "felt-cloud", color: "mint" } })));
  });

  it("creates and selects a team inline before the overview refresh arrives", async () => {
    const user = userEvent.setup();
    render(<AssistantProfileForm accountId="account" onCreated={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "New team" }));
    expect((screen.getByRole("button", { name: "Create mate" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Team name"), "Launch team{Enter}");
    await waitFor(() => expect(mocks.createTeam).toHaveBeenCalledWith({ accountId: "account", name: "Launch team" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Team" }).textContent).toContain("Launch team"));
    expect(mocks.create).not.toHaveBeenCalled();
    await fillProfile(user);
    await user.click(screen.getByRole("button", { name: "Create mate" }));
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

  it("starts profile setup on a fresh account without creating a team", async () => {
    mocks.teams = [];
    const user = userEvent.setup();
    render(<AssistantProfileForm accountId="account" onCreated={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText("Advanced")).toBeNull();
    expect(screen.getByRole("button", { name: "Team" }).textContent).toContain("No team");
    expect(screen.getByRole("button", { name: "Mate provider" }).textContent).toContain("Codex");
    await fillProfile(user);
    await user.click(screen.getByRole("button", { name: "Create mate" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ teamId: null, profileSetup: true })));
    expect(mocks.createTeam).not.toHaveBeenCalled();
  });
});
