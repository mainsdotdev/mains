// @vitest-environment jsdom
import { StrictMode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "@/lib/redux/api/baseApi";
import appSettings from "@/lib/redux/slices/appSettingsSlice";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import { toastStore } from "@/components/ui";
import { PullRequestView } from "./pull-request-view";
import { deferred, prFixture } from "./pull-request-test-fixtures";

// Only the third-party diff DOM/highlighter is replaced. PR components,
// permissions, Redux endpoints and transport envelopes are real.
vi.mock("@/components/markdown-components", () => ({ markdownComponents: {} }));
vi.mock("@/lib/diff-highlighter", () => ({ warmDiffHighlighter: vi.fn(), useDiffHighlighterReady: () => true }));
vi.mock("@pierre/diffs/react", () => ({ PatchDiff: ({ lineAnnotations, renderAnnotation, renderGutterUtility }: any) => <div>
  {renderGutterUtility(() => ({ lineNumber: hoveredLine, side: "additions" }))}
  {lineAnnotations?.map((annotation: any) => <div key={annotation.side + annotation.lineNumber}>{renderAnnotation(annotation)}</div>)}
</div> }));

const invoke = vi.fn();
let hoveredLine = 1;
const stores: ReturnType<typeof makeStore>[] = [];
const thread = { id: "thread-1", isResolved: false, path: "app.ts", line: 1, side: "right" as const,
  viewerCanResolve: true, viewerCanUnresolve: false, comments: [{ id: "comment-1", body: "Please explain", author: null,
    createdAt: prFixture.createdAt, url: null }] };
const patch = "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new\n";
function makeStore() {
  return configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer, appSettings }, middleware: (defaults) => defaults().concat(baseApi.middleware) });
}
async function harness() {
  const store = makeStore(); stores.push(store);
  const h = render(<StrictMode><Provider store={store}><MemoryRouter>
    <PullRequestView prRef={{ owner: "acme", repo: "widget", number: 176 }} />
  </MemoryRouter></Provider></StrictMode>);
  await screen.findByRole("textbox", { name: "Leave a comment" });
  fireEvent.click(screen.getByRole("tab", { name: /Changes/ }));
  await screen.findByRole("button", { name: "Reply" });
  return h;
}
beforeEach(() => {
  hoveredLine = 1;
  invoke.mockImplementation(async (channel) => {
    if (channel === CHANNELS.pullRequests.getDetail) return { success: true, data: { ...prFixture, reviewThreads: [thread] } };
    if (channel === CHANNELS.pullRequests.getDiff) return { success: true, data: { diffText: patch, truncated: false } };
    return { success: true, data: undefined };
  });
  setTransport({ kind: "test", invoke, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} } as Transport);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  for (const store of stores.splice(0)) store.dispatch(baseApi.util.resetApiState());
  resetTransport(); toastStore.dismissAll(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

describe("PR inline action ownership", () => {
  it("keeps newer reply text after the submitted reply succeeds", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.replyToThread ? receipt.promise : original(channel, args));
    await harness(); fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const input = screen.getByPlaceholderText("Reply");
    fireEvent.change(input, { target: { value: "  First reply  " } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(invoke).toHaveBeenCalledWith(CHANNELS.pullRequests.replyToThread, [{ provider: "github", threadId: thread.id, body: "First reply" }]);
    fireEvent.change(input, { target: { value: "Next reply" } });
    await act(async () => { receipt.resolve({ success: true }); });
    expect((screen.getByPlaceholderText("Reply") as HTMLTextAreaElement).value).toBe("Next reply");
  });
  it("keeps a rejected inline comment open for explicit retry", async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.addReviewComment
      ? Promise.resolve({ success: false, error: "Review was rejected" }) : original(channel, args));
    await harness(); fireEvent.click(screen.getByTitle("Add a comment"));
    const input = screen.getByPlaceholderText("Comment on line 1");
    fireEvent.change(input, { target: { value: "Review draft" } }); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(toastStore.getSnapshot().some((toast) => toast.message === "Review was rejected")).toBe(true));
    expect((screen.getByPlaceholderText("Comment on line 1") as HTMLTextAreaElement).value).toBe("Review draft");
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.pullRequests.addReviewComment)).toHaveLength(1);
  });
  it("does not close a replacement line composer when the old comment succeeds", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.addReviewComment ? receipt.promise : original(channel, args));
    await harness(); fireEvent.click(screen.getByTitle("Add a comment"));
    const input = screen.getByPlaceholderText("Comment on line 1");
    fireEvent.change(input, { target: { value: "Old line" } }); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(invoke).toHaveBeenCalledWith(CHANNELS.pullRequests.addReviewComment,
      [{ provider: "github", owner: "acme", repo: "widget", number: 176, path: "app.ts", line: 1, side: "right", body: "Old line" }]);
    hoveredLine = 2; fireEvent.click(screen.getByTitle("Add a comment"));
    const next = screen.getByPlaceholderText("Comment on line 2");
    expect((next as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(next, { target: { value: "New line" } });
    await act(async () => { receipt.resolve({ success: true }); });
    expect((screen.getByPlaceholderText("Comment on line 2") as HTMLTextAreaElement).value).toBe("New line");
  });
  it("closes only an unchanged inline draft after one successful submission", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.addReviewComment ? receipt.promise : original(channel, args));
    await harness(); fireEvent.click(screen.getByTitle("Add a comment"));
    const input = screen.getByPlaceholderText("Comment on line 1");
    fireEvent.change(input, { target: { value: "Review" } });
    act(() => { fireEvent.keyDown(input, { key: "Enter", ctrlKey: true }); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true }); });
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.pullRequests.addReviewComment)).toHaveLength(1);
    await act(async () => { receipt.resolve({ success: true }); });
    expect(screen.queryByPlaceholderText("Comment on line 1")).toBeNull();
  });
  it("shares a pending resolve between Changes and Summary", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.resolveThread ? receipt.promise : original(channel, args));
    await harness();
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    fireEvent.click(screen.getByRole("tab", { name: "Summary" }));
    const summaryResolve = screen.getByRole("button", { name: "Resolve" });
    expect((summaryResolve as HTMLButtonElement).disabled).toBe(true); fireEvent.click(summaryResolve);
    const input = screen.getByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(input, { target: { value: "New comment" } }); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.pullRequests.resolveThread)).toHaveLength(1);
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.pullRequests.addComment)).toBe(false);
    await act(async () => { receipt.resolve({ success: true }); });
    expect((summaryResolve as HTMLButtonElement).disabled).toBe(true);
    expect((input as HTMLTextAreaElement).value).toBe("New comment");
  });
  it("does not close a reopened reply editor when its cancelled attempt finishes", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.replyToThread ? receipt.promise : original(channel, args));
    await harness();
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const input = screen.getByPlaceholderText("Reply");
    fireEvent.change(input, { target: { value: "Explanation" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await act(async () => { receipt.resolve({ success: true }); });
    expect((screen.getByPlaceholderText("Reply") as HTMLTextAreaElement).value).toBe("Explanation");
  });
  it("sends one reply for repeated submit shortcuts", async () => {
    const receipt = deferred<any>();
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.replyToThread ? receipt.promise : original(channel, args));
    await harness();
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const input = screen.getByPlaceholderText("Reply");
    fireEvent.change(input, { target: { value: "Explanation" } });
    act(() => { fireEvent.keyDown(input, { key: "Enter", metaKey: true }); fireEvent.keyDown(input, { key: "Enter", metaKey: true }); });
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.pullRequests.replyToThread)).toHaveLength(1);
    await act(async () => { receipt.resolve({ success: true }); });
  });
});
