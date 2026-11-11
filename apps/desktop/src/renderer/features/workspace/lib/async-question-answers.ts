import type { AnswerAsyncQuestionsPayload, AnswerAsyncQuestionsResponse, DismissAsyncQuestionsPayload } from "@mains/contracts/async-questions";
import { CHANNELS } from "@mains/contracts/channels";
import { getTransport, onTransportChange, type Transport } from "@/lib/transport";
import { waitForConversationSettings } from "./conversation-settings-writer";

function assertConnected(transport: Transport) {
  if (getTransport() !== transport || transport.status() !== "connected") {
    throw new Error("Backend connection changed before sending.");
  }
}

async function questionAccountId(transport: Transport): Promise<string> {
  assertConnected(transport);
  const account = await transport.invoke(CHANNELS.account.get, []);
  if (!account.success) throw new Error(account.error);
  const accountId = (account.data as { id?: string } | null)?.id;
  if (!accountId) throw new Error("No account found.");
  assertConnected(transport);
  return accountId;
}

export async function dismissAsyncQuestions(
  payload: Omit<DismissAsyncQuestionsPayload, "accountId">,
  transport: Transport = getTransport(),
  assertOwner: () => void = () => {},
): Promise<void> {
  assertOwner();
  const accountId = await questionAccountId(transport);
  assertOwner();
  assertConnected(transport);
  const result = await transport.invoke(CHANNELS.runs.dismissAsyncQuestions, [{ ...payload, accountId }]);
  if (!result.success) throw new Error(result.error);
}

export async function sendAsyncQuestionAnswers(
  payload: Omit<AnswerAsyncQuestionsPayload, "accountId">,
  transport: Transport = getTransport(),
  assertOwner: () => void = () => {},
): Promise<AnswerAsyncQuestionsResponse> {
  let invoked = false, retired = false;
  const off = onTransportChange(() => { retired = true; });
  const current = () => { assertOwner(); if (retired) throw new Error("Backend connection changed before sending."); assertConnected(transport); };
  try {
    current();
    const accountId = await questionAccountId(transport);
    if (!payload.checkOnly) await waitForConversationSettings(transport, payload.runId);
    current();
    invoked = true;
    const result = await transport.invoke(CHANNELS.runs.answerAsyncQuestions, [{ ...payload, accountId }]);
    if (!result.success) throw new Error(result.error);
    return result.data as AnswerAsyncQuestionsResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (invoked && /timeout|timed out|disconnect|offline|exited|stopping|socket|connection|transport/i.test(message) &&
        !/delivery is unknown/i.test(message)) {
      throw new Error("Delivery is unknown. Check delivery before sending again.");
    }
    throw error;
  } finally { off(); }
}
