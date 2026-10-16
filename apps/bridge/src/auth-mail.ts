export interface BridgeMailEnv {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  AUTH_MAILER?: { fetch(input: string, init?: RequestInit): Promise<Response> };
}
export type BridgeMailKind = "sign-in" | "verify-email" | "reset-password";
export function bridgeMailConfigured(env: BridgeMailEnv): boolean {
  return !!env.AUTH_MAILER || !!env.RESEND_API_KEY && !!env.MAIL_FROM;
}
const messages = {
  "sign-in": { subject: "Sign in to Mains Bridge", instruction: "Sign in to Mains Bridge", expiry: "five minutes" },
  "verify-email": { subject: "Verify your Mains email", instruction: "Verify your email address", expiry: "one hour" },
  "reset-password": { subject: "Reset your Mains password", instruction: "Set your Mains sign-in password", expiry: "15 minutes" },
};
export async function sendBridgeMail(env: BridgeMailEnv, message: { to: string; url: string; kind: BridgeMailKind }): Promise<void> {
  const copy = messages[message.kind];
  const text = `${copy.instruction}: ${message.url}\nThis link expires in ${copy.expiry}. If you did not request it, you can ignore this email.`;
  let response: Response;
  if (env.AUTH_MAILER) response = await env.AUTH_MAILER.fetch("https://bridge-mail.internal/send", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...message, subject: copy.subject, text }),
  });
  else if (env.RESEND_API_KEY && env.MAIL_FROM) response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [message.to], subject: copy.subject, text }),
  });
  else throw new Error("Email sign-in is not configured");
  if (!response.ok) throw new Error("Could not send the account email");
}
