// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AskUserQuestionDisplay } from "./ask-user-question-display";

afterEach(cleanup);

const questions = [
  { question: "Which database?", header: "Database", options: [{ label: "Postgres" }, { label: "SQLite" }], multiSelect: false },
  { question: "Which checks?", header: "Checks", options: [{ label: "Lint" }, { label: "Tests" }], multiSelect: true },
  { question: "Deploy now?", header: "Deploy", options: [{ label: "Yes" }, { label: "No" }], multiSelect: false },
];

function isMarked(label: string): boolean {
  return !!screen.getByText(label).closest(".flex")?.querySelector("svg");
}

it("marks Claude's answers, which are keyed by question text", () => {
  render(<AskUserQuestionDisplay params={{ questions }} output={{
    questions,
    answers: {
      "Which database?": "Postgres",
      "Which checks?": "Lint, Tests",
      "Deploy now?": "The user dismissed this question without answering.",
    },
    annotations: { "Deploy now?": { unanswered: "dismissed" } },
  }} />);
  fireEvent.click(screen.getByRole("button", { name: /Question.*Database/ }));

  expect(isMarked("Postgres")).toBe(true);
  expect(isMarked("SQLite")).toBe(false);
  // A multi-select answer marks each option it names, not one free-text row.
  expect(isMarked("Lint")).toBe(true);
  expect(isMarked("Tests")).toBe(true);
  expect(screen.queryByText("Lint, Tests")).toBeNull();
  // A dismissed question reads as dismissed, not as the text the model read.
  expect(screen.getByText("Dismissed")).toBeTruthy();
  expect(screen.queryByText(/dismissed this question/)).toBeNull();
  expect(isMarked("Yes")).toBe(false);
});

it("still reads answers keyed by question index", () => {
  render(<AskUserQuestionDisplay params={{ questions }} output={{ answers: { 0: "SQLite", 2: "Tomorrow" } }} />);
  fireEvent.click(screen.getByRole("button", { name: /Question.*Database/ }));

  expect(isMarked("SQLite")).toBe(true);
  expect(screen.getByText("Tomorrow")).toBeTruthy();
});
