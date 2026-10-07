import assert from "node:assert/strict";
import test from "node:test";
import { parsePromptImages } from "../src/lib/prompt-images.ts";

test("durable prompt images retain their conversation identity without carrying pixels", () => {
  const images = parsePromptImages([{ name: "screen.png", type: "image", attachmentId: "attachment-id", dataUrl: "data:image/png;base64,legacy" }], "run-1");
  assert.deepEqual(images, [{ key: "prompt-image:0:screen.png", name: "screen.png", runId: "run-1", attachmentId: "attachment-id" }]);
});

test("legacy images remain visible while documents and malformed entries are skipped", () => {
  const images = parsePromptImages([null, "invalid", { type: "document", dataUrl: "data:image/png;base64,x" }, { type: "image", dataUrl: "https://example.com" }, { type: "image", dataUrl: "data:image/png;base64,x" }], "run-1");
  assert.deepEqual(images, [{ key: "prompt-image:4:image-5", name: "image-5", uri: "data:image/png;base64,x" }]);
});
