import { describe, expect, it } from "vitest";
import { buildInspectorScript } from "./inspector.script";

describe("buildInspectorScript", () => {
  it("removes picker UI before emitting a selection and adds no capture marker", () => {
    const script = buildInspectorScript(true);
    const payloadStart = script.indexOf("var payload = {");
    const teardown = script.indexOf("teardown();", payloadStart);
    const emit = script.indexOf("emit(payload);", payloadStart);

    expect(payloadStart).toBeGreaterThan(-1);
    expect(teardown).toBeGreaterThan(payloadStart);
    expect(emit).toBeGreaterThan(teardown);
    expect(script).not.toContain("data-mains-selection-marker");
  });
});
