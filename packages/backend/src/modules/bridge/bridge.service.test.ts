import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../../../test/setup-db";
import { configureBackendRuntime } from "../../runtime/backend-runtime";
import { createNodeBackendRuntime } from "../../runtime/node-backend-runtime";

let database: ReturnType<typeof createTestDb>, directory: string, restoreRuntime: () => void;
vi.mock("../../db/client", () => ({ getSqlite: () => database.sqlite, getDb: () => database.db }));
import { bridgeService } from "./bridge.service";

beforeEach(async () => {
  database = createTestDb();
  database.sqlite.exec("INSERT INTO accounts(id) VALUES('default'); INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','A')");
  directory = await mkdtemp(join(tmpdir(), "mains-bridge-owner-"));
  restoreRuntime = configureBackendRuntime(createNodeBackendRuntime({ dataDir: directory, appVersion: "test" }));
  vi.stubEnv("MAINS_BRIDGE_CONFIG", join(directory, "bridge", "dev.json"));
});
afterEach(async () => {
  await bridgeService.stop(); restoreRuntime(); database.cleanup();
  await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks();
});

describe("Bridge service ownership", () => {
  it("can retry startup after a malformed development config is removed", async () => {
    await mkdir(join(directory, "bridge"), { recursive: true });
    await writeFile(join(directory, "bridge", "dev.json"), "invalid JSON");
    await bridgeService.start();
    expect(bridgeService.getStatus()).toMatchObject({ state: "error", error: "Invalid Bridge development configuration JSON" });
    await rm(join(directory, "bridge", "dev.json"));
    await bridgeService.start();
    expect(bridgeService.getStatus()).toMatchObject({ state: "disabled", error: null });
  });
});
