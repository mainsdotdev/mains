import { createHash } from "node:crypto";
import {
    canAccessAssistantAssignment, type Assistant, type AssistantMemory, type AssistantWelcomeQuestion,
    type MobileMateAssignment, type MobileMateChange, type MobileMateChat, type MobileMateDirectory,
    type MobileMateIdentity, type MobileMateMemory, type MobileMateRoutine, type MobileMateRoutines,
    type MobileMateSchedule, type MobileMateTask, type MobileMateTasks,
} from "@mains/contracts/assistants";
import { accountService } from "../account";
import { assertOwnedRecord } from "../bridge/bridge.ownership";
import { pulseService } from "../pulse/pulse.service";
import type { Pulse } from "../pulse/pulse.dto";
import { assistantWelcome } from "./assistant-welcome";
import { assistantWork } from "./assistant-work";
import { assistantsRepo } from "./assistants.repo";
import { assistantsService } from "./assistants.service";
import { object, onlyKeys, text } from "./assistants.validation";

async function assertAccount(accountId: string) {
    if ((await accountService.getAccount()).id !== accountId) throw new Error("Account is unavailable");
}

function mateIdentity({ id, name, avatar, isArchived }: MobileMateIdentity): MobileMateIdentity {
    return { id, name, avatar, isArchived };
}

async function ownedMate(accountId: string, mateId: string) {
    await assertAccount(accountId);
    const mate = assistantsService.get(mateId, accountId);
    if (!mate) throw new Error("Assistant is unavailable");
    return mate;
}

function ownMemory(mate: Assistant, id: string) {
    const note = assistantsRepo.memory(id);
    if (!note || note.accountId !== mate.accountId || (note.assistantId ? note.assistantId !== mate.id : !mate.teamId || mate.teamId !== note.teamId))
        throw new Error("Memory is unavailable for this Mate");
    return note;
}

function memoryNote({ id, title, content, pinned, revision, assistantId }: AssistantMemory, full: boolean): MobileMateMemory {
    return { id, title, content: full ? content : content.slice(0, 400), pinned, revision, shared: assistantId === null };
}

function ownRoutine(mate: Assistant, id: string) {
    const pulse = pulseService.getById(id);
    if (!pulse || pulse.accountId !== mate.accountId || pulse.assistantId !== mate.id) throw new Error("Routine is unavailable for this Mate");
    assertOwnedRecord("pulses", id);
    return pulse;
}

function routineRevision({ title, prompt, frequency, dayOfWeek, hour, minute, timezone }: Pulse) {
    return createHash("sha256").update(JSON.stringify([title, prompt, frequency, dayOfWeek, hour, minute, timezone])).digest("hex");
}

function mobileRoutine(pulse: Pulse, full: boolean): MobileMateRoutine {
    const { id, title, prompt, frequency, dayOfWeek, hour, minute, timezone, workspaceId, isActive,
        nextRunAt, lastRunId, lastAssignmentStatus, lastError } = pulse;
    return { id, title, prompt: full ? prompt : prompt.slice(0, 400), frequency, dayOfWeek, hour, minute, timezone, workspaceId,
        isActive, nextRunAt, lastRunId, lastAssignmentStatus: lastAssignmentStatus ?? null, lastError: lastError?.slice(0, 1000) ?? null,
        revision: routineRevision(pulse) };
}

function offset(selection: unknown): number {
    if (selection === undefined) return 0;
    if (typeof selection !== "number" || !Number.isSafeInteger(selection) || selection < 0) throw new Error("Choose a valid page");
    return selection;
}

function schedule(input: unknown): MobileMateSchedule {
    const value = object(input);
    onlyKeys(value, ["title", "prompt", "frequency", "dayOfWeek", "hour", "minute", "timezone"]);
    const { frequency, dayOfWeek, hour, minute } = value;
    if (frequency !== "hourly" && frequency !== "daily" && frequency !== "weekdays" && frequency !== "weekly")
        throw new Error("Choose a routine frequency");
    if (typeof hour !== "number" || typeof minute !== "number" || !Number.isInteger(hour) || !Number.isInteger(minute) ||
        (frequency === "weekly" ? typeof dayOfWeek !== "number" || !Number.isInteger(dayOfWeek) : dayOfWeek !== null))
        throw new Error("Choose a valid routine time");
    return { title: text(value.title, "Routine name"), prompt: text(value.prompt, "Routine task", 24000),
        frequency, dayOfWeek: typeof dayOfWeek === "number" ? dayOfWeek : null, hour, minute, timezone: text(value.timezone, "Timezone", 100) };
}

function revision(value: unknown, allowNew = false) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (allowNew ? 0 : 1)) throw new Error("Invalid memory revision");
    return value;
}

