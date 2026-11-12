// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { StrictMode } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "@/lib/redux/api/baseApi";
import { useGetPrDiffQuery, type PrRefInput } from "@/lib/redux/api/pullRequestsApi";
import { getTransport, resetTransport, setTransport, type Transport, type TransportStatus } from "@/lib/transport";
import { toastStore } from "@/components/ui";
import { PullRequestView } from "./pull-request-view";

vi.mock("@/components/markdown-components", () => ({ markdownComponents: {} }));
vi.mock("@/lib/diff-highlighter", () => ({ warmDiffHighlighter: vi.fn() }));
vi.mock("./pr-diff-view", () => ({ PrDiffView: ({ prRef }: { prRef: PrRefInput }) => {
  const { data } = useGetPrDiffQuery(prRef);
  return <div><div>Diff for #{prRef.number}</div><div>{data?.diffText}</div></div>;
} }));

import { deferred, prFixture } from "./pull-request-test-fixtures";

let failDetail = false;
let connected = true;
let diffText = "Original diff";
let detail = prFixture;
let status: TransportStatus = "connected";
const statusListeners = new Set<(status: TransportStatus) => void>();
const invoke = vi.fn();
const openExternal = vi.fn();
const stores: ReturnType<typeof makeStore>[] = [];
function makeStore() {
  return configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer }, middleware: (defaults) => defaults().concat(baseApi.middleware) });
}
function harness() {
  const state = makeStore(); stores.push(state);
  const view = (number = 176, active = true) => <StrictMode><Provider store={state}><MemoryRouter>
    <PullRequestView prRef={{ owner: "Acme", repo: "Widget", number }} active={active} />
  </MemoryRouter></Provider></StrictMode>;
  return { state, view, ...render(view()) };
}
beforeEach(() => {
  failDetail = false; connected = true;
  diffText = "Original diff";
  detail = prFixture;
  status = "connected"; statusListeners.clear();
  invoke.mockImplementation(async (channel, args) => {
    if (channel === CHANNELS.pullRequests.getDetail) return failDetail
      ? { success: false, error: "GitHub connection not found" } : { success: true, data: { ...detail, number: args[0].number } };
    if (channel === CHANNELS.pullRequests.getAvailability) return { success: true, data: { provider: "github", connected, viewer: null, error: null } };
    if (channel === CHANNELS.pullRequests.getActivity || channel === CHANNELS.pullRequests.getCommits) return {
      success: true, data: { items: [], startCursor: null, hasPreviousPage: false, totalCount: 0 },
    };
    if (channel === CHANNELS.pullRequests.getDiff) return { success: true, data: { diffText, truncated: false } };
    return { success: true, data: undefined };
  });
  setTransport({ kind: "test", invoke, subscribe: () => () => {}, status: () => status,
    onStatusChange: (listener) => { statusListeners.add(listener); return () => { statusListeners.delete(listener); }; } } as Transport);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(window, "api", { configurable: true, value: { shell: { openExternal } } });
});
afterEach(() => {
  cleanup();
  for (const state of stores.splice(0)) state.dispatch(baseApi.util.resetApiState());
  resetTransport(); toastStore.dismissAll(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

describe("shared pull request view", () => {
  it("loads commits on expansion, follows older pages and deduplicates overlapping records", async () => {
    const original = invoke.getMockImplementation()!;
    const commit = (oid: string, message: string) => ({ oid, message, committedAt: prFixture.createdAt,
      author: null, authorName: "Release Bot", url: `https://github.com/acme/widget/commit/${oid}` });
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.getCommits
      ? Promise.resolve({ success: true, data: args[0].cursor ? {
        items: [commit("aaaaaaa", "First change"), commit("bbbbbbb", "Old overlapping message")],
        startCursor: "first", hasPreviousPage: false, totalCount: 3,
      } : {
        items: [commit("bbbbbbb", "Second change"), commit("ccccccc", "Latest change")],
        startCursor: "older", hasPreviousPage: true, totalCount: 3,
      } }) : original(channel, args));
    harness();
    const toggle = await screen.findByRole("button", { name: /84 commits/ });
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.pullRequests.getCommits)).toBe(false);
    fireEvent.click(toggle);
    await screen.findByRole("button", { name: "Second change" });
    fireEvent.click(screen.getByRole("button", { name: "Load older commits" }));
    await screen.findByRole("button", { name: "First change" });
    expect(invoke).toHaveBeenCalledWith(CHANNELS.pullRequests.getCommits,
      [{ provider: "github", owner: "acme", repo: "widget", number: 176, cursor: "older" }]);
    const group = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(within(group).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["First change", "aaaaaaa", "Second change", "bbbbbbb", "Latest change", "ccccccc"]);
    expect(screen.queryByText("Old overlapping message")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load older commits" })).toBeNull();
  });

  it("loads real activity pages, retries an older-page error and filters on the provider", async () => {
    const original = invoke.getMockImplementation()!;
    let failOlder = true;
    const event = (id: string, kind: string, body: string | null) => ({ id, kind, body,
      author: { login: "reviewer", avatarUrl: null }, createdAt: prFixture.updatedAt,
      url: null, reviewer: null, reviewState: kind === "review" ? "APPROVED" : null, commitOid: null });
    invoke.mockImplementation((channel, args) => {
      if (channel !== CHANNELS.pullRequests.getActivity) return original(channel, args);
      const input = args[0];
      if (input.cursor && failOlder) return Promise.resolve({ success: false, error: "Temporary failure" });
      return Promise.resolve({ success: true, data: input.filter === "comments" ? {
        items: [event("comment", "comment", "Only comments")], hasPreviousPage: false, startCursor: "comment", totalCount: 1,
      } : input.cursor ? {
        items: [event("old", "comment", "Earlier comment")], hasPreviousPage: false, startCursor: "first", totalCount: 2,
      } : {
        items: [event("review", "review", "Approved release")], hasPreviousPage: true, startCursor: "older", totalCount: 2,
      } });
    });
    harness();
    await screen.findByText("Approved release");
    expect(screen.queryByText("okan opened this pull request")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load older activity" }));
    await screen.findByText("Unable to load activity.");
    expect(screen.getByText("Approved release")).toBeTruthy();
    failOlder = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Earlier comment");
    expect(screen.getByText("okan opened this pull request")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Filter activity" }));
    fireEvent.click(await screen.findByRole("option", { name: "Comments" }));
    await screen.findByText("Only comments");
    expect(invoke).toHaveBeenCalledWith(CHANNELS.pullRequests.getActivity,
      [{ provider: "github", owner: "acme", repo: "widget", number: 176, filter: "comments", cursor: null }]);
    expect(screen.queryByText("Approved release")).toBeNull();
    expect(screen.queryByRole("button", { name: /commits/ })).toBeNull();
  });

  it("shows timed checks, exposes the rest and opens the check's details", async () => {
    const start = "2026-11-12T10:00:00Z";
    detail = { ...prFixture, ciStatus: "failing", checks: Array.from({ length: 6 }, (_, index) => ({
      id: `check-${index}`, name: `Check ${index}`, status: index === 0 ? "failing" as const : "passing" as const,
      startedAt: start, completedAt: "2026-11-12T10:01:05Z", url: `https://github.com/check/${index}`,
    })) };
    harness();
    await screen.findByText("1 failing check");
    expect(screen.getAllByText("01:05").length).toBeGreaterThan(0);
    expect(screen.queryByText("Check 5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 more" }));
    expect(screen.getByText("Check 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Check 5 check details" }));
    expect(openExternal).toHaveBeenCalledWith("https://github.com/check/5");
  });

  it("retires queued status callbacks as well as receipts through an A-B-A backend switch", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.addComment ? receipt.promise : original(channel, args));
    const h = harness(); const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(input, { target: { value: "Old scope" } }); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    const transportA = getTransport(); const queued = [...statusListeners];
    act(() => {
      setTransport({ ...transportA, kind: "temporary-b" }); setTransport(transportA);
      h.state.dispatch(baseApi.util.resetApiState());
    });
    const fresh = await screen.findByRole("textbox", { name: "Leave a comment" });
    expect((fresh as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(fresh, { target: { value: "Fresh scope" } });
    const reads = invoke.mock.calls.filter(([channel]) => channel === CHANNELS.pullRequests.getDetail).length;
    await act(async () => { for (const callback of queued) callback("connected"); });
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.pullRequests.getDetail)).toHaveLength(reads);
    await act(async () => { receipt.resolve({ success: true }); });
    expect((fresh as HTMLTextAreaElement).value).toBe("Fresh scope");
    expect(toastStore.getSnapshot()).toHaveLength(0);
  });
  it("submits one top-level comment for repeated shortcuts before React commits", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.addComment ? receipt.promise : original(channel, args));
    harness(); const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(input, { target: { value: "One comment" } });
    act(() => { fireEvent.keyDown(input, { key: "Enter", ctrlKey: true }); fireEvent.keyDown(input, { key: "Enter", metaKey: true }); });
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.pullRequests.addComment)).toHaveLength(1);
    await act(async () => { receipt.resolve({ success: true }); });
    expect((input as HTMLTextAreaElement).value).toBe("");
  });
  it("allows marking ready again after a confirmed ready PR is externally converted back to draft", async () => {
    detail = { ...prFixture, isDraft: true };
    harness(); await screen.findByRole("textbox", { name: "Leave a comment" });
    detail = { ...prFixture, isDraft: false };
    fireEvent.click(screen.getByRole("button", { name: "Ready for review" }));
    await screen.findByRole("button", { name: "Merge" });
    detail = { ...prFixture, isDraft: true };
    fireEvent.click(screen.getByRole("button", { name: "Refresh pull request" }));
    await screen.findByRole("button", { name: "Ready for review" });
    await waitFor(() => expect((screen.getByRole("button", { name: "Ready for review" }) as HTMLButtonElement).disabled).toBe(false));
  });
  it("acknowledges an unchanged accepted comment while hidden without a toast", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.addComment ? receipt.promise : original(channel, args));
    const h = harness(); const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(input, { target: { value: "Posted while hidden" } }); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    h.rerender(h.view(176, false));
    await act(async () => { receipt.resolve({ success: true }); });
    expect(toastStore.getSnapshot()).toHaveLength(0);
    h.rerender(h.view(176, true));
    expect((await screen.findByRole("textbox", { name: "Leave a comment" }) as HTMLTextAreaElement).value).toBe("");
  });
  it("accepts a new resolve after the provider confirmed the previous resolve and later reopened the thread", async () => {
    const thread = { id: "thread-1", isResolved: false, path: "app.ts", line: 1, side: "right" as const,
      viewerCanResolve: true, viewerCanUnresolve: true, comments: [] };
    detail = { ...prFixture, reviewThreads: [thread] };
    harness();
    const resolve = await screen.findByRole("button", { name: "Resolve" });
    detail = { ...detail, reviewThreads: [{ ...thread, isResolved: true }] };
    fireEvent.click(resolve);
    await screen.findByRole("button", { name: "Unresolve" });
    detail = { ...detail, reviewThreads: [thread] };
    fireEvent.click(screen.getByRole("button", { name: "Refresh pull request" }));
    await screen.findByRole("button", { name: "Resolve" });
    await waitFor(() => expect((screen.getByRole("button", { name: "Resolve" }) as HTMLButtonElement).disabled).toBe(false));
  });
  it("preserves an uncertain draft across disconnect/reconnect without replay or late acknowledgement", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.addComment ? receipt.promise : original(channel, args));
    harness(); const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(input, { target: { value: "Uncertain comment" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    act(() => {
      status = "offline"; for (const listener of statusListeners) listener(status);
      status = "connected"; for (const listener of statusListeners) listener(status);
    });
    await act(async () => { receipt.resolve({ success: true }); });
    expect((screen.getByRole("textbox", { name: "Leave a comment" }) as HTMLTextAreaElement).value).toBe("Uncertain comment");
    expect(toastStore.getSnapshot()).toHaveLength(0);
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.pullRequests.addComment)).toHaveLength(1);
  });
  it("keeps a rejected comment for explicit retry without replaying it", async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.addComment
      ? Promise.resolve({ success: false, error: "GitHub rejected this comment" }) : original(channel, args));
    harness();
    const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(input, { target: { value: "Do not lose this" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(toastStore.getSnapshot().some((toast) => toast.message === "GitHub rejected this comment")).toBe(true));
    await waitFor(() => expect((screen.getByRole("button", { name: "Send prompt" }) as HTMLButtonElement).disabled).toBe(false));
    expect((input as HTMLTextAreaElement).value).toBe("Do not lose this");
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.pullRequests.addComment)).toHaveLength(1);
    invoke.mockImplementation(original);
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.pullRequests.addComment)).toHaveLength(2);
  });
  it("does not authorize writes from detail retained after a failed refresh", async () => {
    const h = harness();
    const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(input, { target: { value: "Draft" } });
    failDetail = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh pull request" }));
    await screen.findByText("Unable to refresh. Showing the last loaded pull request.");
    expect((screen.getByRole("button", { name: "Merge" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.pullRequests.addComment)).toBe(false);
    expect((input as HTMLTextAreaElement).value).toBe("Draft");
    h.unmount();
  });
  it.each(["merge", "ready"] as const)("does not repeat a confirmed %s while provider detail is unchanged", async (kind) => {
    if (kind === "ready") detail = { ...prFixture, isDraft: true };
    const receipt = deferred<any>(); const refresh = deferred<any>();
    const original = invoke.getMockImplementation()!;
    let mutationStarted = false;
    const channel = kind === "merge" ? CHANNELS.pullRequests.merge : CHANNELS.pullRequests.markReady;
    invoke.mockImplementation((name, args) => {
      if (name === channel) { mutationStarted = true; return receipt.promise; }
      if (name === CHANNELS.pullRequests.getDetail && mutationStarted) return refresh.promise;
      return original(name, args);
    });
    harness(); await screen.findByRole("textbox", { name: "Leave a comment" });
    const name = kind === "merge" ? "Merge" : "Ready for review";
    const button = screen.getByRole("button", { name });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(invoke.mock.calls.filter(([name]) => name === channel)).toHaveLength(1);
    await act(async () => { receipt.resolve({ success: true }); });
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { refresh.resolve({ success: true, data: detail }); });
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name }));
    expect(invoke.mock.calls.filter(([name]) => name === channel)).toHaveLength(1);
    if (kind === "ready") expect(invoke).toHaveBeenCalledWith(channel, [{ provider: "github", nodeId: prFixture.nodeId }]);
  });
  it.each(["success", "failure"])("ignores late comment %s after closing the view", async (result) => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.addComment ? receipt.promise : original(channel, args));
    const h = harness(); const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(input, { target: { value: "Comment" } }); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    h.unmount();
    await act(async () => { receipt.resolve(result === "success" ? { success: true } : { success: false, error: "Late rejection" }); });
    expect(toastStore.getSnapshot()).toHaveLength(0);
  });
  it("does not publish an old receipt into a replacement PR draft", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.addComment ? receipt.promise : original(channel, args));
    const h = harness(); const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(input, { target: { value: "For 176" } }); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    h.rerender(h.view(177));
    const next = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(next, { target: { value: "For 177" } });
    await act(async () => { receipt.resolve({ success: true }); });
    expect((next as HTMLTextAreaElement).value).toBe("For 177");
    expect(toastStore.getSnapshot()).toHaveLength(0);
  });
  it("starts a fresh draft owner after backend replacement and ignores the old receipt", async () => {
    const receipt = deferred<any>();
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.addComment ? receipt.promise : original(channel, args));
    const h = harness();
    const oldInput = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(oldInput, { target: { value: "Backend A draft" } });
    fireEvent.keyDown(oldInput, { key: "Enter", ctrlKey: true });
    const invokeB = vi.fn(original);
    act(() => {
      setTransport({ kind: "test-b", invoke: invokeB, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} } as Transport);
      h.state.dispatch(baseApi.util.resetApiState());
    });
    const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    expect((input as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(input, { target: { value: "Backend B draft" } });
    await act(async () => { receipt.resolve({ success: true }); });
    expect((input as HTMLTextAreaElement).value).toBe("Backend B draft");
    expect(toastStore.getSnapshot()).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(invokeB).toHaveBeenCalledWith(CHANNELS.pullRequests.addComment, [{ provider: "github", owner: "acme", repo: "widget", number: 176, body: "Backend B draft" }]));
  });
  it("keeps edits made after the submitted comment snapshot", async () => {
    const original = invoke.getMockImplementation()!;
    let finish!: (result: unknown) => void;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.addComment
      ? new Promise((resolve) => { finish = resolve; }) : original(channel, args));
    harness();
    const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(input, { target: { value: "First comment" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    fireEvent.change(input, { target: { value: "Next comment" } });
    await act(async () => { finish({ success: true }); });
    expect((screen.getByRole("textbox", { name: "Leave a comment" }) as HTMLTextAreaElement).value).toBe("Next comment");
  });
  it("does not submit from an inactive preview", async () => {
    detail = { ...prFixture, reviewThreads: [{ id: "thread-1", isResolved: false, path: "app.ts", line: 1,
      side: "right", viewerCanResolve: true, viewerCanUnresolve: false, comments: [] }] };
    const h = harness();
    const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(input, { target: { value: "Keep this draft" } });
    h.rerender(h.view(176, false));
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(invoke.mock.calls.filter(([channel]) => [CHANNELS.pullRequests.addComment, CHANNELS.pullRequests.resolveThread].includes(channel))).toHaveLength(0);
  });
  it("admits only one resolve request while a review thread is pending", async () => {
    detail = { ...prFixture, reviewThreads: [{ id: "thread-1", isResolved: false, path: "app.ts", line: 1,
      side: "right", viewerCanResolve: true, viewerCanUnresolve: false, comments: [] }] };
    const original = invoke.getMockImplementation()!;
    let finish!: (result: unknown) => void;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.pullRequests.resolveThread
      ? new Promise((resolve) => { finish = resolve; }) : original(channel, args));
    harness();
    const resolve = await screen.findByRole("button", { name: "Resolve" });
    act(() => { fireEvent.click(resolve); fireEvent.click(resolve); });
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.pullRequests.resolveThread)).toHaveLength(1);
    await act(async () => { finish({ success: true }); });
  });
  it("loads from a URL reference without an inbox row, then opens Changes", async () => {
    harness();
    await screen.findByRole("heading", { name: prFixture.title });
    expect(invoke).toHaveBeenCalledWith(CHANNELS.pullRequests.getDetail,
      [{ provider: "github", owner: "acme", repo: "widget", number: 176 }]);
    await screen.findByText("okan opened this pull request");
    fireEvent.click(screen.getByRole("tab", { name: /Changes/ }));
    expect(screen.getByText("Diff for #176")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Leave a comment" })).toBeNull();
  });
  it("posts a comment using the same reference and retains a draft across preview hiding", async () => {
    const h = harness();
    const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    fireEvent.change(input, { target: { value: "Looks good" } });
    h.rerender(h.view(176, false));
    h.rerender(h.view(176, true));
    expect((screen.getByRole("textbox", { name: "Leave a comment" }) as HTMLTextAreaElement).value).toBe("Looks good");
    await waitFor(() => expect((screen.getByRole("button", { name: "Refresh pull request" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Leave a comment" }), { key: "Enter", metaKey: true });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(CHANNELS.pullRequests.addComment,
      [{ provider: "github", owner: "acme", repo: "widget", number: 176, body: "Looks good" }]));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Leave a comment" }) as HTMLTextAreaElement).value).toBe(""));
  });
  it("uses the selected merge method and refreshes the live data", async () => {
    harness();
    await screen.findByRole("heading", { name: prFixture.title });
    fireEvent.click(screen.getByRole("button", { name: "Choose merge method" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Squash and merge" }));
    fireEvent.click(screen.getByRole("button", { name: "Squash and merge" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(CHANNELS.pullRequests.merge,
      [{ provider: "github", owner: "acme", repo: "widget", number: 176, method: "squash" }]));
    await waitFor(() => expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.pullRequests.getDetail).length).toBeGreaterThan(1));
  });
  it("refreshes the diff as well as the summary after an external push", async () => {
    harness();
    await screen.findByRole("heading", { name: prFixture.title });
    fireEvent.click(screen.getByRole("tab", { name: /Changes/ }));
    await screen.findByText("Original diff");
    diffText = "Updated diff";
    fireEvent.click(screen.getByRole("button", { name: "Refresh pull request" }));
    await screen.findByText("Updated diff");
  });
  it("shows connection guidance and recovers when GitHub is connected", async () => {
    failDetail = true; connected = false;
    const h = harness();
    await screen.findByRole("button", { name: "Connect GitHub" });
    expect(screen.queryByRole("textbox", { name: "Leave a comment" })).toBeNull();
    const links = screen.getAllByRole("button", { name: "Open on GitHub" });
    fireEvent.click(links[0]);
    expect(openExternal).toHaveBeenCalledWith(prFixture.url);
    failDetail = false; connected = true;
    act(() => { h.state.dispatch(baseApi.util.invalidateTags(["Connection"])); });
    await screen.findByRole("textbox", { name: "Leave a comment" });
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
  });
  it("does not send a draft written for a different PR", async () => {
    const h = harness();
    fireEvent.change(await screen.findByRole("textbox", { name: "Leave a comment" }), { target: { value: "For PR 176" } });
    h.rerender(h.view(177));
    const input = await screen.findByRole("textbox", { name: "Leave a comment" });
    expect((input as HTMLTextAreaElement).value).toBe("");
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.pullRequests.addComment)).toBe(false);
  });
});
