import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPrSource, getCommits, getActivity } = vi.hoisted(() => ({
  createPrSource: vi.fn(), getCommits: vi.fn(), getActivity: vi.fn(),
}));
vi.mock("./sources/source.factory", () => ({ createPrSource, isSupportedPrProvider: (id: string) => id === "github" }));
vi.mock("../connections", () => ({ getConnectionWithSecrets: vi.fn() }));
vi.mock("../sync/sync.connection-utils", () => ({ getSelectedResources: vi.fn() }));
import { pullRequestsService } from "./pullRequests.service";

const ref = { owner: "acme", repo: "widget", number: 179 };
beforeEach(() => {
  vi.clearAllMocks();
  createPrSource.mockResolvedValue({ getCommits, getActivity });
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
