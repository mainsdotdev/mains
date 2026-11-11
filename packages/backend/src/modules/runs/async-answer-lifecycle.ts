import type { AsyncQuestionReply, AnswerAsyncQuestionsResponse } from "@mains/contracts/async-questions";

export interface AnswerSubmission {
  reply: AsyncQuestionReply;
  assertCurrent?: () => void;
  uncertain: boolean;
  phase: "checking" | "preparing" | "invoked" | "uncertain" | "accepted";
  promise?: Promise<AnswerAsyncQuestionsResponse>;
}
// Disposition (dismiss/supersede) is durable metadata. Delivery uncertainty is
// separate: cancellation retires preparation but cannot erase accepted input.
export const answerSubmissions = new Map<string, AnswerSubmission>();
const revisions = new Map<string, number>();
const jobs = new Set<Promise<unknown>>();
let generation = {}, phase: "open" | "closing" | "closed" = "open";
let stopping: Promise<void> | undefined;
export const answerKey = (runId: string, artifactId: number) => JSON.stringify([runId, artifactId]);
export function retireAnswer(runId: string, artifactId?: number): void {
  const key = artifactId === undefined ? runId : answerKey(runId, artifactId);
  revisions.set(key, (revisions.get(key) ?? 0) + 1);
}
export function admitAnswer<T>(runId: string, artifactId: number, work: (assertCurrent: () => void) => Promise<T>): Promise<T> {
  if (phase !== "open") return Promise.reject(new Error("User decisions are shutting down"));
  const owner = generation, key = answerKey(runId, artifactId), runRevision = revisions.get(runId), revision = revisions.get(key);
  const assertCurrent = () => {
    if (phase !== "open" || generation !== owner || revisions.get(runId) !== runRevision || revisions.get(key) !== revision) {
      throw new Error("This question decision changed or was dismissed. Reopen it before answering.");
    }
  };
  const result = work(assertCurrent).finally(() => jobs.delete(result));
  jobs.add(result); return result;
}
export function openAsyncAnswers(): void {
  if (phase === "open") return;
  if (phase !== "closed") throw new Error("User decision cleanup is still pending");
  phase = "open"; generation = {}; stopping = undefined; revisions.clear(); answerSubmissions.clear();
}
export function shutdownAsyncAnswers(): Promise<void> {
  if (stopping) return stopping;
  phase = "closing";
  stopping = Promise.allSettled([...jobs]).then(() => { phase = "closed"; answerSubmissions.clear(); revisions.clear(); });
  return stopping;
}
