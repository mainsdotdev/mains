import assert from "node:assert/strict";
import test from "node:test";
import { initialConversationSettings, modelSelectionPatch, patchConversationSettings, projectRunConfig } from "../src/lib/conversation-settings.ts";
import { createConversationSettingsWriter, createSettingsIntents } from "../src/lib/conversation-settings-writer.ts";
import { dedupeModelsByPrettyName, parseServiceTiers, runSettingsFromConfig } from "../src/lib/models.ts";

const a = { model: "chat-a", config: { modelReasoningEffort: "high", sandboxMode: "workspace-write", serviceTier: "ultrafast", goalMode: true, planMode: true } };
const b = { model: "chat-b", config: { modelReasoningEffort: "low", sandboxMode: "read-only" } };
const run = (settings) => ({ model: "initial-model", configSnapshotJson: JSON.stringify({ conversationSettings: settings }) });
const options = { providerId: "codex", providerConfig: b.config, remembered: b, defaultModel: "provider-default" };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("opening a chat keeps its model, effort and permissions instead of new-chat defaults", () => {
  assert.deepEqual(initialConversationSettings({ ...options, run: run(a) }), a);
  assert.deepEqual(initialConversationSettings({ ...options, run: run(b) }), b);
  assert.deepEqual(initialConversationSettings({ ...options, run: run(a), draft: b, latestModel: "last-turn" }), a);
});

test("legacy chats use their last turn and execution settings; a loading chat has no default model", () => {
  const settings = initialConversationSettings({ ...options, run: { model: "original", configSnapshotJson: JSON.stringify(a.config) }, latestModel: "last-turn" });
  assert.equal(settings.model, "last-turn");
  assert.equal(settings.config.modelReasoningEffort, "high");
  assert.equal(settings.config.sandboxMode, "workspace-write");
  assert.equal(initialConversationSettings({ ...options, run: { model: null, configSnapshotJson: null } }).model, "");
});

test("new chats remember accepted preferences but reset Plan/Goal, while deliberate draft toggles survive", () => {
  const settings = initialConversationSettings({ ...options, remembered: a });
  assert.equal(settings.model, a.model);
  assert.equal(settings.config.serviceTier, "ultrafast");
  assert.equal(settings.config.goalMode, false);
  assert.equal(settings.config.planMode, false);
  assert.deepEqual(initialConversationSettings({ ...options, draft: a }), a);
  assert.equal(a.config.goalMode, true);
});

test("sheet edits change one conversation and preserve provider-specific effort and permission keys", () => {
  const changed = patchConversationSettings("codex", a, { model: "next", effortLevel: "FutureEffort", permissionMode: "read-only", fastMode: false });
  assert.deepEqual(changed, { model: "next", config: { ...a.config, modelReasoningEffort: "FutureEffort", thinkingMode: true, sandboxMode: "read-only", serviceTier: "default" } });
  assert.equal(a.model, "chat-a");
  assert.equal(patchConversationSettings("copilot_cli", b, { effortLevel: "" }).config.thinkingMode, false);
  const claude = patchConversationSettings("claude_code", { model: "opus", config: {} }, { effortLevel: "ultracode", permissionMode: "auto" });
  assert.equal(claude.config.ultracode, true);
  assert.equal(patchConversationSettings("claude_code", claude, { effortLevel: "medium" }).config.ultracode, false);
  assert.equal(patchConversationSettings("cursor", b, { permissionMode: "ask" }).config.mode, "ask");
});

test("the phone caches only run-setting keys, never provider credentials or execution paths", () => {
  assert.deepEqual(projectRunConfig({ ...a.config, apiKey: "secret", additionalDirectories: ["/private"], conversationSettings: { ...a, config: { ...a.config, apiKey: "secret" } } }), { ...a.config, conversationSettings: a });
});

