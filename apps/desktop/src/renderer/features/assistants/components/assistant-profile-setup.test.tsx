// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantWelcome, AssistantWelcomeQuestion } from "@mains/contracts/assistants";
import { AssistantProfileSetupCard } from "./assistant-profile-setup";

const mocks = vi.hoisted(() => ({ send: vi.fn(), reducedMotion: false, platform: "darwin" }));
vi.mock("@/lib/redux/api/assistantsApi", () => ({
  useSetupAssistantProfileMutation: () => [mocks.send, { isLoading: false }],
}));
vi.mock("@/hooks/use-prefers-reduced-motion", () => ({ usePrefersReducedMotion: () => mocks.reducedMotion }));
vi.mock("../../../../shared/runtime-platform", () => ({ getRuntimeOS: () => mocks.platform }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); mocks.reducedMotion = false; mocks.platform = "darwin"; });

const question: AssistantWelcomeQuestion = {
  header: "Set up", question: "Hi, I’m Release. What would you like me to help with?", options: [], idleMessage: "Profile saved.",
  profileSetup: { turns: [] },
};
const welcome: AssistantWelcome = {
  assistantId: "release", runId: "welcome-release", state: "ready", question,
  answer: null, wasSkipped: false, error: null, createdAt: new Date(),
};
const props = { accountId: "account", busy: false, onRetry: vi.fn() };

function enterAnswer(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Setup answer" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

it("streams the first question before making the answer form available", () => {
  let now = 0, frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  function advance(count: number) {
    act(() => {
      for (let index = 0; index < count; index++) {
        const pending = [...frames.values()];
        frames.clear();
        now += 1000 / 60;
        pending.forEach(callback => callback(now));
      }
    });
  }

  const view = render(<AssistantProfileSetupCard {...props} welcome={welcome} animateIntro />);
  const streamedMessage = view.container.querySelector('p[aria-hidden="true"]');
  expect(streamedMessage?.textContent).toBe("");
  expect(screen.queryByRole("textbox", { name: "Setup answer" })).toBeNull();
  expect(view.container.querySelector("form")?.hasAttribute("inert")).toBe(true);

  advance(15);
  expect(streamedMessage?.textContent).toMatch(/^Hi/);
  expect(streamedMessage?.textContent).not.toBe(question.question);
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();

  advance(90);
  expect(screen.getByText(question.question)).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Setup answer" })).toBeTruthy();
  expect(view.container.querySelector("form")?.hasAttribute("inert")).toBe(false);
});

it("shows a new welcome and its answer form immediately with reduced motion", () => {
  mocks.reducedMotion = true;
  render(<AssistantProfileSetupCard {...props} welcome={welcome} animateIntro />);
  expect(screen.getByText(question.question)).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Setup answer" })).toBeTruthy();
});

it.each([
  { platform: "darwin", modifier: { metaKey: true }, label: "⌘↵", keyshortcuts: "Meta+Enter" },
  { platform: "win32", modifier: { ctrlKey: true }, label: "Ctrl+Enter", keyshortcuts: "Control+Enter" },
])("sends the focused answer with the displayed shortcut on $platform", async ({ platform, modifier, label, keyshortcuts }) => {
  mocks.platform = platform;
  mocks.send.mockClear().mockReturnValue({ unwrap: async () => undefined });
  render(<AssistantProfileSetupCard {...props} welcome={welcome} />);
  const input = screen.getByRole("textbox", { name: "Setup answer" });
  const button = screen.getByRole("button", { name: "Send" });
  expect(button.textContent).toContain(label);
  expect(button.getAttribute("aria-keyshortcuts")).toBe(keyshortcuts);
  input.focus();
  fireEvent.keyDown(input, { key: "Enter", ...modifier });
  fireEvent.change(input, { target: { value: "Check signing" } });
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true, ...modifier });
  fireEvent.keyDown(input, { key: "Enter", repeat: true, ...modifier });
  expect(mocks.send).not.toHaveBeenCalled();
  await act(async () => { fireEvent.keyDown(input, { key: "Enter", ...modifier }); });
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ accountId: "account", id: "release", input: { action: "answer", step: 0, answer: "Check signing" } });
});

