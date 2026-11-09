import { describe, expect, it, vi } from "vitest";
import type { SkillInfo } from "@/lib/redux/api/providersApi";
import { allowsImageSubmission, availableImageSkill, createImageCreatorLifecycle } from "./image-creator-lifecycle";

const skill: SkillInfo = { name: "imagegen", path: "/skills/imagegen/SKILL.md", scope: "system", enabled: true, userInvokable: true };
const eligible = { skill, prompt: "$imagegen A mountain", runsLoaded: true, settingsReady: true, loading: false };
describe("image creator submission policy", () => {
  it.each([
    ["missing skill", { skill: undefined }], ["empty instruction", { prompt: " $imagegen \n" }],
    ["history still loading", { runsLoaded: false }], ["settings still loading", { settingsReady: false }],
    ["native request pending", { loading: true }], ["running turn", { activeRun: { id: "run", status: "running" } }],
    ["queued turn", { activeRun: { id: "run", status: "queued" } }], ["wrong routed run", { runId: "other", activeRun: { id: "run", status: "succeeded" } }],
    ["missing routed run", { runId: "run" }],
  ])("does not submit with %s", (_name, patch) => {
    expect(allowsImageSubmission({ ...eligible, ...patch })).toBe(false);
  });
  it("allows an idle new run and a follow-up for the actual completed run", () => {
    expect(allowsImageSubmission(eligible)).toBe(true);
    expect(allowsImageSubmission({ ...eligible, runId: "run", activeRun: { id: "run", status: "succeeded" } })).toBe(true);
  });
  it("does not trust disabled, non-invokable, loading or failed skill discovery", () => {
    expect(availableImageSkill(skill, false, null)).toBe(skill);
    expect(availableImageSkill({ ...skill, enabled: false }, false, null)).toBeUndefined();
    expect(availableImageSkill({ ...skill, userInvokable: false }, false, null)).toBeUndefined();
    expect(availableImageSkill(skill, true, null)).toBeUndefined();
    expect(availableImageSkill(skill, false, new Error("Failed"))).toBeUndefined();
  });
});

describe("image creator operation ownership", () => {
  it("permits stopping a later turn when terminal status arrived before the previous stop receipt", () => {
    const life = createImageCreatorLifecycle(); life.attach();
    life.observeRun({ id: "run", status: "running" });
    const stop = life.beginStop("run", true)!;
    life.observeRun({ id: "run", status: "canceled" });
    stop.succeed(); stop.finish();
    life.observeRun({ id: "run", status: "running" });
    expect(life.beginStop("run", true)).toBeTruthy();
  });
  function owner() { const life = createImageCreatorLifecycle(); const detach = life.attach(); life.observeEligibility(true); return { life, detach }; }
  it("admits one preparation and lets only that attempt enter native delivery", () => {
    const { life } = owner(); const first = life.beginSubmission(true)!;
    expect(life.beginSubmission(true)).toBeUndefined(); expect(first.submit()).toBe(true);
    expect(first.submit()).toBe(false); expect(life.cancelPreparation()).toBe(false);
    first.finish(); expect(life.beginSubmission(true)).toBeTruthy();
  });
  it("cancels before delivery, releases its lease once and ignores the old finisher", () => {
    const { life } = owner(); const first = life.beginSubmission(true)!; const release = vi.fn(); first.own(release);
    expect(life.cancelPreparation()).toBe(true); expect(life.cancelPreparation()).toBe(false);
    const next = life.beginSubmission(true)!;
    expect(first.submit()).toBe(false); first.finish();
    expect(next.current()).toBe(true); expect(release).toHaveBeenCalledOnce();
  });
  it("rechecks eligibility before native delivery", () => {
    const { life } = owner(); const first = life.beginSubmission(true)!;
    life.observeEligibility(false); expect(first.submit()).toBe(false); first.finish();
    expect(life.canSubmit(false)).toBe(false);
  });
  it("retains a new-conversation acceptance barrier if later handoff fails", () => {
    const { life } = owner(); const first = life.beginSubmission(true)!;
    first.submit(); expect(first.accept(true)).toBe(true); first.finish();
    expect(life.beginSubmission(true)).toBeUndefined();
  });
  it("permits a new follow-up after its prior accepted submission finishes", () => {
    const { life } = owner(); const first = life.beginSubmission(true)!;
    first.submit(); first.accept(false); first.finish();
    expect(life.beginSubmission(true)).toBeTruthy();
  });
  it("does not acknowledge an edited draft, including A-B-A edits", () => {
    const { life } = owner(); const first = life.beginSubmission(true)!;
    expect(first.unchangedDraft()).toBe(true); life.editDraft(); life.editDraft(); expect(first.unchangedDraft()).toBe(false);
  });
  it("does not revive old tickets through Strict Mode attachment or transport retirement", () => {
    const { life, detach } = owner(); const first = life.beginSubmission(true)!; const release = vi.fn(); first.own(release);
    detach(); life.attach(); const next = life.beginSubmission(true)!;
    expect(first.accept(true)).toBe(false); first.finish(); expect(next.current()).toBe(true);
    life.retire(); life.attach(); expect(next.current()).toBe(false); expect(life.beginSubmission(true)).toBeUndefined();
    expect(release).toHaveBeenCalledOnce();
  });
  it("coalesces stop, allows failure retry and waits for terminal status before another turn's stop", () => {
    const { life } = owner();
    const failed = life.beginStop("run", true)!; expect(life.beginStop("run", true)).toBeUndefined(); failed.finish();
    const retry = life.beginStop("run", true)!; retry.succeed(); retry.finish();
    expect(life.beginStop("run", true)).toBeUndefined();
    life.observeRun({ id: "run", status: "canceled" });
    expect(life.beginStop("run", false)).toBeUndefined(); expect(life.beginStop("run", true)).toBeTruthy();
  });
});
