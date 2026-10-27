import assert from "node:assert/strict";
import test from "node:test";
import { composerModeControls } from "../src/lib/composer-mode.ts";

test("Codex Code, Work and Chat offer only the controls their harness supports", () => {
  const read = (draftMode) => composerModeControls({ providerId: "codex", draftMode });
  assert.deepEqual(read("developer"), { mode: "developer", showPermissionControls: true, supportsPlanMode: true, supportsGoalMode: true });
  assert.deepEqual(read("work"), { mode: "work", showPermissionControls: false, supportsPlanMode: false, supportsGoalMode: true });
  assert.deepEqual(read("chat"), { mode: "chat", showPermissionControls: false, supportsPlanMode: false, supportsGoalMode: false });
});

test("provider-specific Plan and Goal toggles stay hidden for the other engines", () => {
  for (const providerId of ["claude_code", "copilot_cli", "cursor"]) {
    const controls = composerModeControls({ providerId, draftMode: "developer" });
    assert.equal(controls.showPermissionControls, true);
    assert.equal(controls.supportsPlanMode, false);
    assert.equal(controls.supportsGoalMode, false);
  }
  assert.equal(composerModeControls({ providerId: "claude_code", draftMode: "work" }).showPermissionControls, false);
});

test("an existing conversation follows its saved mode when a different space is selected", () => {
  const controls = composerModeControls({ providerId: "codex", runId: "chat", runMode: "chat", draftMode: "developer" });
  assert.equal(controls.mode, "chat");
  assert.equal(controls.showPermissionControls, false);
  assert.equal(controls.supportsGoalMode, false);
  assert.equal(composerModeControls({ providerId: "codex", runId: "code", runMode: "developer", draftMode: "chat" }).supportsPlanMode, true);
});

test("a loading conversation cannot borrow the selected space's permissions", () => {
  for (const runMode of [undefined, null, "invalid"]) {
    assert.deepEqual(composerModeControls({ providerId: "codex", runId: "loading", runMode, draftMode: "developer" }), {
      mode: null, showPermissionControls: false, supportsPlanMode: false, supportsGoalMode: false,
    });
  }
});
