import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPrSource, getCommits, getActivity, getReviewDetails, getDiff } = vi.hoisted(() => ({
  createPrSource: vi.fn(), getCommits: vi.fn(), getActivity: vi.fn(), getReviewDetails: vi.fn(), getDiff: vi.fn(),
}));
vi.mock("./sources/source.factory", () => ({ createPrSource, isSupportedPrProvider: (id: string) => id === "github" }));
vi.mock("../connections", () => ({ getConnectionWithSecrets: vi.fn() }));
vi.mock("../sync/sync.connection-utils", () => ({ getSelectedResources: vi.fn() }));
import { pullRequestsService } from "./pullRequests.service";

const ref = { owner: "acme", repo: "widget", number: 179 };
beforeEach(() => {
  vi.clearAllMocks();
  createPrSource.mockResolvedValue({ getCommits, getActivity, getReviewDetails, getDiff });
});

describe("PR review snapshots", () => {
  const revision = { baseOid: "a".repeat(40), headOid: "b".repeat(40) };
  const pr = { state: "open", title: "Review changes", body: "Description", revision };

  beforeEach(() => {
    getReviewDetails.mockReset().mockResolvedValue(pr);
    getDiff.mockReset().mockResolvedValue({ diffText: "diff --git a/file b/file\n", truncated: true });
  });

  it("keeps the exact diff and coverage for the selected revision", async () => {
    await expect(pullRequestsService.getReviewSnapshot(ref, revision)).resolves.toEqual({
      ...pr, diffText: "diff --git a/file b/file\n", truncated: true,
    });
    expect(getReviewDetails).toHaveBeenCalledTimes(2);
  });

  it("rejects a revision change while reading the diff", async () => {
    getReviewDetails.mockResolvedValueOnce(pr).mockResolvedValueOnce({ ...pr, revision: { ...revision, headOid: "c".repeat(40) } });
    await expect(pullRequestsService.getReviewSnapshot(ref, revision)).rejects.toThrow("pull request changed");
    expect(getDiff).toHaveBeenCalledOnce();
  });

  it("rejects a stale selection before reading the diff", async () => {
    await expect(pullRequestsService.getReviewSnapshot(ref, { ...revision, baseOid: "c".repeat(40) })).rejects.toThrow("pull request changed");
    expect(getDiff).not.toHaveBeenCalled();
  });
});

describe("PR page input boundary", () => {
  it("passes validated references, cursors and filters through the provider seam", async () => {
    await pullRequestsService.getCommits({ ...ref, cursor: "older", pageSize: 40 });
    expect(getCommits).toHaveBeenCalledWith(ref, { cursor: "older", pageSize: 40 });
    await pullRequestsService.getActivity({ ...ref, filter: "reviews" });
    expect(getActivity).toHaveBeenCalledWith(ref, { cursor: null, pageSize: undefined }, "reviews");
  });
  it.each([
    { cursor: 12 }, { cursor: "x".repeat(2049) }, { pageSize: 0 }, { pageSize: 101 }, { pageSize: 1.5 },
    { pageSize: NaN }, { number: -1 }, { owner: " " },
  ])("rejects malformed pagination or references before calling the source", async (patch) => {
    await expect(pullRequestsService.getCommits({ ...ref, ...patch } as never)).rejects.toThrow();
    expect(createPrSource).not.toHaveBeenCalled();
  });
  it("rejects unknown filters instead of silently broadening the activity query", async () => {
    await expect(pullRequestsService.getActivity({ ...ref, filter: "unknown" } as never)).rejects.toThrow("Unknown pull request activity filter");
    expect(createPrSource).not.toHaveBeenCalled();
  });
});
