import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { bridgeApprovalCode, bridgeBase64, formatBridgeVerificationCode } from "@mains/contracts/bridge-auth";

it("binds the device comparison to its account, backend, encryption key and signing key", async () => {
  const identity = { accountId: "account", backendId: "backend", publicKey: bridgeBase64(new Uint8Array(32).fill(1)),
    signingPublicKey: bridgeBase64(new Uint8Array(32).fill(2)) };
  const expected = formatBridgeVerificationCode(createHash("sha256").update(JSON.stringify([
    3, "mains.bridge.v3/device-approval", identity.accountId, identity.backendId, identity.publicKey, identity.signingPublicKey,
  ])).digest());
  expect(await bridgeApprovalCode(identity)).toBe(expected);
  for (const change of [{ accountId: "other" }, { backendId: "other" }, { publicKey: identity.signingPublicKey }, { signingPublicKey: identity.publicKey }])
    expect(await bridgeApprovalCode({ ...identity, ...change })).not.toBe(expected);
  await expect(bridgeApprovalCode({ ...identity, signingPublicKey: undefined as unknown as string })).rejects.toThrow();
});
