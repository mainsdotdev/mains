import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveStandaloneServerToken: vi.fn(),
  startStandaloneServer: vi.fn(),
}));

vi.mock("./server-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./server-token")>();
  return {
    ...actual,
    resolveStandaloneServerToken: mocks.resolveStandaloneServerToken,
  };
});

vi.mock("./standalone-server", () => ({
  startStandaloneServer: mocks.startStandaloneServer,
}));

import { runServerCli } from "./server-cli";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runServerCli argument validation", () => {
  it("rejects a missing token value before creating a token or starting a server", async () => {
    await expect(
      runServerCli(["serve", "--token", "--lan"]),
    ).rejects.toThrow("--token requires a value");

    expect(mocks.resolveStandaloneServerToken).not.toHaveBeenCalled();
    expect(mocks.startStandaloneServer).not.toHaveBeenCalled();
  });
});
