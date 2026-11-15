// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantWelcome } from "@mains/contracts/assistants";
import { AssistantWelcomeCard } from "./assistant-welcome-card";
vi.mock("@/features/workspace/hooks", () => ({ usePluginLogoMap: () => new Map(), renderPluginIcon: () => null, normalizeSlug: (value: string) => value }));
afterEach(cleanup);
const welcome: AssistantWelcome = { assistantId: "release", runId: "welcome-release", state: "ready", wasSkipped: false, answer: null, error: null, createdAt: new Date(), question: {
  header: "First step", question: "I'm your release assistant. Where shall we start?", idleMessage: "Message me whenever you're ready.", options: [
    { label: "Review TestFlight", description: "Check the current build." },
    { label: "Draft release notes", description: "Summarize changes." },
    { label: "Check the website", description: "Review the announcement." },
  ],
} };
describe("assistant welcome", () => {
  it("shows role-based choices and waits for an explicit answer", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AssistantWelcomeCard welcome={welcome} busy={false} onAnswer={onAnswer} onRetry={vi.fn()} />);
    expect(screen.getByText(welcome.question!.question)).toBeTruthy();
    expect(screen.getByText("Check the current build.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: /Review TestFlight/ }));
    expect(onAnswer).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledExactlyOnceWith("Review TestFlight"));
  });
  it("accepts the user's own first task", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined), user = userEvent.setup();
    render(<AssistantWelcomeCard welcome={welcome} busy={false} onAnswer={onAnswer} onRetry={vi.fn()} />);
    await user.type(screen.getByRole("textbox"), "Review version 0.24 signing");
    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledExactlyOnceWith("Review version 0.24 signing"));
  });
  it("skips into a friendly idle state without executing a task", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined), user = userEvent.setup();
    const view = render(<AssistantWelcomeCard welcome={welcome} busy={false} onAnswer={onAnswer} onRetry={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledExactlyOnceWith(null));
    view.rerender(<AssistantWelcomeCard welcome={{ ...welcome, state: "skipped", wasSkipped: true }} busy={false} onAnswer={onAnswer} onRetry={vi.fn()} />);
    expect(screen.getByText(welcome.question!.idleMessage)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByText("Skipped")).toBeNull();
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
  it("retains the saved answer when checking interrupted delivery", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined), user = userEvent.setup();
    render(<AssistantWelcomeCard welcome={{ ...welcome, state: "starting", answer: "Check release signing", error: "Connection interrupted" }} busy={false} onAnswer={onAnswer} onRetry={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Check delivery" }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith("Check release signing");
  });
});
