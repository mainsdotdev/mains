import type { AssistantMessageContext } from "@mains/contracts/assistants";
import { CHANNELS } from "@mains/contracts/channels";
import { handle } from "../../ipc-kit/handle";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { assistantsService } from "./assistants.service";
import { assistantWelcome } from "./assistant-welcome";
import { assistantWork } from "./assistant-work";
import { object, onlyKeys, text } from "./assistants.validation";
import { emit } from "../../ipc-kit/event-bus";
import type { IpcInvokeContext } from "../../ipc-kit";
import { assistantsMobile } from "./assistants-mobile";

function handleWithContext<Args extends unknown[], T>(fn: (ctx: IpcInvokeContext, ...args: Args) => T | Promise<T>) {
    const invoke = handle(fn);
    return (ctx: IpcInvokeContext, ...args: Args) => invoke(ctx, ctx, ...args);
}

export function registerAssistantsIpc() {
    const changed = async <T>(action: () => T | Promise<T>) => { const result = await action(); emit(CHANNELS.assistants.changed, {}); return result; };
    ipcMain.handle(CHANNELS.assistants.mobileDirectory, handle(assistantsMobile.directory));
    ipcMain.handle(CHANNELS.assistants.mobileAssignment, handle(assistantsMobile.assignment));
    ipcMain.handle(CHANNELS.assistants.mobileMemory, handle(assistantsMobile.memory));
    ipcMain.handle(CHANNELS.assistants.mobileAssignments, handle(assistantsMobile.assignments));
    ipcMain.handle(CHANNELS.assistants.mobileRoutines, handle(assistantsMobile.routines));
    ipcMain.handle(CHANNELS.assistants.mobileManage, handle(async (accountId: string, mateId: string, change: unknown, requestId: string) => {
        await changed(() => assistantsMobile.manage(accountId, mateId, change, requestId));
        return { accepted: true };
    }));
    ipcMain.handle(CHANNELS.assistants.assignment, handle((accountId: string, id: string) => assistantsService.assignment(accountId, id)));
    ipcMain.handle(CHANNELS.assistants.overview, handle((accountId: string) => assistantsService.overview(accountId)));
    ipcMain.handle(CHANNELS.assistants.createTeam, handleWithContext((ctx, payload: unknown) => changed(async () => {
        if (ctx?.deviceId) await assistantsMobile.assertAccount(text(object(payload).accountId, "Account"));
        const team = assistantsService.createTeam(payload);
        return ctx?.deviceId ? { id: team.id, name: team.name } : team;
    })));
    ipcMain.handle(CHANNELS.assistants.changeTeam, handle((payload: unknown) => changed(() => assistantsService.changeTeam(payload))));
    ipcMain.handle(CHANNELS.assistants.updateProfile, handle((payload: unknown) => changed(() => assistantsService.updateProfile(payload, assistantWork.guard()))));
    ipcMain.handle(CHANNELS.assistants.setPinned, handle((payload: unknown) => changed(() => assistantsService.setPinned(payload))));
    ipcMain.handle(CHANNELS.assistants.create, handleWithContext((ctx, payload: unknown) => changed(async () => {
        if (ctx?.deviceId) await assistantsMobile.assertAccount(text(object(payload).accountId, "Account"));
        const assistant = await assistantsService.create(payload, assistantWork.guard());
        assistantWelcome.prepare(assistant.id);
        return ctx?.deviceId ? { id: assistant.id } : assistant;
    })));
    ipcMain.handle(CHANNELS.assistants.prepareWelcome, handleWithContext(async (ctx, accountId: string, id: string) => {
        if (ctx?.deviceId) await assistantsMobile.assertAccount(accountId);
        assistantWelcome.retry(accountId, id);
    }));
    ipcMain.handle(CHANNELS.assistants.setupProfile, handleWithContext(async (ctx, accountId: string, id: string, input: unknown) => {
        if (ctx?.deviceId) await assistantsMobile.assertAccount(accountId);
        assistantWelcome.setupProfile(accountId, id, input);
    }));
    ipcMain.handle(CHANNELS.assistants.respondWelcome, handleWithContext(async (ctx, accountId: string, id: string, answer: string | null, execution?: unknown) => {
        if (ctx?.deviceId) await assistantsMobile.assertAccount(accountId);
        return assistantWelcome.respond(accountId, id, answer, {}, ctx?.deviceId ? undefined : execution);
    }));
    ipcMain.handle(CHANNELS.assistants.archive, handle((accountId: string, id: string, archived: boolean) => changed(() => { assistantsService.archive(id, accountId, archived); if (!archived) assistantWelcome.prepare(id); })));
    ipcMain.handle(CHANNELS.assistants.remove, handle((accountId: string, id: string) => changed(() => assistantsService.remove(id, accountId))));
    ipcMain.handle(CHANNELS.assistants.saveMemory, handle((payload: unknown) => changed(() => assistantsService.saveMemory(payload))));
    ipcMain.handle(CHANNELS.assistants.removeMemory, handle((accountId: string, id: string, revision: number) => changed(() => assistantsService.removeMemory(accountId, id, revision))));
    ipcMain.handle(CHANNELS.assistants.conversations, handleWithContext((ctx, accountId: string, id: string) => {
        return ctx?.deviceId ? assistantsMobile.chats(accountId, id) : assistantsService.conversations(id, accountId, { includeArchivedMate: true });
    }));
    ipcMain.handle(CHANNELS.assistants.assign, handle((payload: unknown) => assistantWork.assign(payload, undefined, assistantWork.guard())));
    ipcMain.handle(CHANNELS.assistants.reviewPullRequest, handle((payload: unknown) => assistantWork.reviewPullRequest(payload)));
    ipcMain.handle(CHANNELS.assistants.pullRequestReviews, handle((accountId: string, ref: unknown, selectedId?: string) => assistantsService.pullRequestReviews(accountId, ref, selectedId)));
    ipcMain.handle(CHANNELS.assistants.reconcile, handle((accountId: string, id: string) => assistantWork.reconcile(accountId, id)));
    ipcMain.handle(CHANNELS.assistants.cancel, handle((accountId: string, id: string) => assistantWork.cancel(accountId, id)));
    ipcMain.handle(CHANNELS.assistants.followup, handle((accountId: string, id: string, messageId: string, message: string) => assistantWork.followup(accountId, id, messageId, message)));
    ipcMain.handle(CHANNELS.assistants.send, handleWithContext(async (ctx, payload: unknown) => {
        const value = object(payload);
        if (ctx?.deviceId) await assistantsMobile.assertAccount(text(value.accountId, "Account"));
        onlyKeys(value, ["accountId", "assistantId", "message", "requestId", "runId", "context", "execution"]);
        const context = value.context === undefined ? {} : object(value.context);
        onlyKeys(context, ["attachments", "initialContext", "contextIssues", "contextFiles", "contextSignals", "contextSkills"]);
        for (const [key, items] of Object.entries(context)) {
            if (items !== undefined && (!Array.isArray(items) || items.length > 100 || items.some(item => !item || typeof item !== "object" || Array.isArray(item)))) throw new Error(`Invalid assistant message ${key}`);
        }
        return assistantWork.sendChat(text(value.accountId, "Account"), text(value.assistantId, "Assistant"), text(value.message, "Message", 24000), text(value.requestId, "Message key"), text(value.runId, "Conversation", 200, true) || undefined, assistantWork.guard(), context as AssistantMessageContext, ctx?.deviceId ? undefined : value.execution);
    }));
}
export function unregisterAssistantsIpc() { Object.values(CHANNELS.assistants).forEach(channel => ipcMain.removeHandler(channel)); }