it.each([false, true])("animates the sent answer only when motion is enabled (reduced motion: %s)", async (reducedMotion) => {
  mocks.reducedMotion = reducedMotion;
  mocks.send.mockReturnValue({ unwrap: async () => undefined });
  const originalAnimate = HTMLElement.prototype.animate;
  const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
  HTMLElement.prototype.animate = animate;
  const column = document.body.appendChild(document.createElement("div"));
  try {
    vi.spyOn(column, "getBoundingClientRect").mockReturnValueOnce(new DOMRect(0, 80)).mockReturnValue(new DOMRect(0, 100));
    render(<AssistantProfileSetupCard {...props} welcome={welcome} columnRef={{ current: column }} />, { container: column });
    vi.spyOn(screen.getByRole("textbox", { name: "Setup answer" }), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 20));
    await act(async () => { enterAnswer("Check signing"); });

    expect(screen.getByText("Check signing", { exact: true })).toBeTruthy();
    if (reducedMotion) {
      expect(animate).not.toHaveBeenCalled();
    } else {
      expect(animate).toHaveBeenCalledTimes(2);
      expect(animate).toHaveBeenNthCalledWith(1, [{ transform: "translateY(-20px)" }, { transform: "none" }], expect.objectContaining({ duration: 260 }));
      expect(animate).toHaveBeenNthCalledWith(2, [
        { transform: "translateY(40px) scale(0.97)", opacity: 0.45 }, { transform: "none", opacity: 1 },
      ], expect.objectContaining({ duration: 260 }));
    }
  } finally {
    if (originalAnimate) HTMLElement.prototype.animate = originalAnimate;
    else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  }
});

it("collects a setup answer and saves an edited profile from the resumed draft", async () => {
  mocks.send.mockReturnValue({ unwrap: async () => undefined });
  const view = render(<AssistantProfileSetupCard {...props} welcome={welcome} />);
  expect(screen.getByText(/Hi, I’m Release/)).toBeTruthy();
  enterAnswer("Check signing");
  const reply = screen.getByText("Check signing", { exact: true });
  expect(screen.getByRole("status").textContent).toBe("Preparing the profile…");
  expect(screen.queryByRole("textbox", { name: "Setup answer" })).toBeNull();
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ accountId: "account", id: "release", input: { action: "answer", step: 0, answer: "Check signing" } }));

  const draft = { description: "Release checks", instructions: "Check signing." };
  view.rerender(<AssistantProfileSetupCard {...props} welcome={{ ...welcome, question: { ...question, profileSetup: {
    turns: [{ question: question.question, answer: "Check signing" }], draft,
  } } }} />);
  expect(screen.getByText("Check signing", { exact: true })).toBe(reply);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Instructions"), { target: { value: "Check signing and ask before uploading." } });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(mocks.send).toHaveBeenLastCalledWith({ accountId: "account", id: "release", input: { action: "save", profile: {
    description: draft.description, instructions: "Check signing and ask before uploading.",
  } } });
});

it("restores the typed answer if sending fails", async () => {
  mocks.send.mockReturnValue({ unwrap: async () => { throw new Error("Send failed"); } });
  render(<AssistantProfileSetupCard {...props} welcome={welcome} />);

  enterAnswer("Check signing");
  expect(screen.getByText("Check signing", { exact: true })).toBeTruthy();

  expect((await screen.findByRole("alert")).textContent).toBe("Send failed");
  const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Setup answer" });
  expect(input.value).toBe("Check signing");
  expect(screen.queryByText("Check signing", { selector: "p", exact: true })).toBeNull();
});

it("shows the provider error with a filled retry button for a failed profile draft", () => {
  const error = "This account needs an active subscription to use Claude Code.\nUpdate your plan to continue.";
  const onRetry = vi.fn().mockResolvedValue(undefined);
  render(<AssistantProfileSetupCard {...props} onRetry={onRetry} welcome={{ ...welcome, state: "failed", error }} />);

  expect(screen.getByRole("alert").textContent).toBe(error);
  const retry = screen.getByRole("button", { name: "Retry profile draft" });
  expect(retry.classList.contains("glass-secondary")).toBe(true);
  fireEvent.click(retry);
  expect(onRetry).toHaveBeenCalledOnce();
});
