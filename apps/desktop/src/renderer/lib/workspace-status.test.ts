import { describe, it, expect } from "vitest";
import { getWorkspaceStatusConfig } from "./workspace-status";

describe("getWorkspaceStatusConfig", () => {
  const statuses = [
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "done",
    "canceled",
    "duplicate",
  ] as const;

  it.each(statuses)("returns config for '%s'", (status) => {
    const config = getWorkspaceStatusConfig(status);
    expect(config).toHaveProperty("label");
    expect(config).toHaveProperty("color");
    expect(config).toHaveProperty("iconColor");
    expect(typeof config.label).toBe("string");
  });

  it("returns correct label for in_progress", () => {
    const config = getWorkspaceStatusConfig("in_progress");
    expect(config.label).toBe("In Progress");
  });

  it("returns correct label for done", () => {
    const config = getWorkspaceStatusConfig("done");
    expect(config.label).toBe("Done");
  });

  it("returns correct label for canceled", () => {
    const config = getWorkspaceStatusConfig("canceled");
    expect(config.label).toBe("Canceled");
  });
});
