// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { asyncQuestionMessageId, type AsyncQuestionState } from "@mains/contracts/async-questions";
import type { Run, RunEvent } from "../../types";
import type { ToolApprovalRequest } from "../../hooks/use-tool-approval";
import { mapArtifactToEvent } from "../../lib/run-event-mappers";
import { CodexAsyncQuestionCard } from "./codex-async-question-card";
import { AsyncQuestionDialogProvider, RunInputDialog } from "./async-question-dialog";

const mocks = vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) });
  return { send: vi.fn(), dismiss: vi.fn().mockResolvedValue(undefined), nativeRespond: vi.fn() };
});
vi.mock("../../lib/async-question-answers", () => ({ sendAsyncQuestionAnswers: mocks.send, dismissAsyncQuestions: mocks.dismiss }));
vi.mock("../../hooks", () => ({
  usePluginLogoMap: () => new Map(), renderPluginIcon: () => null, normalizeSlug: (value: string) => value,
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.dismiss.mockResolvedValue(undefined); });

const questions = [{ title: "Which environment?", options: ["Staging", "Production"] }, { title: "Anything else?", options: null }];
const props = { runId: "run", artifactId: 12, questions };
const answer = { artifactId: 12, answers: ["Staging", "Check the logs"], clientUserMessageId: asyncQuestionMessageId(12) };
function shell({ ownerKey = "local/run", runId = "run", storedAnswer, request, historical = false,
  runStatus = "running", turnId = 1, activeTurnId = 1, state, extraEvents = [] }: {
  ownerKey?: string; runId?: string; storedAnswer?: typeof answer; request?: ToolApprovalRequest; historical?: boolean;
  runStatus?: Run["status"]; turnId?: number; activeTurnId?: number; state?: AsyncQuestionState; extraEvents?: RunEvent[];
} = {}) {
  const event = mapArtifactToEvent({ id: 12, runId, kind: "report", content: "Questions",
    metadata: { source: "codex_async_questions", questions, turnId, asyncQuestionAnswer: storedAnswer, asyncQuestionState: state } });
  return <AsyncQuestionDialogProvider ownerKey={ownerKey} runId={runId} runStatus={runStatus}
    turns={[{ id: activeTurnId, status: runStatus === "running" ? "active" : "completed" }]}
    events={[event, ...extraEvents]} historical={historical}>
    <CodexAsyncQuestionCard {...props} runId={runId} answer={storedAnswer} state={state} />
    <RunInputDialog request={request} onRespond={mocks.nativeRespond} variant="codex" />
  </AsyncQuestionDialogProvider>;
}
function fill() {
  fireEvent.click(screen.getByRole("button", { name: "Staging" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Custom answer" }), { target: { value: "Check the logs" } });
}

describe("Codex async questions in the existing approval dialog", () => {
  it("collects sequential answers and sends once only after the last question", async () => {
    let resolve!: (value: unknown) => void;
    mocks.send.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(shell());
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Staging" }));
    expect(screen.getByRole("button", { name: "Staging" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Question 2 of 2")).toBeTruthy();
    expect(mocks.send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Custom answer" }), { target: { value: "Check the logs" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    fireEvent.click(screen.getByRole("button", { name: "Loading..." }));
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ runId: "run", artifactId: 12, answers: answer.answers, checkOnly: false });
    expect(screen.queryByText("Answer sent")).toBeNull();
    await act(async () => resolve({ accepted: true, answer }));
    expect(screen.getByRole("status").textContent).toBe("Answer sent");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.nativeRespond).not.toHaveBeenCalled();
  });

  it("lets a custom answer replace a selected option and keeps earlier answers when going back", async () => {
    mocks.send.mockResolvedValue({ accepted: true, answer: { ...answer, answers: ["A preview environment", "Check the logs"] } });
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Staging" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Custom answer" }), { target: { value: " A preview environment " } });
    expect(screen.getByRole("button", { name: "Staging" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByRole("textbox", { name: "Custom answer" }) as HTMLInputElement).value).toBe("A preview environment");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Custom answer" }), { target: { value: "Check the logs" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText("Answer sent");
    expect(mocks.send.mock.calls[0][0].answers).toEqual(["A preview environment", "Check the logs"]);
  });

  it("preserves answers and permits retry after a rejected send", async () => {
    mocks.send.mockRejectedValueOnce(new Error("The provider is not enabled."));
    render(shell());
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByRole("alert");
    expect((screen.getByRole("textbox", { name: "Custom answer" }) as HTMLInputElement).value).toBe("Check the logs");
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Answer sent")).toBeNull();
    expect(mocks.nativeRespond).not.toHaveBeenCalled();
  });

  it("checks uncertain delivery without resending or allowing the frozen answer to change", async () => {
    mocks.send.mockRejectedValueOnce(new Error("Delivery is unknown. Check delivery before sending again."))
      .mockResolvedValueOnce({ accepted: false }).mockResolvedValueOnce({ accepted: true, answer });
    render(shell());
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    const check = await screen.findByRole("button", { name: "Check delivery" });
    expect((screen.getByRole("textbox", { name: "Custom answer" }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(check);
    await waitFor(() => expect(screen.getByRole("button", { name: "Check delivery" })).toBeTruthy());
    expect(mocks.send.mock.calls[1][0]).toEqual({ runId: "run", artifactId: 12, answers: answer.answers, checkOnly: true });
    fireEvent.click(screen.getByRole("button", { name: "Check delivery" }));
    await screen.findByText("Answer sent");
    expect(mocks.send.mock.calls[2][0].checkOnly).toBe(true);
  });

  it("persists dismissal and reopens from the transcript without sending or losing input", async () => {
    render(shell());
    fireEvent.change(screen.getByRole("textbox", { name: "Custom answer" }), { target: { value: "Later" } });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect((screen.getByRole("textbox", { name: "Custom answer" }) as HTMLInputElement).value).toBe("Later");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.nativeRespond).not.toHaveBeenCalled();
    expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith({ runId: "run", artifactId: 12 });
    await act(async () => {});
  });

  it("scopes draft answers to their backend and conversation through chat switches", () => {
    const view = render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Staging" }));
    view.rerender(shell({ ownerKey: "remote/run", runId: "run" }));
    expect(screen.getByRole("button", { name: "Staging" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Production" }));
    view.rerender(shell());
    expect(screen.getByRole("button", { name: "Staging" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("restores accepted history as a read-only card, including a custom answer to a multiple-choice question", () => {
    render(shell({ storedAnswer: { ...answer, answers: ["A preview environment", "Check the logs"] } }));
    fireEvent.click(screen.getByRole("button", { name: /Question.*Which environment/ }));
    expect(screen.getByText("A preview environment")).toBeTruthy();
    expect(screen.getByText("Check the logs")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Answer sent");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("gives real approvals priority and routes their replies to the native responder", () => {
    const request: ToolApprovalRequest = { requestId: "native", runId: "run", kind: "ask_user", toolName: "UserInput", question: "Which account?", timestamp: 1 };
    const view = render(shell({ request }));
    expect(screen.queryByText("Question 1 of 2")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Custom answer" }), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(mocks.nativeRespond).toHaveBeenCalledExactlyOnceWith("native", true, "work");
    expect(mocks.send).not.toHaveBeenCalled();
    view.rerender(shell());
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
  });

  it("opens historical questions only from the explicit Answer action", () => {
    render(shell({ historical: true }));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(screen.getByRole("textbox", { name: "Custom answer" })).toBeTruthy();
  });

  it.each(["succeeded", "failed", "canceled"] as const)("closes the dialog on %s and retains a compact action and the draft", (runStatus) => {
    const view = render(shell());
    fireEvent.change(screen.getByRole("textbox", { name: "Custom answer" }), { target: { value: "Later" } });
    view.rerender(shell({ runStatus }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("2 questions awaiting answers")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Answer pending questions" }));
    expect((screen.getByRole("textbox", { name: "Custom answer" }) as HTMLInputElement).value).toBe("Later");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it("answers a manually reopened completed question through the existing continuation path", async () => {
    mocks.send.mockResolvedValue({ accepted: true, answer });
    render(shell({ runStatus: "succeeded" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Answer pending questions" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText("Answer sent");
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ runId: "run", artifactId: 12, answers: answer.answers, checkOnly: false });
    expect(screen.queryByText("2 questions awaiting answers")).toBeNull();
  });

  it("settles an answer that is accepted after its dialog closed at completion", async () => {
    let resolve!: (value: unknown) => void;
    mocks.send.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(shell());
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    view.rerender(shell({ runStatus: "succeeded" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("Answer sent")).toBeNull();
    await act(async () => resolve({ accepted: true, answer }));
    expect(screen.getByText("Answer sent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Answer pending questions" })).toBeNull();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("never automatically opens a question from an earlier turn", () => {
    const view = render(shell({ runStatus: "succeeded" }));
    fireEvent.click(screen.getByRole("button", { name: "Answer pending questions" }));
    view.rerender(shell({ activeTurnId: 2 }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Answer pending questions" })).toBeTruthy();
  });

  it("makes unanswered questions passive once a newer ordinary input is accepted", () => {
    const view = render(shell());
    const input = mapArtifactToEvent({ id: 13, runId: "run", kind: "user-prompt", content: "Continue with another task",
      metadata: { source: "user", clientUserMessageId: "follow-up" } });
    view.rerender(shell({ extraEvents: [input] }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Answer/ })).toBeNull();
    expect(screen.getByText("No longer awaiting an answer")).toBeTruthy();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("restores persisted passive questions even when the superseding input is outside the history window", () => {
    render(shell({ historical: true, state: { supersededBy: 13 } }));
    expect(screen.getByText("No longer awaiting an answer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Answer/ })).toBeNull();
  });

  it("restores a dismissal after remount while still allowing explicit answering", () => {
    const view = render(shell({ state: { dismissed: true } }));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(screen.getByRole("textbox", { name: "Custom answer" })).toBeTruthy();
    view.unmount();
    render(shell({ state: { dismissed: true } }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Answer pending questions" })).toBeTruthy();
  });

  it("reports an unsaved dismissal and lets an explicit reopen retry it", async () => {
    mocks.dismiss.mockRejectedValueOnce(new Error("offline"));
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not save dismissal");
    fireEvent.click(screen.getByRole("button", { name: "Answer pending questions" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(mocks.dismiss).toHaveBeenCalledTimes(2);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("keeps uncertain answers checkable after completion and supersession without permitting a new send", async () => {
    mocks.send.mockRejectedValueOnce(new Error("Delivery is unknown. Check delivery before sending again."))
      .mockResolvedValueOnce({ accepted: true, answer });
    const view = render(shell());
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByRole("button", { name: "Check delivery" });
    view.rerender(shell({ runStatus: "succeeded", state: { supersededBy: 13 } }));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check answer delivery" }));
    expect((screen.getByRole("textbox", { name: "Custom answer" }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Check delivery" }).at(-1)!);
    await screen.findByText("Answer sent");
    expect(mocks.send.mock.calls[1][0].checkOnly).toBe(true);
  });
});
