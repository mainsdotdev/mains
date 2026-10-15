import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { asyncQuestionMessageId } from "@mains/contracts/async-questions";
import type { Transport } from "@/lib/transport/types";
import { dismissAsyncQuestions, sendAsyncQuestionAnswers } from "./async-question-answers";

const state = vi.hoisted(() => ({ transport: null as unknown as Transport }));
vi.mock("@/lib/transport", () => ({ getTransport: () => state.transport }));

const payload = { runId: "run", artifactId: 12, answers: ["Staging"] };
const accepted = { accepted: true, answer: { artifactId: 12, answers: ["Staging"], clientUserMessageId: asyncQuestionMessageId(12) } };
function transport() {
  return { kind: "test", status: () => "connected" as const,
    invoke: vi.fn(async (channel: string) => ({ success: true as const, data: channel === CHANNELS.account.get ? { id: "account" } : accepted })),
    subscribe: () => () => {}, onStatusChange: () => () => {},
  };
}
beforeEach(() => { state.transport = transport(); });

describe("async question answer transport", () => {
  it("sends through the owning transport with its account", async () => {
    await expect(sendAsyncQuestionAnswers(payload)).resolves.toEqual(accepted);
    expect(state.transport.invoke).toHaveBeenLastCalledWith(CHANNELS.runs.answerAsyncQuestions, [{ ...payload, accountId: "account" }]);
  });

  it("does not send to a new backend when the account lookup races a switch", async () => {
    const original = transport();
    state.transport = original;
    original.invoke.mockImplementationOnce(async () => {
      state.transport = transport();
      return { success: true, data: { id: "old-account" } };
    });
    await expect(sendAsyncQuestionAnswers(payload)).rejects.toThrow("Backend connection changed before sending");
    expect(original.invoke).toHaveBeenCalledTimes(1);
    expect(state.transport.invoke).not.toHaveBeenCalled();
  });

  it("reports uncertain delivery after a lost response so the card can check instead of resend", async () => {
    const current = transport();
    state.transport = current;
    current.invoke.mockImplementationOnce(async () => ({ success: true, data: { id: "account" } }))
      .mockRejectedValueOnce(new Error("WebSocket request timed out"));
    await expect(sendAsyncQuestionAnswers(payload)).rejects.toThrow("Delivery is unknown");
    expect(current.invoke).toHaveBeenCalledTimes(2);
  });

  it("saves dismissal through the owning account without invoking the answer endpoint", async () => {
    const dismissal = { runId: payload.runId, artifactId: payload.artifactId };
    await dismissAsyncQuestions(dismissal);
    expect(state.transport.invoke).toHaveBeenLastCalledWith(CHANNELS.runs.dismissAsyncQuestions, [{ ...dismissal, accountId: "account" }]);
    expect(state.transport.invoke).toHaveBeenCalledTimes(2);
  });

  it("does not save dismissal into a different backend when the account lookup races a switch", async () => {
    const original = transport();
    state.transport = original;
    original.invoke.mockImplementationOnce(async () => {
      state.transport = transport();
      return { success: true, data: { id: "old-account" } };
    });
    await expect(dismissAsyncQuestions({ runId: payload.runId, artifactId: payload.artifactId })).rejects.toThrow("Backend connection changed");
    expect(original.invoke).toHaveBeenCalledTimes(1);
    expect(state.transport.invoke).not.toHaveBeenCalled();
  });
});
