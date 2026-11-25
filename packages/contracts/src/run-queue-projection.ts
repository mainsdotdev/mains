/** Display-only pending input. The creating client remains its sole delivery owner. */
export interface QueueMessageProjection {
  id: string;
  text: string;
  attachmentNames: string[];
  status: "queued" | "editing" | "sending" | "unknown" | "error";
  error?: string;
}
export interface PublishRunQueuePayload {
  runId: string;
  producerId: string;
  revision: number;
  messages: QueueMessageProjection[];
  pauseReason?: string;
}
export interface RunQueueProjection extends PublishRunQueuePayload { expiresAt: number }
export interface RunQueueProjections { queues: RunQueueProjection[] }
