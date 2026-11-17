// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantWelcome, AssistantWelcomeQuestion } from "@mains/contracts/assistants";
import { AssistantProfileSetupCard } from "./assistant-profile-setup";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/redux/api/assistantsApi", () => ({
  useSetupAssistantProfileMutation: () => [mocks.send, { isLoading: false }],
}));
afterEach(cleanup);

it("collects a setup answer and saves an edited profile from the resumed draft", async () => {
  mocks.send.mockReturnValue({ unwrap: async () => undefined });
  const question: AssistantWelcomeQuestion = {
    header: "Set up", question: "Hi, I’m Release. What would you like me to help with?", options: [], idleMessage: "Profile saved.",
    profileSetup: { turns: [] },
  };
  const welcome: AssistantWelcome = {
    assistantId: "release", runId: "welcome-release", state: "ready", question,
    answer: null, wasSkipped: false, error: null, createdAt: new Date(),
  };
  const props = { accountId: "account", busy: false, onRetry: vi.fn() };
  const view = render(<AssistantProfileSetupCard {...props} welcome={welcome} />);
  expect(screen.getByText(/Hi, I’m Release/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Setup answer"), { target: { value: "Check signing" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ accountId: "account", id: "release", input: { action: "answer", step: 0, answer: "Check signing" } }));

  const draft = { description: "Release checks", instructions: "Check signing." };
  view.rerender(<AssistantProfileSetupCard {...props} welcome={{ ...welcome, question: { ...question, profileSetup: {
    turns: [{ question: question.question, answer: "Check signing" }], draft,
  } } }} />);
  expect(screen.getByText("Check signing", { exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Instructions"), { target: { value: "Check signing and ask before uploading." } });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(mocks.send).toHaveBeenLastCalledWith({ accountId: "account", id: "release", input: { action: "save", profile: {
    description: draft.description, instructions: "Check signing and ask before uploading.",
  } } });
});
