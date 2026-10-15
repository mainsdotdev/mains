import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createAppSettings, createProject, createWorkspace, createRun, createProvider, createRunContext, createRunArtifact, createReview, createReviewFinding } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import { automations, pulses } from "../../db/schema";
import { assertOwnedRecord } from "./bridge.ownership";

let db: DatabaseInstance;
let cleanup: () => void;
vi.mock("../../db/client", () => ({ getDb: () => db }));
vi.mock("node-pty", () => ({ spawn: vi.fn() }));


import { workspaceRepo } from "../workspace/workspace.repo";
import { projectsRepo } from "../projects/projects.repo";
import { runsRepo } from "../runs/runs.repo";
import { pulseRepo } from "../pulse/pulse.repo";
import { automationsRepo } from "../automations/automations.repo";
import { workspaceService } from "../workspace/workspace.service";
import { projectsService } from "../projects/projects.service";
import { runsService } from "../runs/runs.service";
import { pulseService } from "../pulse/pulse.service";
import { automationsService } from "../automations/automations.service";
import { terminalService } from "../terminal/terminal.service";
import { gitFlowService } from "../gitFlow/gitFlow.service";

describe("Bridge ownership boundary", () => {
  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    createAppSettings(db, { backendId: "backend-a" });
    createProvider(db, { id: "codex" });
    for (const [suffix, ownerBackendId] of [["a", "backend-a"], ["b", "backend-b"]]) {
      createProject(db, { id: `project-${suffix}`, ownerBackendId, rootPath: "/same/repo", remoteOrigin: "github.com/org/repo" });
      createWorkspace(db, { id: `workspace-${suffix}`, ownerBackendId, projectId: `project-${suffix}`, rootPath: "/same/repo" });
      createRun(db, { id: `run-${suffix}`, ownerBackendId, workspaceId: `workspace-${suffix}`, providerId: "codex", status: "running" });
      db.insert(pulses).values({ id: `pulse-${suffix}`, ownerBackendId, accountId: "default", providerId: "codex", model: "test", title: "Daily", prompt: "Work", frequency: "daily", hour: 9, minute: 0, timezone: "UTC", nextRunAt: new Date(0) }).run();
      db.insert(automations).values({ id: `automation-${suffix}`, ownerBackendId, accountId: "default", name: "Sync", kind: "sync", action: "sync:all", intervalMinutes: 10, nextRunAt: new Date(0) }).run();
    }
  });
  afterEach(() => cleanup());

  it("lists both backends, but operational queries return only this backend", async () => {
    expect((await workspaceRepo.findAll()).map((row) => [row.id, row.isReplica])).toEqual(expect.arrayContaining([["workspace-a", false], ["workspace-b", true]]));
    expect((await workspaceRepo.findAllOwned()).map((row) => row.id)).toEqual(["workspace-a"]);
    expect((await projectsRepo.findAllOwned()).map((row) => row.id)).toEqual(["project-a"]);
    expect((await projectsRepo.findByRemoteOrigin("default", "github.com/org/repo"))?.id).toBe("project-a");
    expect((await workspaceRepo.findByRootPath("default", "/same/repo"))?.id).toBe("workspace-a");
    expect((await runsRepo.findPendingRuns()).map((row) => row.id)).toEqual(["run-a"]);
    expect((await runsRepo.findOwnedRunsByStatus("default", "running")).map((row) => row.id)).toEqual(["run-a"]);
    expect(pulseRepo.findActive().map((row) => row.id)).toEqual(["pulse-a"]);
    expect(pulseRepo.findDueActive(new Date()).map((row) => row.id)).toEqual(["pulse-a"]);
    expect(pulseRepo.findNextScheduled()?.id).toBe("pulse-a");
    expect(automationsRepo.findActive().map((row) => row.id)).toEqual(["automation-a"]);
    expect(automationsRepo.findDue(new Date()).map((row) => row.id)).toEqual(["automation-a"]);
  });

  it("refuses replica mutations before git, filesystem, provider or scheduler effects", async () => {
    await expect(workspaceService.switchBranch("workspace-b", "main")).rejects.toThrow(/read-only/);
    await expect(workspaceService.delete("workspace-b", { removeWorktree: true })).rejects.toThrow(/read-only/);
    await expect(projectsService.remove("project-b")).rejects.toThrow(/read-only/);
    expect(() => terminalService.create("remote-terminal", "/tmp", () => {}, { workspaceId: "workspace-b" })).toThrow(/read-only/);
    await expect(gitFlowService.resolveRoot("workspace-b")).rejects.toThrow(/read-only/);
    await expect(runsService.updateRun("run-b", { title: "No" })).rejects.toThrow(/read-only/);
    await expect(runsService.archiveRun("run-b")).rejects.toThrow(/read-only/);
    await expect(runsService.abortRun("run-b")).rejects.toThrow(/read-only/);
    expect(() => pulseService.update("pulse-b", { title: "No" })).toThrow(/read-only/);
    await expect(pulseService.executePulse("pulse-b")).rejects.toThrow(/read-only/);
    expect(() => automationsService.delete("automation-b")).toThrow(/read-only/);
    await expect(automationsService.executeAutomation("automation-b")).rejects.toThrow(/read-only/);
  });

  it("inherits ownership for child mutations and creation targets", async () => {
    const context = createRunContext(db, { runId: "run-b" });
    await expect(runsService.removeContext(context.id)).rejects.toThrow(/read-only/);
    createReview(db, { id: "remote-review", workspaceId: "workspace-b", runId: "run-b" });
    createReviewFinding(db, { id: "remote-finding", reviewId: "remote-review" });
    await expect(workspaceService.updateFinding("remote-finding", { validated: true })).rejects.toThrow(/read-only/);
    await expect(workspaceService.create({ accountId: "default", name: "No", projectId: "project-b", rootPath: "/tmp/no" })).rejects.toThrow(/read-only/);
    await expect(runsService.createRun({ id: "no", accountId: "default", workspaceId: "workspace-b", providerId: "codex" })).rejects.toThrow(/read-only/);
    expect(() => assertOwnedRecord("runs", "run-a")).not.toThrow();
  });

  it("reads replica transcripts without resolving or inspecting the source filesystem", async () => {
    createRunArtifact(db, { runId: "run-b", kind: "report", content: "Stored reply" });
    createRunArtifact(db, { runId: "run-b", kind: "file", path: "/same/repo/output.txt" });
    const resolveRoot = vi.spyOn(runsService, "getRunExecutionRoot");
    try {
      const artifacts = await runsService.getArtifactsByRun("run-b");
      expect(artifacts).toHaveLength(2);
      expect(artifacts[0].content).toBe("Stored reply");
      const history = await runsService.getHistoryPage({ runId: "run-b" });
      expect(history.artifacts).toHaveLength(2);
      expect((await runsService.getRunDetails("run-b"))?.artifacts).toHaveLength(2);
      expect(resolveRoot).not.toHaveBeenCalled();
    } finally { resolveRoot.mockRestore(); }
  });
});
