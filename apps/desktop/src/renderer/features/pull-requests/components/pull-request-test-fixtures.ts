import type { PullRequestDetail } from "@/lib/redux/api/pullRequestsApi";

export const prFixture: PullRequestDetail = {
  provider: "github", nodeId: "pr-176", number: 176, title: "Prepare Mains 0.22.0 stable",
  url: "https://github.com/acme/widget/pull/176", repo: { owner: "acme", repo: "widget" },
  author: { login: "okan", avatarUrl: null }, state: "open", isDraft: false,
  additions: 29, deletions: 6, headRefName: "release/0.22.0", baseRefName: "dev",
  createdAt: "2026-11-06T06:00:00Z", updatedAt: "2026-11-06T06:10:00Z",
  ciStatus: "passing", reviewDecision: "APPROVED", bodyText: "Release preparation",
  body: "## Summary\nPrepare the stable release.\n\n- [x] Version updated\n- [x] Checks passed",
  mergedAt: null, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", autoMergeEnabled: false,
  viewerCanUpdate: true, comments: [], reviewThreads: [], latestReviews: [{ author: "reviewer", state: "APPROVED" }],
  checks: [{ name: "Desktop checks", status: "passing" }],
};

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
