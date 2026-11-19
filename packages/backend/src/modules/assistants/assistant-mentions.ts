import { allowsAssistantMentions, type AssistantMessageContext } from "@mains/contracts/assistants";
import type { StartRunContextItem } from "../runs/runs.dto";
import { assistantsService } from "./assistants.service";
import { object, text } from "./assistants.validation";

/** A durable user selection; only its own accepted prompt may dispatch it. */
export function prepareAssistantMentions(args: { accountId: string; mode: string; assistantId: string | null; prompt: string; promptId?: string; fallbackPromptId?: string; context: AssistantMessageContext }): { promptId?: string; items: StartRunContextItem[] | undefined } {
    const items = args.context.initialContext ?? [];
    const selected = items.filter(item => item.metadata?.source === "assistant_mention");
    if (!selected.length) return { promptId: args.promptId, items: args.context.initialContext };
    if (!allowsAssistantMentions(args.mode, args.assistantId)) throw new Error("Call Mates from a standard Code or Work conversation.");
    if (selected.length > 4) throw new Error("Call up to four assistants in one message");
    const mentions = selected.map(item => {
        const assistant = assistantsService.requireForWork(text(item.metadata?.assistantId, "Assistant"), args.accountId);
        const token = `@assistant-${assistant.id}`;
        if (item.metadata?.token !== token) throw new Error("Invalid assistant mention");
        return { item, assistant, token, requestId: text(item.metadata?.requestId, "Mention key", 80) };
    });
    if (new Set(mentions.map(m => m.assistant.id)).size !== mentions.length) throw new Error("Mention each assistant once per message");
    const promptId = text(args.promptId || args.fallbackPromptId || `mention-${mentions[0].requestId}`, "Message key", 100);
    const prompt = text(mentions.reduce((value, m) => value.split(m.token).join(`@${m.assistant.name}`), args.prompt), "Request", 24000);
    const { initialContext: _context, attachments: _uploads, ...context } = args.context;
    const taskContext: AssistantMessageContext = { ...context, initialContext: items.filter(item => item.metadata?.source !== "assistant_mention") };
    return { promptId, items: items.map(item => {
        const mention = mentions.find(m => m.item === item);
        if (!mention) return item;
        const { assistant, token, requestId } = mention;
        const content = [
            `The work addressed to @${assistant.name} in this message is delegated to that Mate. Mains schedules the assignment automatically after accepting this message.`,
            "Briefly acknowledge the handoff in the user's language. The Mate handles the task and asks any necessary clarifying questions in its own chat.",
            "Do not work on the delegated task, ask the user clarifying questions about it, create another assignment, or poll for progress.",
            "End this turn after the acknowledgment and wait for Mains to deliver the Mate's report in a later turn. Continue this turn only for separate work the user explicitly assigned to this conversation.",
        ].join(" ");
        return { kind: "note", ref: assistant.name, content,
            metadata: { source: "assistant_mention", assistantId: assistant.id, name: assistant.name, token, requestId, sourcePromptId: promptId, sourcePrompt: args.prompt, prompt, context: taskContext } };
    }) };
}

/** Share explicit uploads as durable file references, without copying pixels into the queue. */
export function withAssistantMentionFiles(items: StartRunContextItem[] | undefined, files: Array<{ sourcePath: string }>): StartRunContextItem[] | undefined {
    if (!files.length) return items;
    return items?.map(item => {
        if (item.metadata?.source !== "assistant_mention") return item;
        const context = readTaskContext(item.metadata.context);
        return { ...item, metadata: { ...item.metadata, context: { ...context, contextFiles: [...(context.contextFiles ?? []), ...files.map(file => ({ path: file.sourcePath, type: "file" as const }))] } } };
    });
}

export function readTaskContext(input: unknown): AssistantMessageContext {
    const value = object(input ?? {}), result: Record<string, unknown> = {};
    for (const key of ["initialContext", "contextFiles", "contextIssues", "contextSignals", "contextSkills"] as const) {
        if (value[key] === undefined) continue;
        if (!Array.isArray(value[key]) || value[key].length > 100) throw new Error("Invalid assistant task context");
        result[key] = value[key];
    }
    return result as AssistantMessageContext;
}
