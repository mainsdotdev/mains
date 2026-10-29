import { expect, it, vi } from "vitest";
import { checkBackupAccess } from "../scripts/check-backup-access";
import { loadOperationsTarget } from "../scripts/operations-lib";

it("checks only the configured database metadata with the provided CI token", async () => {
  const target = await loadOperationsTarget("staging");
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, result: { uuid: target.databaseId } }));
  await checkBackupAccess(target, "fixture-token", request);
  expect(request).toHaveBeenCalledExactlyOnceWith(
    `https://api.cloudflare.com/client/v4/accounts/${target.accountId}/d1/database/${target.databaseId}`,
    expect.objectContaining({ headers: { Authorization: "Bearer fixture-token" }, redirect: "error" }),
  );
  expect(request.mock.calls[0][1]?.method).toBeUndefined(); // GET, never export or query.
});

it("retains only HTTP status and numeric error codes for an access denial", async () => {
  const target = await loadOperationsTarget("staging");
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: false,
    errors: [{ code: 10000, message: "secret-token private SQL" }, { code: 10000 }, { code: "secret-token" }],
  }, { status: 403 }));
  await expect(checkBackupAccess(target, "secret-token", request)).rejects.toMatchObject({
    message: "D1 metadata access denied for staging (HTTP 403; Cloudflare codes: 10000). Check the CI token's account scope and D1 Read permission",
  });
});

it("rejects mismatched database identity and missing credentials", async () => {
  const target = await loadOperationsTarget("production");
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, result: { uuid: "another-database" } }));
  await expect(checkBackupAccess(target, "fixture-token", request)).rejects.toThrow("D1 metadata identity mismatch for production");
  request.mockClear();
  await expect(checkBackupAccess(target, "", request)).rejects.toThrow("Configure CLOUDFLARE_API_TOKEN");
  expect(request).not.toHaveBeenCalled();
});

it("hides network errors and invalid response bodies", async () => {
  const target = await loadOperationsTarget("staging");
  const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret-token signed-url"));
  await expect(checkBackupAccess(target, "secret-token", request)).rejects.toMatchObject({
    message: "D1 metadata check failed for staging; provider details are not logged",
  });
  request.mockResolvedValue(new Response("private HTML", { status: 502 }));
  await expect(checkBackupAccess(target, "secret-token", request)).rejects.toMatchObject({
    message: "D1 metadata check returned an invalid response (HTTP 502)",
  });
});
