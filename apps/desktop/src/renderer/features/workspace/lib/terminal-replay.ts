import type { TerminalDataEvent, TerminalSnapshot } from "@mains/contracts/terminal";

/** Stream events can arrive before the attach response. Replay each chunk once. */
export function createTerminalReplay(write: (data: string) => void) {
  let sequence = -1;
  let waiting = true;
  let pending: TerminalDataEvent[] = [];
  let pendingChars = 0;
  const limit = 128 * 1024;
  const accept = (event: TerminalDataEvent) => {
    if (event.sequence <= sequence) return;
    sequence = event.sequence;
    write(event.data);
  };
  return {
    begin() { waiting = true; pending = []; pendingChars = 0; },
    push(event: TerminalDataEvent) {
      if (!waiting) { accept(event); return; }
      const chunk = { ...event, data: event.data.slice(-limit) };
      pending.push(chunk);
      pendingChars += chunk.data.length;
      while (pendingChars > limit && pending.length > 1) pendingChars -= pending.shift()!.data.length;
    },
    restore(snapshot: TerminalSnapshot) {
      write(snapshot.data);
      sequence = snapshot.sequence;
      waiting = false;
      for (const event of pending) accept(event);
      pending = [];
      pendingChars = 0;
    },
  };
}
