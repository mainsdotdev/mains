import { describe, expect, it } from "vitest";
import { createConnectionWizardLifecycle } from "./connection-wizard-lifecycle";

describe("connection wizard ownership", () => {
  it("admits only one action synchronously, before loading has rendered", () => {
    const owner = createConnectionWizardLifecycle(() => true); owner.attach();
    const first = owner.begin();
    expect(first).toBeDefined(); expect(owner.begin()).toBeUndefined();
    first!.finish(); expect(owner.begin()).toBeDefined();
  });
  it("permanently retires delayed success, error and chained work after closure", () => {
    const owner = createConnectionWizardLifecycle(() => true); owner.attach();
    const lease = owner.begin()!; owner.retire(); owner.attach();
    expect(lease.current()).toBe(false); expect(owner.begin()).toBeUndefined();
  });
  it("invalidates Strict Mode's first setup without poisoning the replacement setup", () => {
    const owner = createConnectionWizardLifecycle(() => true); owner.attach();
    const first = owner.begin()!; owner.detach(); owner.attach();
    const replacement = owner.begin()!;
    first.finish(); expect(first.current()).toBe(false); expect(replacement.current()).toBe(true);
    expect(owner.begin()).toBeUndefined();
  });
  it("checks the bound backend/account before admitting or publishing work", () => {
    let current = true; const owner = createConnectionWizardLifecycle(() => current); owner.attach();
    const lease = owner.begin()!; current = false;
    expect(lease.current()).toBe(false); expect(owner.begin()).toBeUndefined();
  });
});