test("service tiers retain the catalog's identifiers and the conversation's selected speed", () => {
  const tiers = [{ id: "ultrafast", name: "Ultra fast" }, { id: "future-tier", name: "Future speed" }];
  assert.deepEqual(parseServiceTiers(JSON.stringify(tiers)), tiers);
  assert.equal(patchConversationSettings("codex", a, { serviceTier: "future-tier" }).config.serviceTier, "future-tier");
  assert.equal(runSettingsFromConfig("codex", a.config).fastMode, true);
  assert.deepEqual(parseServiceTiers("not json"), []);
});

test("choosing a model clamps unsupported effort and speed in the same conversation write", () => {
  const model = { id: "next", effortLevels: '["low", "medium"]', serviceTiersJson: '[{"id":"fast","name":"Fast"}]', supportsFastMode: true };
  assert.deepEqual(modelSelectionPatch("codex", a, model), { model: "next", effortLevel: "medium", serviceTier: "default" });
  assert.deepEqual(modelSelectionPatch("codex", { ...a, config: { modelReasoningEffort: "low", serviceTier: "priority" } }, model), { model: "next", serviceTier: "fast" });
  assert.equal(a.config.serviceTier, "ultrafast");
});

test("duplicate catalog labels keep the conversation's actual model ID without moving rows", () => {
  const first = { id: "alias", displayName: "Same model" };
  const chosen = { id: "saved-id", displayName: "Same model" };
  const other = { id: "other", displayName: "Other model" };
  assert.deepEqual(dedupeModelsByPrettyName([first, other, chosen], "codex", "saved-id"), [chosen, other]);
});

test("rapid selections save in order and keep the newest pending choice visible", async () => {
  const writer = createConversationSettingsWriter();
  const first = deferred();
  const second = deferred();
  const sent = [];
  const one = writer.write("mac:chat", a, async (settings) => { sent.push(settings); await first.promise; });
  const two = writer.write("mac:chat", b, async (settings) => { sent.push(settings); await second.promise; });
  assert.deepEqual(writer.getPending("mac:chat"), b);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(sent, [a]);
  first.resolve();
  await one;
  assert.deepEqual(writer.getPending("mac:chat"), b);
  second.resolve();
  await two;
  await writer.wait("mac:chat");
  assert.deepEqual(sent, [a, b]);
  assert.equal(writer.getPending("mac:chat"), null);
});

test("a failed save rolls back and does not block the next selection or another computer", async () => {
  const writer = createConversationSettingsWriter();
  const first = deferred();
  const one = writer.write("mac-a:chat", a, () => first.promise);
  const two = writer.write("mac-a:chat", b, async () => {});
  const other = writer.write("mac-b:chat", a, async () => {});
  await other;
  assert.deepEqual(writer.getPending("mac-a:chat"), b);
  first.reject(new Error("refused"));
  await assert.rejects(one, /refused/);
  await two;
  assert.equal(writer.getPending("mac-a:chat"), null);
  await assert.rejects(writer.write("mac-a:chat", a, async () => { throw new Error("offline"); }), /offline/);
  assert.equal(writer.getPending("mac-a:chat"), null);
});

test("late successful replies cannot replace newer accepted new-chat defaults", () => {
  const intents = createSettingsIntents();
  const first = intents.begin("mac:codex");
  const second = intents.begin("mac:codex");
  assert.equal(intents.accept("mac:codex", second), true);
  assert.equal(intents.accept("mac:codex", first), false);
  const older = intents.begin("mac:claude");
  intents.begin("mac:claude"); // A later rejected/unsent choice doesn't discard a success.
  assert.equal(intents.accept("mac:claude", older), true);
});
test("enabling Goal or Plan turns off the other mode, matching the desktop composer", () => {
  const original = { model: "model", config: { planMode: true, goalMode: false, sandboxMode: "read-only" } };
  const goal = patchConversationSettings("codex", original, { goalMode: true });
  assert.equal(goal.config.goalMode, true);
  assert.equal(goal.config.planMode, false);
  const plan = patchConversationSettings("codex", goal, { planMode: true });
  assert.equal(plan.config.planMode, true);
  assert.equal(plan.config.goalMode, false);
  assert.equal(plan.config.sandboxMode, "read-only");
});