export const assistantsMobile = {
    assertAccount,
    async directory(accountId: string, selectedId?: string | null, archived = false): Promise<MobileMateDirectory> {
        await assertAccount(accountId);
        if (typeof archived !== "boolean") throw new Error("Choose a valid Mate directory");
        const selected = selectedId == null ? null : assistantsService.get(text(selectedId, "Mate"), accountId);
        if (selectedId != null && !selected) throw new Error("Assistant is unavailable");
        const profiles = selected ? [selected] : assistantsRepo.list(accountId).filter(mate => mate.isArchived === archived);
        const welcomes = new Map(assistantsRepo.welcomes(accountId).filter(row => row.state !== "started").map(row => [row.assistantId, row]));
        return {
            teams: assistantsRepo.teams(accountId).map(({ id, name }) => ({ id, name })),
            mates: profiles.map(profile => {
                const { id, description, teamId, providerId, model, spaceSnapshot, effort, instructions, isArchived, pinnedAt } = profile;
                const row = isArchived ? undefined : welcomes.get(id);
                const question = row?.question ? JSON.parse(row.question) as AssistantWelcomeQuestion : null;
                const needsSetup = !!question?.profileSetup && !question.profileSetup.saved;
                const welcome = row && selected ? { runId: row.runId, state: row.state, question, error: row.error } : null;
                const mate = { ...mateIdentity(profile), description, teamId, providerId, model, pinnedAt, needsSetup, welcome };
                if (!selected || (isArchived && !archived)) return mate;
                return { ...mate, details: { spaceName: spaceSnapshot.name, effort, instructions } };
            }),
        };
    },
    async chats(accountId: string, mateId: string): Promise<MobileMateChat[]> {
        await assertAccount(accountId);
        return assistantsService.conversations(mateId, accountId, { includeArchivedMate: true }).map(({ id, title, goal, updatedAt }) => {
            const label = title?.trim() || goal?.split("\n", 1)[0].trim();
            return { id, title: label ? Array.from(label).slice(0, 240).join("") : null, updatedAt };
        });
    },
    async assignment(accountId: string, runId: string, id: string): Promise<MobileMateAssignment> {
        await assertAccount(accountId);
        const task = assistantsRepo.assignment(text(id, "Assignment"));
        const source = text(runId, "Conversation");
        if (!task || task.accountId !== accountId || (task.fromRunId !== source && task.workerRunId !== source))
            throw new Error("Assignment is unavailable in this conversation");
        const { runsService } = await import("../runs");
        const run = await runsService.getRunById(source);
        if (run?.accountId !== accountId || run.isArchived || run.isReplica) throw new Error("Conversation is unavailable");
        const worker = task.workerRunId ? await runsService.getRunById(task.workerRunId) : null;
        const assignee = assistantsService.get(task.toAssistantId, accountId);
        return {
            id: task.id, title: task.title === "Assistant request" ? "Mate request" : task.title, status: task.status,
            result: task.result, error: task.error,
            assignee: assignee ? mateIdentity(assignee) : null,
            workerRunId: worker && worker.accountId === accountId && worker.assistantId === task.toAssistantId && !worker.isArchived && !worker.isReplica ? worker.id : null,
        };
    },
    async memory(accountId: string, mateId: string, id?: string): Promise<MobileMateMemory[] | MobileMateMemory> {
        const mate = await ownedMate(accountId, mateId);
        if (id !== undefined) return memoryNote(ownMemory(mate, text(id, "Memory")), true);
        return assistantsRepo.memories(accountId, mate).map(note => memoryNote(note, false));
    },
    async assignments(accountId: string, mateId: string, selection?: string | number): Promise<MobileMateTasks | MobileMateTask> {
        const mate = await ownedMate(accountId, mateId);
        const full = typeof selection === "string";
        const rows = assistantsRepo.assignmentsForMate(mate, full ? text(selection, "Assignment") : undefined, full ? 0 : offset(selection));
        const items = rows.slice(0, 100).map(({ task, workerRunId }) => {
            const { id, title, taskKey, status, result, prompt, error, evidence, toAssistantId, pullRequestReview } = task;
            const assignee = toAssistantId === mate.id ? mate : assistantsService.get(toAssistantId, accountId);
            const brief = pullRequestReview ? pullRequestReview.focus ?? "" : prompt;
            return { id, title: title === "Assistant request" && taskKey.startsWith("mention:") ? "Mate request" : title, status, workerRunId,
                assignee: assignee ? mateIdentity(assignee) : null, brief: full ? brief : brief.slice(0, 400),
                result: full ? result : result?.slice(0, 400) ?? null, error: error?.slice(0, 2000) ?? null, evidence: full ? evidence : [] };
        });
        if (!full) return { items, activeCount: rows[0]?.activeCount ?? 0, hasMore: rows.length > 100 };
        if (!items[0]) throw new Error("Assignment is unavailable for this Mate");
        return items[0];
    },
    async routines(accountId: string, mateId: string, selection?: string | number): Promise<MobileMateRoutines | MobileMateRoutine> {
        const mate = await ownedMate(accountId, mateId);
        if (typeof selection === "string") return mobileRoutine(ownRoutine(mate, text(selection, "Routine")), true);
        const start = offset(selection);
        const routines = pulseService.forAssistant(accountId, mate.id, start, { includeArchivedMate: true });
        return { items: routines.slice(0, 100).map(pulse => mobileRoutine(pulse, false)), nextOffset: routines.length > 100 ? start + 100 : null };
    },
    async manage(accountId: string, mateId: string, change: unknown, requestId: string): Promise<void> {
        const mate = await ownedMate(accountId, mateId);
        const value = object(change);
        const action = value.action as MobileMateChange["action"];
        const key = text(requestId, "Mate change key", 100);
        if (action === "archive") {
            onlyKeys(value, ["action", "archived"]);
            if (typeof value.archived !== "boolean") throw new Error("Choose an archive state");
            assistantsService.archive(mate.id, accountId, value.archived);
            if (!value.archived) assistantWelcome.prepare(mate.id);
            return;
        }
        if (action === "setPinned") {
            onlyKeys(value, ["action", "pinned"]);
            assistantsService.setPinned({ accountId, id: mate.id, pinned: value.pinned });
            return;
        }
        assistantsService.requireForWork(mate.id, accountId);
        switch (action) {
            case "updateProfile": {
                onlyKeys(value, ["action", "profile", "expectedProfile", "teamChange", "modelChange"]);
                const { action: _action, ...profile } = value;
                await assistantsService.updateProfile({ ...profile, accountId, id: mate.id }, assistantWork.guard());
                return;
            }
            case "saveMemory": {
                onlyKeys(value, ["action", "note", "expectedTeamId"]);
                const note = object(value.note);
                onlyKeys(note, ["id", "title", "content", "shared", "pinned", "revision"]);
                if (mate.teamId !== value.expectedTeamId) throw new Error("This Mate’s team changed. Reopen the note to review it.");
                if (typeof note.shared !== "boolean" || typeof note.pinned !== "boolean") throw new Error("Invalid memory settings");
                const id = text(note.id, "Memory"), expected = revision(note.revision, true);
                if (expected > 0) ownMemory(mate, id);
                assistantsService.saveMemory({ accountId, id, teamId: mate.teamId, assistantId: note.shared ? null : mate.id,
                    title: note.title, content: note.content, pinned: note.pinned, ...(expected > 0 && { expectedRevision: expected }) });
                return;
            }
            case "deleteMemory": {
                onlyKeys(value, ["action", "id", "revision"]);
                const id = text(value.id, "Memory");
                ownMemory(mate, id);
                assistantsService.removeMemory(accountId, id, revision(value.revision));
                return;
            }
            case "assign":
                onlyKeys(value, ["action", "title", "prompt"]);
                await assistantWork.assign({ accountId, toAssistantId: mate.id, taskKey: key, title: value.title, prompt: value.prompt }, undefined, assistantWork.guard());
                return;
            case "cancelTask":
            case "checkTask":
            case "followup": {
                onlyKeys(value, action === "followup" ? ["action", "id", "message"] : ["action", "id"]);
                const task = assistantsRepo.assignment(text(value.id, "Assignment"));
                if (!task || !canAccessAssistantAssignment(mate, task)) throw new Error("Assignment is unavailable for this Mate");
                if (action === "cancelTask") await assistantWork.cancel(accountId, task.id);
                else if (action === "checkTask") await assistantWork.reconcile(accountId, task.id);
                else await assistantWork.followup(accountId, task.id, key, text(value.message, "Message", 24000));
                return;
            }
            case "createRoutine": {
                onlyKeys(value, ["action", "schedule", "workspaceId"]);
                const workspaceId = value.workspaceId === null ? null : text(value.workspaceId, "Workspace");
                pulseService.createRoutine(accountId, mate.id, { ...schedule(value.schedule), workspaceId, mode: workspaceId ? "developer" : "work" }, `mobile:${key}`);
                return;
            }
            case "updateRoutine": {
                onlyKeys(value, ["action", "id", "schedule", "revision"]);
                const routine = ownRoutine(mate, text(value.id, "Routine"));
                if (routineRevision(routine) !== value.revision) throw new Error("This routine changed. Reopen it to review the latest schedule.");
                pulseService.update(routine.id, schedule(value.schedule));
                return;
            }
            case "toggleRoutine": {
                onlyKeys(value, ["action", "id", "isActive"]);
                const routine = ownRoutine(mate, text(value.id, "Routine"));
                if (typeof value.isActive !== "boolean") throw new Error("Choose a routine state");
                if (routine.isActive !== value.isActive) pulseService.toggle(routine.id, value.isActive);
                return;
            }
            case "deleteRoutine":
            case "runRoutine": {
                onlyKeys(value, ["action", "id"]);
                const routine = ownRoutine(mate, text(value.id, "Routine"));
                if (action === "deleteRoutine") pulseService.delete(routine.id);
                else if (!await pulseService.runNow(routine.id)) throw new Error("Routine changed before dispatch");
                return;
            }
            default: throw new Error("Unknown Mate change");
        }
    },
};
