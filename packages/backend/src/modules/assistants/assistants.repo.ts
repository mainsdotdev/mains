import { and, desc, eq, isNull, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { assistantTeams, assistants, assistantWelcomes, assistantMemories, assistantAssignments, assistantMessages, runs, runContext, workspaces, projects } from "../../db/schema";
import type { Assistant, AssistantAssignment } from "@mains/contracts/assistants";
import { normalizeAssistantAvatar } from "@mains/contracts/assistants";
function assistant(row: typeof assistants.$inferSelect): Assistant {
    const { settings, spaceSnapshot, mode: _mode, workspaceId: _workspace, avatar, ...rest } = row;
    return { ...rest, avatar: normalizeAssistantAvatar(JSON.parse(avatar)), conversationSettings: JSON.parse(settings), spaceSnapshot: JSON.parse(spaceSnapshot) };
}
function assignment(row: typeof assistantAssignments.$inferSelect): AssistantAssignment {
    const { dedupeKey: _dedupeKey, context: _context, sourcePromptId: _sourcePrompt, sourceContextId: _sourceContext, execution, ...rest } = row;
    return { ...rest, execution: JSON.parse(execution), evidence: JSON.parse(row.evidence) };
}
export const assistantsRepo = {
    activeAssistantIds(accountId: string) { return getDb().selectDistinct({ id: runs.assistantId }).from(runs).where(and(eq(runs.accountId, accountId), eq(runs.isArchived, false), isNotNull(runs.assistantId), or(eq(runs.status, "running"), eq(runs.status, "queued")))).limit(200).all().map(row => row.id!); },
    teams(accountId: string) { return getDb().select().from(assistantTeams).where(eq(assistantTeams.accountId, accountId)).orderBy(assistantTeams.createdAt).limit(100).all(); },
    team(id: string, accountId: string) { return getDb().select().from(assistantTeams).where(and(eq(assistantTeams.id, id), eq(assistantTeams.accountId, accountId))).get() ?? null; },
    createTeam(row: typeof assistantTeams.$inferInsert) { getDb().insert(assistantTeams).values(row).run(); },
    list(accountId: string) { return getDb().select().from(assistants).where(eq(assistants.accountId, accountId)).orderBy(assistants.createdAt).limit(200).all().map(assistant); },
    get(id: string, accountId: string) { const row = getDb().select().from(assistants).where(and(eq(assistants.id, id), eq(assistants.accountId, accountId))).get(); return row ? assistant(row) : null; },
    create(row: typeof assistants.$inferInsert) { getDb().insert(assistants).values(row).run(); },
    createWelcome(id: string, question?: string) {
        getDb().insert(assistantWelcomes).values({ assistantId: id, runId: `assistant-welcome-${id}`,
            ...(question ? { state: "ready", question } : {}) }).run();
    },
    saveProfile(id: string, accountId: string, description: string, instructions: string) {
        getDb().update(assistants).set({ description, instructions, updatedAt: new Date() })
            .where(and(eq(assistants.id, id), eq(assistants.accountId, accountId))).run();
    },
    welcomeOwner(id: string) { return getDb().select({ accountId: assistants.accountId, isArchived: assistants.isArchived }).from(assistants).where(eq(assistants.id, id)).get() ?? null; },
    welcome(id: string) { return getDb().select().from(assistantWelcomes).where(eq(assistantWelcomes.assistantId, id)).get() ?? null; },
    welcomes(accountId?: string) { return getDb().select({ welcome: assistantWelcomes }).from(assistantWelcomes).innerJoin(assistants, eq(assistants.id, assistantWelcomes.assistantId)).where(accountId ? eq(assistants.accountId, accountId) : undefined).all().map(row => row.welcome); },
    patchWelcome(id: string, patch: Partial<typeof assistantWelcomes.$inferInsert>) { getDb().update(assistantWelcomes).set({ ...patch, updatedAt: new Date() }).where(eq(assistantWelcomes.assistantId, id)).run(); },
    usesSpace(spaceId: string) { return !!getDb().select({ id: assistants.id }).from(assistants).where(eq(assistants.spaceId, spaceId)).limit(1).get(); },
    hasPendingRun(id: string) { return !!getDb().select({ id: runs.id }).from(runs).where(and(eq(runs.assistantId, id), or(eq(runs.status, "running"), eq(runs.status, "queued")))).limit(1).get(); },
    hasPendingTeamWork(id: string) {
        return !!getDb().select({ id: assistantAssignments.id }).from(assistantAssignments).where(and(
            or(eq(assistantAssignments.fromAssistantId, id), eq(assistantAssignments.toAssistantId, id)),
            or(sql`${assistantAssignments.status} NOT IN ('completed', 'failed', 'canceled')`,
                sql`EXISTS (SELECT 1 FROM assistant_messages m WHERE m.assignment_id = ${assistantAssignments.id} AND m.status IN ('queued', 'dispatching', 'uncertain'))`),
        )).limit(1).get();
    },
    changeTeam(id: string, accountId: string, teamId: string | null) {
        const updatedAt = new Date();
        getDb().update(assistants).set({ teamId, updatedAt }).where(and(eq(assistants.id, id), eq(assistants.accountId, accountId))).run();
        getDb().update(assistantMemories).set({ teamId, updatedAt, revision: sql`${assistantMemories.revision} + 1` })
            .where(and(eq(assistantMemories.assistantId, id), eq(assistantMemories.accountId, accountId))).run();
    },
    archive(id: string, archived: boolean) { getDb().update(assistants).set({ isArchived: archived, updatedAt: new Date() }).where(eq(assistants.id, id)).run(); },
    memories(accountId: string, assistant?: Pick<Assistant, "id" | "teamId">) {
        const scope = assistant && or(
            eq(assistantMemories.assistantId, assistant.id),
            assistant.teamId ? and(eq(assistantMemories.teamId, assistant.teamId), isNull(assistantMemories.assistantId)) : undefined,
        );
        return getDb().select().from(assistantMemories).where(and(eq(assistantMemories.accountId, accountId), scope))
            .orderBy(desc(assistantMemories.pinned), desc(assistantMemories.updatedAt), assistantMemories.id).limit(200).all();
    },
    memory(id: string) { return getDb().select().from(assistantMemories).where(eq(assistantMemories.id, id)).get() ?? null; },
    insertMemory(row: typeof assistantMemories.$inferInsert) { getDb().insert(assistantMemories).values(row).run(); },
    updateMemory(id: string, revision: number, patch: Pick<typeof assistantMemories.$inferInsert, "title" | "content" | "pinned" | "sourceRunId">) {
        return getDb().update(assistantMemories).set({ ...patch, revision: revision + 1, updatedAt: new Date() }).where(and(eq(assistantMemories.id, id), eq(assistantMemories.revision, revision))).run().changes === 1;
    },
    removeMemory(id: string, revision: number) { return getDb().delete(assistantMemories).where(and(eq(assistantMemories.id, id), eq(assistantMemories.revision, revision))).run().changes === 1; },
    pendingMentions() {
        return getDb().select({ contextId: runContext.id, runId: runs.id, accountId: runs.accountId, metadata: runContext.metadata }).from(runContext)
            .innerJoin(runs, eq(runs.id, runContext.runId)).leftJoin(assistantAssignments, or(eq(assistantAssignments.sourceContextId, runContext.id), and(eq(assistantAssignments.fromRunId, runs.id), sql`${assistantAssignments.taskKey} = 'mention:' || json_extract(${runContext.metadata}, '$.sourcePromptId') || ':' || json_extract(${runContext.metadata}, '$.requestId')`, sql`${assistantAssignments.toAssistantId} = json_extract(${runContext.metadata}, '$.assistantId')`)))
            .where(and(isNull(assistantAssignments.id), eq(runs.isArchived, false), eq(runs.mode, "developer"), sql`json_extract(${runContext.metadata}, '$.source') = 'assistant_mention'`,
                sql`EXISTS (SELECT 1 FROM run_artifacts a WHERE a.run_id = ${runs.id} AND a.kind = 'user-prompt' AND a.content = json_extract(${runContext.metadata}, '$.sourcePrompt') AND (json_extract(a.metadata, '$.clientPromptId') = json_extract(${runContext.metadata}, '$.sourcePromptId') OR json_extract(a.metadata, '$.clientUserMessageId') = json_extract(${runContext.metadata}, '$.sourcePromptId')))`))
            .orderBy(runContext.id).limit(50).all();
    },
    assignmentsWithSource() { return getDb().select({ task: assistantAssignments }).from(assistantAssignments).innerJoin(runs, eq(runs.id, assistantAssignments.fromRunId)).where(and(eq(runs.isArchived, false), sql`NOT EXISTS (SELECT 1 FROM run_artifacts a WHERE a.run_id = ${assistantAssignments.fromRunId} AND json_extract(a.metadata, '$.source') = 'assistant_assignment' AND json_extract(a.metadata, '$.assignmentId') = ${assistantAssignments.id})`)).orderBy(assistantAssignments.createdAt, assistantAssignments.id).limit(200).all().map(row => assignment(row.task)); },
    pendingRuns() { return getDb().select({ id: runs.id }).from(runs).where(and(sql `${runs.assistantId} IS NOT NULL`, eq(runs.status, "running"))).limit(200).all(); },
    conversations(id: string, accountId: string) {
        return getDb().select({
            id: runs.id, title: runs.title, goal: runs.goal, status: runs.status,
            mode: runs.mode, workspaceId: runs.workspaceId, workspaceName: workspaces.name, projectName: projects.name,
            createdAt: runs.createdAt, updatedAt: runs.updatedAt,
        }).from(runs)
            .leftJoin(workspaces, and(eq(workspaces.id, runs.workspaceId), eq(workspaces.accountId, accountId)))
            .leftJoin(projects, and(eq(projects.id, workspaces.projectId), eq(projects.accountId, accountId)))
            .where(and(eq(runs.assistantId, id), eq(runs.accountId, accountId), eq(runs.isArchived, false)))
            .orderBy(desc(runs.updatedAt), desc(runs.createdAt), desc(runs.id)).limit(100).all();
    },
    assignments(accountId: string) { return getDb().select().from(assistantAssignments).where(eq(assistantAssignments.accountId, accountId)).orderBy(sql`CASE WHEN status IN ('completed', 'failed', 'canceled') THEN 1 ELSE 0 END`, desc(assistantAssignments.createdAt), assistantAssignments.id).limit(200).all().map(assignment); },
    assignment(id: string) { const row = getDb().select().from(assistantAssignments).where(eq(assistantAssignments.id, id)).get(); return row ? assignment(row) : null; },
    byKey(accountId: string, key: string) { const row = getDb().select().from(assistantAssignments).where(and(eq(assistantAssignments.accountId, accountId), eq(assistantAssignments.dedupeKey, key))).get(); return row ? assignment(row) : null; },
    assignmentContext(id: string) { const row = getDb().select({ context: assistantAssignments.context, sourcePromptId: assistantAssignments.sourcePromptId }).from(assistantAssignments).where(eq(assistantAssignments.id, id)).get(); return row ? { context: JSON.parse(row.context), sourcePromptId: row.sourcePromptId } : null; },
    byWorker(runId: string) { const row = getDb().select().from(assistantAssignments).where(eq(assistantAssignments.workerRunId, runId)).get(); return row ? assignment(row) : null; },
    enqueue(row: typeof assistantAssignments.$inferInsert, message: typeof assistantMessages.$inferInsert) { getDb().transaction(() => { getDb().insert(assistantAssignments).values(row).run(); getDb().insert(assistantMessages).values(message).run(); }); },
    patchAssignment(id: string, patch: Partial<typeof assistantAssignments.$inferInsert>) { getDb().update(assistantAssignments).set({ ...patch, updatedAt: new Date() }).where(eq(assistantAssignments.id, id)).run(); },
    messages() { return getDb().select().from(assistantMessages).where(eq(assistantMessages.status, "queued")).orderBy(sql`rowid`).limit(100).all(); },
    message(id: string) { return getDb().select().from(assistantMessages).where(eq(assistantMessages.id, id)).get() ?? null; },
    assignmentMessages(id: string) { return getDb().select().from(assistantMessages).where(eq(assistantMessages.assignmentId, id)).orderBy(desc(assistantMessages.createdAt), sql`rowid DESC`).limit(50).all().reverse(); },
    unfinishedAssignments() { return getDb().select().from(assistantAssignments).where(or(eq(assistantAssignments.status, "running"), eq(assistantAssignments.status, "queued"))).limit(200).all().map(assignment); },
    hasUnconfirmedDelivery(runId: string) { return !!getDb().select({ id: assistantMessages.id }).from(assistantMessages).where(and(eq(assistantMessages.targetRunId, runId), or(eq(assistantMessages.status, "dispatching"), eq(assistantMessages.status, "uncertain")))).limit(1).get(); },
  unsettledMessages() { return getDb().select().from(assistantMessages).where(or(eq(assistantMessages.status, "dispatching"), eq(assistantMessages.status, "uncertain"))).limit(200).all(); },
    addMessage(row: typeof assistantMessages.$inferInsert) { getDb().insert(assistantMessages).values(row).onConflictDoNothing().run(); },
    patchMessage(id: string, patch: Partial<typeof assistantMessages.$inferInsert>) { getDb().update(assistantMessages).set({ ...patch, updatedAt: new Date() }).where(eq(assistantMessages.id, id)).run(); },
    claimMessage(id: string) { return getDb().update(assistantMessages).set({ status: "dispatching", updatedAt: new Date() }).where(and(eq(assistantMessages.id, id), eq(assistantMessages.status, "queued"))).run().changes === 1; },
    cancelMessages(assignmentId: string) { getDb().update(assistantMessages).set({ status: "canceled", updatedAt: new Date() }).where(and(eq(assistantMessages.assignmentId, assignmentId), eq(assistantMessages.status, "queued"))).run(); },
    transaction<T>(action: () => T): T { return getDb().transaction(action); },
    runAssistantId(runId: string) { return getDb().select({ assistantId: runs.assistantId, accountId: runs.accountId }).from(runs).where(eq(runs.id, runId)).get() ?? null; },
    contextCount(accountId: string) { return getDb().get<{
        n: number;
    }>(sql `SELECT count(*) AS n FROM assistant_memories WHERE account_id = ${accountId}`)?.n ?? 0; },
};
