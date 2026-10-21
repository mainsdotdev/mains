import { countUse, type CountingDatabase } from "./limit-count";
import { renderBridgeMail, type BridgeMail } from "./mail-template";

export interface BridgeMailEnv {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  AUTH_MAILER?: { fetch(input: string, init?: RequestInit): Promise<Response> };
  AUTH_DB?: CountingDatabase;
  /** "unrestricted" lifts the closed-beta mail policy for tests and local development only. */
  BRIDGE_MAIL_POLICY?: string;
  /** The most emails this hub sends a UTC day. Staging and production share Resend's 100, so their limits add up to it. */
  BRIDGE_MAIL_DAILY_LIMIT?: string;
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
  // The provider's own quota is the same pause as ours, with the same message.
  if (response.status === 429) throw new BridgeMailLimitError();
  if (!response.ok) throw new Error("Could not send the account email");
}

/** A hub's daily total when its configuration sets none, and what one address may receive in a day: enough to
 * sign up and sign in, too few to flood a mailbox. Resend's free tier allows 100 a day across both hubs. */
export const BRIDGE_MAIL_DAILY_LIMIT = 10, BRIDGE_MAIL_PER_ADDRESS_DAILY = 10;
export function bridgeMailDailyLimit(env: BridgeMailEnv): number {
  const configured = Number(env.BRIDGE_MAIL_DAILY_LIMIT);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : BRIDGE_MAIL_DAILY_LIMIT;
}
export class BridgeMailLimitError extends Error {
  constructor() { super("Email is paused for today. Continue with GitHub or try again tomorrow."); }
}
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
/** Every account email goes through here. Signing up and signing in work for any address; Bridge access is
 * gated after sign-in, by invitation. An address past its daily allowance is skipped silently, and once the
 * day's limit is reached every request is refused alike. */
export async function deliverBridgeMail(env: BridgeMailEnv, message: BridgeMail, now = Date.now()): Promise<"sent" | "skipped"> {
  if (env.BRIDGE_MAIL_POLICY === "unrestricted") { await sendBridgeMail(env, message); return "sent"; }
  const db = env.AUTH_DB;
  if (!db) throw new Error("Email sign-in is not configured");
  const date = new Date(now), day = `mail:day:${date.toISOString().slice(0, 10)}`;
  const endOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  const today = await db.prepare("SELECT count FROM bridge_limits WHERE id=? AND expires_at>=?").bind(day, now).first<{ count: number }>();
  const limit = bridgeMailDailyLimit(env);
  if ((today?.count ?? 0) >= limit) throw new BridgeMailLimitError();
  const to = message.to.trim().toLowerCase();
  if (await countUse(db, `mail:to:${await digest(to)}`, now + 86_400_000, now) > BRIDGE_MAIL_PER_ADDRESS_DAILY) return "skipped";
  // Two requests can both pass the check above; the counter itself is exact.
  if (await countUse(db, day, endOfDay, now) > limit) return "skipped";
  await sendBridgeMail(env, message);
  return "sent";
}
