import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ArchivedRun, ArchivedWorkspace } from "@/lib/redux/api";
import {
  ArchivedWorkspaceRow,
  groupArchivedRuns,
} from "./archived-workspaces";

function archivedWorkspace(
  overrides: Partial<ArchivedWorkspace> = {},
): ArchivedWorkspace {
  return {
    id: "workspace-1",
    accountId: "default",
    projectId: "project-1",
    name: "Archived workspace",
    rootPath: "/tmp/workspace-1",
    repoUrl: null,
    baseBranch: "main",
    metadata: null,
    status: "done",
    isArchived: true,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-02T00:00:00Z"),
    projectName: "Project",
    pathExists: true,
    worktree: null,
    ...overrides,
  };
}

describe("ArchivedWorkspaceRow", () => {
  it("shows a missing Project and disables only Unarchive", () => {
    const markup = renderToStaticMarkup(
      createElement(ArchivedWorkspaceRow, {
        workspace: archivedWorkspace({ projectName: null }),
        onDelete: vi.fn(),
        onUnarchive: vi.fn(),
      }),
    );

    expect(markup).toContain("Project missing");
    expect(markup.match(/ disabled=""/g)).toHaveLength(1);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Unarchive<\/button>/);
  });

  it("keeps Unarchive available when the Project exists", () => {
    const markup = renderToStaticMarkup(
      createElement(ArchivedWorkspaceRow, {
        workspace: archivedWorkspace(),
        onDelete: vi.fn(),
        onUnarchive: vi.fn(),
      }),
    );

    expect(markup).not.toContain("Project missing");
    expect(markup).not.toContain('disabled=""');
  });
});

function archivedRun(overrides: Partial<ArchivedRun> = {}): ArchivedRun {
  return {
    id: "run-1",
    accountId: "default",
    workspaceId: null,
    collectionId: null,
    spaceId: null,
    providerId: "claude_code",
    mode: "developer",
    model: null,
    title: "A run",
    goal: null,
    status: "succeeded",
    systemPrompt: null,
    configSnapshot: null,
    toolPolicySnapshot: null,
    startedAt: null,
    endedAt: null,
    lastError: null,
    sessionId: null,
    isArchived: true,
    createdAt: Date.parse("2026-08-01T00:00:00Z"),
    updatedAt: Date.parse("2026-08-02T00:00:00Z"),
    workspace: null,
    collection: null,
    ...overrides,
  };
}

describe("groupArchivedRuns", () => {
  const life = { id: "collection-1", name: "Life", icon: "emoji:❤️" };

  it("splits code runs from chats and names each group by its own owner", () => {
    const sections = groupArchivedRuns(
      [
        archivedRun({
          id: "code-1",
          workspace: { id: "ws-1", name: "mains", isArchived: false, icon: null },
        }),
        archivedRun({ id: "code-2" }),
        archivedRun({
          id: "chat-1",
          mode: "chat",
          collectionId: life.id,
          collection: life,
        }),
        archivedRun({ id: "chat-2", mode: "work" }),
      ],
      "",
    );

    expect(
      sections.map((section) => [
        section.key,
        section.groups.map((group) => [group.title, group.runs.length]),
      ]),
    ).toEqual([
      [
        "code",
        [
          ["mains", 1],
          ["No workspace", 1],
        ],
      ],
      [
        "chats",
        [
          ["Life", 1],
          ["No project", 1],
        ],
      ],
    ]);
  });

  it("files a chat with no project under No project", () => {
    const [chats] = groupArchivedRuns(
      [archivedRun({ mode: "chat" })],
      "",
    );

    expect(chats.key).toBe("chats");
    expect(chats.groups.map((group) => group.title)).toEqual(["No project"]);
  });

  it("carries each group's own icon", () => {
    const [code, chats] = groupArchivedRuns(
      [
        archivedRun({
          id: "code-1",
          workspace: {
            id: "ws-1",
            name: "mains",
            isArchived: false,
            icon: "icon:rocket",
          },
        }),
        archivedRun({
          id: "chat-1",
          mode: "chat",
          collectionId: life.id,
          collection: life,
        }),
      ],
      "",
    );

    expect(code.groups[0].icon).toBe("icon:rocket");
    expect(chats.groups[0].icon).toBe("emoji:❤️");
  });

  it("matches a chat on its project name and drops empty sections", () => {
    const sections = groupArchivedRuns(
      [
        archivedRun({
          id: "code-1",
          workspace: { id: "ws-1", name: "mains", isArchived: false, icon: null },
        }),
        archivedRun({
          id: "chat-1",
          mode: "chat",
          collectionId: life.id,
          collection: life,
        }),
      ],
      "life",
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe("chats");
    expect(sections[0].groups[0].runs.map((run) => run.id)).toEqual(["chat-1"]);
  });
});
