import type { AssistantTeamWork, AssistantTeamWorkItem } from "@mains/contracts/assistants";
import type { ApprovalKind } from "@mains/contracts/runs";
import { listPendingApprovals, runsService } from "../runs";
import { assistantsRepo } from "./assistants.repo";
import { text } from "./assistants.validation";

function assignmentStatus(
    task: ReturnType<typeof assistantsRepo.teamWorkAssignments>[number],
    runStatus: string | undefined,
    needsUser: boolean,
): AssistantTeamWorkItem["status"] {
    if (task.status === "canceled") return "canceled";
    if (needsUser) return "needs_you";
    if (task.status === "completed") return "completed";
    if (["failed", "uncertain", "blocked"].includes(task.status)) return "needs_attention";
    if (runStatus === "running") return "running";
    if (task.status === "queued" || task.hasQueuedInput || runStatus === "queued") return "queued";
    return task.hasPendingChild ? "waiting_for_teammate" : "needs_attention";
}

export async function readAssistantTeamWork(account: string, teamKey: string): Promise<AssistantTeamWork> {
    const accountId = text(account, "Account"), teamId = text(teamKey, "Team");
    const team = assistantsRepo.team(teamId, accountId);
    if (!team) throw new Error("Team is unavailable");

    const live = new Map((await runsService.listActiveRuns())
        .filter(run => run.accountId === accountId && run.assistantId)
        .map(run => [run.id, run.status]));
    const pending = new Map<string, Set<ApprovalKind>>();
    const now = Date.now();
    for (const { runId, kind, expiresAt } of listPendingApprovals()) {
        if (expiresAt <= now) continue;
        const kinds = pending.get(runId) ?? new Set<ApprovalKind>();
        kinds.add(kind);
        pending.set(runId, kinds);
    }

    const conversations = assistantsRepo.teamWorkConversations(accountId, teamId, [...new Set([...live.keys(), ...pending.keys()])]);
    const teamRunIds = new Set(conversations.map(run => run.id));
    const taskRunIds = new Set<string>();
    const items: AssistantTeamWorkItem[] = assistantsRepo.teamWorkAssignments(accountId, teamId).map(task => {
        const { id, assistantId, runId, title, pullRequestKey, updatedAt } = task;
        if (runId) taskRunIds.add(runId);
        const currentTeamRun = runId && teamRunIds.has(runId) ? runId : undefined;
        const pendingKinds = currentTeamRun && task.status !== "canceled" ? [...(pending.get(currentTeamRun) ?? [])] : [];
        const status = assignmentStatus(task, currentTeamRun ? live.get(currentTeamRun) : undefined, pendingKinds.length > 0);
        return { id, kind: "assignment", assistantId, runId, title, status, pendingKinds, pullRequestKey, updatedAt };
    });
    for (const { id, assistantId, title, updatedAt } of conversations) {
        if (taskRunIds.has(id)) continue;
        const pendingKinds = [...(pending.get(id) ?? [])];
        const status = pendingKinds.length ? "needs_you" : live.get(id) === "queued" ? "queued" : "running";
        items.push({ id, kind: "conversation", assistantId, runId: id, title: title || "Mate conversation", status, pendingKinds, pullRequestKey: null, updatedAt });
    }
    items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id));
    return { team: { id: team.id, name: team.name }, items };
}
