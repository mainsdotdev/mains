import { bridgeApprovalCode, bridgeBytes, bridgeRecoveryMessage, validateBridgeDeviceWrap, validateBridgeRecoveryWrap,
  type BridgeApprovalRequest, type BridgeRegisteredBackend, type BridgeSealedAccountKey } from "@mains/contracts/bridge-auth";
import { digestToken, randomToken, signedInUser, type AuthEnv } from "./identity";
import { HttpError, identifier, json, jsonInput, rateLimit, textField } from "./auth-http";
import { reportBridgeFailure } from "./observability";

export interface BackendRow {
  account_id: string; backend_id: string; public_key: string; label: string; platform: string;
  status: "pending" | "approved" | "revoked"; token_hash: string; token_expires_at: number; created_at: number; last_seen: number | null;
  recovery_challenge: string | null; challenge_expires_at: number | null;
}
export type IdentityControl = { approval(accountId: string, request: BridgeApprovalRequest): Promise<void>; revoked(accountId: string, backendId: string): Promise<void> };
const ttl = 90 * 24 * 60 * 60 * 1000;
export async function backendIdentity(request: Request, env: AuthEnv, pending = false): Promise<BackendRow | null> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!env.AUTH_DB || !token?.startsWith("b7_")) return null;
  const row = await env.AUTH_DB.prepare("SELECT * FROM bridge_backends WHERE token_hash=? AND token_expires_at>?")
    .bind(await digestToken(token), Date.now()).first<BackendRow>();
  return row && row.status !== "revoked" && (pending || row.status === "approved") ? row : null;
}
export async function backendStillApproved(env: AuthEnv, account: string, backend: string, hash: string): Promise<boolean> {
  return !!await env.AUTH_DB?.prepare("SELECT 1 FROM bridge_backends WHERE account_id=? AND backend_id=? AND token_hash=? AND status='approved' AND token_expires_at>?")
    .bind(account, backend, hash, Date.now()).first();
}
const format = (row: BackendRow): BridgeRegisteredBackend => ({ backendId: row.backend_id, publicKey: row.public_key, label: row.label, platform: row.platform,
  status: row.status, createdAt: new Date(row.created_at).toISOString(), lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null });
const approvedSql = "EXISTS(SELECT 1 FROM bridge_backends authorizer WHERE authorizer.account_id=? AND authorizer.backend_id=? AND authorizer.token_hash=? AND authorizer.status='approved' AND authorizer.token_expires_at>?)";
const approvalArgs = (b: BackendRow) => [b.account_id, b.backend_id, b.token_hash, Date.now()];
async function approvals(env: AuthEnv, account: string): Promise<BridgeApprovalRequest[]> {
  const rows = await env.AUTH_DB!.prepare(`SELECT a.request_id,a.expires_at,b.* FROM bridge_approvals a JOIN bridge_backends b
    ON a.account_id=b.account_id AND a.backend_id=b.backend_id AND a.public_key=b.public_key
    WHERE a.account_id=? AND a.status='pending' AND b.status='pending' AND a.expires_at>? ORDER BY a.expires_at`)
    .bind(account, Date.now()).all<BackendRow & { request_id: string; expires_at: number }>();
  return Promise.all(rows.results.map(async (row) => ({ requestId: row.request_id, backendId: row.backend_id, publicKey: row.public_key,
    label: row.label, platform: row.platform, code: await bridgeApprovalCode(row.public_key), expiresAt: new Date(row.expires_at).toISOString() })));
}

