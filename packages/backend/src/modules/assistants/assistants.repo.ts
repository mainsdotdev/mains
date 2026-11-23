import { and, desc, eq, getTableColumns, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { assistantTeams, assistants, assistantWelcomes, assistantMemories, assistantAssignments, assistantMessages, runs, runContext, workspaces, projects } from "../../db/schema";
import type { Assistant, AssistantAssignment, AssistantMessageContext, AssistantProfile, AssistantPullRequestContext, AssistantPullRequestReview } from "@mains/contracts/assistants";
import { ASSISTANT_MENTION_MODES, normalizeAssistantAvatar } from "@mains/contracts/assistants";
import { ownedHere } from "../bridge/bridge.ownership";
function assistant(row: typeof assistants.$inferSelect): Assistant {
    const { settings, spaceSnapshot, mode: _mode, workspaceId: _workspace, avatar, ...rest } = row;
    return { ...rest, avatar: normalizeAssistantAvatar(JSON.parse(avatar)), conversationSettings: JSON.parse(settings), spaceSnapshot: JSON.parse(spaceSnapshot) };
}
const { context: _assignmentContext, ...assignmentFields } = getTableColumns(assistantAssignments);
const assignmentProjection = { ...assignmentFields, review: sql<string | null>`json_extract(${assistantAssignments.context}, '$.pullRequestReview')` };
const activeAssignment = sql`${assistantAssignments.status} NOT IN ('completed', 'failed', 'canceled')`;
type AssignmentRow = Omit<typeof assistantAssignments.$inferSelect, "context"> & { review: string | null };
type AssignmentContext = AssistantMessageContext & { pullRequestReview?: AssistantPullRequestContext };

function assignment(row: AssignmentRow): AssistantAssignment {
    const { dedupeKey: _dedupeKey, review, sourcePromptId: _sourcePrompt, sourceContextId: _sourceContext, execution, evidence, ...rest } = row;
    return { ...rest, execution: JSON.parse(execution), evidence: JSON.parse(evidence), ...(review && { pullRequestReview: JSON.parse(review) }) };
}

export const assistantsRepo = {
    activeAssistantIds(accountId: string) { return getDb().selectDistinct({ id: runs.assistantId }).from(runs).where(and(eq(runs.accountId, accountId), eq(runs.isArchived, false), isNotNull(runs.assistantId), or(eq(runs.status, "running"), eq(runs.status, "queued")))).limit(200).all().map(row => row.id!); },
    teams(accountId: string) { return getDb().select().from(assistantTeams).where(eq(assistantTeams.accountId, accountId)).orderBy(assistantTeams.createdAt).limit(100).all(); },
    team(id: string, accountId: string) { return getDb().select().from(assistantTeams).where(and(eq(assistantTeams.id, id), eq(assistantTeams.accountId, accountId))).get() ?? null; },
    createTeam(row: typeof assistantTeams.$inferInsert) { getDb().insert(assistantTeams).values(row).run(); },
    // Creation timestamps have second precision, so break ties by insertion order.
    list(accountId: string) { return getDb().select().from(assistants).where(eq(assistants.accountId, accountId)).orderBy(assistants.createdAt, sql`rowid ASC`).limit(200).all().map(assistant); },
    get(id: string, accountId: string) { const row = getDb().select().from(assistants).where(and(eq(assistants.id, id), eq(assistants.accountId, accountId))).get(); return row ? assistant(row) : null; },
    create(row: typeof assistants.$inferInsert) { getDb().insert(assistants).values(row).run(); },
    createWelcome(id: string, question?: string) {
        getDb().insert(assistantWelcomes).values({ assistantId: id, runId: `assistant-welcome-${id}`,
            ...(question ? { state: "ready", question } : {}) }).run();
    },
    saveProfile(id: string, accountId: string, profile: Partial<AssistantProfile>,
                execution?: Pick<Assistant, "model" | "effort" | "conversationSettings">) {
        const { avatar, ...fields } = profile;
        const modelFields = execution && { model: execution.model, effort: execution.effort, settings: JSON.stringify(execution.conversationSettings) };
        getDb().update(assistants).set({ ...fields, ...(avatar && { avatar: JSON.stringify(avatar) }), ...modelFields, updatedAt: new Date() })
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
    setPinned(id: string, accountId: string, pinnedAt: Date | null) {
        getDb().update(assistants).set({ pinnedAt }).where(and(eq(assistants.id, id), eq(assistants.accountId, accountId))).run();
    },
    deleteArchived(id: string, accountId: string): void {
        const db = getDb();
        db.transaction(() => {
            const received = and(eq(assistantAssignments.accountId, accountId), eq(assistantAssignments.toAssistantId, id));
            const receivedIds = db.select({ id: assistantAssignments.id }).from(assistantAssignments).where(received);
            db.update(assistantAssignments).set({ parentId: null }).where(and(
                eq(assistantAssignments.accountId, accountId), inArray(assistantAssignments.parentId, receivedIds),
            )).run();
            // The receiving Mate still owns the work assigned to it by this sender.
            db.update(assistantAssignments).set({ fromAssistantId: null, fromRunId: null, sourceContextId: null })
                .where(and(eq(assistantAssignments.accountId, accountId), eq(assistantAssignments.fromAssistantId, id))).run();
            db.delete(assistantAssignments).where(received).run();
            const removed = db.delete(assistants).where(and(eq(assistants.id, id), eq(assistants.accountId, accountId), eq(assistants.isArchived, true))).run();
            if (!removed.changes) throw new Error("Mate is no longer archived.");
        });
    },
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
            .where(and(isNull(assistantAssignments.id), eq(runs.isArchived, false), isNull(runs.assistantId), inArray(runs.mode, ASSISTANT_MENTION_MODES), sql`json_extract(${runContext.metadata}, '$.source') = 'assistant_mention'`,
                sql`EXISTS (SELECT 1 FROM assistants a WHERE a.id = json_extract(${runContext.metadata}, '$.assistantId') AND a.account_id = ${runs.accountId})`,
                sql`EXISTS (SELECT 1 FROM run_artifacts a WHERE a.run_id = ${runs.id} AND a.kind = 'user-prompt' AND a.content = json_extract(${runContext.metadata}, '$.sourcePrompt') AND (json_extract(a.metadata, '$.clientPromptId') = json_extract(${runContext.metadata}, '$.sourcePromptId') OR json_extract(a.metadata, '$.clientUserMessageId') = json_extract(${runContext.metadata}, '$.sourcePromptId')))`))
            .orderBy(runContext.id).limit(50).all();
    },
    assignmentsWithSource() { return getDb().select({ task: assignmentProjection }).from(assistantAssignments).innerJoin(runs, eq(runs.id, assistantAssignments.fromRunId)).where(and(eq(runs.isArchived, false), sql`NOT EXISTS (SELECT 1 FROM run_artifacts a WHERE a.run_id = ${assistantAssignments.fromRunId} AND json_extract(a.metadata, '$.source') = 'assistant_assignment' AND json_extract(a.metadata, '$.assignmentId') = ${assistantAssignments.id})`)).orderBy(assistantAssignments.createdAt, assistantAssignments.id).limit(200).all().map(row => assignment(row.task)); },
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
    assignments(accountId: string) { return getDb().select(assignmentProjection).from(assistantAssignments).where(eq(assistantAssignments.accountId, accountId)).orderBy(sql`CASE WHEN status IN ('completed', 'failed', 'canceled') THEN 1 ELSE 0 END`, desc(assistantAssignments.createdAt), assistantAssignments.id).limit(200).all().map(assignment); },
    assignmentsForMate(mate: Pick<Assistant, "id" | "accountId" | "teamId">, taskId?: string, offset = 0) {
        // Match canAccessAssistantAssignment before applying the page limit.
        const scope = and(eq(assistantAssignments.accountId, mate.accountId), or(
            and(isNull(assistantAssignments.teamId), eq(assistantAssignments.toAssistantId, mate.id)),
            mate.teamId ? eq(assistantAssignments.teamId, mate.teamId) : undefined,
        ));
        return getDb().select({ task: assignmentProjection, workerRunId: runs.id,
            activeCount: sql<number>`sum(CASE WHEN ${activeAssignment} THEN 1 ELSE 0 END) OVER ()`,
        }).from(assistantAssignments)
            .leftJoin(runs, and(eq(runs.id, assistantAssignments.workerRunId), eq(runs.accountId, mate.accountId),
                eq(runs.assistantId, assistantAssignments.toAssistantId), eq(runs.isArchived, false), ownedHere(runs.ownerBackendId)))
            .where(and(scope, taskId === undefined ? undefined : eq(assistantAssignments.id, taskId)))
            .orderBy(desc(activeAssignment), desc(assistantAssignments.createdAt), assistantAssignments.id)
            .limit(taskId === undefined ? 101 : 1).offset(offset).all()
            .map(row => ({ ...row, task: assignment(row.task) }));
    },
    pullRequestReviews(accountId: string, prKey: string, selectedId: string): AssistantPullRequestReview[] {
        const rows = getDb().select({ task: assignmentProjection, workerRunId: runs.id })
            .from(assistantAssignments)
            .leftJoin(runs, and(eq(runs.id, assistantAssignments.workerRunId), eq(runs.accountId, accountId), eq(runs.assistantId, assistantAssignments.toAssistantId), eq(runs.isArchived, false)))
            .where(and(eq(assistantAssignments.accountId, accountId), sql`json_extract(${assistantAssignments.context}, '$.pullRequestReview.key') = ${prKey}`))
            .orderBy(sql`CASE WHEN ${assistantAssignments.id} = ${selectedId} THEN 0 ELSE 1 END`, desc(assistantAssignments.createdAt), sql`${assistantAssignments}.rowid DESC`).limit(50).all();
        return rows.map(({ task, workerRunId }) => {
            const item = assignment(task);
            const { revision, truncated } = item.pullRequestReview!;
            return { revision, truncated, assignment: { ...item, workerRunId } };
        });
    },
    assignment(id: string) { const row = getDb().select(assignmentProjection).from(assistantAssignments).where(eq(assistantAssignments.id, id)).get(); return row ? assignment(row) : null; },
    byKey(accountId: string, key: string) { const row = getDb().select(assignmentProjection).from(assistantAssignments).where(and(eq(assistantAssignments.accountId, accountId), eq(assistantAssignments.dedupeKey, key))).get(); return row ? assignment(row) : null; },
    assignmentContext(id: string): AssistantMessageContext | undefined {
        const row = getDb().select({ context: assistantAssignments.context }).from(assistantAssignments).where(eq(assistantAssignments.id, id)).get();
        if (!row) return undefined;
        const { pullRequestReview: _review, ...context } = JSON.parse(row.context) as AssignmentContext;
        return context;
    },
    releasePullRequestReviewInputs(id: string) {
        // The worker now retains the originals as ordinary run attachments.
        getDb().update(assistantAssignments).set({ context: sql`json_remove(${assistantAssignments.context}, '$.attachments')` })
            .where(and(eq(assistantAssignments.id, id), sql`json_type(${assistantAssignments.context}, '$.pullRequestReview') = 'object'`)).run();
    },
    byWorker(runId: string) { const row = getDb().select(assignmentProjection).from(assistantAssignments).where(eq(assistantAssignments.workerRunId, runId)).get(); return row ? assignment(row) : null; },
    enqueue(row: typeof assistantAssignments.$inferInsert, message: typeof assistantMessages.$inferInsert) { getDb().transaction(() => { getDb().insert(assistantAssignments).values(row).run(); getDb().insert(assistantMessages).values(message).run(); }); },
    patchAssignment(id: string, patch: Partial<typeof assistantAssignments.$inferInsert>) { getDb().update(assistantAssignments).set({ ...patch, updatedAt: new Date() }).where(eq(assistantAssignments.id, id)).run(); },
    messages() { return getDb().select().from(assistantMessages).where(eq(assistantMessages.status, "queued")).orderBy(sql`rowid`).limit(100).all(); },
    message(id: string) { return getDb().select().from(assistantMessages).where(eq(assistantMessages.id, id)).get() ?? null; },
    assignmentMessages(id: string) { return getDb().select().from(assistantMessages).where(eq(assistantMessages.assignmentId, id)).orderBy(desc(assistantMessages.createdAt), sql`rowid DESC`).limit(50).all().reverse(); },
    unfinishedAssignments() { return getDb().select(assignmentProjection).from(assistantAssignments).where(or(eq(assistantAssignments.status, "running"), eq(assistantAssignments.status, "queued"))).limit(200).all().map(assignment); },
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
