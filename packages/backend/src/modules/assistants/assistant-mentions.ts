import type { AssistantMessageContext } from "@mains/contracts/assistants";
import type { StartRunContextItem } from "../runs/runs.dto";
import { assistantsService } from "./assistants.service";
import { object, text } from "./assistants.validation";

/** A durable user selection; only its own accepted prompt may dispatch it. */
export function prepareAssistantMentions(args: { accountId: string; mode: string; prompt: string; promptId?: string; fallbackPromptId?: string; context: AssistantMessageContext }): { promptId?: string; items: StartRunContextItem[] | undefined } {
    const items = args.context.initialContext ?? [];
    const selected = items.filter(item => item.metadata?.source === "assistant_mention");
    if (!selected.length) return { promptId: args.promptId, items: args.context.initialContext };
    if (args.mode !== "developer") throw new Error("Call assistants from a Code conversation");
    if (selected.length > 4) throw new Error("Call up to four assistants in one message");
    const mentions = selected.map(item => {
        const assistant = assistantsService.require(text(item.metadata?.assistantId, "Assistant"), args.accountId);
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
        return { kind: "note", ref: assistant.name, content: `The user selected @${assistant.name} for this message. Mains will schedule their task after this input is accepted. Do not create a duplicate assignment for this mention; its result will return here.`,
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
