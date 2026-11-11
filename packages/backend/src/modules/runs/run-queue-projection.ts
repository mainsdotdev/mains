import type { PublishRunQueuePayload, RunQueueProjection } from "@mains/contracts/run-queue-projection";

const LEASE_MS = 60_000;
/** Ephemeral metadata, never a second queue consumer or a durable pending-input table. */
export function createRunQueueProjectionStore(now = Date.now) {
  const entries = new Map<string, RunQueueProjection>();
  function prune() { for (const [key, value] of entries) if (value.expiresAt <= now()) entries.delete(key); }
  function publish(input: PublishRunQueuePayload): boolean {
    if (!input || typeof input.runId !== "string" || input.runId.length > 200 || !input.runId ||
        typeof input.producerId !== "string" || !/^[\w-]{1,80}$/.test(input.producerId) ||
        !Number.isSafeInteger(input.revision) || input.revision < 1 || !Array.isArray(input.messages) || input.messages.length > 32) throw new Error("Invalid queue projection.");
    const messages = input.messages.map(message => {
      if (!message || typeof message.id !== "string" || !message.id || message.id.length > 200 ||
          typeof message.text !== "string" || message.text.length > 4096 ||
          !["queued", "editing", "sending", "unknown", "error"].includes(message.status) ||
          !Array.isArray(message.attachmentNames) || message.attachmentNames.length > 5 ||
          message.attachmentNames.some(name => typeof name !== "string" || name.length > 240 || /[\\/]/.test(name)) ||
          message.error !== undefined && (typeof message.error !== "string" || message.error.length > 1024)) throw new Error("Invalid queued message projection.");
      return { id: message.id, text: message.text, status: message.status, attachmentNames: [...message.attachmentNames], ...(message.error ? { error: message.error } : {}) };
    });
    if (new Set(messages.map(message => message.id)).size !== messages.length ||
        input.pauseReason !== undefined && (typeof input.pauseReason !== "string" || input.pauseReason.length > 1024)) throw new Error("Invalid queue projection.");
    const value = { runId: input.runId, producerId: input.producerId, revision: input.revision, messages,
      ...(input.pauseReason ? { pauseReason: input.pauseReason } : {}), expiresAt: now() + LEASE_MS };
    if (Buffer.byteLength(JSON.stringify(value)) > 256 * 1024) throw new Error("Queue projection exceeds the metadata limit.");
    prune();
    const key = JSON.stringify([value.runId, value.producerId]), previous = entries.get(key);
    if (previous && previous.revision >= value.revision) return false;
    // Empty publications retain their revision so late old writes cannot resurrect a removed row.
    entries.set(key, value);
    while (entries.size > 128) entries.delete(entries.keys().next().value!);
    return true;
  }
  return {
    publish,
    read(runId: string) { prune(); return [...entries.values()].filter(value => value.runId === runId && value.messages.length).slice(-4).map(value => structuredClone(value)); },
    clear() { entries.clear(); },
  };
}
export const runQueueProjections = createRunQueueProjectionStore();
