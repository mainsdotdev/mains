import { describe, expect, it } from "vitest";
import type { WorkspaceActivity } from "@/lib/redux/api";
import { activityActionLabel, activityRow } from "./activity-row";

function activity(
  partial: Partial<WorkspaceActivity> & Pick<WorkspaceActivity, "type">,
): WorkspaceActivity {
  return {
    id: "a1",
    workspaceId: "w1",
    title: "Title",
    summary: null,
    metadata: null,
    refId: null,
    createdAt: 1,
    ...partial,
  };
}

describe("activityRow", () => {
  it("previews the first files and opens the chat that edited them", () => {
    const row = activityRow(activity({
      type: "diff",
      title: "4 files changed",
      refId: "run-1",
      metadata: {
        fileNames: [
          "src/a.ts",
          "src/b.ts",
          "src/nested/index.ts",
          "pkg/index.ts",
        ],
      },
    }));

    expect(row.subtitle).toBe("a.ts, b.ts, and 2 more");
    expect(row.detail).toBe("src/a.ts\nsrc/b.ts\nsrc/nested/index.ts\npkg/index.ts");
    expect(row.action).toEqual({ kind: "run", runId: "run-1" });
    expect(row.iconTone).toBe("default");
  });

  it("keeps a parent segment when two files share a name", () => {
    const row = activityRow(activity({
      type: "diff",
      title: "2 files changed",
      metadata: { fileNames: ["src/index.ts", "pkg/index.ts"] },
    }));

    expect(row.subtitle).toBe("src/index.ts, pkg/index.ts");
    expect(row.detail).toBeNull();
    expect(row.action).toBeNull();
  });

  it("does not repeat a legacy diff title under itself", () => {
    const row = activityRow(activity({
      type: "diff",
      title: "3 files changed",
      summary: "3 files changed",
      refId: "run-9",
    }));

    expect(row.subtitle).toBeNull();
    expect(row.action).toEqual({ kind: "run", runId: "run-9" });
  });

  it("marks an undone edit and drops the chat link's echo", () => {
    const row = activityRow(activity({
      type: "diff",
      title: "1 file changed",
      summary: "1 file changed",
      metadata: { undoneAt: 10, fileNames: ["src/a.ts"] },
      refId: "run-1",
    }));

    expect(row.title).toBe("1 file changed (undone)");
    expect(row.subtitle).toBe("a.ts");
    expect(row.undone).toBe(true);
    expect(row.iconTone).toBe("muted");
  });

  it("shows a commit subject beside the short hash", () => {
    const row = activityRow(activity({
      type: "commit",
      title: "Fix the activity row",
      refId: "abcdef1234567890",
    }));

    expect(row.title).toBe("You committed changes");
    expect(row.subtitle).toBe("Fix the activity row");
    expect(row.sha).toBe("abcdef1234567890");
    expect(row.detail).toBeNull();
  });

  it("opens a pull request and keeps the body behind the label", () => {
    const row = activityRow(activity({
      type: "pr",
      title: "Activity timeline",
      summary: "What changed\n\nAnd why.",
      refId: "https://github.com/acme/repo/pull/7",
      metadata: { base: "main", draft: true },
    }));

    expect(row.subtitle).toBe("Draft · main");
    expect(row.detail).toBe("What changed\n\nAnd why.");
    expect(row.action).toEqual({
      kind: "url",
      url: "https://github.com/acme/repo/pull/7",
    });
  });

  it("leaves a pull request without an http url unlinked", () => {
    const row = activityRow(activity({
      type: "pr",
      title: "Local only",
      refId: "not a url",
    }));

    expect(row.action).toBeNull();
  });

  it("opens a review note and shows a summary that used to be dropped", () => {
    const row = activityRow(activity({
      type: "review",
      title: "Code Review",
      summary: "Look at the timeline.\nThe icons are one color.",
      refId: "review-1",
      metadata: { status: "in_review" },
    }));

    expect(row.subtitle).toBe("Look at the timeline.");
    expect(row.detail).toContain("The icons are one color.");
    expect(row.action).toEqual({
      kind: "note",
      reviewId: "review-1",
      title: "Code Review",
      status: "in_review",
    });
  });

  it("colors a batch of findings and lists the counts", () => {
    const row = activityRow(activity({
      type: "finding",
      title: "3 findings saved",
      metadata: { count: 3, critical: 1, warning: 2, info: 0 },
    }));

    expect(row.title).toBe("Mains added 3 findings");
    expect(row.subtitle).toBe("1 critical, 2 warning");
    expect(row.iconTone).toBe("danger");
    expect(row.action).toBeNull();
  });

  it("opens the file a single finding names", () => {
    const row = activityRow(activity({
      type: "finding",
      title: "Finding in src/app.ts",
      summary: "Unchecked cast",
      metadata: { severity: "warning", file: "src/app.ts", lineStart: 12 },
    }));

    expect(row.title).toBe("Finding in src/app.ts:12");
    expect(row.subtitle).toBe("Unchecked cast");
    expect(row.iconTone).toBe("warning");
    expect(row.action).toEqual({ kind: "file", path: "src/app.ts" });
  });

  it("shows a dependency scan summary and treats high as danger", () => {
    const row = activityRow(activity({
      type: "finding",
      title: "Dependency scan: 4 packages",
      summary: "0 critical, 1 high, 2 medium risk",
      metadata: {
        summary: { total: 4, critical: 0, high: 1, medium: 2, low: 0, safe: 1 },
      },
    }));

    expect(row.subtitle).toBe("0 critical, 1 high, 2 medium risk");
    expect(row.iconTone).toBe("danger");
    expect(row.detail).toBeNull();
    expect(row.action).toBeNull();
  });

  it("puts the branch under a push", () => {
    const row = activityRow(activity({
      type: "push",
      title: "You pushed changes",
      metadata: { branch: "feature/activity" },
    }));

    expect(row.subtitle).toBe("feature/activity");
    expect(row.action).toBeNull();
  });

  it("names each click", () => {
    expect(activityActionLabel({ kind: "run", runId: "r" })).toBe("Open chat");
    expect(activityActionLabel({ kind: "url", url: "https://example.com" })).toBe("Open pull request");
    expect(activityActionLabel({ kind: "note", reviewId: "n", title: "T", status: "open" })).toBe("Open review");
    expect(activityActionLabel({ kind: "file", path: "a.ts" })).toBe("Open file");
  });
});
