import { expect } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { BridgeAuthStatus } from "@mains/contracts/bridge-auth";
import { startLocalBackends, waitFor } from "./local-backends";
type Fixture = Awaited<ReturnType<typeof startLocalBackends>>;
export async function signIn(fixture: Fixture, backend: Fixture["a"], email = "owner@example.com", includeExisting = true) {
  await backend.client.call(CHANNELS.bridge.signIn, { hubUrl: fixture.hub.url, label: backend.label, includeExisting, flow: "device" });
  const status = await backend.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus);
  expect(status.state).toBe("signing-in"); expect(status.login?.code).toBeTruthy();
  const browser = await fixture.hub.login(email);
  const claim = await fetch(new URL(`/api/auth/device?user_code=${encodeURIComponent(status.login!.code!)}`, fixture.hub.url), { headers: { Cookie: browser.cookie } });
  expect(claim.status).toBe(200);
  const response = await fetch(new URL("/api/auth/device/approve", fixture.hub.url), { method: "POST", headers: { Cookie: browser.cookie, Origin: new URL(fixture.hub.url).origin, "Content-Type": "application/json" }, body: JSON.stringify({ userCode: status.login!.code }) });
  expect(response.status).toBe(200);
  return waitFor(() => backend.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus), (value) => value.state === "ready" || value.state === "needs-approval", "signed-in backend", 45_000);
}
export async function approve(fixture: Fixture) {
  const status = await waitFor(() => fixture.a.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth),
    (value) => value.approvals.some((entry) => entry.backendId === fixture.b.backendId), "approval request");
  await fixture.a.client.call(CHANNELS.bridge.approveBackend, status.approvals.find((entry) => entry.backendId === fixture.b.backendId));
  const offered = await waitFor(() => fixture.b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth),
    (value) => value.state === "needs-verification", "account key comparison");
  expect(offered.joinCodes).toEqual([]);
  // The approver shows the code for the entry that admitted B; B pins exactly that history.
  const join = (await fixture.a.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth)).joinCodes.find((entry) => entry.backendId === fixture.b.backendId);
  expect(join?.code).toBeTruthy();
  expect((await fixture.b.client.call(CHANNELS.bridge.getStatus)).enabled).toBe(false);
  await fixture.b.client.call(CHANNELS.bridge.confirmAccountKey, join!.code);
  return waitFor(() => fixture.b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth), (value) => value.state === "ready", "approved backend");
}
