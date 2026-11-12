import { beforeEach, describe, expect, it, vi } from "vitest";

const { graphql } = vi.hoisted(() => ({ graphql: vi.fn() }));
vi.mock("@octokit/rest", () => ({ Octokit: class { graphql = graphql; } }));
import { createGithubPrSource } from "./github.source";

const ref = { owner: "acme", repo: "widget", number: 179 };
const source = () => createGithubPrSource({ token: "test" });
const pageInfo = { startCursor: "older", hasPreviousPage: true };
const actor = { login: "okan", avatarUrl: null };
const at = "2026-11-12T08:00:00Z";
const result = (key: string, nodes: unknown[]) => ({ repository: { pullRequest: {
  [key]: { nodes, pageInfo, totalCount: 84 },
} } });

beforeEach(() => graphql.mockReset());

describe("GitHub PR commit and activity pages", () => {
  it("loads older commit pages and preserves unsigned authors and canonical URLs", async () => {
    graphql.mockResolvedValue(result("commits", [null, { commit: {
      oid: "abc123", messageHeadline: "Prepare release", committedDate: at, url: "https://github.com/acme/widget/commit/abc123",
      author: { name: "Release Bot", user: null },
    } }]));
    const page = await source().getCommits(ref, { cursor: "before-this", pageSize: 25 });
    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("commits(last: $last, before: $before)"), {
      ...ref, last: 25, before: "before-this",
    });
    expect(page).toEqual({ totalCount: 84, ...pageInfo, items: [{
      oid: "abc123", message: "Prepare release", committedAt: at, author: null, authorName: "Release Bot",
      url: "https://github.com/acme/widget/commit/abc123",
    }] });
  });

  it("filters the provider timeline before pagination and uses the review submission time", async () => {
    graphql.mockResolvedValue(result("timelineItems", [
      { __typename: "PullRequestReview", id: "review", author: actor, body: "Looks good", createdAt: at,
        submittedAt: "2026-11-12T08:10:00Z", state: "APPROVED", url: "https://github.com/review" },
      { __typename: "PullRequestReview", id: "draft", state: "PENDING", createdAt: at },
      null,
    ]));
    const page = await source().getActivity(ref, { cursor: "before-review" }, "reviews");
    expect(graphql).toHaveBeenCalledWith(expect.any(String), {
      ...ref, last: 30, before: "before-review", types: ["PULL_REQUEST_REVIEW"],
    });
    expect(page.items).toEqual([expect.objectContaining({ id: "review", kind: "review", author: actor,
      createdAt: "2026-11-12T08:10:00Z", reviewState: "APPROVED", body: "Looks good" })]);
    expect(page).toMatchObject(pageInfo);
  });

  it("maps real lifecycle events, teams and removed actors without inventing activity", async () => {
    graphql.mockResolvedValue(result("timelineItems", [
      { __typename: "ReviewRequestedEvent", id: "request", actor, createdAt: at, requestedReviewer: { name: "Desktop" } },
      { __typename: "MergedEvent", id: "merge", actor: null, createdAt: at, commit: { oid: "merged-sha", url: "https://github.com/merged" } },
      { __typename: "HeadRefForcePushedEvent", id: "push", actor, createdAt: at, afterCommit: { oid: "new-head", url: "https://github.com/head" } },
      { __typename: "UnknownFutureEvent", id: "unknown", createdAt: at },
    ]));
    const page = await source().getActivity(ref, {}, "all");
    expect(page.items).toEqual([
      expect.objectContaining({ kind: "review_requested", reviewer: "Desktop", author: actor }),
      expect.objectContaining({ kind: "merged", author: null, commitOid: "merged-sha", url: "https://github.com/merged" }),
      expect.objectContaining({ kind: "force_pushed", commitOid: "new-head" }),
    ]);
    expect(page).toMatchObject(pageInfo);
  });

  it("reports an inaccessible PR instead of treating it as an empty timeline", async () => {
    graphql.mockResolvedValue({ repository: { pullRequest: null } });
    await expect(source().getActivity(ref, {}, "all")).rejects.toThrow("Pull request not found");
    await expect(source().getCommits(ref, {})).rejects.toThrow("Pull request not found");
  });
});

describe("GitHub PR check details", () => {
  const node = () => ({
    id: "pr", number: 179, title: "Prepare release", url: "https://github.com/acme/widget/pull/179", body: "Description",
    isDraft: false, state: "OPEN", additions: 1, deletions: 0, baseRefName: "main", headRefName: "release",
    createdAt: at, updatedAt: at, author: actor, repository: { name: "widget", owner: { login: "acme" } },
    mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", viewerCanUpdate: true, reviewDecision: null, mergedAt: null,
    comments: { nodes: [] }, reviewThreads: { nodes: [] }, latestReviews: { nodes: [] },
    commits: { totalCount: 84, nodes: [{ commit: { statusCheckRollup: { id: "rollup", state: "PENDING", contexts: {
      nodes: [{ __typename: "CheckRun", id: "check-1", name: "Desktop", status: "IN_PROGRESS", conclusion: null,
        detailsUrl: "https://github.com/check/1", startedAt: at, completedAt: null }],
      pageInfo: { endCursor: "checks-next", hasNextPage: true },
    } } } }] },
  });

  it("follows check pages on the same rollup and retains timing and legacy status links", async () => {
    graphql.mockResolvedValueOnce({ repository: { pullRequest: node() } }).mockResolvedValueOnce({ node: { contexts: {
      nodes: [{ __typename: "StatusContext", id: "legacy", context: "External CI", state: "SUCCESS", targetUrl: "https://ci.example.com/1" }],
      pageInfo: { endCursor: "checks-end", hasNextPage: false },
    } } });
    const detail = await source().getDetail(ref);
    expect(graphql).toHaveBeenNthCalledWith(2, expect.any(String), { id: "rollup", after: "checks-next" });
    expect(detail.commitCount).toBe(84);
    expect(detail.checks).toEqual([
      { id: "check-1", name: "Desktop", status: "pending", url: "https://github.com/check/1", startedAt: at, completedAt: null },
      { id: "legacy", name: "External CI", status: "passing", url: "https://ci.example.com/1", startedAt: null, completedAt: null },
    ]);
  });

  it("does not silently publish an incomplete check list when a later page fails", async () => {
    graphql.mockResolvedValueOnce({ repository: { pullRequest: node() } }).mockRejectedValueOnce(new Error("Rate limited"));
    await expect(source().getDetail(ref)).rejects.toThrow("Rate limited");
  });
});
