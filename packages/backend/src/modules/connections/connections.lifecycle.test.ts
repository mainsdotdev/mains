import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createConnection } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";
let db: DatabaseInstance, cleanup: () => void, restore: () => void;
vi.mock("../../db/client", () => ({ getDb: () => db }));
import { connectionsService, getConnectionWithSecrets } from "./connections.service";
import { connectionsRepo } from "./connections.repo";
import { openConnectionLifecycle, shutdownConnectionLifecycle } from "./connection-lifecycle";

beforeEach(() => {
  openConnectionLifecycle();
  ({ db, cleanup } = createTestDb());
  restore = installTestBackendRuntime();
  createConnection(db, { id: "connection", provider: "github", status: "active" });
});
afterEach(async () => { await shutdownConnectionLifecycle(); vi.restoreAllMocks(); restore(); cleanup(); });

describe("connection credential ownership", () => {
  it("rejects credentials for a different provider before rotating or activating its connection", async () => {
    await expect(connectionsService.saveCredentials({ provider: "linear", connectionId: "connection", apiKey: "test-linear-key" })).rejects.toThrow("provider");
    expect(await connectionsRepo.findTokensByConnectionId("connection")).toHaveLength(0);
    expect(await connectionsRepo.findById("connection")).toMatchObject({ provider: "github", status: "active" });
  });
  it("rolls back token rotation when activating the connection fails", async () => {
    await connectionsService.saveCredentials({ provider: "github", connectionId: "connection", token: "original-token" });
    db.run(sql`CREATE TRIGGER reject_activation BEFORE UPDATE ON connections BEGIN SELECT RAISE(ABORT, 'Connection metadata unavailable'); END`);
    await expect(connectionsService.saveCredentials({ provider: "github", connectionId: "connection", token: "replacement-token" })).rejects.toThrow();
    expect((await getConnectionWithSecrets("github"))?.secrets.token).toBe("original-token");
  });

  it("keeps revocation atomic if retiring current tokens fails", async () => {
    await connectionsService.saveCredentials({ provider: "github", connectionId: "connection", token: "original-token" });
    db.run(sql`CREATE TRIGGER reject_token_retirement BEFORE UPDATE ON connection_tokens BEGIN SELECT RAISE(ABORT, 'Token store unavailable'); END`);
    await expect(connectionsService.revoke("github")).rejects.toThrow();
    expect(await connectionsRepo.findById("connection")).toMatchObject({ status: "active" });
    expect((await getConnectionWithSecrets("github"))?.secrets.token).toBe("original-token");
  });

  it("does not let an earlier credential save reactivate a connection after revoke was requested", async () => {
    const find = connectionsRepo.findById.bind(connectionsRepo);
    let release!: () => void, enter!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), entered = new Promise<void>((resolve) => { enter = resolve; });
    vi.spyOn(connectionsRepo, "findById").mockImplementationOnce(async (id) => { const value = await find(id); enter(); await gate; return value; });
    const save = connectionsService.saveCredentials({ provider: "github", connectionId: "connection", token: "stale-token" }); await entered;
    const revoke = connectionsService.revoke("github");
    await new Promise<void>((resolve) => setImmediate(resolve)); release(); await Promise.allSettled([save, revoke]);
    expect(await connectionsRepo.findById("connection")).toMatchObject({ status: "revoked" });
    expect(await getConnectionWithSecrets("github")).toBeNull();
  });

});

it("joins duplicate credential submissions without rotating twice", async () => {
  const input = { provider: "github", connectionId: "connection", token: "test-token" };
  const results = await Promise.all([connectionsService.saveCredentials(input), connectionsService.saveCredentials(input)]);
  expect(results[0]).toEqual(results[1]);
  expect(await connectionsRepo.findTokensByConnectionId("connection")).toHaveLength(1);
});
it("rejects a selection captured before revoke, even after a new authorization", async () => {
  const { connection } = await connectionsService.getByProvider("github");
  await connectionsService.revoke("github");
  await connectionsService.saveCredentials({ provider: "github", connectionId: "connection", token: "new-token" });
  await expect(connectionsService.saveResources({ provider: "github", connectionId: "connection", expectedRevision: connection.revision, resources: [{ fullName: "org/repo", name: "repo" }] })).rejects.toThrow("changed");
  expect(await connectionsRepo.findResourcesByConnectionId("connection")).toEqual([]);
});
it("rolls back every selected resource if a later resource cannot be saved", async () => {
  db.run(sql`CREATE TRIGGER fail_resource BEFORE INSERT ON connection_resources WHEN NEW.external_id = 'org/second' BEGIN SELECT RAISE(ABORT, 'Resource unavailable'); END`);
  await expect(connectionsService.saveResources({ provider: "github", connectionId: "connection", resources: [{ fullName: "org/first", name: "first" }, { fullName: "org/second", name: "second" }] })).rejects.toThrow();
  expect(await connectionsRepo.findResourcesByConnectionId("connection")).toEqual([]);
});
it("never uses another provider's credentials for discovery", async () => {
  await connectionsService.saveCredentials({ provider: "github", connectionId: "connection", token: "test-token" });
  const network = vi.spyOn(globalThis, "fetch");
  await expect(connectionsService.getGitlabProjects("connection")).rejects.toThrow(/provider/);
  expect(network).not.toHaveBeenCalled();
});
it("retries the same failed selection without accepting a different stale intent", async () => {
  const { connection } = await connectionsService.getByProvider("github");
  const input = { provider: "github", connectionId: "connection", expectedRevision: connection.revision, resources: [{ fullName: "org/repo", name: "repo" }] };
  db.run(sql`CREATE TRIGGER fail_selection BEFORE INSERT ON connection_resources BEGIN SELECT RAISE(ABORT, 'Unavailable'); END`);
  await expect(connectionsService.saveResources(input)).rejects.toThrow();
  db.run(sql`DROP TRIGGER fail_selection`);
  await expect(connectionsService.saveResources(input)).resolves.toMatchObject({ count: 1 });
});
it("does not revive an old read lease when the backend generation reopens", async () => {
  await connectionsService.saveCredentials({ provider: "github", connectionId: "connection", token: "test-token" });
  const old = await getConnectionWithSecrets("github"); expect(old?.lease?.current()).toBe(true);
  await shutdownConnectionLifecycle(); openConnectionLifecycle();
  expect(old?.lease?.current()).toBe(false);
  expect((await getConnectionWithSecrets("github"))?.lease?.current()).toBe(true);
});
it("rejects an external status change between identity lookup and secret resolution", async () => {
  await connectionsService.saveCredentials({ provider: "github", connectionId: "connection", token: "test-token" });
  const read = getConnectionWithSecrets("github");
  db.run(sql`UPDATE connections SET status = 'revoked' WHERE id = 'connection'`);
  expect(await read).toBeNull();
});