export async function handleDevices(request: Request, env: AuthEnv, control: IdentityControl): Promise<Response> {
  const path = new URL(request.url).pathname, db = env.AUTH_DB;
  if (!db) return json({ error: "Bridge sign-in is not configured" }, 503);
  try {
    if (path === "/v1/backends" && request.method === "POST") {
      const user = await signedInUser(env, request);
      if (!user) throw new HttpError(401, "Sign in first");
      await rateLimit(env, `register:${user.id}`, 20);
      const body = await jsonInput(request), backendId = identifier(body.backendId), label = textField(body.label, "label"), platform = textField(body.platform, "platform", 32);
      bridgeBytes(body.publicKey, 32); const publicKey = body.publicKey as string;
      const token = `b7_${randomToken()}`, hash = await digestToken(token), now = Date.now();
      // Live registrations cannot be replaced merely by logging into the account.
      const row = await db.prepare(`INSERT INTO bridge_backends(account_id,backend_id,public_key,label,platform,status,token_hash,token_expires_at,created_at)
        VALUES(?,?,?,?,?,'pending',?,?,?) ON CONFLICT(account_id,backend_id) DO UPDATE SET public_key=excluded.public_key,label=excluded.label,
        platform=excluded.platform,status='pending',token_hash=excluded.token_hash,token_expires_at=excluded.token_expires_at,created_at=excluded.created_at,
        recovery_challenge=NULL,challenge_expires_at=NULL WHERE bridge_backends.status='revoked' OR bridge_backends.token_expires_at<? RETURNING *`)
        .bind(user.id, backendId, publicKey, label, platform, hash, now + ttl, now, now).first<BackendRow>();
      if (!row) throw new HttpError(409, "This backend is already registered; revoke its old registration before signing in again");
      await db.batch([db.prepare("DELETE FROM bridge_key_wraps WHERE account_id=? AND backend_id=?").bind(user.id, backendId),
        db.prepare("DELETE FROM bridge_approvals WHERE account_id=? AND backend_id=?").bind(user.id, backendId)]);
      return json({ accountId: user.id, email: user.email, backend: format(row), token, expiresAt: row.token_expires_at }, 201);
    }
    const backend = await backendIdentity(request, env, true);
    if (!backend) throw new HttpError(401, "Backend sign-in expired or was revoked");
    await rateLimit(env, `backend:${backend.account_id}:${backend.backend_id}`, 180);
    const account = backend.account_id, id = backend.backend_id, ready = backend.status === "approved";
    const requireApproved = () => { if (!ready) throw new HttpError(403, "Approve this backend on another device or enter its recovery code"); };
    if (path === "/v1/keys/mine" && request.method === "GET") {
      const keys = await db.prepare("SELECT recovery_public_key FROM bridge_accounts WHERE account_id=?").bind(account).first<{ recovery_public_key: string }>();
      const mine = ready ? await db.prepare("SELECT wrap FROM bridge_key_wraps WHERE account_id=? AND backend_id=?").bind(account, id).first<{ wrap: string }>() : null;
      const approval = await db.prepare("SELECT status,expires_at FROM bridge_approvals WHERE account_id=? AND backend_id=?").bind(account, id).first();
      return json({ accountId: account, backend: format(backend), initialized: !!keys, recoveryPublicKey: keys?.recovery_public_key ?? null,
        wrap: mine ? JSON.parse(mine.wrap) : null, approval });
    }
    if (path === "/v1/keys/bootstrap" && request.method === "POST") {
      const body = await jsonInput(request); validateBridgeDeviceWrap(body.wrap); validateBridgeRecoveryWrap(body.recovery); bridgeBytes(body.recoveryPublicKey, 32);
      if (ready) throw new HttpError(409, "This account already has keys");
      const now = Date.now();
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO bridge_accounts(account_id,initializer_backend_id,initializer_token_hash,recovery_public_key,recovery_wrap,created_at)
          SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM bridge_backends WHERE account_id=? AND backend_id=? AND token_hash=? AND status='pending' AND token_expires_at>?)`)
          .bind(account, id, backend.token_hash, body.recoveryPublicKey, JSON.stringify(body.recovery), now, account, id, backend.token_hash, now),
        db.prepare(`INSERT OR IGNORE INTO bridge_key_wraps(account_id,backend_id,wrap) SELECT ?,?,? FROM bridge_accounts
          WHERE account_id=? AND initializer_backend_id=? AND initializer_token_hash=? AND EXISTS(SELECT 1 FROM bridge_backends WHERE account_id=? AND backend_id=? AND token_hash=? AND status='pending' AND token_expires_at>?)`)
          .bind(account, id, JSON.stringify(body.wrap), account, id, backend.token_hash, account, id, backend.token_hash, now),
        db.prepare(`UPDATE bridge_backends SET status='approved' WHERE account_id=? AND backend_id=? AND token_hash=?
          AND EXISTS(SELECT 1 FROM bridge_key_wraps WHERE account_id=? AND backend_id=?)`)
          .bind(account, id, backend.token_hash, account, id),
      ]);
      const initialized = await db.prepare("SELECT initializer_token_hash FROM bridge_accounts WHERE account_id=?").bind(account).first<{ initializer_token_hash: string }>();
      if (initialized?.initializer_token_hash !== backend.token_hash) throw new HttpError(409, "This account is initialized; use device approval or recovery");
      return json({ ok: true });
    }
    if (path === "/v1/backends" && request.method === "GET") {
      requireApproved();
      const result = await db.prepare("SELECT * FROM bridge_backends WHERE account_id=? ORDER BY created_at").bind(account).all<BackendRow>();
      return json(result.results.map(format));
    }
    if (path.startsWith("/v1/backends/") && request.method === "DELETE") {
      const target = identifier(decodeURIComponent(path.slice("/v1/backends/".length)));
      if (target !== id) requireApproved();
      const authorized = target === id ? "token_hash=? AND token_expires_at>?" : approvedSql;
      const authorizedArgs = target === id ? [backend.token_hash, Date.now()] : approvalArgs(backend);
      const result = await db.batch([
        db.prepare(`UPDATE bridge_backends SET status='revoked',recovery_challenge=NULL WHERE account_id=? AND backend_id=? AND ${authorized}`)
          .bind(account, target, ...authorizedArgs),
        db.prepare("DELETE FROM bridge_key_wraps WHERE account_id=? AND backend_id=? AND EXISTS(SELECT 1 FROM bridge_backends WHERE account_id=? AND backend_id=? AND status='revoked')")
          .bind(account, target, account, target),
        db.prepare("DELETE FROM bridge_approvals WHERE account_id=? AND backend_id=? AND EXISTS(SELECT 1 FROM bridge_backends WHERE account_id=? AND backend_id=? AND status='revoked')")
          .bind(account, target, account, target),
      ]);
      if (!result[0].meta.changes) throw new HttpError(404, "Backend unavailable");
      await control.revoked(account, target); return json({ ok: true });
    }
    if (path === "/v1/approvals" && request.method === "GET") { requireApproved(); return json(await approvals(env, account)); }
    if (path === "/v1/approvals" && request.method === "POST") {
      if (ready) throw new HttpError(409, "Backend is already approved");
      await rateLimit(env, `approval:${account}:${id}`, 5);
      const now = Date.now();
      await db.prepare(`INSERT INTO bridge_approvals(request_id,account_id,backend_id,public_key,status,expires_at) VALUES(?,?,?,?,'pending',?)
        ON CONFLICT(account_id,backend_id) DO UPDATE SET request_id=excluded.request_id,public_key=excluded.public_key,status='pending',expires_at=excluded.expires_at
        WHERE bridge_approvals.status<>'pending' OR bridge_approvals.expires_at<?`).bind(crypto.randomUUID(), account, id, backend.public_key, now + 600_000, now).run();
      const entry = (await approvals(env, account)).find((r) => r.backendId === id)!;
      await control.approval(account, entry); return json(entry, 201);
    }
    if (path === "/v1/keys/wraps" && request.method === "POST") {
      requireApproved(); const body = await jsonInput(request); validateBridgeDeviceWrap(body.wrap);
      const target = identifier(body.backendId), publicKey = textField(body.publicKey, "public key"); bridgeBytes(publicKey, 32);
      const code = await bridgeApprovalCode(publicKey);
      if (body.code !== code) throw new HttpError(400, "The approval codes do not match");
      const requestId = textField(body.requestId, "request id");
      const result = await db.batch([
        db.prepare(`INSERT OR IGNORE INTO bridge_key_wraps(account_id,backend_id,wrap) SELECT b.account_id,b.backend_id,? FROM bridge_backends b
          JOIN bridge_approvals a ON a.account_id=b.account_id AND a.backend_id=b.backend_id
          WHERE b.account_id=? AND b.backend_id=? AND b.public_key=? AND b.status='pending' AND a.request_id=? AND a.public_key=b.public_key
          AND a.status='pending' AND a.expires_at>? AND ${approvedSql}`)
          .bind(JSON.stringify(body.wrap), account, target, publicKey, requestId, Date.now(), ...approvalArgs(backend)),
        db.prepare(`UPDATE bridge_backends SET status='approved' WHERE account_id=? AND backend_id=? AND public_key=? AND status='pending'
          AND EXISTS(SELECT 1 FROM bridge_key_wraps WHERE account_id=? AND backend_id=?)`).bind(account, target, publicKey, account, target),
        db.prepare("UPDATE bridge_approvals SET status='approved' WHERE account_id=? AND backend_id=? AND request_id=? AND EXISTS(SELECT 1 FROM bridge_backends WHERE account_id=? AND backend_id=? AND status='approved')")
          .bind(account, target, requestId, account, target),
      ]);
      if (!result[0].meta.changes) throw new HttpError(409, "Approval expired, changed or was already completed");
      return json({ ok: true });
    }
    if (path.startsWith("/v1/approvals/") && request.method === "DELETE") {
      requireApproved(); const requestId = textField(decodeURIComponent(path.slice("/v1/approvals/".length)), "request id");
      const result = await db.prepare(`UPDATE bridge_approvals SET status='rejected' WHERE account_id=? AND request_id=? AND status='pending' AND ${approvedSql}`)
        .bind(account, requestId, ...approvalArgs(backend)).run();
      if (!result.meta.changes) throw new HttpError(404, "Approval unavailable"); return json({ ok: true });
    }
    if (path === "/v1/keys/recovery" && request.method === "GET") {
      const row = await db.prepare("SELECT recovery_public_key,recovery_wrap FROM bridge_accounts WHERE account_id=?").bind(account).first<{ recovery_public_key: string; recovery_wrap: string }>();
      if (!row) throw new HttpError(404, "Account keys are not initialized");
      return json({ recoveryPublicKey: row.recovery_public_key, recovery: JSON.parse(row.recovery_wrap) });
    }
    if (path === "/v1/keys/recovery" && request.method === "PUT") {
      requireApproved(); const body = await jsonInput(request); validateBridgeRecoveryWrap(body.recovery);
      const result = await db.prepare(`UPDATE bridge_accounts SET recovery_wrap=? WHERE account_id=? AND recovery_public_key=? AND ${approvedSql}`)
        .bind(JSON.stringify(body.recovery), account, body.recoveryPublicKey, ...approvalArgs(backend)).run();
      if (!result.meta.changes) throw new HttpError(409, "Recovery key does not match the account"); return json({ ok: true });
    }
    if (path === "/v1/keys/recovery/challenge" && request.method === "POST") {
      if (ready) throw new HttpError(409, "Backend is already approved");
      await rateLimit(env, `recover:${account}:${id}`, 10);
      const challenge = randomToken();
      await db.prepare("UPDATE bridge_backends SET recovery_challenge=?,challenge_expires_at=? WHERE account_id=? AND backend_id=? AND token_hash=? AND status='pending'")
        .bind(challenge, Date.now() + 300_000, account, id, backend.token_hash).run();
      return json({ challenge });
    }
    if (path === "/v1/keys/recovery/unlock" && request.method === "POST") {
      if (ready) throw new HttpError(409, "Backend is already approved");
      const body = await jsonInput(request); validateBridgeDeviceWrap(body.wrap);
      if (body.challenge !== backend.recovery_challenge || (backend.challenge_expires_at ?? 0) <= Date.now()) throw new HttpError(403, "Recovery challenge expired");
      const keys = await db.prepare("SELECT recovery_public_key FROM bridge_accounts WHERE account_id=?").bind(account).first<{ recovery_public_key: string }>();
      if (!keys) throw new HttpError(404, "Account keys unavailable");
      const verifyKey = await crypto.subtle.importKey("raw", bridgeBytes(keys.recovery_public_key, 32), "Ed25519", false, ["verify"]);
      if (!await crypto.subtle.verify("Ed25519", verifyKey, bridgeBytes(body.signature, 64),
        bridgeRecoveryMessage(account, id, backend.public_key, body.challenge as string, body.wrap as BridgeSealedAccountKey))) throw new HttpError(403, "Recovery proof is invalid");
      const result = await db.batch([
        db.prepare(`INSERT OR IGNORE INTO bridge_key_wraps(account_id,backend_id,wrap) SELECT account_id,backend_id,? FROM bridge_backends
          WHERE account_id=? AND backend_id=? AND token_hash=? AND status='pending' AND recovery_challenge=? AND challenge_expires_at>?`)
          .bind(JSON.stringify(body.wrap), account, id, backend.token_hash, body.challenge, Date.now()),
        db.prepare(`UPDATE bridge_backends SET status='approved',recovery_challenge=NULL,challenge_expires_at=NULL WHERE account_id=? AND backend_id=? AND token_hash=?
          AND EXISTS(SELECT 1 FROM bridge_key_wraps WHERE account_id=? AND backend_id=?)`).bind(account, id, backend.token_hash, account, id),
        db.prepare("UPDATE bridge_approvals SET status='approved' WHERE account_id=? AND backend_id=? AND EXISTS(SELECT 1 FROM bridge_backends WHERE account_id=? AND backend_id=? AND status='approved')")
          .bind(account, id, account, id),
      ]);
      if (!result[0].meta.changes) throw new HttpError(409, "Recovery challenge was already used"); return json({ ok: true });
    }
    if (path === "/v1/backends/refresh" && request.method === "POST") {
      requireApproved(); const token = `b7_${randomToken()}`, expiresAt = Date.now() + ttl;
      const result = await db.prepare("UPDATE bridge_backends SET token_hash=?,token_expires_at=? WHERE account_id=? AND backend_id=? AND token_hash=? AND status='approved'")
        .bind(await digestToken(token), expiresAt, account, id, backend.token_hash).run();
      if (!result.meta.changes) throw new HttpError(401, "Backend access changed"); return json({ token, expiresAt });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (!(error instanceof HttpError)) reportBridgeFailure(env, "identity", 400);
    return json({ error: error instanceof HttpError ? error.message : "Invalid identity or key request" }, error instanceof HttpError ? error.status : 400);
  }
}
