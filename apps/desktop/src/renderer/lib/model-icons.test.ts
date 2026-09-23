import { describe, expect, it } from "vitest";
import {
  dedupeModelsByPrettyName,
  formatModelDisplayName,
  getModelPrettyName,
  resolveModelDisplayName,
  selectableModelNames,
} from "./model-icons";

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

describe("Claude model labels", () => {
  it("shows the same name for both Claude catalogue formats", () => {
    expect(
      getModelPrettyName(
        { displayName: "Opus", description: "Opus 5.5 · Best for everyday, complex tasks" },
        "claude",
      ),
    ).toBe("Opus 5.5");
    expect(
      getModelPrettyName(
        { displayName: "Opus 5.5", description: "Most capable for ambitious work" },
        "claude",
      ),
    ).toBe("Opus 5.5");
    expect(
      getModelPrettyName(
        { displayName: "Opus 5.5", description: "Opus 5.5 for ambitious work" },
        "claude",
      ),
    ).toBe("Opus 5.5");
  });

  it("keeps distinct models that share a description", () => {
    const models = [
      { id: "claude-opus-5", displayName: "Opus 5", description: "Best for everyday, complex tasks" },
      { id: "claude-opus-4-8", displayName: "Opus 4.8", description: "Best for everyday, complex tasks" },
    ];

    expect(dedupeModelsByPrettyName(models, "claude")).toEqual(models);
  });
});

describe("resolveModelDisplayName", () => {
  const claudeModels = [
    {
      id: "sonnet",
      displayName: "Claude Sonnet",
      description: "Claude Sonnet 5 · Best for everyday work",
    },
    {
      id: "haiku",
      displayName: "Claude Haiku",
      description: "Claude Haiku 4.5 · Fastest",
    },
    {
      id: "opus[1m]",
      displayName: "Claude Opus [1M]",
    },
  ];

  it("uses the same catalogue label as the model dropdown", () => {
    expect(resolveModelDisplayName("sonnet", claudeModels, "claude")).toBe(
      "Claude Sonnet 5",
    );
  });

  it("maps Claude canonical usage ids back to their picker aliases", () => {
    expect(
      resolveModelDisplayName(
        "claude-haiku-4-5-20251001",
        claudeModels,
        "claude",
      ),
    ).toBe("Claude Haiku 4.5");
    expect(
      resolveModelDisplayName("claude-sonnet-5", claudeModels, "claude"),
    ).toBe("Claude Sonnet 5");
  });

  it("falls back to the existing formatter when the model is absent", () => {
    expect(resolveModelDisplayName("GPT-5.6-Sol", [], "codex")).toBe(
      "GPT 5.6 Sol",
    );
  });
});
