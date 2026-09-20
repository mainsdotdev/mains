// @vitest-environment jsdom

import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PromptSuggestionChips } from "./prompt-suggestion-chips";

describe("PromptSuggestionChips", () => {
  it("offers every follow-up, reading the label and sending the prompt", async () => {
    const onSelect = vi.fn();
    render(
      createElement(PromptSuggestionChips, {
        suggestions: [
          {
            label: "Make it investor-ready",
            prompt: "Expand this into a 6-slide investor pitch",
          },
          {
            label: "Create a PDF handout",
            prompt: "Create a matching one-page PDF handout",
          },
        ],
        onSelect,
      }),
    );

    expect(screen.getAllByRole("button")).toHaveLength(2);

    await userEvent.click(
      screen.getByRole("button", { name: "Make it investor-ready" }),
    );

    expect(onSelect).toHaveBeenCalledWith(
      "Expand this into a 6-slide investor pitch",
    );
  });

  it("falls back to the prompt when the provider gave no label", () => {
    render(
      createElement(PromptSuggestionChips, {
        suggestions: [{ prompt: "Run the tests again" }],
        onSelect: vi.fn(),
      }),
    );

    expect(screen.getByRole("button", { name: "Run the tests again" })).toBeTruthy();
  });

  it("renders nothing without a suggestion", () => {
    const { container } = render(
      createElement(PromptSuggestionChips, {
        suggestions: [],
        onSelect: vi.fn(),
      }),
    );

    expect(container.firstChild).toBeNull();
  });
});
