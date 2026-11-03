import { describe, expect, it } from "vitest";
import type { Project, RecentRun, Workspace } from "@/lib/redux/api";
import { groupDeveloperChats } from "./developer-chat-groups";

const project = (id: string, extra: Partial<Project> = {}): Project => ({
  id, name: id, isArchived: false, sortOrder: 0, ...extra,
} as Project);
const workspace = (id: string, projectId: string, extra: Partial<Workspace> = {}): Workspace => ({
  id, projectId, name: id, rootPath: `/repos/${id}`, isArchived: false, metadata: null, ...extra,
} as Workspace);
const chat = (id: string, workspaceId: string | null, extra: Partial<RecentRun> = {}): RecentRun => ({
  id, title: id, workspaceId, mode: "developer", isArchived: false, pinnedAt: null, ...extra,
} as RecentRun);
const sources = { local: true, bridge: true };

describe("developer sidebar project chats", () => {
  it("puts local and worktree chats directly in the same project, without workspace subgroups", () => {
    const result = groupDeveloperChats([chat("review", "local"), chat("fix", "tree")], [project("mains")],
      [workspace("local", "mains"), workspace("tree", "mains", { metadata: { worktree: { enabled: true } } })], new Map(), sources, "");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].project.name).toBe("mains");
    expect(result.groups[0].chats.map((run) => run.id)).toEqual(["review", "fix"]);
    expect(result.recents).toEqual([]);
  });

  it("keeps legacy pinned chats in their project and hides chats without an available workspace", () => {
    const result = groupDeveloperChats([chat("pinned", "local", { pinnedAt: 1 }), chat("orphan", "missing"),
      chat("detached", null),
      chat("work-mode", "local", { mode: "work" }), chat("archived", "local", { isArchived: true })],
      [project("mains")], [workspace("local", "mains")], new Map(), sources, "");
    expect(result.groups[0].chats.map((run) => run.id)).toEqual(["pinned"]);
    expect(result.recents).toEqual([]);
  });

  it.each([false, true])("hides chats of archived workspaces, including replicas (%s)", (isReplica) => {
    const result = groupDeveloperChats([chat("active", "local"), chat("archived-workspace-chat", "archived", { isReplica })],
      [project("mains")], [workspace("local", "mains"), workspace("archived", "mains", { isArchived: true, isReplica })],
      new Map(), sources, "");
    expect(result.groups[0].chats.map((run) => run.id)).toEqual(["active"]);
    expect(result.recents).toEqual([]);
  });

  it("searches chat titles and live branches without losing workspace-to-project ownership", () => {
    const result = groupDeveloperChats([chat("fix", "tree"), chat("review", "local")], [project("mains")],
      [workspace("local", "mains"), workspace("tree", "mains")],
      new Map([["tree", { workspaceId: "tree", branch: "codex/login", pathExists: true }]]), sources, "login");
    expect(result.groups[0].chats.map((run) => run.id)).toEqual(["fix"]);
    expect(result.groups[0].project.id).toBe("mains");
  });

  it("merges another device's checkout of the same repository and honors the source filter", () => {
    const projects = [project("mains", { remoteOrigin: "github.com/team/mains" }),
      project("replica-project", { isReplica: true, remoteOrigin: "github.com/team/mains" })];
    const workspaces = [workspace("local", "mains"), workspace("remote", "replica-project", { isReplica: true })];
    const runs = [chat("own", "local"), chat("other-device", "remote", { isReplica: true })];
    const merged = groupDeveloperChats(runs, projects, workspaces, new Map(), sources, "");
    expect(merged.groups).toHaveLength(1);
    expect(merged.groups[0].chats.map((run) => run.id)).toEqual(["own", "other-device"]);
    const localOnly = groupDeveloperChats(runs, projects, workspaces, new Map(), { local: true, bridge: false }, "");
    expect(localOnly.groups[0].chats.map((run) => run.id)).toEqual(["own"]);
  });
});
