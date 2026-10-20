import { countUse, type CountingDatabase } from "./limit-count";
import { renderBridgeMail, type BridgeMail } from "./mail-template";

export interface BridgeMailEnv {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  AUTH_MAILER?: { fetch(input: string, init?: RequestInit): Promise<Response> };
  AUTH_DB?: CountingDatabase;
  /** "unrestricted" lifts the closed-beta mail policy for tests and local development only. */
  BRIDGE_MAIL_POLICY?: string;
}
export { MAINS_DOWNLOAD_URL, type BridgeMail, type BridgeMailKind } from "./mail-template";
export function bridgeMailConfigured(env: BridgeMailEnv): boolean {
  return !!env.AUTH_MAILER || !!env.RESEND_API_KEY && !!env.MAIL_FROM;
}
export async function sendBridgeMail(env: BridgeMailEnv, message: BridgeMail): Promise<void> {
  // HTML in the sign-in pages' look, with the same content as plain text for clients that prefer it.
  const { subject, text, html, attachments } = renderBridgeMail(message);
  let response: Response;
  if (env.AUTH_MAILER) response = await env.AUTH_MAILER.fetch("https://bridge-mail.internal/send", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...message, subject, text, html, attachments }),
  });
  else if (env.RESEND_API_KEY && env.MAIL_FROM) response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [message.to], subject, text, html, attachments }),
  });
  else throw new Error("Email sign-in is not configured");
  if (!response.ok) throw new Error("Could not send the account email");
}

/** Resend's free tier allows 100 emails a day across staging and production together. */
export const BRIDGE_MAIL_DAILY_LIMIT = 10, BRIDGE_MAIL_PER_ADDRESS_HOURLY = 3;
export class BridgeMailLimitError extends Error {
  constructor() { super("Email is paused for today. Continue with GitHub or try again tomorrow."); }
}
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
/** Every account email goes through here. During the closed beta only an address that can use Bridge
 * receives mail: an invitation that was not revoked, or a user with a Bridge account or an entitlement.
 * Other addresses, and an address past its hourly allowance, are skipped silently, so the public forms
 * never reveal which addresses are known. The daily limit applies to every request alike, before any of that. */
export async function deliverBridgeMail(env: BridgeMailEnv, message: BridgeMail, now = Date.now()): Promise<"sent" | "skipped"> {
  if (env.BRIDGE_MAIL_POLICY === "unrestricted") { await sendBridgeMail(env, message); return "sent"; }
  const db = env.AUTH_DB;
  if (!db) throw new Error("Email sign-in is not configured");
  const date = new Date(now), day = `mail:day:${date.toISOString().slice(0, 10)}`;
  const endOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  const today = await db.prepare("SELECT count FROM bridge_limits WHERE id=? AND expires_at>=?").bind(day, now).first<{ count: number }>();
  if ((today?.count ?? 0) >= BRIDGE_MAIL_DAILY_LIMIT) throw new BridgeMailLimitError();
  const to = message.to.trim().toLowerCase();
  const allowed = await db.prepare(`SELECT 1 FROM bridge_beta_invites WHERE email=?1 AND status<>'revoked'
    UNION ALL SELECT 1 FROM user u WHERE lower(u.email)=?1 AND (EXISTS(SELECT 1 FROM bridge_accounts WHERE account_id=u.id)
      OR EXISTS(SELECT 1 FROM account_entitlements WHERE account_id=u.id)) LIMIT 1`).bind(to).first();
  if (!allowed) return "skipped";
  if (await countUse(db, `mail:to:${await digest(to)}`, now + 3_600_000, now) > BRIDGE_MAIL_PER_ADDRESS_HOURLY) return "skipped";
  // Two requests can both pass the check above; the counter itself is exact.
  if (await countUse(db, day, endOfDay, now) > BRIDGE_MAIL_DAILY_LIMIT) return "skipped";
  await sendBridgeMail(env, message);
  return "sent";
}
