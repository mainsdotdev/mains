import { describe, expect, it } from "vitest";
import { CursorMessageStream } from "./cursor-message-stream";

const diagnostic = "Error: RetriableError: WritableIterable is closed";
function replay(chunks: string[]) {
  const stream = new CursorMessageStream();
  const previews: string[] = [];
  for (const chunk of chunks) { stream.push(chunk); previews.push(stream.content); }
  return { ...stream.finish(), previews };
}

describe("Cursor message projection", () => {
  it.each(["\n", "\r\n"])("holds a title header split at every character (%j)", (newline) => {
    const result = replay([...`---${newline}title: Refactor hero${newline}---${newline}${newline}Reviewing the hero.`]);
    expect(result.content).toBe("Reviewing the hero.");
    expect(result.previews.every((text) => !text.includes("title:"))).toBe(true);
  });

  it.each([
    "---\nA horizontal rule and some prose.",
    "---\ntitle: Example\nauthor: Okan\n---\nBody",
    "```yaml\n---\ntitle: Example\n---\n```",
    "Here is a title: Example",
    "---\ntitle: An unfinished header",
    "---\ntitle: " + "x".repeat(5000),
  ])("preserves ordinary markdown, YAML and incomplete headers", (content) => {
    expect(replay([...content]).content).toBe(content);
  });

  it.each([
    diagnostic,
    "Error: ConnectError: [unavailable] transport closed",
    "Error: ConnectError: [aborted] transport aborted",
    "Error: ConnectError: [deadline_exceeded] timed out",
    "Something went wrong communicating with the server. Please try again.",
  ])("detects a standalone terminal diagnostic split across chunks: %s", (failure) => {
    const result = replay([...failure]);
    expect(result.failure).toBe(failure);
    expect(result.content).toBe("");
  });

  it("retains prose before a dedicated Cursor error delta and hides the error in previews", () => {
    const result = replay(["Hi.", "\n\n" + diagnostic, "\n    at send (cli.js:1:2)\n"]);
    expect(result.content).toBe("Hi.");
    expect(result.failure).toBe(diagnostic);
    expect(result.previews.every((text) => !text.includes("RetriableError"))).toBe(true);
  });

  it.each(["\n", "\r\n"])("detects an appended diagnostic even when paragraph breaks are split (%j)", (newline) => {
    const result = replay(["Hi.", ...`${newline}${newline}${diagnostic}`]);
    expect(result.content).toBe("Hi.");
    expect(result.failure).toBe(diagnostic);
  });

  it("restores later recovery text in the live preview", () => {
    const result = replay([diagnostic, "\nRecovered successfully."]);
    expect(result.previews.at(-1)).toBe(diagnostic + "\nRecovered successfully.");
    expect(result.failure).toBeUndefined();
  });

  it.each([
    ["This error means a closed stream:\n" + diagnostic],
    ["Example:\n\n```text\n", "\n\n" + diagnostic, "\n```"],
    ["Example:\n\n~~~\n", "\n\n" + diagnostic, "\n~~~"],
    ["> " + diagnostic],
    ["    " + diagnostic],
    [diagnostic, "\nRecovered successfully."],
    ["Error: HTTP 500 from the application being debugged"],
    ["Error: ConnectError: [permission_denied] subscription required"],
    ["Error: RetriableError: [internal] Failed to run step, exceeded max retries"],
  ])("keeps error explanations, code and non-transport failures in the response", (...chunks) => {
    const result = replay(chunks);
    expect(result.failure).toBeUndefined();
    expect(result.content).toBe(chunks.join(""));
  });
});
