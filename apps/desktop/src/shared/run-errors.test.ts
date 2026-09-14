import { describe, expect, it } from "vitest";
import { classifyRunErrorKind } from "./run-errors";

describe("classifyRunErrorKind", () => {
  it.each([
    // Claude Code SDK/CLI
    "Failed to authenticate: OAuth session expired and could not be refreshed",
    "Invalid API key · Please run /login",
    // Copilot via GitHub CLI
    "GitHub CLI is not authenticated. Please run `gh auth login` in your terminal to sign in.",
    // Cursor agent
    'Not authenticated. Run "agent login" to sign in.',
    "not logged in",
    "Login required",
    // Codex / generic HTTP
    "Not signed in to Codex",
    "Request failed with status 401",
    "Unauthorized",
    "authentication error: token expired",
    "credentials are invalid or revoked",
  ])("classifies %j as auth", (message) => {
    expect(classifyRunErrorKind(message)).toBe("auth");
  });

  it.each([
    "Unknown error",
    "Forced abort: adapter did not wind down within timeout",
    "max turns exceeded",
    "ENOENT: no such file or directory",
    "The user aborted a request.",
    "Model overloaded, please retry",
  ])("leaves %j unclassified", (message) => {
    expect(classifyRunErrorKind(message)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(classifyRunErrorKind(null)).toBeNull();
    expect(classifyRunErrorKind(undefined)).toBeNull();
    expect(classifyRunErrorKind("")).toBeNull();
  });
});
