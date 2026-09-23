import { describe, it, expect } from "vitest";
import { validateCreate } from "./pulse.validation";
import type { CreatePulseInput } from "./pulse.dto";

function base(overrides: Partial<CreatePulseInput> = {}): CreatePulseInput {
  return {
    workspaceId: "ws-1",
    providerId: "claude_code",
    model: "sonnet",
    title: "Digest",
    prompt: "Summarize",
    frequency: "daily",
    hour: 9,
    minute: 0,
    timezone: "Europe/Istanbul",
    ...overrides,
  };
}

describe("pulse.validation — mode/target shape", () => {
  it("developer (default) requires a workspace and rejects a collection", () => {
    expect(validateCreate(base())).toBeNull();
    expect(validateCreate(base({ workspaceId: null }))).toContain(
      "workspaceId is required",
    );
    expect(validateCreate(base({ collectionId: "col-1" }))).toContain(
      "collectionId is only allowed",
    );
  });

  it("work/chat reject a workspace and accept an optional collection", () => {
    for (const mode of ["work", "chat"] as const) {
      expect(
        validateCreate(base({ mode, workspaceId: null })),
      ).toBeNull();
      expect(
        validateCreate(base({ mode, workspaceId: null, collectionId: "col-1" })),
      ).toBeNull();
      expect(validateCreate(base({ mode }))).toContain(
        "workspaceId is only allowed for developer pulses",
      );
    }
  });

  it("rejects unknown modes", () => {
    expect(validateCreate(base({ mode: "gaming" as never }))).toContain(
      "Invalid mode",
    );
  });
});
