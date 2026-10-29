import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadOperationsTarget, OperationsError, type OperationsTarget } from "./operations-lib";

/** Check the CI credential against the configured database without reading SQL. */
export async function checkBackupAccess(target: OperationsTarget, token: string, request = fetch): Promise<void> {
  if (!token) throw new OperationsError("Configure CLOUDFLARE_API_TOKEN for the backup environment");
  let response: Response;
  try {
    response = await request(`https://api.cloudflare.com/client/v4/accounts/${target.accountId}/d1/database/${target.databaseId}`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new OperationsError(`D1 metadata check failed for ${target.environment}; provider details are not logged`); }
  let body: { success?: boolean; result?: { uuid?: string }; errors?: { code?: unknown }[] };
  try { body = await response.json() as typeof body; }
  catch { throw new OperationsError(`D1 metadata check returned an invalid response (HTTP ${response.status})`); }
  if (!response.ok || body?.success !== true) {
    const codes = Array.isArray(body?.errors) ? [...new Set(body.errors.map((error) => error?.code)
      .filter((code): code is number => typeof code === "number" && Number.isInteger(code) && code >= 1000 && code <= 999999))].slice(0, 4) : [];
    throw new OperationsError(`D1 metadata access denied for ${target.environment} (HTTP ${response.status}${codes.length ? `; Cloudflare codes: ${codes.join(", ")}` : ""}). Check the CI token's account scope and D1 Read permission`);
  }
  if (body.result?.uuid !== target.databaseId) throw new OperationsError(`D1 metadata identity mismatch for ${target.environment}`);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) try {
  const target = await loadOperationsTarget(process.env.TARGET_ENV ?? "");
  await checkBackupAccess(target, process.env.CLOUDFLARE_API_TOKEN ?? "");
  console.log(`CI token can read the configured ${target.environment} D1 database metadata.`);
} catch (error) {
  console.error(error instanceof OperationsError ? error.message : "Backup access check failed; sensitive diagnostics are not logged");
  process.exitCode = 1;
}
