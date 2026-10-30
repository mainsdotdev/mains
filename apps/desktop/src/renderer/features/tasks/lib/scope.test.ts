import { describe, expect, it } from "vitest";
import type { IssueWithEntity } from "@/lib/redux/api";
import {
  ALL_SCOPE,
  issueScopeCounts,
  matchesIssueScope,
  readTasksLocation,
  scopeForTab,
  supportsStatusMapping,
  tasksLocationParams,
} from "./scope";

function row(provider: string, resourceId: string | null): IssueWithEntity {
  return {
    issue: { provider, repo: null } as IssueWithEntity["issue"],
    entity: { resourceId } as IssueWithEntity["entity"],
  };
}

describe("readTasksLocation", () => {
  it("defaults to all issues", () => {
    expect(readTasksLocation(new URLSearchParams(""))).toEqual({
      tab: "issues",
      scope: ALL_SCOPE,
    });
  });

  it("reads tab, provider and resource", () => {
    const params = new URLSearchParams("tab=pull_requests&provider=github&resource=r1");
    expect(readTasksLocation(params)).toEqual({
      tab: "pull_requests",
      scope: { provider: "github", resourceId: "r1" },
    });
  });

  it("ignores a resource without its provider", () => {
    expect(readTasksLocation(new URLSearchParams("resource=r1")).scope).toEqual(ALL_SCOPE);
  });

  it("treats an unknown tab as issues", () => {
    expect(readTasksLocation(new URLSearchParams("tab=nope")).tab).toBe("issues");
  });

  it("drops a scope the pull request tab cannot show", () => {
    const params = new URLSearchParams("tab=pull_requests&provider=linear&resource=t1");
    expect(readTasksLocation(params).scope).toEqual(ALL_SCOPE);
  });
});

describe("tasksLocationParams", () => {
  it("omits defaults", () => {
    expect(tasksLocationParams("issues", ALL_SCOPE).toString()).toBe("");
  });

  it("round-trips through readTasksLocation", () => {
    const scope = { provider: "github", resourceId: "r1" };
    const params = tasksLocationParams("pull_requests", scope);
    expect(readTasksLocation(params)).toEqual({ tab: "pull_requests", scope });
  });

  it("keeps a provider-wide scope without a resource", () => {
    const params = tasksLocationParams("issues", { provider: "jira", resourceId: null });
    expect(params.toString()).toBe("provider=jira");
  });
});

describe("scopeForTab", () => {
  it("keeps a GitHub scope on the pull request tab", () => {
    const scope = { provider: "github", resourceId: "r1" };
    expect(scopeForTab(scope, "pull_requests")).toBe(scope);
  });

  it("keeps every scope on the issues tab", () => {
    const scope = { provider: "linear", resourceId: "t1" };
    expect(scopeForTab(scope, "issues")).toBe(scope);
  });
});

describe("matchesIssueScope", () => {
  it("matches everything for the all scope", () => {
    expect(matchesIssueScope(row("jira", "a"), ALL_SCOPE)).toBe(true);
  });

  it("filters by provider", () => {
    const scope = { provider: "github", resourceId: null };
    expect(matchesIssueScope(row("github", "a"), scope)).toBe(true);
    expect(matchesIssueScope(row("linear", "a"), scope)).toBe(false);
  });

  it("filters by resource, including providers with no issue.repo", () => {
    const scope = { provider: "gitlab", resourceId: "p1" };
    expect(matchesIssueScope(row("gitlab", "p1"), scope)).toBe(true);
    expect(matchesIssueScope(row("gitlab", "p2"), scope)).toBe(false);
    expect(matchesIssueScope(row("gitlab", null), scope)).toBe(false);
  });
});

describe("issueScopeCounts", () => {
  it("counts per provider and per resource", () => {
    const counts = issueScopeCounts([
      row("github", "a"),
      row("github", "a"),
      row("github", "b"),
      row("linear", "t"),
      row("linear", null),
    ]);
    expect(counts.total).toBe(5);
    expect(counts.byProvider.get("github")).toBe(3);
    expect(counts.byProvider.get("linear")).toBe(2);
    expect(counts.byResource.get("a")).toBe(2);
    expect(counts.byResource.get("t")).toBe(1);
    expect(counts.byResource.has("null")).toBe(false);
  });
});

describe("supportsStatusMapping", () => {
  it("is on for providers whose users define their own workflow states", () => {
    expect(["linear", "jira", "trello", "asana"].every(supportsStatusMapping)).toBe(true);
    expect(supportsStatusMapping("github")).toBe(false);
    expect(supportsStatusMapping("gitlab")).toBe(false);
  });
});
