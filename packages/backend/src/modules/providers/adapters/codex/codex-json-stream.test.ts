import { describe, expect, it } from "vitest";
import { createCodexJsonStream } from "./codex-json-stream";

describe("Codex JSON stream framing", () => {
  it("preserves nested, multiline objects and string escapes at every possible split", () => {
    const messages = [{ result: { nested: [{ text: 'Türkçe { \\" }' }] } }, { method: "next", params: {} }];
    const frames = messages.map((message) => JSON.stringify(message, null, 2));
    const text = frames.join("\n");
    for (let split = 0; split <= text.length; split++) {
      const stream = createCodexJsonStream();
      const received = [...stream.push(text.slice(0, split)), ...stream.push(text.slice(split))];
      expect(received.map((frame) => JSON.parse(frame))).toEqual(messages);
    }
  });

  it("ignores text outside frames and clears abandoned partial frames", () => {
    const stream = createCodexJsonStream();
    expect([...stream.push('startup output\n {"partial":')]).toEqual([]);
    stream.clear();
    expect([...stream.push('noise {"fresh":true}\n')]).toEqual(['{"fresh":true}']);
  });

  it("bounds a fragmented message and releases its partial contents on overflow", () => {
    const stream = createCodexJsonStream(32);
    expect([...stream.push('{"text":"')]).toEqual([]);
    expect(() => [...stream.push("x".repeat(32))]).toThrow("exceeded 32 characters");
    expect([...stream.push('{"fresh":true}')]).toEqual(['{"fresh":true}']);
  });

  it("applies the size limit per message rather than to a batch", () => {
    const stream = createCodexJsonStream(16);
    const frames = Array.from({ length: 20 }, (_, id) => JSON.stringify({ id }));
    expect([...stream.push(frames.join("\n"))]).toEqual(frames);
  });
});
