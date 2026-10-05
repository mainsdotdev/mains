import type { ConversationSettings } from "@mains/contracts/run-settings";
import { CHANNELS } from "@mains/contracts/channels";
import type { Transport } from "@/lib/transport/types";

const pending = new WeakMap<Transport, Map<string, Promise<void>>>();

/** Preserve click order even when a composer unmounts or switches backends. */
export function persistConversationSettings(transport: Transport, runId: string, settings: ConversationSettings): Promise<void> {
  let writes = pending.get(transport);
  if (!writes) { writes = new Map(); pending.set(transport, writes); }
  const write = (writes.get(runId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const result = await transport.invoke(CHANNELS.runs.update, [runId, { conversationSettings: settings }]);
    if (!result.success) throw new Error(result.error);
  });
  writes.set(runId, write);
  void write.finally(() => { if (writes.get(runId) === write) writes.delete(runId); }).catch(() => {});
  return write;
}

export async function waitForConversationSettings(transport: Transport, runId: string): Promise<void> {
  await pending.get(transport)?.get(runId);
}
