import { createInputReceipt } from "../input-receipt-lifecycle";

/** One open input stream per query; only native receipts acknowledge delivery. */
export interface ClaudeInputMessage {
  type: "user";
  uuid: string;
  session_id: string;
  parent_tool_use_id: null;
  message: { role: "user"; content: string };
  priority?: "now";
}

interface ReceiptFrame {
  type: string;
  uuid?: string;
  command_uuid?: string;
  state?: string;
  subtype?: string;
  capabilities?: string[];
  parent_tool_use_id?: unknown;
  agent_id?: unknown;
  user_message_uuid?: string;
  user_message_uuids?: string[];
  message?: unknown;
}

type Acceptance = { turnId: string; delivery: "queue" | "steer" };
type Input = {
  receipt: ReturnType<typeof createInputReceipt<Acceptance>>;
  resolve?: (receipt: Acceptance) => void;
  reject?: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export function isClaudeUserInput(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" || Array.isArray(content) && content.some((block) =>
    block && typeof block === "object" && ["text", "image", "document"].includes((block as { type: string }).type));
}

export function createClaudeTurnInput(options: {
  initial: ClaudeInputMessage;
  onInitialAccepted?: (turnId: string) => Promise<void>;
  cancel: (uuid: string) => Promise<boolean>;
  receiptTimeoutMs?: number;
}) {
  const inputs = new Map<string, Input>();
  const messages: ClaudeInputMessage[] = [options.initial];
  let wake: (() => void) | undefined;
  let phase: "open" | "ending" | "closed" | "stopped" = "open";
  let supportsReceipts: boolean | undefined;
  let turnId: string | undefined = options.initial.uuid;
  inputs.set(options.initial.uuid, {
    receipt: createInputReceipt(async ({ turnId }) => { await options.onInitialAccepted?.(turnId); }),
  });

  const stream: AsyncIterable<ClaudeInputMessage> = {
    async *[Symbol.asyncIterator]() {
      while (phase === "open" || phase === "ending" || messages.length) {
        const message = messages.shift();
        if (message) yield message;
        else await new Promise<void>((resolve) => { wake = resolve; });
      }
    },
  };

  function close() {
    if (phase !== "stopped") phase = "closed";
    wake?.();
    wake = undefined;
  }

  async function cancel(uuid: string): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([options.cancel(uuid), new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 2_000);
        timer.unref?.();
      })]);
    } finally { clearTimeout(timer); }
  }

  async function accept(uuid: string) {
    const input = inputs.get(uuid);
    if (!input || phase === "stopped") return;
    if (!input.receipt.accepted) {
      // A send can reach the CLI as its previous result is already in flight.
      // Represent that delivery as a real continuation, never as a fold into
      // the finished turn. Further steering is closed at the first result.
      const delivery = uuid === options.initial.uuid || !turnId ? "queue" : "steer";
      turnId ??= uuid;
      clearTimeout(input.timer);
      void input.receipt.accept({ turnId, delivery }).catch(() => {});
    }
    try {
      await input.receipt.projection;
      input.resolve?.(input.receipt.acceptance!);
    } catch (error) {
      input.reject?.(new Error(`Delivery is unknown: Claude accepted the message but could not save its receipt. ${String(error)}`));
      throw error;
    }
  }

  async function observe(frame: ReceiptFrame) {
    if (frame.agent_id || frame.parent_tool_use_id) return;
    if (frame.type === "result" && phase === "open") phase = "ending";
    if (frame.type === "system" && frame.subtype === "init") {
      supportsReceipts = frame.capabilities?.includes("msg_lifecycle_v1") ?? false;
    }
    if (frame.type === "command_lifecycle") {
      const uuid = frame.command_uuid;
      if (uuid && frame.state === "started") await accept(uuid);
      else if (uuid && frame.state === "cancelled") {
        const input = inputs.get(uuid);
        if (input && !input.receipt.accepted) {
          clearTimeout(input.timer);
          input.reject?.(new Error("Claude did not accept this message. It stays queued."));
          inputs.delete(uuid);
        }
      }
    } else if (frame.type === "user" && frame.uuid && isClaudeUserInput(frame.message)) {
      // --replay-user-messages echoes prompts when a turn takes them, not
      // when they are merely written to stdin or admitted to the queue.
      await accept(frame.uuid);
    }
    if (frame.type === "assistant" || frame.type === "stream_event" || frame.type === "result") {
      for (const uuid of new Set([frame.user_message_uuid, ...(frame.user_message_uuids ?? [])])) {
        if (uuid) await accept(uuid);
      }
    }
    if (frame.type === "result") {
      turnId = undefined;
      // Withdraw messages that missed the active turn. A false cancellation
      // is not an ACK: a dequeued message must still produce a native receipt.
      await Promise.all([...inputs].filter(([, input]) => !input.receipt.accepted).map(async ([uuid, input]) => {
        try {
          const queuedIndex = messages.findIndex((message) => message.uuid === uuid);
          if (queuedIndex >= 0) messages.splice(queuedIndex, 1);
          const withdrawn = queuedIndex >= 0 || await cancel(uuid);
          // Native acceptance can arrive while cancellation is in flight.
          // Its receipt is authoritative even if control later says canceled.
          if (withdrawn && !input.receipt.accepted) {
            clearTimeout(input.timer);
            input.reject?.(new Error("The Claude turn ended before accepting this message. It stays queued."));
            inputs.delete(uuid);
          }
        } catch { /* Stream closure is uncertain until a receipt or history confirms delivery. */ }
      }));
      close();
    }
  }

  function send(message: ClaudeInputMessage, project: (receipt: Acceptance) => Promise<void>): Promise<Acceptance> {
    if (phase !== "open") {
      return Promise.reject(new Error("There is no active Claude turn to steer. The message stays queued."));
    }
    if (supportsReceipts === undefined) {
      return Promise.reject(new Error("Claude is still starting. The message stays queued."));
    }
    if (!supportsReceipts) {
      return Promise.reject(new Error("This Claude runtime does not support tracked steering. Update the Claude runtime."));
    }
    if (inputs.has(message.uuid)) return Promise.reject(new Error("This message is already being sent."));
    return new Promise((resolve, reject) => {
      const input: Input = { receipt: createInputReceipt(project), resolve, reject };
      input.timer = setTimeout(() => {
        reject(new Error("Timed out waiting for Claude to accept this message. Delivery is unknown."));
      }, options.receiptTimeoutMs ?? 30_000);
      input.timer.unref?.();
      inputs.set(message.uuid, input);
      messages.push(message);
      wake?.();
      wake = undefined;
    });
  }

  function stop() {
    phase = "stopped";
    for (const input of inputs.values()) input.receipt.retire();
    messages.length = 0;
    close();
  }

  function finish() {
    stop();
    for (const input of inputs.values()) {
      clearTimeout(input.timer);
      if (!input.receipt.accepted) input.reject?.(new Error("Claude connection closed before confirming delivery. The message stays queued."));
    }
  }

  return {
    stream, send, observe, stop, finish,
    async drainAccepted() {
      await Promise.allSettled([...inputs.values()].flatMap((input) => input.receipt.projection ? [input.receipt.projection] : []));
    },
    getStatus(uuid: string) {
      const input = inputs.get(uuid);
      return { accepted: input?.receipt.accepted ?? false, ...input?.receipt.acceptance };
    },
    async getAcceptedStatus(uuid: string) {
      const input = inputs.get(uuid);
      // A recovery check must not overtake the original projection and take
      // its artifact identity before that projection creates a late boundary.
      await input?.receipt.projection?.catch(() => {});
      return { accepted: input?.receipt.accepted ?? false, ...input?.receipt.acceptance };
    },
  };
}
