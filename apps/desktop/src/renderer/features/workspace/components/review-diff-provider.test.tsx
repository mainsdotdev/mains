// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workers: [] as { terminate: ReturnType<typeof vi.fn> }[] }));
vi.mock("@pierre/diffs/worker/worker.js?worker", () => ({
  default: class extends EventTarget {
    terminate = vi.fn();
    constructor() { super(); mocks.workers.push(this); }
    postMessage(request: { type: string; id: string }) {
      if (request.type !== "initialize") return;
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: { type: "success", requestType: "initialize", id: request.id, sentAt: Date.now() },
      })));
    }
  },
}));

import { ReviewDiffProvider } from "./review-diff-provider";

describe("Review highlighting worker lifetime", () => {
  it("shares workers between mounted Reviews and releases them after the last Review closes", async () => {
    const view = render(<>
      <ReviewDiffProvider key="first"><span>First review</span></ReviewDiffProvider>
      <ReviewDiffProvider key="second"><span>Second review</span></ReviewDiffProvider>
    </>);
    await waitFor(() => expect(mocks.workers).toHaveLength(2));
    view.rerender(<ReviewDiffProvider key="second"><span>Second review</span></ReviewDiffProvider>);
    expect(mocks.workers.every((worker) => worker.terminate.mock.calls.length === 0)).toBe(true);
    view.unmount();
    await waitFor(() => mocks.workers.forEach((worker) => expect(worker.terminate).toHaveBeenCalledOnce()));
  });
});
