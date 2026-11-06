// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "@/lib/redux/api/baseApi";
import { useGetPrDiffQuery, type PrRefInput, type PullRequestDetail } from "@/lib/redux/api/pullRequestsApi";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import { toastStore } from "@/components/ui";
import { PullRequestView } from "./pull-request-view";

vi.mock("@/components/markdown-components", () => ({ markdownComponents: {} }));
vi.mock("@/lib/diff-highlighter", () => ({ warmDiffHighlighter: vi.fn() }));
vi.mock("./pr-diff-view", () => ({ PrDiffView: ({ prRef }: { prRef: PrRefInput }) => {
  const { data } = useGetPrDiffQuery(prRef);
  return <div><div>Diff for #{prRef.number}</div><div>{data?.diffText}</div></div>;
} }));

export const prFixture: PullRequestDetail = {
  provider: "github", nodeId: "pr-176", number: 176, title: "Prepare Mains 0.22.0 stable",
  url: "https://github.com/acme/widget/pull/176", repo: { owner: "acme", repo: "widget" },
  author: { login: "okan", avatarUrl: null }, state: "open", isDraft: false,
  additions: 29, deletions: 6, headRefName: "release/0.22.0", baseRefName: "dev",
  createdAt: "2026-11-06T06:00:00Z", updatedAt: "2026-11-06T06:10:00Z",
  ciStatus: "passing", reviewDecision: "APPROVED", bodyText: "Release preparation",
  body: "## Summary\nPrepare the stable release.\n\n- [x] Version updated\n- [x] Checks passed",
  mergedAt: null, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", autoMergeEnabled: false,
  viewerCanUpdate: true, comments: [], reviewThreads: [], latestReviews: [{ author: "reviewer", state: "APPROVED" }],
  checks: [{ name: "Desktop checks", status: "passing" }],
};

let failDetail = false;
let connected = true;
let diffText = "Original diff";
const invoke = vi.fn();
const openExternal = vi.fn();
const stores: ReturnType<typeof makeStore>[] = [];
function makeStore() {
  return configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer }, middleware: (defaults) => defaults().concat(baseApi.middleware) });
}
function harness() {
  const state = makeStore(); stores.push(state);
  const view = (number = 176, active = true) => <Provider store={state}><MemoryRouter>
    <PullRequestView prRef={{ owner: "Acme", repo: "Widget", number }} active={active} />
  </MemoryRouter></Provider>;
  return { state, view, ...render(view()) };
}
beforeEach(() => {
  failDetail = false; connected = true;
  diffText = "Original diff";
  invoke.mockImplementation(async (channel) => {
    if (channel === CHANNELS.pullRequests.getDetail) return failDetail
      ? { success: false, error: "GitHub connection not found" } : { success: true, data: prFixture };
    if (channel === CHANNELS.pullRequests.getAvailability) return { success: true, data: { provider: "github", connected, viewer: null, error: null } };
    if (channel === CHANNELS.pullRequests.getDiff) return { success: true, data: { diffText, truncated: false } };
    return { success: true, data: undefined };
  });
  setTransport({ kind: "test", invoke, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} } as Transport);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(window, "api", { configurable: true, value: { shell: { openExternal } } });
});
afterEach(() => {
  cleanup();
  for (const state of stores.splice(0)) state.dispatch(baseApi.util.resetApiState());
  resetTransport(); toastStore.dismissAll(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

describe("shared pull request view", () => {
  it("loads from a URL reference without an inbox row, then opens Changes", async () => {
    harness();
    await screen.findByRole("heading", { name: prFixture.title });
    expect(invoke).toHaveBeenCalledWith(CHANNELS.pullRequests.getDetail,
      [{ provider: "github", owner: "acme", repo: "widget", number: 176 }]);
    expect(screen.getByText("okan opened this pull request")).toBeTruthy();
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
