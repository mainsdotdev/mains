import { describe, it, expect } from "vitest";
import { selectSessionRunId } from "./select-session-run";

describe("selectSessionRunId", () => {
  it("returns the run tab being viewed", () => {
    expect(
      selectSessionRunId({ activeTab: "run-1", previousNonEditorTab: null }),
    ).toBe("run-1");
  });

  // Opening a changed file out of the panel switches to the editor; the panel
  // is still describing the run the user came from.
  it("falls back to the run the editor was opened from", () => {
    expect(
      selectSessionRunId({ activeTab: "editor", previousNonEditorTab: "run-1" }),
    ).toBe("run-1");
  });

  it("has no run for the empty state", () => {
    expect(
      selectSessionRunId({ activeTab: "editor", previousNonEditorTab: null }),
    ).toBeNull();
  });

  // The panel floats rather than sharing the layout when these return null, so
  // a tab that isn't a run must not resolve to one.
  it.each(["new-run", "issue:abc", "signal:abc", "note:abc"])(
    "has no run on the %s tab",
    (activeTab) => {
      expect(
        selectSessionRunId({ activeTab, previousNonEditorTab: null }),
      ).toBeNull();
    },
  );

  it("does not fall back to a non-run tab the editor was opened from", () => {
    expect(
      selectSessionRunId({ activeTab: "editor", previousNonEditorTab: "new-run" }),
    ).toBeNull();
  });
});
