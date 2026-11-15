// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assistant } from "@mains/contracts/assistants";
import type { Pulse } from "@/lib/redux/api/pulseApi";
import { AssistantRoutines } from "./assistant-routines";

const mocks = vi.hoisted(() => ({ pulses: [] as Pulse[] | undefined, error: undefined as unknown, create: vi.fn(), update: vi.fn(), toggle: vi.fn(), run: vi.fn(), remove: vi.fn(), refetch: vi.fn() }));
vi.mock("@/lib/redux/api/pulseApi", () => ({
  useGetPulsesQuery: () => ({ currentData: mocks.pulses, error: mocks.error, refetch: mocks.refetch }),
  useCreateAssistantRoutineMutation: () => [mocks.create, {}], useUpdatePulseMutation: () => [mocks.update, {}],
  useTogglePulseMutation: () => [mocks.toggle, {}], useRunPulseNowMutation: () => [mocks.run, {}], useDeletePulseMutation: () => [mocks.remove, {}],
}));
vi.mock("@/lib/redux/api", () => ({
  useListWorkspacesQuery: () => ({ currentData: [
    { id: "repo", accountId: "account", projectId: "project", name: "feat/ios" },
    { id: "foreign", accountId: "foreign", name: "Foreign" },
    { id: "archived", accountId: "account", name: "Archived", isArchived: true },
    { id: "replica", accountId: "account", name: "Replica", isReplica: true },
  ] }),
  useListProjectsQuery: () => ({ currentData: [{ id: "project", accountId: "account", name: "Mains" }] }),
}));
const assistant = { id: "assistant", accountId: "account", name: "Release", providerId: "codex", model: "fixed-model" } as Assistant;
const pulse = { id: "routine", accountId: "account", assistantId: "assistant", title: "Release digest", prompt: "Check and report release readiness", frequency: "daily", hour: 9, minute: 0, dayOfWeek: null, timezone: "Europe/Istanbul", mode: "work", workspaceId: null, isActive: true, nextRunAt: new Date("2026-11-17T06:00:00Z"), lastRunId: "last-chat", lastAssignmentStatus: "completed" } as Pulse;
const originalScroll = HTMLElement.prototype.scrollIntoView;
beforeEach(() => {
  for (const method of [mocks.create, mocks.update, mocks.toggle, mocks.run, mocks.remove]) method.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({}) });
  mocks.refetch.mockReset(); mocks.pulses = []; mocks.error = undefined;
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); if (originalScroll) HTMLElement.prototype.scrollIntoView = originalScroll; else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); });

describe("assistant routines", () => {
  it("creates a Work routine from the shared form with the assistant's identity", async () => {
    const user = userEvent.setup();
    render(<AssistantRoutines assistant={assistant} onOpenChat={vi.fn()} />);
    expect(screen.getByText(/No routines yet/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "New routine" }));
    await user.type(screen.getByLabelText("Routine name"), "Daily digest");
    await user.type(screen.getByLabelText("Task and completion criteria"), "Summarize decisions and cite their sources");
    await user.click(screen.getByRole("button", { name: "Create routine" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ accountId: "account", assistantId: "assistant", input: expect.objectContaining({ mode: "work", workspaceId: null, title: "Daily digest", prompt: "Summarize decisions and cite their sources", frequency: "daily", hour: 9, minute: 0, timezone: expect.any(String) }) }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "New routine" })).toBeNull());
  });
  it("uses the library selectors for a weekly repository routine", async () => {
    const user = userEvent.setup();
    render(<AssistantRoutines assistant={assistant} onOpenChat={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "New routine" }));
    await user.type(screen.getByLabelText("Routine name"), "Weekly release check");
    await user.type(screen.getByLabelText("Task and completion criteria"), "Run checks and report blockers");
    await user.click(screen.getByRole("button", { name: "Run in" }));
    for (const name of ["Foreign", "Archived", "Replica"]) expect(screen.queryByRole("option", { name })).toBeNull();
    await user.click(await screen.findByRole("option", { name: "Mains / feat/ios" }));
    await user.click(within(screen.getByRole("group", { name: "Routine schedule" })).getByRole("button"));
    await user.click(screen.getByRole("button", { name: "Frequency" }));
    await user.click(await screen.findByRole("option", { name: "Weekly" }));
    await user.click(screen.getByRole("button", { name: "Create routine" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ mode: "developer", workspaceId: "repo", frequency: "weekly", dayOfWeek: 1 }) })));
  });
  it("edits, pauses, runs, opens the last chat and confirms deletion", async () => {
    mocks.pulses = [pulse, { ...pulse, id: "other", assistantId: "other-assistant", title: "Other assistant" }, { ...pulse, id: "foreign", accountId: "foreign", title: "Foreign account" }];
    const user = userEvent.setup(), openChat = vi.fn();
    render(<AssistantRoutines assistant={assistant} onOpenChat={openChat} />);
    expect(screen.queryByRole("article", { name: "Other assistant" })).toBeNull();
    expect(screen.queryByRole("article", { name: "Foreign account" })).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Pause Release digest" }));
    expect(mocks.toggle).toHaveBeenCalledWith({ id: "routine", isActive: false });
    await user.click(screen.getByRole("button", { name: "Run now" }));
    expect(mocks.run).toHaveBeenCalledWith("routine");
    await user.click(screen.getByRole("button", { name: "Open last chat" }));
    expect(openChat).toHaveBeenCalledWith("last-chat");
    await user.click(screen.getByRole("button", { name: "Edit Release digest" }));
    await user.clear(screen.getByLabelText("Routine name"));
    await user.type(screen.getByLabelText("Routine name"), "Updated digest");
    await user.click(screen.getByRole("button", { name: "Save routine" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ id: "routine", input: expect.objectContaining({ title: "Updated digest", timezone: "Europe/Istanbul" }) }));
    expect(mocks.update.mock.calls[0][0].input).not.toHaveProperty("assistantId");
    expect(mocks.update.mock.calls[0][0].input).not.toHaveProperty("model");
    await user.click(screen.getByRole("button", { name: "Delete Release digest" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("routine"));
  });
  it("preserves the routine draft after a save failure", async () => {
    mocks.create.mockReturnValue({ unwrap: () => Promise.reject({ error: "Scheduler unavailable" }) });
    const user = userEvent.setup();
    render(<AssistantRoutines assistant={assistant} onOpenChat={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "New routine" }));
    await user.type(screen.getByLabelText("Routine name"), "Keep this draft");
    await user.type(screen.getByLabelText("Task and completion criteria"), "Check the release");
    await user.click(screen.getByRole("button", { name: "Create routine" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Scheduler unavailable");
    expect((screen.getByLabelText("Routine name") as HTMLInputElement).value).toBe("Keep this draft");
  });
  it("offers load retry and prevents starting archived assistants", async () => {
    mocks.pulses = undefined; mocks.error = { error: "Connection lost" };
    const user = userEvent.setup();
    render(<AssistantRoutines assistant={{ ...assistant, isArchived: true }} onOpenChat={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("Connection lost");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "New routine" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
