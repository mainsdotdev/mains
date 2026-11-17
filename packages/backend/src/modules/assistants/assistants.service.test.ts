import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createProject, createProvider, createSpace, createRun, createWorkspace } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";
import { spaces, providers, appSettings, assistants as assistantProfiles, runs, pulses } from "../../db/schema";
let db: DatabaseInstance;
vi.mock("../../db/client", () => ({ getDb: () => db }));
vi.mock("../providers/adapters", async () => ({
    createWorkAdapter: vi.fn(), couldModifyFiles: () => false,
    emitUserPromptArtifact: (await import("../providers/adapters/adapter.shared")).emitUserPromptArtifact,
}));
import { assistantsService } from "./assistants.service";
import { assistantsRepo } from "./assistants.repo";
import { assistantWelcome } from "./assistant-welcome";
import { assistantWork } from "./assistant-work";
import { providersService } from "../providers";
import { runsService, listPendingApprovals, handleToolApprovalResponse } from "../runs";
import { clearAllPendingRequests } from "../runs/user-input-broker";
import { insertRunInputArtifact } from "../runs/run-input-artifact";
import { createWorkAdapter } from "../providers/adapters";
import { createFakeDriver } from "../providers/adapters/fake.driver";
import { createWorkRunAdapter } from "../providers/adapters/work-run-core";
import { auditBridgeSchema } from "../bridge/bridge.records";
import type { Assistant, AssistantAssignment } from "@mains/contracts/assistants";
import { createCodexRequestBroker } from "../providers/adapters/codex/codex-request-broker";
import { pulseService } from "../pulse";
import { dispatchMainsTool, toClaudeTools } from "../providers/adapters/mains-tools.registry";
let cleanup: () => void, restore: () => void, root: string;
let driver: ReturnType<typeof createFakeDriver>;
let teamId: string;
async function makeAssistant(name: string, providerId: "codex" | "claude_code" = "codex") {
    return assistantsService.create({ accountId: "default", teamId, name, description: `${name} responsibility`, instructions: `Own ${name}.`, spaceId: providerId, model: "test-model", effort: "high" });
}
function makeIndependentAssistant(name: string) {
    return assistantsService.create({ accountId: "default", name, instructions: `Own ${name}.`, spaceId: "codex", model: "test-model", effort: "high" });
}
async function settled(runId: string) {
    await vi.waitFor(async () => expect((await runsService.getRunById(runId))?.status).toBe("succeeded"));
}
function workspace(id: string, accountId = "default") {
    const rootPath = join(root, id); mkdirSync(rootPath, { recursive: true });
    return createWorkspace(db, { id, accountId, rootPath });
}
beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    root = mkdtempSync(join(tmpdir(), "mains-assistants-"));
    restore = installTestBackendRuntime({ getPath: name => join(root, name) });
    createAccount(db);
    for (const id of ["codex", "claude_code"] as const) {
        createProvider(db, { id, isEnabled: true, config: JSON.stringify({ defaultModel: "provider-default", permissionMode: "default" }) });
        createSpace(db, { id, providerId: id, mode: "work", systemPrompt: "Original Space instructions" });
    }
    vi.spyOn(providersService, "getModels").mockResolvedValue([{ id: "test-model", displayName: "Test model", supportedEffortLevels: ["low", "high"] }]);
    driver = createFakeDriver();
    driver.enable("resumeSession");
    driver.enable("forkSession");
    driver.enable("canResumeSession");
    const resume = driver.driver.resumeSession!;
    driver.driver.resumeSession = async (request) => {
        const acquired = await resume(request);
        if (request.clientUserMessageId) {
            await insertRunInputArtifact(request.runId, { type: "artifact", kind: "user-prompt", content: request.message, metadata: { clientUserMessageId: request.clientUserMessageId } });
            await request.onInputAccepted?.(`accepted-${request.clientUserMessageId}`);
        }
        return acquired;
    };
    // Native Claude/Codex acknowledge and persist queued input themselves.
    driver.driver.steerRun = async () => ({ turnId: "fake-steer" });
    vi.mocked(createWorkAdapter).mockReturnValue(createWorkRunAdapter(driver.driver));
    teamId = assistantsService.createTeam({ accountId: "default", name: "Release team" }).id;
});
afterEach(async () => {
    clearAllPendingRequests();
    await pulseService.stop();
    await assistantWork.stop();
    restore();
    cleanup();
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe("blocking assistant questions", () => {
    const input = { question: "Where and when would you like to travel?", header: "Trip details" };
    const conversation = async (assistant: Assistant) => {
        const { runId } = await assistantWork.sendChat("default", assistant.id, "Plan a trip", `question-${randomUUID()}`);
        await vi.waitFor(() => expect(driver.calls.executePrompt.some(call => (call.session as { id: string }).id === runId)).toBe(true));
        return { id: runId };
    };
    beforeEach(() => { driver.script({ awaitAbort: true }); assistantWork.start(); });
    afterEach(async () => {
        clearAllPendingRequests();
        await Promise.all((await runsService.listActiveRuns()).map(run => runsService.abortRun(run.id)));
        await vi.waitFor(async () => expect(await runsService.listActiveRuns()).toEqual([]));
    });

    it.each(["codex", "claude_code"] as const)("waits for an actual answer through the %s tool seam", async providerId => {
        const assistant = await makeAssistant("Gezici", providerId), source = await conversation(assistant);
        const ctx = { runId: source.id, workspaceId: null, rootPath: null };
        const responded = vi.fn(), respondToRequestError = vi.fn();
        let result: Promise<unknown>;
        if (providerId === "codex") {
            const broker = createCodexRequestBroker({ getRunState: () => ({ mode: "work", assistantId: assistant.id, fileChangeItems: new Map() }), getMainsToolContext: () => ctx });
            result = broker.handleRequest({ runId: source.id, runIsDead: false, id: 42, method: "item/tool/call", params: {
                tool: "AskAssistantQuestion", arguments: JSON.stringify(input),
            }, server: { respondToRequest: responded, respondToRequestError } }).then(() => {
                expect(respondToRequestError).not.toHaveBeenCalled();
                expect(responded).toHaveBeenCalledWith(42, expect.objectContaining({ success: true }));
                return JSON.parse(responded.mock.calls[0][1].contentItems[0].text);
            });
        } else {
            const tool = toClaudeTools(ctx, "work", true).find(tool => tool.name === "AskAssistantQuestion")!;
            result = tool.handler(input).then(reply => JSON.parse(reply.content[0].text));
        }
        const finished = vi.fn();
        void result.then(finished, finished);
        await vi.waitFor(() => expect(listPendingApprovals(source.id)).toHaveLength(1));
        const request = listPendingApprovals(source.id)[0];
        expect(request).toMatchObject({ runId: source.id, kind: "ask_user", toolName: "AskAssistantQuestion", question: input.question, isOther: true });
        expect(finished).not.toHaveBeenCalled();
        expect(responded).not.toHaveBeenCalled();
        const answer = "İstanbul → Tokyo, yılbaşı haftası\n2 kişi, toplam 1.000 €";
        handleToolApprovalResponse({ requestId: request.requestId, approvalToken: request.approvalToken, approved: true, answer });
        await expect(result).resolves.toEqual({ status: "answered", question: input.question, answer });
        expect(listPendingApprovals(source.id)).toEqual([]);
        expect(assistantsService.context(assistant.id, "default", "trip")).toContain("use AskAssistantQuestion and wait for its result");
    });

    it("returns a selected option and keeps questions in other runs pending when one is stopped", async () => {
        const assistant = await makeAssistant("Gezici"), first = await conversation(assistant), second = await conversation(assistant);
        const ask = (runId: string) => assistantWork.tool(runId, "AskAssistantQuestion", { ...input, options: [{ label: "Tokyo", description: "A week in Japan" }, { label: "Paris" }] });
        const canceled = ask(first.id), answered = ask(second.id);
        await vi.waitFor(() => expect(listPendingApprovals().filter(request => [first.id, second.id].includes(request.runId))).toHaveLength(2));
        await runsService.abortRun(first.id);
        await expect(canceled).resolves.toMatchObject({ status: "canceled", message: expect.stringContaining("Do not assume an answer") });
        const remaining = listPendingApprovals(second.id)[0];
        expect(remaining.options).toEqual([{ label: "Tokyo", description: "A week in Japan" }, { label: "Paris" }]);
        handleToolApprovalResponse({ requestId: remaining.requestId, approvalToken: remaining.approvalToken, approved: true, answer: "Tokyo" });
        await expect(answered).resolves.toMatchObject({ status: "answered", answer: "Tokyo" });
    });

    it.each([{ approved: false }, { approved: true }, { approved: true, answer: "  " }])("never substitutes a default answer after %j", async response => {
        const assistant = await makeAssistant("Gezici"), source = await conversation(assistant);
        const result = assistantWork.tool(source.id, "AskAssistantQuestion", { ...input, options: [{ label: "Tokyo" }, { label: "Paris" }] });
        await vi.waitFor(() => expect(listPendingApprovals(source.id)).toHaveLength(1));
        const request = listPendingApprovals(source.id)[0];
        handleToolApprovalResponse({ ...response, requestId: request.requestId, approvalToken: request.approvalToken });
        const reply = await result;
        expect(reply).toMatchObject({ status: "canceled", question: input.question });
        expect(reply).not.toHaveProperty("answer");
    });

    it("returns an unanswered outcome at the broker deadline without inventing an answer", async () => {
        const assistant = await makeAssistant("Gezici"), source = await conversation(assistant);
        vi.useFakeTimers();
        try {
            const result = assistantWork.tool(source.id, "AskAssistantQuestion", input);
            await vi.waitFor(() => expect(listPendingApprovals(source.id)).toHaveLength(1));
            const finished = vi.fn();
            void result.then(finished, finished);
            await vi.advanceTimersByTimeAsync(299_000);
            expect(finished).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1000);
            const reply = await result;
            expect(reply).toMatchObject({ status: "canceled", message: expect.stringContaining("expired") });
            expect(reply).not.toHaveProperty("answer");
            expect(listPendingApprovals(source.id)).toEqual([]);
        } finally { vi.useRealTimers(); }
    });

    it("rejects malformed choices, missing questions and unavailable conversations before opening a form", async () => {
        const assistant = await makeAssistant("Gezici"), source = await conversation(assistant);
        for (const invalid of [{ question: "  " }, { ...input, options: [] }, { ...input, options: [{ label: "Tokyo" }, { label: "Tokyo" }] }, { ...input, options: [{ label: "" }, { label: "Paris" }] }]) {
            await expect(dispatchMainsTool("AskAssistantQuestion", invalid, { runId: source.id, workspaceId: null, rootPath: null })).rejects.toThrow();
        }
        for (const overrides of [{ assistantId: null }, { isArchived: true }, { ownerBackendId: "another-backend" }, { mode: "chat" as const }, { status: "succeeded" as const }]) {
            const unavailable = createRun(db, { assistantId: assistant.id, providerId: "codex", mode: "work", status: "succeeded", ...overrides });
            await expect(assistantWork.tool(unavailable.id, "AskAssistantQuestion", input)).rejects.toThrow();
        }
        expect(listPendingApprovals(source.id)).toEqual([]);
    });
});

describe("scheduled assistant routines", () => {
    beforeEach(() => pulseService.start());
    const routine = (assistant: Assistant, input: Record<string, unknown> = {}) => pulseService.createRoutine("default", assistant.id, {
        title: "Morning release check", prompt: "Check the release and report findings with evidence.",
        frequency: "daily", hour: 9, minute: 0, timezone: "Europe/Istanbul", ...input,
    });

    it("creates a scheduled assignment through the assistant's frozen profile and exposes its chat and report", async () => {
        const assistant = await makeAssistant("Release");
        const pulse = routine(assistant, { providerId: "claude_code", model: "ignored-model" });
        expect(pulse).toMatchObject({ assistantId: assistant.id, mode: "work", workspaceId: null, providerId: "codex", model: "test-model", effortLevel: "high" });
        const due = new Date(Date.now() - 60_000);
        db.update(pulses).set({ nextRunAt: due }).where(eq(pulses.id, pulse.id)).run();
        assistantWork.start();
        await Promise.all([pulseService.tick(), pulseService.tick()]);
        const fired = pulseService.getById(pulse.id)!;
        expect(fired.lastAssignmentId).toBeTruthy();
        const task = assistantsRepo.assignment(fired.lastAssignmentId!)!;
        await settled(task.workerRunId!);
        expect(driver.calls.createSession.filter(call => call.runId === task.workerRunId)).toHaveLength(1);
        expect(driver.calls.createSession.find(call => call.runId === task.workerRunId)).toMatchObject({ mode: "work", model: "test-model", configSnapshot: { modelReasoningEffort: "high", assistantId: assistant.id } });
        await assistantWork.tool(task.workerRunId!, "ReportAssistantTask", { assignmentId: task.id, status: "completed", result: "Release checked", evidence: ["release-check.log"] });
        expect(pulseService.getById(pulse.id)).toMatchObject({ lastRunId: task.workerRunId, lastAssignmentStatus: "completed" });
        expect(assistantsService.conversations(assistant.id, "default").some(chat => chat.id === task.workerRunId)).toBe(true);
        await pulseService.stop(); pulseService.start(); await pulseService.tick();
        expect(assistantsRepo.assignments("default").filter(item => item.toAssistantId === assistant.id)).toHaveLength(1);
    });

    it("keeps Run now distinct from the next scheduled occurrence and prevents accumulating open tasks", async () => {
        const assistant = await makeAssistant("Release"), pulse = routine(assistant);
        const first = await pulseService.runNow(pulse.id);
        const task = assistantsRepo.assignment(first!.lastAssignmentId!)!;
        await expect(pulseService.runNow(pulse.id)).rejects.toThrow("previous routine task is still open");
        expect(assistantsRepo.assignments("default")).toHaveLength(1);
        assistantWork.start();
        await settled(task.workerRunId!);
        await assistantWork.tool(task.workerRunId!, "ReportAssistantTask", { assignmentId: task.id, status: "completed", result: "Done", evidence: ["routine-check.log"] });
        // Simulate firing the original schedule slot after an earlier manual run.
        db.update(pulses).set({ nextRunAt: pulse.nextRunAt }).where(eq(pulses.id, pulse.id)).run();
        const second = await pulseService.executePulse(pulse.id);
        expect(second?.lastAssignmentId).not.toBe(task.id);
        expect(assistantsRepo.assignments("default")).toHaveLength(2);
        await settled(assistantsRepo.assignment(second!.lastAssignmentId!)!.workerRunId!);
    });

    it("runs a repository routine as Developer while keeping its conversation under the assistant", async () => {
        const assistant = await makeAssistant("Release"), repo = workspace("routine-code");
        const pulse = routine(assistant, { mode: "developer", workspaceId: repo.id });
        assistantWork.start();
        const fired = await pulseService.runNow(pulse.id);
        const task = assistantsRepo.assignment(fired!.lastAssignmentId!)!;
        await settled(task.workerRunId!);
        expect(driver.calls.createSession.find(call => call.runId === task.workerRunId)).toMatchObject({ mode: "developer", execution: { workspaceId: repo.id, cwd: repo.rootPath } });
        expect(await runsService.getRunsByWorkspace(repo.id)).toEqual([]);
        expect(assistantsService.conversations(assistant.id, "default").some(chat => chat.id === task.workerRunId)).toBe(true);
    });

    it("validates ownership, profile edits, schedule settings and immutable assistant identity", async () => {
        const assistant = await makeAssistant("Release"), pulse = routine(assistant);
        const foreign = workspace("foreign-routine", "other-account");
        expect(() => routine(assistant, { mode: "developer", workspaceId: foreign.id })).toThrow("Workspace is unavailable");
        expect(() => routine(assistant, { timezone: "Mars/Olympus" })).toThrow("valid routine timezone");
        expect(() => routine(assistant, { hour: 9.5 })).toThrow("valid routine time");
        expect(() => pulseService.create("other-account", { ...pulse, assistantId: assistant.id })).toThrow("unavailable");
        expect(() => pulseService.update(pulse.id, { model: "another-model" })).toThrow("fixed profile");
        expect(() => pulseService.update(pulse.id, { assistantId: "other" } as never)).toThrow("original assistant");
        expect(() => pulseService.update(pulse.id, { lastAssignmentId: "forged" } as never)).toThrow("Unknown pulse setting");
        expect(() => pulseService.update(pulse.id, { frequency: "weekly", dayOfWeek: null })).toThrow("dayOfWeek");
        const changed = pulseService.update(pulse.id, { title: "Evening check", hour: 18, minute: 30, timezone: "UTC" });
        expect(changed).toMatchObject({ title: "Evening check", hour: 18, minute: 30, assistantId: assistant.id });
        const later = changed!.nextRunAt!.getTime();
        pulseService.toggle(pulse.id, false);
        expect(pulseService.toggle(pulse.id, true)?.nextRunAt!.getTime()).toBeGreaterThanOrEqual(later);
    });

    it("pauses routines when the assistant is archived and preserves accepted tasks when a routine is deleted", async () => {
        const assistant = await makeAssistant("Release"), pulse = routine(assistant);
        assistantsService.archive(assistant.id, "default", true);
        expect(pulseService.getById(pulse.id)?.isActive).toBe(false);
        await expect(pulseService.runNow(pulse.id)).rejects.toThrow("unavailable");
        assistantsService.archive(assistant.id, "default", false);
        const fired = await pulseService.runNow(pulse.id);
        const taskId = fired!.lastAssignmentId!;
        pulseService.delete(pulse.id);
        expect(pulseService.getById(pulse.id)).toBeNull();
        expect(assistantsRepo.assignment(taskId)).toBeTruthy();
    });

    it("retires a paused repository routine before its asynchronous task admission commits", async () => {
        const assistant = await makeAssistant("Release"), repo = workspace("routine-repo");
        const pulse = routine(assistant, { mode: "developer", workspaceId: repo.id });
        const { workspaceService } = await import("../workspace");
        let release!: () => void;
        const original = workspaceService.get.bind(workspaceService);
        const gate = new Promise<void>(resolve => { release = resolve; });
        const lookup = vi.spyOn(workspaceService, "get").mockImplementation(async id => { await gate; return original(id); });
        const pending = pulseService.runNow(pulse.id);
        await vi.waitFor(() => expect(lookup).toHaveBeenCalled());
        pulseService.toggle(pulse.id, false);
        release();
        expect(await pending).toBeNull();
        expect(assistantsRepo.assignments("default")).toHaveLength(0);
    });
});
describe("conversational assistant routines", () => {
    const input = { requestId: "morning-check", title: "Morning check", prompt: "Review the release checklist and report findings with evidence.", frequency: "daily", hour: 9, minute: 0, timezone: "Europe/Istanbul" };
    const conversation = (assistant: Assistant, overrides: Record<string, unknown> = {}) => createRun(db, { assistantId: assistant.id, providerId: assistant.providerId, mode: "work", status: "succeeded", ...overrides });
    beforeEach(() => { pulseService.start(); assistantWork.start(); });

    it("creates a teamless routine through the Codex tool broker, deduplicates retries, and runs it through Pulse", async () => {
        const assistant = await makeIndependentAssistant("Release"), source = conversation(assistant);
        const call = async () => {
            const broker = createCodexRequestBroker({ getRunState: () => ({ mode: "work", assistantId: assistant.id, fileChangeItems: new Map() }),
                getMainsToolContext: () => ({ runId: source.id, workspaceId: null, rootPath: null }) });
            const respondToRequest = vi.fn(), respondToRequestError = vi.fn();
            await broker.handleRequest({ runId: source.id, runIsDead: false, id: 42, method: "item/tool/call", params: { tool: "CreateAssistantRoutine", arguments: JSON.stringify(input) }, server: { respondToRequest, respondToRequestError } });
            expect(respondToRequestError).not.toHaveBeenCalled();
            const reply = respondToRequest.mock.calls[0][1];
            expect(reply.success).toBe(true);
            return JSON.parse(reply.contentItems[0].text);
        };
        const saved = await call();
        expect(saved).toMatchObject({ title: "Morning check", hour: 9, timezone: "Europe/Istanbul", mode: "work", workspaceId: null, isActive: true });
        await pulseService.stop(); await assistantWork.stop(); assistantWork.start(); pulseService.start();
        expect((await call()).id).toBe(saved.id);
        expect(pulseService.getAll()).toHaveLength(1);
        const fired = await pulseService.runNow(saved.id);
        const task = assistantsRepo.assignment(fired!.lastAssignmentId!)!;
        expect(task).toMatchObject({ teamId: null, toAssistantId: assistant.id });
        await settled(task.workerRunId!);
        await assistantWork.tool(task.workerRunId!, "ReportAssistantTask", { assignmentId: task.id, status: "completed", result: "Checklist reviewed", evidence: ["checklist.log"] });
        expect(await assistantWork.tool(source.id, "ReadAssistantRoutine", { routineId: saved.id })).toMatchObject({ lastAssignmentStatus: "completed", lastRunId: task.workerRunId });
        expect(driver.calls.createSession.find(call => call.runId === task.workerRunId)).toMatchObject({ mode: "work", model: "test-model", configSnapshot: { assistantId: assistant.id, modelReasoningEffort: "high" } });
    });

    it("reads, reschedules, pauses, resumes and deletes the same panel-visible record without changing its execution", async () => {
        const assistant = await makeAssistant("Release"), repo = workspace("scheduled-repo"), source = conversation(assistant, { mode: "developer", workspaceId: repo.id });
        const saved = await assistantWork.tool(source.id, "CreateAssistantRoutine", { ...input, frequency: "weekly", dayOfWeek: 1 }) as { id: string };
        expect(pulseService.getAll()[0]).toMatchObject({ id: saved.id, assistantId: assistant.id, mode: "developer", workspaceId: repo.id });
        const changed = await assistantWork.tool(source.id, "UpdateAssistantRoutine", { routineId: saved.id, frequency: "daily", hour: 10, minute: 30 }) as { nextRunAt: Date };
        expect(changed).toMatchObject({ frequency: "daily", dayOfWeek: null, hour: 10, minute: 30, timezone: input.timezone, prompt: input.prompt, mode: "developer", workspaceId: repo.id });
        expect(await assistantWork.tool(source.id, "UpdateAssistantRoutine", { routineId: saved.id, isActive: false })).toMatchObject({ isActive: false });
        expect(await assistantWork.tool(source.id, "UpdateAssistantRoutine", { routineId: saved.id, isActive: true })).toMatchObject({ isActive: true });
        expect(await assistantWork.tool(source.id, "DeleteAssistantRoutine", { routineId: saved.id })).toMatchObject({ deleted: true, id: saved.id });
        expect(pulseService.getById(saved.id)).toBeNull();
    });

    it("keeps other assistants, accounts, generic pulses and replicas outside this assistant's management scope", async () => {
        const assistant = await makeAssistant("Release"), colleague = await makeAssistant("Other"), source = conversation(assistant);
        const saved = await assistantWork.tool(source.id, "CreateAssistantRoutine", input) as { id: string };
        const base = pulseService.getById(saved.id)!;
        createAccount(db, { id: "foreign" });
        db.insert(pulses).values([
            { ...base, id: "colleague-routine", assistantId: colleague.id },
            { ...base, id: "foreign-routine", accountId: "foreign" },
            { ...base, id: "generic-pulse", assistantId: null },
            { ...base, id: "replica-routine", ownerBackendId: "another-backend" },
        ]).run();
        const listed = await assistantWork.tool(source.id, "ListAssistantRoutines", {}) as { routines: Array<{ id: string }> };
        expect(listed.routines.map(r => r.id)).toEqual([saved.id]);
        for (const routineId of ["colleague-routine", "foreign-routine", "generic-pulse", "replica-routine"]) {
            await expect(assistantWork.tool(source.id, "ReadAssistantRoutine", { routineId })).rejects.toThrow();
            await expect(assistantWork.tool(source.id, "UpdateAssistantRoutine", { routineId, isActive: false })).rejects.toThrow();
            await expect(assistantWork.tool(source.id, "DeleteAssistantRoutine", { routineId })).rejects.toThrow();
        }
        const ordinary = createRun(db, { mode: "developer", workspaceId: workspace("ordinary-code").id });
        await expect(assistantWork.tool(ordinary.id, "CreateAssistantRoutine", input)).rejects.toThrow("assistant conversation");
        db.update(assistantProfiles).set({ isArchived: true }).where(eq(assistantProfiles.id, assistant.id)).run();
        await expect(assistantWork.tool(source.id, "ListAssistantRoutines", {})).rejects.toThrow("unavailable");
    });

    it("keeps retry keys scoped to the conversation and rejects conflicting or forged settings", async () => {
        const assistant = await makeAssistant("Release"), first = conversation(assistant), second = conversation(assistant);
        const created = await assistantWork.tool(first.id, "CreateAssistantRoutine", input) as { id: string };
        await expect(assistantWork.tool(first.id, "CreateAssistantRoutine", { ...input, hour: 12 })).rejects.toThrow("different settings");
        expect((await assistantWork.tool(second.id, "CreateAssistantRoutine", input) as { id: string }).id).not.toBe(created.id);
        await expect(assistantWork.tool(first.id, "CreateAssistantRoutine", { ...input, assistantId: "forged" })).rejects.toThrow("Unknown assistant field");
        await expect(assistantWork.tool(first.id, "UpdateAssistantRoutine", { routineId: created.id, workspaceId: "forged" })).rejects.toThrow("Unknown assistant field");
        await expect(assistantWork.tool(first.id, "UpdateAssistantRoutine", { routineId: created.id })).rejects.toThrow("setting to update");
        for (const extra of [{ timezone: "Mars/Olympus" }, { hour: 9.5 }, { isActive: "yes" }, { frequency: "weekly" }]) {
            await expect(assistantWork.tool(first.id, "CreateAssistantRoutine", { ...input, ...extra, requestId: "invalid" })).rejects.toThrow();
        }
        const ctx = { workspaceId: null, rootPath: null, runId: first.id };
        await expect(dispatchMainsTool("CreateAssistantRoutine", { ...input, accountId: "forged" }, ctx)).rejects.toThrow("Invalid arguments");
        await expect(dispatchMainsTool("CreateAssistantRoutine", { ...input, minute: 80 }, ctx)).rejects.toThrow("Invalid arguments");
    });

    it("returns bounded paged summaries and an explicit timezone while preserving full prompts for reads", async () => {
        const assistant = await makeAssistant("Release"), source = conversation(assistant);
        const created = await assistantWork.tool(source.id, "CreateAssistantRoutine", { ...input, prompt: "a".repeat(1000), timezone: undefined }) as { id: string; timezone: string };
        expect(created.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
        const base = pulseService.getById(created.id)!;
        db.insert(pulses).values(Array.from({ length: 101 }, (_, index) => ({ ...base, id: `extra-${String(index).padStart(3, "0")}` }))).run();
        const first = await assistantWork.tool(source.id, "ListAssistantRoutines", {}) as { nextOffset: number; routines: Array<{ id: string; prompt: string }> };
        expect(first.routines).toHaveLength(100);
        expect(first.routines.every(r => r.prompt.length === 600)).toBe(true);
        expect(first.nextOffset).toBe(100);
        expect(await assistantWork.tool(source.id, "ListAssistantRoutines", { offset: first.nextOffset })).toMatchObject({ nextOffset: null, routines: expect.any(Array) });
        expect(await assistantWork.tool(source.id, "ReadAssistantRoutine", { routineId: created.id })).toMatchObject({ prompt: "a".repeat(1000) });
        await assistantWork.stop();
        await expect(assistantWork.tool(source.id, "DeleteAssistantRoutine", { routineId: created.id })).rejects.toThrow("shutting down");
        expect(pulseService.getById(created.id)).not.toBeNull();
    });
});

describe("assistant profiles and shared knowledge", () => {
    it("lists an assistant’s latest activity first across repositories and Work without exposing archived or foreign chats", async () => {
        const assistant = await makeAssistant("History"), other = await makeAssistant("Other");
        assistantsRepo.patchWelcome(assistant.id, { state: "started" });
        const project = createProject(db, { id: "history-project", name: "mains" });
        const repo = createWorkspace(db, { id: "history-workspace", projectId: project.id, name: "feat/ios" });
        const createdAt = new Date("2026-11-01T00:00:00Z"), updatedAt = new Date("2026-11-14T12:00:00Z");
        createRun(db, { id: "older-code-chat", assistantId: assistant.id, workspaceId: repo.id, mode: "developer", title: "TestFlight check", createdAt, updatedAt });
        createRun(db, { id: "newer-work-chat", assistantId: assistant.id, mode: "work", createdAt: new Date("2026-11-12T00:00:00Z"), updatedAt: new Date("2026-11-13T00:00:00Z") });
        createRun(db, { id: "archived-chat", assistantId: assistant.id, isArchived: true });
        createRun(db, { id: "other-assistant-chat", assistantId: other.id });
        createRun(db, { id: "foreign-chat", assistantId: assistant.id, accountId: "foreign-account" });

        const chats = assistantsService.conversations(assistant.id, "default");
        expect(chats.map(chat => chat.id)).toEqual(["older-code-chat", "newer-work-chat"]);
        expect(chats[0]).toMatchObject({ workspaceId: repo.id, workspaceName: "feat/ios", projectName: "mains", mode: "developer", title: "TestFlight check", createdAt, updatedAt });
        expect(chats[1]).toMatchObject({ workspaceId: null, workspaceName: null, projectName: null, mode: "work" });
        expect(() => assistantsService.conversations(assistant.id, "foreign-account")).toThrow("unavailable");
    });
    it("saves mosaic avatars and reads legacy shapes without rewriting stored settings", async () => {
        const input = { accountId: "default", teamId, name: "Release assistant", instructions: "Help with releases", spaceId: "codex", model: "test-model", effort: "high" };
        const assistant = await assistantsService.create({ ...input, avatar: { shape: "kite", color: "rose" } });
        expect(assistant.avatar).toEqual({ shape: "kite", color: "rose" });
        expect(assistantsService.get(assistant.id, "default")?.avatar).toEqual(assistant.avatar);
        const legacyClient = await assistantsService.create({ ...input, name: "Legacy client", avatar: { shape: "cross", color: "amber" } });
        expect(legacyClient.avatar).toEqual({ shape: "arch", color: "amber" });
        for (const [legacy, current] of [["circle", "sphere"], ["square", "cube"], ["cross", "arch"]]) {
            db.update(assistantProfiles).set({ avatar: JSON.stringify({ shape: legacy, color: "mint" }) }).where(eq(assistantProfiles.id, assistant.id)).run();
            expect(assistantsService.get(assistant.id, "default")?.avatar).toEqual({ shape: current, color: "mint" });
            expect(JSON.parse(db.select().from(assistantProfiles).where(eq(assistantProfiles.id, assistant.id)).get()!.avatar).shape).toBe(legacy);
        }
        await expect(assistantsService.create({ ...input, name: "Invalid", avatar: { shape: "cube", color: "unknown" } })).rejects.toThrow("available avatar");
    });
    it("projects direct and delegated running conversations into account-scoped avatar activity", async () => {
        const assistant = await makeAssistant("Coordinator"), idle = await makeAssistant("Idle");
        createAccount(db, { id: "another-account" });
        createRun(db, { id: "active-chat", accountId: "default", assistantId: assistant.id, status: "running" });
        createRun(db, { id: "queued-chat", accountId: "default", assistantId: assistant.id, status: "queued" });
        createRun(db, { id: "finished-chat", accountId: "default", assistantId: idle.id, status: "succeeded" });
        createRun(db, { id: "foreign-chat", accountId: "another-account", assistantId: idle.id, status: "running" });
        expect(assistantsService.overview("default").activeAssistantIds).toEqual([assistant.id]);
        db.update(runs).set({ status: "succeeded" }).where(eq(runs.accountId, "default")).run();
        expect(assistantsService.overview("default").activeAssistantIds).toEqual([]);
    });
    it("pins Space, model and effort across starts, continuations and forks", async () => {
        const assistant = await makeAssistant("Coordinator");
        db.update(spaces).set({ systemPrompt: "Changed globally", mode: "chat", providerId: "claude_code" }).where(eq(spaces.id, assistant.spaceId)).run();
        db.update(providers).set({ config: JSON.stringify({ defaultModel: "different", modelReasoningEffort: "low" }) }).where(eq(providers.id, "codex")).run();
        db.insert(appSettings).values({ id: "default", accountId: "default", activeSpaceId: "claude_code" }).run();
        const { runId } = await runsService.executeRun({ accountId: "default", assistantId: assistant.id, providerId: "claude_code", goal: "Prepare release", model: "different", conversationSettings: { model: "different", config: { modelReasoningEffort: "low" } } });
        await settled(runId);
        const request = driver.calls.createSession[0];
        expect(request.model).toBe("test-model");
        expect(request.mode).toBe("work");
        expect(request.configSnapshot?.modelReasoningEffort).toBe("high");
        expect(request.extraInstructions).toContain("Original Space instructions");
        expect(request.extraInstructions).not.toContain("Changed globally");
        await runsService.continueRun({ runId, accountId: "default", message: "Next step", model: "different", conversationSettings: { model: "different", config: { modelReasoningEffort: "low" } } });
        await settled(runId);
        expect(driver.calls.resumeSession[0].model).toBe("test-model");
        expect(driver.calls.resumeSession[0].configSnapshot?.modelReasoningEffort).toBe("high");
        const fork = await runsService.forkRun({ sourceRunId: runId, accountId: "default", message: "Explore a variant" });
        await settled(fork.runId);
        expect((await runsService.getRunById(fork.runId))?.assistantId).toBe(assistant.id);
        expect(driver.calls.forkSession[0].configSnapshot?.modelReasoningEffort).toBe("high");
        await expect(runsService.updateConversationSettings(runId, { model: "different", config: {} })).rejects.toThrow("fixed");
        await expect(runsService.updateRun(runId, { model: "different" })).rejects.toThrow("fixed");
        await expect(runsService.createRun({ id: "forged", accountId: "default", providerId: "claude_code", assistantId: assistant.id })).rejects.toThrow("assistant conversation endpoint");
        expect(assistantsService.conversations(assistant.id, "default").filter(chat => chat.id !== `assistant-welcome-${assistant.id}`)).toHaveLength(2);
        expect(await runsService.listRecentRuns({ accountId: "default", providerId: "codex", mode: "work" })).toHaveLength(0);
    });
    it("sends ordinary composer context and attachments through the frozen assistant profile", async () => {
        const assistant = await makeAssistant("Release");
        const { runId } = await assistantWork.sendChat("default", assistant.id, "Use this release brief", "composer-context-start", undefined, undefined, {
            initialContext: [{ kind: "note", content: "Ship the verified commit" }],
            attachments: [{ name: "brief.txt", type: "document", mimeType: "text/plain", data: "cmVsZWFzZQ==" }],
        });
        await settled(runId);
        expect((await runsService.getContextByRun(runId)).some(row => row.content === "Ship the verified commit")).toBe(true);
        expect(driver.calls.createSession[0].model).toBe("test-model");
        await assistantWork.sendChat("default", assistant.id, "Add the checklist", "composer-context-next", runId, undefined, {
            initialContext: [{ kind: "note", content: "Verify signing before distribution" }],
        });
        await settled(runId);
        expect((await runsService.getContextByRun(runId)).some(row => row.content === "Verify signing before distribution")).toBe(true);
        expect(driver.calls.resumeSession[0].model).toBe("test-model");
    });
    it("rejects unsupported model/effort and execution-profile edits", async () => {
        await expect(assistantsService.create({ accountId: "default", teamId, name: "No", instructions: "Work", spaceId: "codex", model: "test-model", effort: "unsupported" })).rejects.toThrow("effort");
        await expect(assistantsService.create({ accountId: "default", teamId, name: "No", instructions: "Work", spaceId: "codex", model: "missing", effort: "high" })).rejects.toThrow("model");
        await expect(assistantsService.create({ accountId: "default", teamId, name: "No", instructions: "Work", spaceId: "codex", model: "test-model", effort: "high", sandboxMode: "danger-full-access" })).rejects.toThrow("Unknown assistant field");
    });
    it("shares team facts, isolates private notes and rejects stale writes", async () => {
        const a = await makeAssistant("Build"), b = await makeAssistant("Website");
        const shared = assistantsService.saveMemory({ accountId: "default", teamId, title: "Release policy", content: "Use internal TestFlight first", pinned: true });
        assistantsService.saveMemory({ accountId: "default", teamId, assistantId: a.id, title: "Private", content: "Private build preference" });
        expect(assistantsService.context(b.id, "default", "release")).toContain("internal TestFlight");
        expect(assistantsService.context(b.id, "default", "release")).not.toContain("Private build preference");
        expect(shared.revision).toBe(1);
    });
    it("keeps immutable source/revision evidence and enforces account boundaries", async () => {
        const a = await makeAssistant("Build");
        const row = assistantsService.saveMemory({ accountId: "default", teamId, assistantId: a.id, title: "Decision", content: "First" }, "source-run");
        const next = assistantsService.saveMemory({ accountId: "default", teamId, assistantId: a.id, id: row.id, title: "Decision", content: "Second", expectedRevision: row.revision }, "next-run");
        expect(next.revision).toBe(2);
        expect(next.sourceRunId).toBe("next-run");
        expect(() => assistantsService.saveMemory({ accountId: "default", teamId, assistantId: a.id, id: row.id, title: "Decision", content: "Stale", expectedRevision: row.revision })).toThrow("changed");
        createAccount(db, { id: "other" });
        expect(assistantsService.get(a.id, "other")).toBeNull();
        expect(() => assistantsService.removeMemory("other", row.id, next.revision)).toThrow("not found");
    });
    it("keeps independent assistants isolated and carries private memory through joining and leaving", async () => {
        const assistant = await makeIndependentAssistant("Build"), other = await makeIndependentAssistant("Website");
        const chat = createRun(db, { assistantId: assistant.id, status: "succeeded" });
        const otherChat = createRun(db, { assistantId: other.id, status: "succeeded" });
        const sharedNote = assistantsService.saveMemory({ accountId: "default", teamId, title: "Release policy", content: "Use the internal track.", pinned: true });
        assistantWork.start();
        const privateNote = await assistantWork.tool(chat.id, "SaveAssistantMemory", { scope: "assistant", title: "Preference", content: "Check the build logs.", pinned: true }) as { id: string };
        await expect(assistantWork.tool(chat.id, "SaveAssistantMemory", { scope: "team", title: "Preference", content: "Check the build logs." })).rejects.toThrow("Join a team");
        expect(assistantsService.overview("default").memories).toContainEqual(expect.objectContaining({ id: privateNote.id, teamId: null, assistantId: assistant.id }));
        expect(await assistantWork.tool(otherChat.id, "RecallAssistantMemory", {})).toEqual([]);
        expect(assistantsService.context(assistant.id, "default", "")).not.toContain("Use the internal track.");
        expect(assistantsService.context(assistant.id, "default", "")).not.toContain("Website");
        expect(await assistantWork.tool(chat.id, "ListAssistants", {})).toEqual([]);
        const request = { toAssistantId: other.id, taskKey: "task", title: "Check", prompt: "Check the build." };
        await expect(assistantWork.tool(chat.id, "AssignAssistantTask", request)).rejects.toThrow("Delegate only");
        const task = await assistantWork.assign({ ...request, accountId: "default" });
        expect(task.teamId).toBeNull();
        await expect(assistantWork.tool(chat.id, "ReadAssistantTask", { assignmentId: task.id })).rejects.toThrow("unavailable");
        await expect(assistantWork.tool(chat.id, "SendAssistantTaskMessage", { assignmentId: task.id, messageId: "foreign", message: "Different task" })).rejects.toThrow("unavailable");
        expect(await assistantWork.tool(chat.id, "ListAssistantTasks", {})).toEqual([]);
        expect(await assistantWork.tool(otherChat.id, "ListAssistantTasks", {})).toContainEqual(expect.objectContaining({ id: task.id }));

        const membership = { accountId: "default", id: assistant.id };
        expect(assistantsService.changeTeam({ ...membership, teamId }).teamId).toBe(teamId);
        expect(assistantsService.memories(assistant.id, "default").map(note => note.id)).toEqual(expect.arrayContaining([privateNote.id, sharedNote.id]));
        expect(assistantsService.changeTeam({ ...membership, teamId: null }).teamId).toBeNull();
        expect(assistantsService.memories(assistant.id, "default").map(note => note.id)).toEqual([privateNote.id]);
        expect(assistantsRepo.memory(sharedNote.id)?.teamId).toBe(teamId);
        expect(assistantsService.conversations(assistant.id, "default").map(run => run.id)).toContain(chat.id);
    });
    it("changes team with private notes while retaining shared knowledge, history and profile settings", async () => {
        const assistant = await makeAssistant("Build"), teammate = await makeAssistant("Website");
        const destination = assistantsService.createTeam({ accountId: "default", name: "New team" });
        const shared = assistantsService.saveMemory({ accountId: "default", teamId, title: "Old policy", content: "Old team knowledge", pinned: true });
        const privateNote = assistantsService.saveMemory({ accountId: "default", teamId, assistantId: assistant.id, title: "Preference", content: "Private build preference", pinned: true });
        assistantsService.saveMemory({ accountId: "default", teamId: destination.id, title: "New policy", content: "New team knowledge", pinned: true });
        const task = await assistantWork.assign({ accountId: "default", toAssistantId: assistant.id, taskKey: "old-task", title: "Build", prompt: "Build" });
        assistantsRepo.patchAssignment(task.id, { status: "completed", result: "Built" });
        assistantsRepo.cancelMessages(task.id);
        createRun(db, { id: "old-chat", assistantId: assistant.id, status: "succeeded" });

        const updated = assistantsService.changeTeam({ accountId: "default", id: assistant.id, teamId: destination.id });

        expect(updated).toEqual({ ...assistant, teamId: destination.id, updatedAt: expect.any(Date) });
        expect(assistantsRepo.memory(privateNote.id)).toMatchObject({ teamId: destination.id, assistantId: assistant.id, revision: privateNote.revision + 1, pinned: true });
        expect(assistantsRepo.memory(shared.id)?.teamId).toBe(teamId);
        expect(assistantsRepo.assignment(task.id)).toMatchObject({ teamId, status: "completed", result: "Built" });
        expect(assistantsService.conversations(assistant.id, "default").some(chat => chat.id === "old-chat")).toBe(true);
        expect(assistantsService.context(assistant.id, "default", "knowledge")).toContain("New team knowledge");
        expect(assistantsService.context(assistant.id, "default", "knowledge")).not.toContain("Old team knowledge");
        expect(assistantsService.context(teammate.id, "default", "knowledge")).not.toContain("Private build preference");
        expect(() => assistantsService.saveMemory({ accountId: "default", teamId: destination.id, assistantId: assistant.id, id: privateNote.id, title: "Preference", content: "Stale", expectedRevision: privateNote.revision })).toThrow("changed");
    });
    it("validates both team and assistant account before changing membership", async () => {
        const assistant = await makeAssistant("Build");
        createAccount(db, { id: "other" });
        const foreign = assistantsService.createTeam({ accountId: "other", name: "Other" });
        expect(() => assistantsService.changeTeam({ accountId: "default", id: assistant.id, teamId: foreign.id })).toThrow("Team not found");
        expect(() => assistantsService.changeTeam({ accountId: "other", id: assistant.id, teamId: foreign.id })).toThrow("unavailable");
        expect(() => assistantsService.changeTeam({ accountId: "default", id: assistant.id, teamId: "missing" })).toThrow("Team not found");
        assistantsService.archive(assistant.id, "default", true);
        expect(() => assistantsService.changeTeam({ accountId: "default", id: assistant.id, teamId })).toThrow("unavailable");
        expect(assistantsService.get(assistant.id, "default")?.teamId).toBe(teamId);
    });
    it("keeps membership stable while conversations, assignments or deliveries are pending", async () => {
        const assistant = await makeAssistant("Build"), requester = await makeAssistant("Coordinator");
        const destination = assistantsService.createTeam({ accountId: "default", name: "New team" });
        const move = (id = assistant.id) => assistantsService.changeTeam({ accountId: "default", id, teamId: destination.id });
        createRun(db, { id: "active-chat", assistantId: assistant.id, status: "queued" });
        for (const status of ["queued", "running"] as const) {
            db.update(runs).set({ status }).where(eq(runs.id, "active-chat")).run();
            expect(() => move()).toThrow("running conversations");
        }
        db.update(runs).set({ status: "succeeded" }).where(eq(runs.id, "active-chat")).run();
        assistantsRepo.enqueue({ id: "task", accountId: "default", teamId, fromAssistantId: requester.id, toAssistantId: assistant.id, taskKey: "test", dedupeKey: "test", title: "Build", prompt: "Build" },
            { id: "delivery", assignmentId: "task", kind: "result", targetRunId: "active-chat", content: "Result" });
        for (const status of ["queued", "running", "blocked", "uncertain"] satisfies AssistantAssignment["status"][]) {
            assistantsRepo.patchAssignment("task", { status });
            expect(() => move()).toThrow("assignments");
            expect(() => move(requester.id)).toThrow("assignments");
        }
        assistantsRepo.patchAssignment("task", { status: "completed" });
        for (const status of ["queued", "dispatching", "uncertain"] as const) {
            assistantsRepo.patchMessage("delivery", { status });
            expect(() => move()).toThrow("deliveries");
            expect(() => move(requester.id)).toThrow("deliveries");
        }
        expect(assistantsService.get(assistant.id, "default")?.teamId).toBe(teamId);
        assistantsRepo.patchMessage("delivery", { status: "delivered" });
        expect(move().teamId).toBe(destination.id);
    });
    it.each(["generating", "starting"] as const)("waits for a %s welcome before changing teams", async state => {
        const assistant = await makeAssistant("Build"), destination = assistantsService.createTeam({ accountId: "default", name: "New team" });
        assistantsRepo.patchWelcome(assistant.id, { state });
        expect(() => assistantsService.changeTeam({ accountId: "default", id: assistant.id, teamId: destination.id })).toThrow("welcome");
    });
    it("rejects an assignment if its target moves teams while resolving execution", async () => {
        const assistant = await makeAssistant("Build"), destination = assistantsService.createTeam({ accountId: "default", name: "New team" });
        vi.spyOn(assistantsService, "execution").mockImplementation(async () => {
            assistantsService.changeTeam({ accountId: "default", id: assistant.id, teamId: destination.id });
            return { mode: "work" };
        });
        await expect(assistantWork.assign({ accountId: "default", toAssistantId: assistant.id, taskKey: "race", title: "Build", prompt: "Build" })).rejects.toThrow("team changed");
        expect(assistantsRepo.assignments("default")).toHaveLength(0);
    });
    it("classifies assistant tables and identity as local in Bridge", () => { expect(() => auditBridgeSchema()).not.toThrow(); });
});
describe("durable assistant delegation", () => {
    async function parentAndWorker(): Promise<{
        parent: Assistant;
        worker: Assistant;
        runId: string;
    }> {
        const parent = await makeAssistant("Coordinator"), worker = await makeAssistant("Website", "claude_code");
        const { runId } = await assistantWork.sendChat("default", parent.id, "Prepare release", "initial-message-key");
        await settled(runId);
        return { parent, worker, runId };
    }
    it("deduplicates delegation and executes the target's own profile", async () => {
        const { worker, runId } = await parentAndWorker();
        const input = { accountId: "default", toAssistantId: worker.id, taskKey: "website", title: "Update website", prompt: "Prepare the release page" };
        const task = await assistantWork.assign(input, runId);
        expect((await assistantWork.assign(input, runId)).id).toBe(task.id);
        await expect(assistantWork.assign({ ...input, prompt: "Different work" }, runId)).rejects.toThrow("new task key");
        assistantWork.start();
        await vi.waitFor(() => expect(driver.calls.createSession).toHaveLength(2));
        await settled(task.workerRunId!);
        const child = await runsService.getRunById(task.workerRunId!);
        expect(child?.providerId).toBe("claude_code");
        expect(child?.assistantId).toBe(worker.id);
        expect(driver.calls.createSession[1].configSnapshot?.effortLevel).toBe("high");
        await vi.waitFor(() => expect(assistantsRepo.assignment(task.id)?.status).toBe("blocked"));
    });
    it("reports evidence back to the requesting conversation exactly once", async () => {
        const { worker, runId } = await parentAndWorker();
        const task = await assistantWork.assign({ accountId: "default", toAssistantId: worker.id, taskKey: "page", title: "Page", prompt: "Prepare page" }, runId);
        assistantWork.start();
        await vi.waitFor(async () => expect(await runsService.getRunById(task.workerRunId!)).not.toBeNull());
        await settled(task.workerRunId!);
        await expect(assistantWork.report(task.workerRunId!, { assignmentId: task.id, status: "completed", result: "Prepared", evidence: [] })).rejects.toThrow("evidence");
        const report = { assignmentId: task.id, status: "completed", result: "Prepared", evidence: ["preview:release-page"] };
        await assistantWork.report(task.workerRunId!, report);
        await assistantWork.report(task.workerRunId!, report);
        await vi.waitFor(() => expect(driver.calls.resumeSession.filter(r => r.message.includes("preview:release-page"))).toHaveLength(1));
        await settled(runId);
        expect(assistantsRepo.assignment(task.id)?.status).toBe("completed");
    });
    it("rejects team crossings and cycles in delegated work", async () => {
        const { parent, worker, runId } = await parentAndWorker();
        const foreignTeam = assistantsService.createTeam({ accountId: "default", name: "Other team" }).id;
        const other = await assistantsService.create({ accountId: "default", teamId: foreignTeam, name: "Other", instructions: "Other work", spaceId: "codex", model: "test-model", effort: "low" });
        await expect(assistantWork.assign({ accountId: "default", toAssistantId: other.id, taskKey: "other", title: "Other", prompt: "Other" }, runId)).rejects.toThrow("own team");
        const task = await assistantWork.assign({ accountId: "default", toAssistantId: worker.id, taskKey: "page", title: "Page", prompt: "Prepare" }, runId);
        createRun(db, { id: task.workerRunId!, assistantId: worker.id, providerId: worker.providerId, mode: "work", status: "succeeded" });
        await expect(assistantWork.assign({ accountId: "default", toAssistantId: parent.id, taskKey: "back", title: "Back", prompt: "Do it" }, task.workerRunId!)).rejects.toThrow("cycle");
        assistantWork.start();
    await expect(assistantWork.tool(task.workerRunId!, "ReadAssistantHistory", { runId })).rejects.toThrow("only this assistant");
    });
    it("recovers pre-dispatch requests and reconciles existing worker identities", async () => {
        const { worker, runId } = await parentAndWorker();
        const first = await assistantWork.assign({ accountId: "default", toAssistantId: worker.id, taskKey: "first", title: "First", prompt: "First" }, runId);
        const second = await assistantWork.assign({ accountId: "default", toAssistantId: worker.id, taskKey: "second", title: "Second", prompt: "Second" }, runId);
        assistantsRepo.patchMessage(`request-${first.id}`, { status: "dispatching" });
        assistantsRepo.patchMessage(`request-${second.id}`, { status: "dispatching" });
        createRun(db, { id: second.workerRunId!, assistantId: worker.id, providerId: worker.providerId, mode: "work", status: "succeeded" });
        await assistantWork.recover();
        expect(assistantsRepo.message(`request-${first.id}`)?.status).toBe("queued");
        expect(assistantsRepo.message(`request-${second.id}`)?.status).toBe("delivered");
        expect(driver.calls.createSession).toHaveLength(1);
    });
    it("does not automatically resend uncertain follow-ups after restart", async () => {
        const { worker, runId } = await parentAndWorker();
        const task = await assistantWork.assign({ accountId: "default", toAssistantId: worker.id, taskKey: "once", title: "Once", prompt: "Once" }, runId);
        createRun(db, { id: task.workerRunId!, assistantId: worker.id, providerId: worker.providerId, mode: "work", status: "succeeded" });
        assistantsRepo.addMessage({ id: "uncertain-message", assignmentId: task.id, targetRunId: task.workerRunId, kind: "followup", content: "Publish", status: "dispatching" });
        vi.spyOn(runsService, "getInputStatus").mockResolvedValue({ accepted: false });
        await assistantWork.recover();
        expect(assistantsRepo.message("uncertain-message")?.status).toBe("uncertain");
        expect(assistantsRepo.assignment(task.id)?.status).toBe("uncertain");
        expect(driver.calls.resumeSession).toHaveLength(0);
    });
    it.each(["blocked", "completed"] as const)("retains the delivery failure and an explicit %s task report during reconciliation", async status => {
        const { worker, runId } = await parentAndWorker();
        const task = await assistantWork.assign({ accountId: "default", toAssistantId: worker.id, taskKey: "writer-lock", title: "Check", prompt: "Check the release" }, runId);
        createRun(db, { id: task.workerRunId!, assistantId: worker.id, providerId: worker.providerId, mode: "work", status: "failed" });
        assistantsRepo.patchAssignment(task.id, { status, result: status === "completed" ? "Readiness check complete" : null });
        const error = "This conversation is open in another Codex application. Release that session before continuing.";
        assistantsRepo.addMessage({ id: "locked-delivery", assignmentId: task.id, targetRunId: task.workerRunId, kind: "followup", content: "Continue", status: "uncertain", error });
        vi.spyOn(runsService, "getInputStatus").mockResolvedValue({ accepted: false });

        await assistantWork.recover(task.id);
        await assistantWork.recover(task.id);

        expect(assistantsRepo.message("locked-delivery")).toMatchObject({ status: "uncertain", error });
        expect(assistantsRepo.assignment(task.id)).toMatchObject({ status: status === "completed" ? "completed" : "uncertain", result: status === "completed" ? "Readiness check complete" : null, error: expect.stringContaining(error) });
        expect(driver.calls.resumeSession).toHaveLength(0);
    });
    it("exposes the last conversation error for older generic uncertain deliveries without replaying them", async () => {
        const { worker, runId } = await parentAndWorker();
        const task = await assistantWork.assign({ accountId: "default", toAssistantId: worker.id, taskKey: "legacy-writer-lock", title: "Check", prompt: "Check the release" }, runId);
        const lastError = "thread existing-thread already has an active writer (code: -32600)";
        createRun(db, { id: task.workerRunId!, assistantId: worker.id, providerId: worker.providerId, mode: "work", status: "failed", lastError });
        assistantsRepo.addMessage({ id: "legacy-locked-delivery", assignmentId: task.id, targetRunId: task.workerRunId, kind: "followup", content: "Continue", status: "uncertain", error: "Delivery could not be confirmed. Inspect the conversation before sending again." });
        vi.spyOn(runsService, "getInputStatus").mockResolvedValue({ accepted: false });
        await assistantWork.recover(task.id);
        const error = assistantsRepo.message("legacy-locked-delivery")?.error;
        expect(error).toContain(`Last conversation error: ${lastError}`);
        await assistantWork.recover(task.id);
        expect(assistantsRepo.message("legacy-locked-delivery")?.error).toBe(error);
        expect(driver.calls.resumeSession).toHaveLength(0);
    });
    it("cancels queued work before it reaches a provider", async () => {
        const worker = await makeAssistant("Release");
        const task = await assistantWork.assign({ accountId: "default", toAssistantId: worker.id, taskKey: "cancel", title: "Canceled", prompt: "Do not run" });
        await assistantWork.cancel("default", task.id);
        expect(assistantsRepo.assignment(task.id)?.status).toBe("canceled");
        expect(assistantsRepo.message(`request-${task.id}`)?.status).toBe("canceled");
        expect(driver.calls.createSession).toHaveLength(0);
    });
});
describe("assistant shutdown and restart boundaries", () => {
    it("retires profile creation before a delayed model catalog can write", async () => {
        assistantWork.start();
        let release!: (value: never[]) => void;
        vi.mocked(providersService.getModels).mockReturnValue(new Promise(resolve => { release = resolve as typeof release; }));
        const creating = assistantsService.create({ accountId: "default", teamId, name: "Delayed", instructions: "Work", spaceId: "codex", model: "test-model", effort: "high" }, assistantWork.guard());
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        await assistantWork.stop();
        release([{ id: "test-model", displayName: "Test", supportedEffortLevels: ["high"] }] as never[]);
        await expect(creating).rejects.toThrow("shutting down");
        expect(assistantsService.overview("default").assistants).toHaveLength(0);
    });
    it("marks an orphaned native turn interrupted without replaying it", async () => {
        const assistant = await makeAssistant("Interrupted");
        const old = createRun(db, { assistantId: assistant.id, providerId: assistant.providerId, mode: "work", status: "running" });
        await assistantWork.recover();
        const restored = await runsService.getRunById(old.id);
        expect(restored?.status).toBe("failed");
        expect(restored?.lastError).toContain("interrupted");
        expect(driver.calls.createSession).toHaveLength(0);
    });
});


describe("assignment message ordering", () => {
  it("keeps a request before a follow-up created in the same second", async () => {
    const assistant = await makeAssistant("Release");
    const task = await assistantWork.assign({ accountId: "default", toAssistantId: assistant.id, taskKey: "ordered", title: "Release", prompt: "Prepare" });
    await assistantWork.followup("default", task.id, "clarification", "Use the preview channel");
    expect(assistantsRepo.messages().filter(m => m.assignmentId === task.id).map(m => m.kind)).toEqual(["request", "followup"]);
  });
  it("does not send a later message past an unconfirmed delivery", async () => {
    const assistant = await makeAssistant("Release");
    const task = await assistantWork.assign({ accountId: "default", toAssistantId: assistant.id, taskKey: "barrier", title: "Release", prompt: "Prepare" });
    createRun(db, { id: task.workerRunId!, assistantId: assistant.id, providerId: assistant.providerId, mode: "work", status: "succeeded" });
    assistantsRepo.patchMessage(`request-${task.id}`, { status: "delivered" });
    assistantsRepo.addMessage({ id: "earlier", assignmentId: task.id, kind: "followup", targetRunId: task.workerRunId, content: "Publish", status: "uncertain" });
    assistantsRepo.addMessage({ id: "later", assignmentId: task.id, kind: "followup", targetRunId: task.workerRunId, content: "Another instruction" });
    assistantWork.start();
    await assistantWork.drain();
    await vi.waitFor(() => expect(assistantsRepo.assignment(task.id)?.status).toBe("uncertain"));
    expect(driver.calls.resumeSession).toHaveLength(0);
    expect(assistantsRepo.message("later")?.status).toBe("queued");
  });
});


describe("dispatcher shutdown", () => {
  it("cancels its own pending native input before joining dispatch", async () => {
    const assistant = await makeAssistant("Release");
    const task = await assistantWork.assign({ accountId: "default", toAssistantId: assistant.id, taskKey: "shutdown", title: "Release", prompt: "Prepare" });
    createRun(db, { id: task.workerRunId!, assistantId: assistant.id, providerId: assistant.providerId, mode: "work", status: "succeeded" });
    assistantsRepo.patchMessage(`request-${task.id}`, { status: "delivered" });
    await assistantWork.followup("default", task.id, "pending-ack", "Continue");
    let reject!: (error: Error) => void;
    const continuing = vi.spyOn(runsService, "continueRun").mockImplementation(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const aborting = vi.spyOn(runsService, "abortRun").mockImplementation(async () => { reject(new Error("Stopped before input acceptance")); });
    assistantWork.start();
    await vi.waitFor(() => expect(continuing).toHaveBeenCalledTimes(1));
    await assistantWork.stop();
    expect(aborting).toHaveBeenCalledWith(task.workerRunId);
    expect(assistantsRepo.message(`${task.id}:pending-ack`)?.status).toBe("uncertain");
    expect(() => assistantWork.guard()()).toThrow("shutting down");
  });
});


describe("stopped requesters", () => {
  it("retains a teammate report without restarting a chat the user stopped", async () => {
    const parent = await makeAssistant("Coordinator"), worker = await makeAssistant("Release");
    const { runId } = await assistantWork.sendChat("default", parent.id, "Prepare release", "stopped-parent-key");
    await settled(runId);
    const task = await assistantWork.assign({ accountId: "default", toAssistantId: worker.id, taskKey: "prepare", title: "Prepare", prompt: "Prepare a draft" }, runId);
    createRun(db, { id: task.workerRunId!, assistantId: worker.id, providerId: worker.providerId, mode: "work", status: "succeeded" });
    await runsService.cancelRun(runId);
    await assistantWork.report(task.workerRunId!, { assignmentId: task.id, status: "completed", result: "Draft prepared", evidence: ["draft-reference"] });
    assistantWork.start();
    await vi.waitFor(() => expect(assistantsRepo.messages()).toHaveLength(0));
    expect(driver.calls.resumeSession).toHaveLength(0);
    expect(assistantsRepo.assignment(task.id)?.result).toBe("Draft prepared");
    expect((await runsService.getRunById(runId))?.status).toBe("canceled");
  });
});

describe("one-time assistant welcome", () => {
    const question = { header: "First step", question: "I'm your release assistant. Where shall we start?", options: [
        { label: "Check TestFlight", description: "Review the current build." },
        { label: "Prepare release notes", description: "Summarize the changes." },
        { label: "Review the release", description: "Inspect readiness." },
    ], idleMessage: "Message me whenever you're ready." };
    async function ready(name = "Release") {
        const generate = vi.fn().mockResolvedValue(JSON.stringify(question));
        driver.driver.generateText = generate;
        vi.mocked(createWorkAdapter).mockReturnValue(createWorkRunAdapter(driver.driver));
        const assistant = await makeAssistant(name);
        assistantWork.start();
        await vi.waitFor(() => expect(assistantsService.welcome(assistant.id, "default")?.state).toBe("ready"));
        return { assistant, generate, welcome: assistantsService.welcome(assistant.id, "default")! };
    }
    it("resumes profile setup, saves edited instructions, then starts real work in the reserved conversation", async () => {
        const generate = vi.fn()
            .mockResolvedValueOnce(JSON.stringify({ question: "Which release checks should I run?" }))
            .mockResolvedValueOnce(JSON.stringify({ description: "Check releases", instructions: "Check builds and signing." }));
        driver.driver.generateText = generate;
        vi.mocked(createWorkAdapter).mockReturnValue(createWorkRunAdapter(driver.driver));
        const assistant = await assistantsService.create({ accountId: "default", teamId: null, name: "Release", spaceId: "codex", model: "test-model", effort: "high", profileSetup: true });
        expect(assistant.teamId).toBeNull();
        const read = () => assistantsService.welcome(assistant.id, "default")!;
        const { runId } = read();
        assistantWork.start();
        expect(read().state).toBe("ready");
        expect(generate).not.toHaveBeenCalled();
        await expect(assistantWork.sendChat("default", assistant.id, "Start work", "early")).rejects.toThrow("Finish setting up");
        const first = { action: "answer", step: 0, answer: "Help with releases" };
        assistantWelcome.setupProfile("default", assistant.id, first);
        await vi.waitFor(() => expect(read().question?.question).toBe("Which release checks should I run?"));
        assistantWelcome.setupProfile("default", assistant.id, first);
        expect(generate).toHaveBeenCalledTimes(1);
        await assistantWork.stop();
        assistantWork.start();
        expect(read().question?.profileSetup?.turns).toHaveLength(1);
        assistantWelcome.setupProfile("default", assistant.id, { action: "answer", step: 1, answer: "Builds and signing" });
        await vi.waitFor(() => expect(read().question?.profileSetup?.draft?.description).toBe("Check releases"));
        expect(generate).toHaveBeenLastCalledWith(expect.stringContaining("Builds and signing"), expect.objectContaining({ isolated: true, model: "test-model", effort: "high" }));
        expect(driver.calls.createSession).toHaveLength(0);
        const profile = { description: "Release checks", instructions: "Check signing. Ask before uploading." };
        assistantWelcome.setupProfile("default", assistant.id, { action: "save", profile });
        assistantWelcome.setupProfile("default", assistant.id, { action: "save", profile });
        expect(assistantsService.require(assistant.id, "default")).toMatchObject(profile);
        expect(read()).toMatchObject({ state: "skipped", runId, question: { profileSetup: { saved: true } } });
        expect(driver.calls.createSession).toHaveLength(0);
        expect((await assistantWork.sendChat("default", assistant.id, "Check this build", `welcome-${assistant.id}`, runId)).runId).toBe(runId);
        await settled(runId);
        expect(driver.calls.createSession).toHaveLength(1);
    });

    it("generates one role-based question with frozen model/effort without starting a native run", async () => {
        const { assistant, generate, welcome } = await ready();
        expect(driver.calls.createSession).toHaveLength(0);
        expect(welcome.question).toEqual(question);
        expect(generate).toHaveBeenCalledWith(expect.stringContaining('"name":"Release"'), expect.objectContaining({ model: "test-model", effort: "high", isolated: true, signal: expect.any(AbortSignal) }));
        expect(assistantsService.overview("default").welcomes?.[0]).not.toHaveProperty("setupPrompt");
        expect(assistantsRepo.welcome(assistant.id)?.setupPrompt).toContain("untrusted reference data");
        await assistantWork.stop();
        assistantWork.start();
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(generate).toHaveBeenCalledTimes(1);
        expect(assistantsService.conversations(assistant.id, "default").map(chat => chat.id)).toEqual([welcome.runId]);
        expect(driver.calls.createSession).toHaveLength(0);
    });
    it("skips without work and persists a friendly idle message across restart", async () => {
        const { assistant, welcome } = await ready();
        await assistantWelcome.respond("default", assistant.id, null);
        await assistantWelcome.respond("default", assistant.id, null);
        await assistantWork.stop();
        assistantWork.start();
        const saved = assistantsService.welcome(assistant.id, "default")!;
        expect(saved.state).toBe("skipped");
        expect(saved.question?.idleMessage).toBe(question.idleMessage);
        expect(driver.calls.createSession).toHaveLength(0);
        expect(await runsService.getRunById(welcome.runId)).toBeNull();
    });
    it("starts the chosen request exactly once, with the welcome ahead of the first real user message", async () => {
        const { assistant, welcome } = await ready();
        const [first, duplicate] = await Promise.all([
            assistantWelcome.respond("default", assistant.id, "Check TestFlight"),
            assistantWelcome.respond("default", assistant.id, "Check TestFlight"),
        ]);
        expect(first).toEqual(duplicate);
        expect(first.runId).toBe(welcome.runId);
        await settled(first.runId);
        expect(driver.calls.createSession).toHaveLength(1);
        expect(driver.calls.createSession[0].goal).toBe("Check TestFlight");
        expect(driver.calls.createSession[0]).toMatchObject({ mode: "work", execution: { workspaceId: null } });
        const history = await runsService.getHistoryPage({ runId: first.runId, direction: "latest" });
        const reports = history.artifacts.filter(a => a.kind === "report");
        expect(reports[0]?.content).toBe(question.question);
        expect(history.artifacts.filter(a => String(a.kind) === "user-prompt").map(a => a.content)).toEqual(["Check TestFlight"]);
        expect((await runsService.getContextByRun(first.runId)).some(row => row.metadata?.origin === "assistant_setup")).toBe(true);
        await assistantWelcome.respond("default", assistant.id, "Check TestFlight");
        await expect(assistantWelcome.respond("default", assistant.id, "Different task")).rejects.toThrow("already answered");
        expect(driver.calls.createSession).toHaveLength(1);
        expect(assistantsService.conversations(assistant.id, "default").map(chat => chat.id)).toEqual([first.runId]);
    });
    it("starts a welcome in the selected repo without changing the assistant profile", async () => {
        const { assistant, welcome } = await ready(), repo = workspace("welcome-repo");
        const target = { mode: "developer" as const, workspaceId: repo.id };
        const [first, duplicate] = await Promise.all([
            assistantWelcome.respond("default", assistant.id, "Check TestFlight", {}, target),
            assistantWelcome.respond("default", assistant.id, "Check TestFlight", {}, target),
        ]);
        expect(first).toEqual(duplicate);
        await settled(welcome.runId);
        expect(driver.calls.createSession).toHaveLength(1);
        expect(driver.calls.createSession[0]).toMatchObject({ mode: "developer", model: assistant.model, execution: { workspaceId: repo.id, cwd: repo.rootPath } });
        expect(assistantsService.welcome(assistant.id, "default")?.execution).toEqual(target);
        expect(assistantsService.overview("default").welcomes?.find(row => row.assistantId === assistant.id)?.execution).toEqual(target);
        expect(assistantsService.get(assistant.id, "default")).toEqual(assistant);
        await expect(assistantWelcome.respond("default", assistant.id, "Check TestFlight", {}, { mode: "work" })).rejects.toThrow("original workspace");
    });
    it("rejects unavailable welcome repos before accepting an answer, and permits an unbound retry", async () => {
        const { assistant, welcome } = await ready();
        createAccount(db, { id: "other" });
        const foreign = workspace("foreign-welcome", "other"), archived = workspace("archived-welcome");
        db.update((await import("../../db/schema")).workspaces).set({ isArchived: true }).where(eq((await import("../../db/schema")).workspaces.id, archived.id)).run();
        for (const workspaceId of [foreign.id, archived.id, "missing"]) {
            await expect(assistantWelcome.respond("default", assistant.id, "Check TestFlight", {}, { mode: "developer", workspaceId })).rejects.toThrow("Workspace is unavailable");
            expect(assistantsService.welcome(assistant.id, "default")).toMatchObject({ state: "ready", answer: null });
            expect(await runsService.getRunById(welcome.runId)).toBeNull();
        }
        await assistantWelcome.respond("default", assistant.id, "Check TestFlight");
        await settled(welcome.runId);
        expect(driver.calls.createSession[0].mode).toBe("work");
    });
    it("keeps the accepted repo across a failed start and restart without replaying a different task", async () => {
        const { assistant, welcome } = await ready(), repo = workspace("retry-welcome");
        const execute = vi.spyOn(runsService, "executeRun").mockRejectedValueOnce(new Error("Connection lost before run creation"));
        await expect(assistantWelcome.respond("default", assistant.id, "Check TestFlight", {}, { mode: "developer", workspaceId: repo.id })).rejects.toThrow("Connection lost");
        expect(assistantsService.welcome(assistant.id, "default")).toMatchObject({ state: "starting", answer: "Check TestFlight", execution: { mode: "developer", workspaceId: repo.id } });
        await assistantWork.stop(); assistantWork.start();
        expect(driver.calls.createSession).toHaveLength(0);
        await expect(assistantWelcome.respond("default", assistant.id, "Check TestFlight", {}, { mode: "work" })).rejects.toThrow("original workspace");
        await assistantWelcome.respond("default", assistant.id, "Check TestFlight");
        await settled(welcome.runId);
        expect(execute).toHaveBeenCalledTimes(2);
        expect(driver.calls.createSession).toHaveLength(1);
        expect(driver.calls.createSession[0].execution).toMatchObject({ workspaceId: repo.id, cwd: repo.rootPath });
    });
    it("uses a selected repo when the first real message follows a skipped welcome", async () => {
        const { assistant, welcome } = await ready(), repo = workspace("skip-welcome-repo");
        await assistantWelcome.respond("default", assistant.id, null);
        await assistantWork.sendChat("default", assistant.id, "Review this repo", `welcome-${assistant.id}`, welcome.runId, undefined, {}, { mode: "developer", workspaceId: repo.id });
        await settled(welcome.runId);
        expect(driver.calls.createSession[0]).toMatchObject({ mode: "developer", execution: { workspaceId: repo.id, cwd: repo.rootPath } });
    });
    it("allows ordinary free text and attachments after skip, with idempotent delivery", async () => {
        const { assistant, welcome } = await ready();
        await assistantWelcome.respond("default", assistant.id, null);
        const key = `welcome-${assistant.id}`;
        const first = await assistantWork.sendChat("default", assistant.id, "Review this brief", key, welcome.runId, assistantWork.guard(), { initialContext: [{ kind: "note", content: "Verified release brief" }] });
        await settled(first.runId);
        await assistantWork.sendChat("default", assistant.id, "Review this brief", key, welcome.runId, assistantWork.guard());
        expect(driver.calls.createSession).toHaveLength(1);
        expect((await runsService.getContextByRun(first.runId)).some(row => row.content === "Verified release brief")).toBe(true);
        const next = await assistantWork.sendChat("default", assistant.id, "A different conversation", "welcome-new-chat");
        await settled(next.runId);
        expect(next.runId).not.toBe(first.runId);
        expect(assistantsService.welcome(assistant.id, "default")?.state).toBe("started");
    });
    it("retries malformed generation without ever creating an interactive run", async () => {
        const generate = vi.fn().mockResolvedValueOnce("invalid JSON").mockResolvedValue(JSON.stringify(question));
        driver.driver.generateText = generate;
        vi.mocked(createWorkAdapter).mockReturnValue(createWorkRunAdapter(driver.driver));
        const assistant = await makeAssistant("Release");
        assistantWork.start();
        await vi.waitFor(() => expect(assistantsService.welcome(assistant.id, "default")?.state).toBe("failed"));
        assistantWelcome.retry("default", assistant.id);
        await vi.waitFor(() => expect(assistantsService.welcome(assistant.id, "default")?.state).toBe("ready"));
        expect(generate).toHaveBeenCalledTimes(2);
        expect(driver.calls.createSession).toHaveLength(0);
    });
    it("cancels generation on shutdown and safely retries only the question after restart", async () => {
        const generate = vi.fn().mockImplementationOnce((_prompt, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("canceled")), { once: true }))).mockResolvedValue(JSON.stringify(question));
        driver.driver.generateText = generate;
        vi.mocked(createWorkAdapter).mockReturnValue(createWorkRunAdapter(driver.driver));
        const assistant = await makeAssistant("Release");
        assistantWork.start();
        await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
        await assistantWork.stop();
        expect(assistantsService.welcome(assistant.id, "default")?.state).toBe("generating");
        assistantWork.start();
        await vi.waitFor(() => expect(assistantsService.welcome(assistant.id, "default")?.state).toBe("ready"));
        expect(generate).toHaveBeenCalledTimes(2);
        expect(driver.calls.createSession).toHaveLength(0);
    });
    it("reconciles a lost dispatch response using its existing run, without replaying it", async () => {
        const { assistant, welcome } = await ready();
        await assistantWelcome.respond("default", assistant.id, "Check TestFlight");
        await settled(welcome.runId);
        assistantsRepo.patchWelcome(assistant.id, { state: "starting" });
        await assistantWork.stop();
        assistantWork.start();
        expect(assistantsService.welcome(assistant.id, "default")?.state).toBe("started");
        expect(driver.calls.createSession).toHaveLength(1);
    });
    it("does not generate a welcome for archived assistants or another account", async () => {
        const assistant = await makeAssistant("Release");
        assistantsService.archive(assistant.id, "default", true);
        const generate = vi.fn();
        driver.driver.generateText = generate;
        vi.mocked(createWorkAdapter).mockReturnValue(createWorkRunAdapter(driver.driver));
        assistantWork.start();
        await expect(assistantWelcome.respond("another-account", assistant.id, null)).rejects.toThrow("unavailable");
        expect(generate).not.toHaveBeenCalled();
    });
});

describe("task-local execution and Code assistant calls", () => {
    it("accepts a scoped Code task report through the dynamic tool broker and delivers it to its requester", async () => {
        const w = workspace("code-report"), assistant = await makeAssistant("TestFlight");
        const source = createRun(db, { id: "report-source", workspaceId: w.id, providerId: "codex", sessionId: "source-session", title: "TestFlight readiness", mode: "developer", status: "succeeded" });
        const task = await assistantWork.assign({ accountId: "default", toAssistantId: assistant.id, taskKey: "code-report", title: "Check", prompt: "Check TestFlight" }, source.id);
        // Native task reports arrive during the worker turn, before its terminal status.
        let finishWorker!: () => void;
        const workerTurn = new Promise<void>(resolve => { finishWorker = resolve; });
        const executePrompt = driver.driver.executePrompt;
        driver.driver.executePrompt = async (...args) => {
            if ((args[0] as { id: string }).id === task.workerRunId) await workerTurn;
            return executePrompt(...args);
        };
        assistantWork.start();
        await vi.waitFor(() => expect(driver.calls.createSession.some(call => call.runId === task.workerRunId)).toBe(true));
        const request = driver.calls.createSession.find(call => call.runId === task.workerRunId)!;
        const broker = createCodexRequestBroker({
            getRunState: () => ({ mode: request.mode, assistantId: request.configSnapshot?.assistantId as string, fileChangeItems: new Map() }),
            getMainsToolContext: () => ({ workspaceId: w.id, rootPath: w.rootPath, runId: task.workerRunId! }),
        });
        const respondToRequest = vi.fn(), respondToRequestError = vi.fn();
        try {
            await broker.handleRequest({ runId: task.workerRunId!, runIsDead: false, id: 42, method: "item/tool/call", params: {
                tool: "ReportAssistantTask", arguments: { assignmentId: task.id, status: "completed", result: "Readiness check complete: NOT READY", evidence: ["swift-test.log"] },
            }, server: { respondToRequest, respondToRequestError } });
        } finally { finishWorker(); }
        expect(respondToRequestError).not.toHaveBeenCalled();
        expect(respondToRequest).toHaveBeenCalledWith(42, expect.objectContaining({ success: true }));
        expect(assistantsRepo.assignment(task.id)).toMatchObject({ status: "completed", result: "Readiness check complete: NOT READY", error: null });
        await vi.waitFor(() => expect(assistantsRepo.assignmentMessages(task.id).find(message => message.id.startsWith("report-"))).toMatchObject({ status: "delivered", error: null }));
        await vi.waitFor(async () => {
            const sourceHistory = await runsService.getHistoryPage({ runId: source.id });
            expect(sourceHistory.artifacts).toContainEqual(expect.objectContaining({ kind: "user-prompt", metadata: expect.objectContaining({ assistantTaskInput: expect.objectContaining({ kind: "result" }) }) }));
        });
        expect(assistantsService.assignment("default", task.id)?.activity?.find(item => item.kind === "result")?.content).toBe("Readiness check complete: NOT READY");
        await settled(source.id);
    });
    it("stores missing team membership without creating a default team", async () => {
        const assistant = await makeIndependentAssistant("Trip planner");
        const overview = assistantsService.overview("default");
        expect(overview.teams.map(team => team.id)).toEqual([teamId]);
        expect(overview.assistants).toEqual([expect.objectContaining({ id: assistant.id, teamId: null })]);
    });
    it("creates a Work assistant from a Code Space without a workspace choice and saves its avatar", async () => {
        db.update(spaces).set({ mode: "developer" }).where(eq(spaces.id, "codex")).run();
        const assistant = await assistantsService.create({ accountId: "default", teamId, name: "Trip planner", description: "Plan trips", instructions: "Plan practical trips.", spaceId: "codex", model: "test-model", effort: "high", avatar: { shape: "cube", color: "mint" } });
        expect(assistant).not.toHaveProperty("workspaceId");
        expect(assistant).not.toHaveProperty("mode");
        expect(assistant.avatar).toEqual({ shape: "cube", color: "mint" });
        const result = await assistantWork.sendChat("default", assistant.id, "Plan a trip", "task-local-work-chat");
        await settled(result.runId);
        const run = await runsService.getRunById(result.runId);
        expect(run).toMatchObject({ mode: "work", workspaceId: null });
        expect(driver.calls.createSession.at(-1)?.execution.cwd).toContain(join("runs", result.runId, "work"));
    });
    it("runs one assistant against two task workspaces and preserves each conversation on resume", async () => {
        const a = workspace("app"), b = workspace("landing"), assistant = await makeAssistant("Release");
        const first = await assistantWork.sendChat("default", assistant.id, "Check the app", "task-local-code-app", undefined, undefined, {}, { mode: "developer", workspaceId: a.id });
        await settled(first.runId);
        const second = await assistantWork.sendChat("default", assistant.id, "Check landing", "task-local-code-web", undefined, undefined, {}, { mode: "developer", workspaceId: b.id });
        await settled(second.runId);
        expect((await runsService.getRunById(first.runId))?.workspaceId).toBe(a.id);
        expect((await runsService.getRunById(second.runId))?.workspaceId).toBe(b.id);
        expect(await runsService.getRunsByWorkspace(a.id)).toEqual([]);
        expect(await runsService.getRunsByWorkspace(b.id)).toEqual([]);
        expect(assistantsService.conversations(assistant.id, "default").map(chat => chat.id)).toEqual(expect.arrayContaining([first.runId, second.runId]));
        db.update(spaces).set({ mode: "chat" }).where(eq(spaces.id, "codex")).run();
        await assistantWork.sendChat("default", assistant.id, "Check again", "task-local-followup", first.runId);
        await settled(first.runId);
        expect(driver.calls.resumeSession.at(-1)).toMatchObject({ mode: "developer", model: "test-model", execution: { workspaceId: a.id, cwd: a.rootPath } });
        await expect(assistantWork.sendChat("default", assistant.id, "Check the app", "task-local-code-app", undefined, undefined, {}, { mode: "developer", workspaceId: b.id })).rejects.toThrow("different workspace");
    });
    it("lets ordinary Code chats delegate, keeping private memory and unrelated tasks isolated", async () => {
        const w = workspace("normal-code"), assistant = await makeAssistant("TestFlight");
        const source = createRun(db, { id: "normal-code-source", workspaceId: w.id, accountId: "default", providerId: "codex", mode: "developer", status: "succeeded" });
        const other = createRun(db, { id: "other-code-source", workspaceId: w.id, accountId: "default", providerId: "codex", mode: "developer", status: "succeeded" });
        const task = await assistantWork.assign({ accountId: "default", toAssistantId: assistant.id, taskKey: "ordinary-call", title: "TestFlight check", prompt: "Check signing" }, source.id);
        expect(task.execution).toEqual({ mode: "developer", workspaceId: w.id });
        expect(task.fromAssistantId).toBeNull();
        assistantWork.start();
        await vi.waitFor(() => expect(assistantsRepo.assignment(task.id)?.status).toBe("blocked"));
        expect((await runsService.getRunById(task.workerRunId!))?.workspaceId).toBe(w.id);
        expect(await assistantWork.tool(source.id, "ReadAssistantTask", { assignmentId: task.id })).toMatchObject({ id: task.id });
        await expect(assistantWork.tool(other.id, "ReadAssistantTask", { assignmentId: task.id })).rejects.toThrow("unavailable");
        await expect(assistantWork.tool(source.id, "RecallAssistantMemory", {})).rejects.toThrow("assistant conversation");
        await assistantWork.report(task.workerRunId!, { assignmentId: task.id, status: "completed", result: "Signing verified", evidence: ["Build 42 passed"] });
        const history = await runsService.getHistoryPage({ runId: source.id });
        expect(history.artifacts.some(a => a.metadata?.source === "assistant_assignment" && a.metadata.assignmentId === task.id)).toBe(true);
    });
    it("dispatches a structured @ selection only after its exact prompt is accepted and deduplicates replayed context", async () => {
        const w = workspace("mention-code"), assistant = await makeAssistant("TestFlight");
        const source = createRun(db, { id: "mention-source", workspaceId: w.id, accountId: "default", providerId: "codex", mode: "developer", status: "succeeded" });
        const { prepareAssistantMentions } = await import("./assistant-mentions");
        const prepared = prepareAssistantMentions({ accountId: "default", mode: "developer", prompt: "Check the current build", promptId: "accepted-mention-message", context: { initialContext: [
            { kind: "note", metadata: { source: "assistant_mention", assistantId: assistant.id, token: `@assistant-${assistant.id}`, requestId: "stable-mention-request" } },
            { kind: "note", content: "Check build 42 only" },
        ] } });
        for (const item of prepared.items ?? []) await runsService.addContext({ runId: source.id, ...item });
        assistantWork.start();
        await assistantWork.drain();
        expect(assistantsRepo.assignments("default")).toHaveLength(0);
        await insertRunInputArtifact(source.id, { type: "artifact", kind: "user-prompt", content: "A different message with the same receipt", metadata: { clientPromptId: prepared.promptId } });
        await assistantWork.drain();
        expect(assistantsRepo.assignments("default")).toHaveLength(0);
        await insertRunInputArtifact(source.id, { type: "artifact", kind: "user-prompt", content: "Check the current build", metadata: { clientPromptId: prepared.promptId } });
        await assistantWork.drain();
        await vi.waitFor(() => expect(assistantsRepo.assignments("default")).toHaveLength(1));
        const task = assistantsRepo.assignments("default")[0];
        await settled(task.workerRunId!);
        expect((await runsService.getContextByRun(task.workerRunId!)).some(item => item.content === "Check build 42 only")).toBe(true);
        for (const item of prepared.items ?? []) await runsService.addContext({ runId: source.id, ...item });
        await assistantWork.drain();
        await assistantWork.stop(); assistantWork.start(); await assistantWork.drain();
        expect(assistantsRepo.assignments("default")).toHaveLength(1);
        expect(driver.calls.createSession.filter(c => c.runId === task.workerRunId)).toHaveLength(1);
    });
    it("rejects foreign and archived workspace targets before admitting work", async () => {
        const foreign = workspace("foreign", "another-account"), archived = workspace("archived"), assistant = await makeAssistant("TestFlight");
        db.update((await import("../../db/schema")).workspaces).set({ isArchived: true }).where(eq((await import("../../db/schema")).workspaces.id, archived.id)).run();
        for (const id of [foreign.id, archived.id]) await expect(assistantWork.assign({ accountId: "default", toAssistantId: assistant.id, taskKey: id, title: "Check", prompt: "Check", execution: { mode: "developer", workspaceId: id } })).rejects.toThrow("Workspace is unavailable");
        expect(assistantsRepo.assignments("default")).toHaveLength(0);
    });
});

it("connects a real Code submission to its teamless @ task and keeps mention names readable", async () => {
    const rootPath = join(root, "submitted-code"); mkdirSync(rootPath);
    const workspace = createWorkspace(db, { id: "submitted-code", rootPath });
    const assistant = await makeIndependentAssistant("TestFlight");
    assistantWork.start();
    const source = await runsService.executeRun({ accountId: "default", providerId: "codex", spaceId: "codex", mode: "developer", workspaceId: workspace.id,
        goal: `@assistant-${assistant.id} Check build 42`, clientPromptId: "code-source-message", initialContext: [{ kind: "note", metadata: { source: "assistant_mention", assistantId: assistant.id, token: `@assistant-${assistant.id}`, requestId: "selected-assistant" } }] });
    await settled(source.runId);
    await vi.waitFor(() => expect(assistantsRepo.assignments("default").some(t => t.fromRunId === source.runId)).toBe(true));
    const task = assistantsRepo.assignments("default").find(t => t.fromRunId === source.runId)!;
    expect(task).toMatchObject({ teamId: null, toAssistantId: assistant.id });
    expect(task.prompt).toBe("@TestFlight Check build 42");
    expect(task.execution).toEqual({ mode: "developer", workspaceId: workspace.id });
    const history = await runsService.getHistoryPage({ runId: source.runId });
    const prompt = history.artifacts.find(a => String(a.kind) === "user-prompt");
    expect(prompt?.metadata?.assistantMentions).toEqual([{ id: assistant.id, name: "TestFlight", token: `@assistant-${assistant.id}` }]);
});
