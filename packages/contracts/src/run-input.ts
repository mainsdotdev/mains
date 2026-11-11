/** Stable refusal messages shared by the backend guard and queued-input clients. */
export const RUN_INPUT_ERRORS = {
  responseStarting: "This conversation is already starting a response.",
  responseActive: "This conversation already has an active response.",
  voiceActive: "End voice chat before starting a new text response.",
  archived: "Unarchive this conversation before sending a message.",
  noActiveTurn: "There is no active turn to steer. The message stays queued.",
  turnChanged: "The active turn changed before sending. The message stays queued.",
} as const;

/** These preflight refusals did not submit a new continuation. */
export function isRunResponseBusy(error: string): boolean {
  return /already (?:has an active response|starting a response)/i.test(error);
}

/** A failed reply is not proof that a native provider rejected the input. */
export function isRunInputDeliveryUncertain(error: string): boolean {
  return /timeout|timed out|disconnect|offline|exited|stopping|socket|connection|transport|delivery is unknown|already being sent/i.test(error);
}
