import { describe, expect, it } from "vitest";
import { formatModelDisplayName, selectableModelNames } from "./model-icons";

describe("formatModelDisplayName", () => {
  it("removes separators from GPT display names", () => {
    expect(formatModelDisplayName("GPT-5.6-Sol", "codex")).toBe(
      "GPT 5.6 Sol",
    );
    expect(formatModelDisplayName("GPT-5.4-Mini", "codex")).toBe(
      "GPT 5.4 Mini",
    );
  });

  it("removes separators after formatting Cursor GPT models", () => {
    expect(formatModelDisplayName("gpt-5-4-mini", "cursor")).toBe(
      "GPT 5.4 Mini",
    );
  });

  it("leaves non-GPT model names unchanged", () => {
    expect(formatModelDisplayName("Claude Sonnet 4.5", "claude")).toBe(
      "Claude Sonnet 4.5",
    );
  });
});

describe("selectableModelNames", () => {
  // "Auto" is a real, selectable model on Copilot and Cursor. Hiding it emptied
  // the Copilot picker entirely on plans where the CLI offers nothing else,
  // which surfaced as "No models found".
  it("keeps Auto", () => {
    expect(selectableModelNames(["Auto", "GPT-5 mini"], "copilot")).toEqual([
      "Auto",
      "GPT-5 mini",
    ]);
    expect(selectableModelNames(["Auto"], "copilot")).toEqual(["Auto"]);
    expect(selectableModelNames(["auto", "Composer 2.5"], "cursor")).toEqual([
      "auto",
      "Composer 2.5",
    ]);
  });

  it("hides only Cursor's `default` placeholder", () => {
    expect(selectableModelNames(["default", "Auto", "Composer"], "cursor")).toEqual([
      "Auto",
      "Composer",
    ]);
    // The same name on another provider is a real model, so it stays.
    expect(selectableModelNames(["default"], "claude")).toEqual(["default"]);
  });

  it("is whitespace- and case-insensitive for the placeholder", () => {
    expect(selectableModelNames(["  Default  "], "cursor")).toEqual([]);
  });

  it("tolerates a missing or non-array list", () => {
    expect(selectableModelNames([], "copilot")).toEqual([]);
    expect(selectableModelNames(undefined as unknown as string[], "copilot")).toEqual([]);
  });
});
