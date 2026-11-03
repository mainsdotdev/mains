import assert from "node:assert/strict";
import test from "node:test";

import { patchConversationSettings } from "../src/lib/conversation-settings.ts";
import {
  effortChoiceLabel,
  effortControlFor,
  effortStopIndex,
  modelOffersUltracode,
  previewModels,
} from "../src/lib/models.ts";

const ids = (...names) => names.map((id) => ({ id }));

test("a long catalogue keeps five models and pins the selected one inside them", () => {
  const models = ids("a", "b", "c", "d", "e", "f", "g");
  const folded = previewModels(models, "b", false);
  assert.deepEqual(folded.visible.map((model) => model.id), ["a", "b", "c", "d", "e"]);
  assert.equal(folded.hiddenCount, 2);
  assert.equal(folded.canFold, true);

  const pinned = previewModels(models, "g", false);
  assert.deepEqual(pinned.visible.map((model) => model.id), ["g", "a", "b", "c", "d"]);
  assert.equal(pinned.hiddenCount, 2);

  const open = previewModels(models, "g", true);
  assert.deepEqual(open.visible.map((model) => model.id), ["a", "b", "c", "d", "e", "f", "g"]);
  assert.equal(open.hiddenCount, 0);
  assert.equal(open.canFold, true);
  assert.equal(previewModels(models.slice(0, 5), "e", false).canFold, false);
});

test("effort follows the model: thinking, a switch, a short slider, or the full list", () => {
  assert.deepEqual(effortControlFor("claude_code", [], "", true), { kind: "thinking", on: true });
  assert.deepEqual(effortControlFor("claude_code", [], "", false), { kind: "thinking", on: false });
  assert.deepEqual(effortControlFor("copilot_cli", [], "", false), { kind: "hidden" });
  assert.deepEqual(effortControlFor("cursor", ["medium"], "", false), { kind: "toggle", on: false, level: "medium" });
  assert.deepEqual(effortControlFor("claude_code", ["high"], "ultracode", true), { kind: "toggle", on: true, level: "high" });
  assert.deepEqual(effortControlFor("codex", ["medium"], "medium", true), { kind: "hidden" });

  assert.deepEqual(
    effortControlFor("codex", ["high", "ultra", "low"], "ultra", true),
    { kind: "slider", stops: ["low", "high", "ultra"] },
  );
  const claude = effortControlFor("claude_code", ["low", "xhigh", "ultracode"], "low", true);
  assert.deepEqual(claude, { kind: "slider", stops: ["", "low", "xhigh"] });
  assert.equal(modelOffersUltracode("claude_code", ["low", "xhigh"]), true);
  assert.equal(modelOffersUltracode("codex", ["xhigh"]), false);

  const six = effortControlFor("claude_code", ["minimal", "low", "medium", "high", "xhigh"], "high", true);
  assert.equal(six.kind, "slider");
  assert.equal(six.stops.length, 6);
  const seven = effortControlFor("claude_code", ["minimal", "low", "medium", "high", "xhigh", "max"], "high", true);
  assert.equal(seven.kind, "list");
  assert.deepEqual(seven.options, ["", "minimal", "low", "medium", "high", "xhigh", "max"]);
});

test("the thumb parks on a real stop, and the pill names only a choice the sheet can show", () => {
  assert.equal(effortStopIndex(["", "low", "high", "xhigh"], "ultracode"), 3);
  assert.equal(effortStopIndex(["", "low", "high"], ""), 0);
  assert.equal(effortStopIndex(["low", "high"], "medium"), 0);
  assert.equal(effortStopIndex(["low", "medium", "high"], "xhigh"), 2);
  assert.equal(effortChoiceLabel({ kind: "thinking", on: true }, ""), "On");
  assert.equal(effortChoiceLabel({ kind: "thinking", on: false }, ""), null);
  assert.equal(effortChoiceLabel({ kind: "hidden" }, "high"), null);
  assert.equal(effortChoiceLabel({ kind: "slider", stops: ["", "high"] }, ""), "Off");
  assert.equal(effortChoiceLabel({ kind: "toggle", on: true, level: "high" }, "ultracode"), "Ultracode");
});

test("a thinking switch writes thinking without an effort level, and an effort write still wins", () => {
  const on = patchConversationSettings("claude_code", { model: "opus", config: { thinkingMode: false, effortLevel: "" } }, { thinkingMode: true });
  assert.equal(on.config.thinkingMode, true);
  assert.equal(on.config.effortLevel, "");

  const off = patchConversationSettings("claude_code", {
    model: "opus",
    config: { ultracode: true, thinkingMode: true, effortLevel: "high" },
  }, { thinkingMode: false });
  assert.equal(off.config.thinkingMode, false);
  assert.equal(off.config.ultracode, false);
  assert.equal(off.config.effortLevel, "");

  const cleared = patchConversationSettings("codex", { model: "gpt", config: { modelReasoningEffort: "high", thinkingMode: true } }, { thinkingMode: false });
  assert.equal(cleared.config.thinkingMode, false);
  assert.equal(cleared.config.modelReasoningEffort, "");

  const effortWins = patchConversationSettings("claude_code", {
    model: "opus",
    config: { ultracode: true, thinkingMode: true, effortLevel: "high" },
  }, { effortLevel: "", thinkingMode: true });
  assert.equal(effortWins.config.thinkingMode, false);
  assert.equal(effortWins.config.ultracode, false);
  assert.equal(effortWins.config.effortLevel, "");
});
