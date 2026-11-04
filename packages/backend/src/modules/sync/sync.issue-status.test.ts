import { describe, expect, it } from "vitest";
import {
  statusFromJiraCategory,
  statusFromLinearType,
  statusFromName,
  statusFromOpenClosed,
} from "./sync.issue-status";

describe("statusFromLinearType", () => {
  it("maps every Linear workflow state type", () => {
    expect(statusFromLinearType("triage")).toBe("backlog");
    expect(statusFromLinearType("backlog")).toBe("backlog");
    expect(statusFromLinearType("unstarted")).toBe("todo");
    expect(statusFromLinearType("started")).toBe("in_progress");
    expect(statusFromLinearType("completed")).toBe("done");
    expect(statusFromLinearType("canceled")).toBe("canceled");
  });

  it("treats Linear's duplicate type as canceled, not open", () => {
    expect(statusFromLinearType("duplicate", "Duplicate")).toBe("canceled");
  });

  it("reads a started state named like a review as in review", () => {
    expect(statusFromLinearType("started", "In Review")).toBe("in_review");
    expect(statusFromLinearType("started", "In Progress")).toBe("in_progress");
  });

  it("falls back on the name for a missing or unknown type", () => {
    expect(statusFromLinearType(undefined)).toBe("todo");
    expect(statusFromLinearType("something-new")).toBe("todo");
    expect(statusFromLinearType("something-new", "Won't fix")).toBe("canceled");
  });
});

describe("statusFromJiraCategory", () => {
  it("maps Jira status categories", () => {
    expect(statusFromJiraCategory("new")).toBe("todo");
    expect(statusFromJiraCategory("indeterminate")).toBe("in_progress");
    expect(statusFromJiraCategory("done")).toBe("done");
    expect(statusFromJiraCategory(null)).toBe("todo");
  });

  it("reads an in-progress status named like a review as in review", () => {
    expect(statusFromJiraCategory("indeterminate", "Code Review")).toBe("in_review");
    expect(statusFromJiraCategory("indeterminate", "In Progress")).toBe("in_progress");
  });
});

describe("statusFromOpenClosed", () => {
  it("treats anything but closed as todo (GitLab says 'opened')", () => {
    expect(statusFromOpenClosed("open")).toBe("todo");
    expect(statusFromOpenClosed("opened")).toBe("todo");
  });

  it("tells a won't-fix close apart from a completed one", () => {
    expect(statusFromOpenClosed("closed")).toBe("done");
    expect(statusFromOpenClosed("closed", "completed")).toBe("done");
    expect(statusFromOpenClosed("closed", "not_planned")).toBe("canceled");
  });
});

describe("statusFromName", () => {
  it.each([
    ["Backlog", "backlog"],
    ["To Do", "todo"],
    ["Not started", "todo"],
    ["Doing", "in_progress"],
    ["In Progress", "in_progress"],
    ["Code review", "in_review"],
    ["QA", "in_review"],
    ["Done", "done"],
    ["Shipped 🚀", "done"],
    ["Won't fix", "canceled"],
    ["Untitled section", "todo"],
  ])("guesses %s as %s", (name, expected) => {
    expect(statusFromName(name)).toBe(expected);
  });

  it("falls back to todo without a name", () => {
    expect(statusFromName(null)).toBe("todo");
    expect(statusFromName("  ")).toBe("todo");
  });
});
