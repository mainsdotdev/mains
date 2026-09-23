import { DatabaseOwnershipError } from "@mains/backend/db/database-ownership";
import { afterEach, describe, expect, it, vi } from "vitest";

const runServerCli = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock("./server-cli", () => ({ runServerCli }));

const originalServiceMode = process.env.MAINS_SERVER_SERVICE;

async function runEntry(error: Error, serviceMode: boolean): Promise<void> {
  vi.resetModules();
  runServerCli.mockRejectedValueOnce(error);
  if (serviceMode) {
    process.env.MAINS_SERVER_SERVICE = "1";
  } else {
    delete process.env.MAINS_SERVER_SERVICE;
  }

  await import("./server-entry");
  await vi.waitFor(() => expect(process.exitCode).not.toBeUndefined());
}

afterEach(() => {
  vi.restoreAllMocks();
  runServerCli.mockReset();
  process.exitCode = undefined;
  if (originalServiceMode === undefined) {
    delete process.env.MAINS_SERVER_SERVICE;
  } else {
    process.env.MAINS_SERVER_SERVICE = originalServiceMode;
  }
});

describe("server process exit behavior", () => {
  it("exits successfully when a background service finds Mains data already owned", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await runEntry(
      new DatabaseOwnershipError("Mains data is already in use"),
      true,
    );

    expect(process.exitCode).toBe(0);
  });

  it("keeps ownership conflicts as failures for an interactive server", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runEntry(
      new DatabaseOwnershipError("Mains data is already in use"),
      false,
    );

    expect(process.exitCode).toBe(1);
  });

  it("keeps unrelated background service startup errors as failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runEntry(new Error("port is unavailable"), true);

    expect(process.exitCode).toBe(1);
  });
});
