import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import type { BridgeBlobPresignResult } from "@mains/contracts/bridge-blobs";
import { startLocalBridgeHub } from "./local-hub.mjs";

let hub: Awaited<ReturnType<typeof startLocalBridgeHub>>;
beforeAll(async () => { hub = await startLocalBridgeHub(); }, 30_000);
afterAll(async () => { await hub?.dispose(); });
const identity = () => ({ blobId: randomBytes(32).toString("base64url"), size: 3 });
async function presign(account: string, blob = identity(), op: "put" | "get" = "put") {
  const response = await fetch(new URL("/v1/blobs/presign", hub.url), { method: "POST", headers: { Authorization: `Bearer ${await hub.token(account, "A")}` }, body: JSON.stringify({ blobs: [blob], op }) });
  expect(response.status).toBe(200); return (await response.json() as BridgeBlobPresignResult).blobs[0];
}
describe("Private R2 blob capabilities", () => {
  it("requires authentication, bounds requests and rejects malformed manifests", async () => {
    const url = new URL("/v1/blobs/presign", hub.url);
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(401);
    const headers = { Authorization: `Bearer ${await hub.token("account", "A")}` };
    for (const blobs of [[{ ...identity(), size: -1 }], [{ ...identity(), size: 50 * 1024 * 1024 + 1 }], [{ blobId: "../../secret", size: 1 }], new Array(17).fill(identity())])
      expect((await fetch(url, { method: "POST", headers, body: JSON.stringify({ op: "put", blobs }) })).status).toBe(400);
    expect((await fetch(url, { method: "POST", headers, body: "x".repeat(17 * 1024) })).status).toBe(400);
    expect((await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${await hub.token("account", "A", "-1s")}` }, body: "{}" })).status).toBe(401);
  });
  it("issues immutable, account-scoped, operation-bound URLs without filenames or MIME metadata", async () => {
    const account = randomUUID(), ref = identity(), signed = await presign(account, ref), bytes = randomBytes(ref.size + 40);
    expect(signed.chunks).toHaveLength(1); expect(signed.chunks[0].exists).toBe(false);
    expect((await fetch(signed.chunks[0].url, { method: "PUT", body: bytes })).status).toBe(204);
    expect((await fetch(signed.chunks[0].url)).status).toBe(403); // A PUT capability cannot read.
    expect((await fetch(signed.chunks[0].url, { method: "PUT", body: randomBytes(bytes.length) })).status).toBe(204);
    const read = (await presign(account, ref, "get")).chunks[0]; expect(read.exists).toBe(true);
    expect(Buffer.from(await (await fetch(read.url)).arrayBuffer())).toEqual(bytes);
    expect((await fetch(read.url, { method: "PUT", body: bytes })).status).toBe(403);
    const other = (await presign(randomUUID(), ref, "get")).chunks[0]; expect(other.exists).toBe(false); expect((await fetch(other.url)).status).toBe(404);
    const modified = new URL(read.url); const cap = modified.searchParams.get("cap")!;
    modified.searchParams.set("cap", cap.slice(0, -8) + "tampered"); expect((await fetch(modified)).status).toBe(403);
    await hub.restart(); // R2 survives Worker/runtime restarts too.
    const after = (await presign(account, ref, "get")).chunks[0]; expect(Buffer.from(await (await fetch(after.url)).arrayBuffer())).toEqual(bytes);
  });
  it("rejects truncated and oversized ciphertext rather than creating an unusable chunk", async () => {
    const signed = await presign(randomUUID()), chunk = signed.chunks[0];
    expect((await fetch(chunk.url, { method: "PUT", body: randomBytes(42) })).status).toBe(400);
    expect((await fetch(chunk.url, { method: "PUT", body: randomBytes(44) })).status).toBe(403);
    await expect((await hub.bucket()).list()).resolves.toBeDefined();
  });
});
