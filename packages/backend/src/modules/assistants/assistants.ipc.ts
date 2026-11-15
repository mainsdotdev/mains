import type { AssistantMessageContext } from "@mains/contracts/assistants";
import { CHANNELS } from "@mains/contracts/channels";
import { handle } from "../../ipc-kit/handle";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { assistantsService } from "./assistants.service";
import { assistantWelcome } from "./assistant-welcome";
import { assistantWork } from "./assistant-work";
import { object, onlyKeys, text } from "./assistants.validation";
import { emit } from "../../ipc-kit/event-bus";
export function registerAssistantsIpc() {
    const changed = async <T>(action: () => T | Promise<T>) => { const result = await action(); emit(CHANNELS.assistants.changed, {}); return result; };
    ipcMain.handle(CHANNELS.assistants.assignment, handle((accountId: string, id: string) => assistantsService.assignment(accountId, id)));
    ipcMain.handle(CHANNELS.assistants.overview, handle((accountId: string) => assistantsService.overview(accountId)));
    ipcMain.handle(CHANNELS.assistants.createTeam, handle((payload: unknown) => changed(() => assistantsService.createTeam(payload))));
    ipcMain.handle(CHANNELS.assistants.create, handle((payload: unknown) => changed(async () => { const assistant = await assistantsService.create(payload, assistantWork.guard()); assistantWelcome.prepare(assistant.id); return assistant; })));
    ipcMain.handle(CHANNELS.assistants.prepareWelcome, handle((accountId: string, id: string) => assistantWelcome.retry(accountId, id)));
    ipcMain.handle(CHANNELS.assistants.respondWelcome, handle((accountId: string, id: string, answer: string | null) => assistantWelcome.respond(accountId, id, answer)));
    ipcMain.handle(CHANNELS.assistants.archive, handle((accountId: string, id: string, archived: boolean) => changed(() => { assistantsService.archive(id, accountId, archived); if (!archived) assistantWelcome.prepare(id); })));
    ipcMain.handle(CHANNELS.assistants.saveMemory, handle((payload: unknown) => changed(() => assistantsService.saveMemory(payload))));
    ipcMain.handle(CHANNELS.assistants.removeMemory, handle((accountId: string, id: string, revision: number) => changed(() => assistantsService.removeMemory(accountId, id, revision))));
    ipcMain.handle(CHANNELS.assistants.conversations, handle((accountId: string, id: string) => assistantsService.conversations(id, accountId)));
    ipcMain.handle(CHANNELS.assistants.assign, handle((payload: unknown) => assistantWork.assign(payload, undefined, assistantWork.guard())));
    ipcMain.handle(CHANNELS.assistants.reconcile, handle((accountId: string, id: string) => assistantWork.reconcile(accountId, id)));
    ipcMain.handle(CHANNELS.assistants.cancel, handle((accountId: string, id: string) => assistantWork.cancel(accountId, id)));
    ipcMain.handle(CHANNELS.assistants.followup, handle((accountId: string, id: string, messageId: string, message: string) => assistantWork.followup(accountId, id, messageId, message)));
    ipcMain.handle(CHANNELS.assistants.send, handle((payload: unknown) => {
        const value = object(payload);
        onlyKeys(value, ["accountId", "assistantId", "message", "requestId", "runId", "context", "execution"]);
        const context = value.context === undefined ? {} : object(value.context);
        onlyKeys(context, ["attachments", "initialContext", "contextIssues", "contextFiles", "contextSignals", "contextSkills"]);
        for (const [key, items] of Object.entries(context)) {
            if (items !== undefined && (!Array.isArray(items) || items.length > 100 || items.some(item => !item || typeof item !== "object" || Array.isArray(item)))) throw new Error(`Invalid assistant message ${key}`);
        }
        return assistantWork.sendChat(text(value.accountId, "Account"), text(value.assistantId, "Assistant"), text(value.message, "Message", 24000), text(value.requestId, "Message key"), text(value.runId, "Conversation", 200, true) || undefined, assistantWork.guard(), context as AssistantMessageContext, value.execution);
    }));
}
export function unregisterAssistantsIpc() { Object.values(CHANNELS.assistants).forEach(channel => ipcMain.removeHandler(channel)); }
