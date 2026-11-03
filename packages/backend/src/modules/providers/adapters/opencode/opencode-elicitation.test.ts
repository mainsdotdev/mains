import { describe, expect, it } from "vitest";
import { decideOpenCodeForm, openCodeFormRequest } from "./opencode-elicitation";

const choice = {
  type: "object",
  properties: {
    approach: {
      type: "string",
      title: "Which approach?",
      oneOf: [
        { const: "keep", title: "Keep it" },
        { const: "rewrite", title: "Rewrite it" },
      ],
    },
  },
  required: ["approach"],
};

describe("OpenCode form elicitation", () => {
  it("reads a form request and ignores other modes", () => {
    expect(openCodeFormRequest({
      mode: "form",
      message: "Which approach?",
      requestedSchema: choice,
    })).toEqual({ message: "Which approach?", schema: choice });
    expect(openCodeFormRequest({ mode: "url", message: "Sign in", url: "https://example.test" })).toBeNull();
    expect(openCodeFormRequest({ mode: "form" })).toBeNull();
  });

  it("returns the chosen value and keeps cancel distinct from decline", () => {
    expect(decideOpenCodeForm(choice, { approved: true, answer: JSON.stringify({ approach: "keep" }) })).toEqual({
      action: "accept",
      content: { approach: "keep" },
    });
    expect(decideOpenCodeForm(choice, { approved: false })).toEqual({ action: "decline" });
    expect(decideOpenCodeForm(choice, { approved: false, answer: "cancel" })).toEqual({ action: "cancel" });
    expect(decideOpenCodeForm(choice, { approved: true, answer: "not-json" })).toEqual({ action: "decline" });
  });
});
