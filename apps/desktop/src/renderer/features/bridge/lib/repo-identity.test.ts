import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/redux/api/projectsApi";
import type { Workspace } from "@/lib/redux/api/workspaceApi";
import { planReplicaWorkspaces, replicaBranch, repoCloneUrl, repoIdentity } from "./repo-identity";

const project = (id: string, name: string, remoteOrigin: string | null, owner = "local"): Project => ({
  id, accountId: "default", name, rootPath: `/repos/${name}`, workspacesPath: null, branches: null, remoteOrigin, defaultBranch: "main",
  setupScript: null, runScript: null, archiveScript: null, icon: null, sortOrder: 0, commitInstructions: null, prInstructions: null,
  isArchived: false, createdAt: new Date(0), updatedAt: new Date(0), ownerBackendId: owner, isReplica: owner !== "local",
});
const workspace = (id: string, projectId: string | null, owner: string, repoUrl: string | null = null): Workspace => ({
  id, accountId: "default", projectId, name: id, rootPath: `/other/${id}`, repoUrl, baseBranch: null, metadata: null, status: "todo",
  isArchived: false, sortOrder: 0, pinnedAt: null, createdAt: new Date(0), updatedAt: new Date(0), ownerBackendId: owner, isReplica: true,
});

describe("repository identity across devices", () => {
  it("normalizes case and treats a missing remote as unidentifiable", () => {
    expect(repoIdentity(project("p", "docs", " GitHub.com/MainsDotDev/Docs "))).toBe("github.com/mainsdotdev/docs");
    expect(repoIdentity(project("p", "notes", null))).toBeNull();
    expect(repoIdentity(project("p", "notes", "  "))).toBeNull();
    expect(repoIdentity(undefined)).toBeNull();
  });

  it("clones from the source checkout's configured URL, falling back to https", () => {
    const docs = project("p", "docs", "github.com/mainsdotdev/docs");
    expect(repoCloneUrl([workspace("w", "p", "A", "git@github.com:mainsdotdev/docs.git")], docs)).toBe("git@github.com:mainsdotdev/docs.git");
    expect(repoCloneUrl([workspace("w", "p", "A")], docs)).toBe("https://github.com/mainsdotdev/docs.git");
    expect(repoCloneUrl([workspace("w", "p", "A")], project("q", "notes", null))).toBeNull();
  });

  it("merges by remote, groups remote-only repositories across devices and leaves the rest under their device", () => {
    const projects = new Map([
      ["local-docs", project("local-docs", "docs", "github.com/mainsdotdev/docs")],
      ["a-docs", project("a-docs", "docs", "github.com/MainsDotDev/docs", "A")],
      ["a-site", project("a-site", "website", "github.com/mainsdotdev/website", "A")],
      ["b-site", project("b-site", "website", "github.com/mainsdotdev/website", "B")],
      ["a-notes", project("a-notes", "notes", null, "A")],
    ]);
    const replicas = [workspace("a-docs-main", "a-docs", "A"), workspace("a-site-main", "a-site", "A", "git@github.com:mainsdotdev/website.git"),
      workspace("b-site-main", "b-site", "B"), workspace("a-notes-main", "a-notes", "A"), workspace("orphan", null, "A")];
    const plan = planReplicaWorkspaces(replicas, projects, ["local-docs"]);
    expect([...plan.merged]).toEqual([["local-docs", [replicas[0]]]]);
    expect(plan.remoteOnly).toHaveLength(1);
    expect(plan.remoteOnly[0]).toMatchObject({ identity: "github.com/mainsdotdev/website", cloneUrl: "git@github.com:mainsdotdev/website.git" });
    expect(plan.remoteOnly[0].workspaces.map((row) => row.id)).toEqual(["a-site-main", "b-site-main"]);
    expect(plan.unmatched.map((row) => row.id)).toEqual(["a-notes-main", "orphan"]);
  });

  it("joins a later local checkout of the same remote instead of keeping a separate repository group", () => {
    const projects = new Map([["a-site", project("a-site", "website", "github.com/mainsdotdev/website", "A")],
      ["local-site", project("local-site", "website", "github.com/mainsdotdev/website")]]);
    const replicas = [workspace("a-site-main", "a-site", "A")];
    expect(planReplicaWorkspaces(replicas, projects, []).remoteOnly).toHaveLength(1);
    const plan = planReplicaWorkspaces(replicas, projects, ["local-site"]);
    expect(plan.remoteOnly).toEqual([]);
    expect(plan.merged.get("local-site")?.map((row) => row.id)).toEqual(["a-site-main"]);
  });

  it("labels a replica by the source's last reported branch, then worktree, then the tracked branch", () => {
    const row = (metadata: Workspace["metadata"], baseBranch: string | null = "main") => ({ ...workspace("w", "p", "A"), metadata, baseBranch });
    expect(replicaBranch(row({ lastBranch: "fix/og", worktree: { enabled: true, name: "mango" } }))).toEqual({ branch: "fix/og", known: true });
    expect(replicaBranch(row({ worktree: { enabled: true, name: "mango" }, tracking: "origin/main" }))).toEqual({ branch: "mango", known: false });
    expect(replicaBranch(row({ worktree: { enabled: false }, tracking: "origin/feature/x" }))).toEqual({ branch: "feature/x", known: false });
    expect(replicaBranch(row({}, "develop"))).toEqual({ branch: "develop", known: false });
    expect(replicaBranch(row(null, null))).toEqual({ branch: "w", known: false });
  });
});
