import { describe, expect, it } from "vitest";
import {
  collectionIdForVisibleRun,
  projectForNewChat,
} from "./run-collection-context";

describe("collectionIdForVisibleRun", () => {
  it("does not restore the previous run's project on a standalone new-chat screen", () => {
    expect(
      collectionIdForVisibleRun("work", "new-run", {
        id: "previous-run",
        collectionId: "project-1",
      }),
    ).toBeUndefined();
  });

  it("syncs project membership from the run that is actually visible", () => {
    expect(
      collectionIdForVisibleRun("chat", "run-1", {
        id: "run-1",
        collectionId: "project-1",
      }),
    ).toBe("project-1");
  });

  it("syncs a visible standalone run back to standalone", () => {
    expect(
      collectionIdForVisibleRun("work", "run-1", {
        id: "run-1",
        collectionId: null,
      }),
    ).toBeNull();
  });
});

describe("projectForNewChat", () => {
  it("hides retained query data after switching to a standalone new chat", () => {
    expect(
      projectForNewChat("chat", null, {
        id: "project-1",
        name: "Health & Fitness",
      }),
    ).toBeUndefined();
  });

  it("returns the selected project in Work and Chat", () => {
    const project = { id: "project-1", name: "Health & Fitness" };
    expect(projectForNewChat("work", project.id, project)).toBe(project);
    expect(projectForNewChat("chat", project.id, project)).toBe(project);
  });

  it("does not flash the previous project while a new selection loads", () => {
    expect(
      projectForNewChat("work", "project-2", {
        id: "project-1",
        name: "Health & Fitness",
      }),
    ).toBeUndefined();
  });
});
