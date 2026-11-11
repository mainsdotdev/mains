import type { ConversationSettings } from "@mains/contracts/run-settings";
import { CHANNELS } from "@mains/contracts/channels";
import type { Transport } from "@/lib/transport/types";
import { createConversationSettingsLifecycle } from "@/lib/conversation-lifecycle";

const writes = createConversationSettingsLifecycle<Transport>();

/** Preserve click order even when a composer unmounts or switches backends. */
export function persistConversationSettings(transport: Transport, runId: string, settings: ConversationSettings): Promise<void> {
  return writes.write(transport, runId, settings, async (snapshot) => {
    const result = await transport.invoke(CHANNELS.runs.update, [runId, { conversationSettings: snapshot }]);
    if (!result.success) throw new Error(result.error);
  });
}

export async function waitForConversationSettings(transport: Transport, runId: string): Promise<void> {
  await writes.wait(transport, runId);
}

export function hasPendingConversationSettings(transport: Transport, runId: string): boolean {
  return writes.pending(transport, runId);
}
