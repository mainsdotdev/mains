// Account emails in the Bridge sign-in pages' look (auth-styles.ts): neutral palette, a white card and one
// blue action, under the Mains logo with the Mains / Bridge wordmark and above the site's links. Nothing
// loads from elsewhere: the logo travels with the message as an inline (CID) attachment, since email clients
// render neither the SVG mark nor data URIs, and every link is also shown as text.
import { MAINS_LOGO_PNG_BASE64 } from "./mail-logo";

export type BridgeMailKind =
  | "sign-in"
  | "verify-email"
  | "reset-password"
  | "beta-invite";
export type BridgeMail =
  | { kind: Exclude<BridgeMailKind, "beta-invite">; to: string; url: string }
  | { kind: "beta-invite"; to: string };
export const MAINS_DOWNLOAD_URL = "https://mains.dev";
export const MAINS_LOGO_CID = "mains-logo";
const footerLinks = [
  ["Download", MAINS_DOWNLOAD_URL],
  ["Docs", "https://docs.mains.dev"],
  ["Changelog", "https://mains.dev/changelog"],
  ["Support", "https://mains.dev/support"],
];

const color = {
  page: "#f7f7f6",
  card: "#ffffff",
  rim: "#e5e5e3",
  text: "#141414",
  muted: "#6f6e69",
  action: "#2563eb",
  onAction: "#ffffff",
};
// Single quotes only: these values sit inside double-quoted style attributes.
const font =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

type Content = {
  subject: string;
  title: string;
  lead: string;
  action: { label: string; url: string };
  body?: string;
  note: string;
  text: string;
};
const links = {
  "sign-in": {
    subject: "Sign in to Mains Bridge",
    instruction: "Sign in to Mains Bridge",
    expiry: "five minutes",
    title: "Sign in to Mains Bridge",
    lead: "Use this link to finish connecting your device to your Mains account.",
    label: "Sign in",
  },
  "verify-email": {
    subject: "Verify your Mains email",
    instruction: "Verify your email address",
    expiry: "one hour",
    title: "Verify your email",
    lead: "Confirm this address to finish creating your Mains account.",
    label: "Verify email",
  },
  "reset-password": {
    subject: "Reset your Mains password",
    instruction: "Set your Mains sign-in password",
    expiry: "15 minutes",
    title: "Set a new password",
    lead: "Choose a new password for your Mains account. Your recovery code and approved devices stay the same.",
    label: "Set new password",
  },
};

function content(message: BridgeMail): Content {
  if (message.kind === "beta-invite") {
    // The invitation carries no link that signs in: sign-in always starts in the app.
    const steps = [
      `Install or update Mains: ${MAINS_DOWNLOAD_URL}`,
      `Open Settings > Bridge and sign in with this email address (${message.to}), or with a GitHub account that uses it.`,
      "Choose Activate beta in the sign-in window.",
    ];
    return {
      subject: "You're invited to the Mains Bridge beta",
      title: "You're invited to Bridge",
      lead: "Bridge keeps your Mains chats and Atlas in sync across your devices, encrypted end to end.",
      action: { label: "Get Mains", url: MAINS_DOWNLOAD_URL },
      body: `<ol style="margin:0 0 24px;padding:0 0 0 20px;color:${color.text}" class="fg">${[
        "Install or update Mains.",
        `Open <strong>Settings &gt; Bridge</strong> and sign in with <strong>${escape(message.to)}</strong>, or with a GitHub account that uses it.`,
        "Choose <strong>Activate beta</strong> in the sign-in window.",
      ]
        .map((step) => `<li style="margin:0 0 8px">${step}</li>`)
        .join("")}</ol>`,
      note: "Your 30 days start when you activate. Includes 1 GiB of storage. No payment required. If you did not expect this invitation, you can ignore this email.",
      text: [
        "You're invited to the Mains Bridge beta. Bridge keeps your Mains chats and Atlas in sync across your devices, encrypted end to end.",
        "",
        ...steps.map((step, index) => `${index + 1}. ${step}`),
        "",
        "Your 30 days start when you activate. Includes 1 GiB of storage. No payment required.",
        "If you did not expect this invitation, you can ignore this email.",
      ].join("\n"),
    };
  }
  // Only the hub's own HTTP(S) links reach a button.
  if (!/^https?:\/\//i.test(message.url))
    throw new Error("Account email links must use HTTP(S)");
  const copy = links[message.kind];
  return {
    subject: copy.subject,
    title: copy.title,
    lead: copy.lead,
    action: { label: copy.label, url: message.url },
    note: `This link expires in ${copy.expiry}. If you did not request it, you can ignore this email.`,
    text: `${copy.instruction}: ${message.url}\nThis link expires in ${copy.expiry}. If you did not request it, you can ignore this email.`,
  };
}

function html(value: Content): string {
  const url = escape(value.action.url);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escape(value.subject)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .page { background: #0c0c0c !important; } .card { background: #141414 !important; border-color: #262625 !important; }
    .fg { color: #f7f7f6 !important; } .muted { color: #b5b5b5 !important; } .rule { border-color: #3a3a38 !important; }
    .link { color: #7aa7ff !important; }
  }
  a.action:hover { background: #1d4ed8 !important; }
</style></head>
<body style="margin:0;padding:0;background:${color.page}" class="page">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(value.lead)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${color.page}" class="page"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 28px"><tr>
<td style="padding-right:12px;vertical-align:middle"><img src="cid:${MAINS_LOGO_CID}" width="48" height="48" alt="Mains" style="display:block;width:48px;height:48px;border:0"></td>
<td style="vertical-align:middle;text-align:left"><p style="margin:0;font:600 22px/1 ${font};letter-spacing:-0.01em;color:${color.text}" class="fg">Mains</p>
<p style="margin:2px 0 0;font:500 11px/1 ${font};text-align:right;color:${color.muted}" class="muted">Bridge</p></td>
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:${color.card};border:1px solid ${color.rim};border-radius:24px" class="card"><tr><td style="padding:32px;font:14px/1.5 ${font};color:${color.text}" class="fg">
<h1 style="margin:0 0 10px;font:600 24px/1.25 ${font};letter-spacing:-0.035em;color:${color.text}" class="fg">${escape(value.title)}</h1>
<p style="margin:0 0 24px;color:${color.muted}" class="muted">${escape(value.lead)}</p>
${value.body ?? ""}<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px"><tr><td style="border-radius:12px;background:${color.action}">
<a href="${url}" class="action" style="display:inline-block;padding:12px 20px;border-radius:12px;background:${color.action};font:500 14px/20px ${font};color:${color.onAction};text-decoration:none">${escape(value.action.label)}</a>
</td></tr></table>
<p style="margin:0 0 24px;font-size:12px;color:${color.muted}" class="muted">Or open this link: <a href="${url}" class="link" style="color:${color.action};word-break:break-all">${url}</a></p>
<p style="margin:0;padding-top:20px;border-top:1px solid ${color.rim};font-size:12px;color:${color.muted}" class="muted rule">${escape(value.note)}</p>
</td></tr></table>
<p style="margin:28px 0 8px;font:13px/1.5 ${font};color:${color.muted}" class="muted">${footerLinks
    .map(
      ([label, href]) =>
        `<a href="${href}" style="color:${color.muted};text-decoration:underline" class="muted">${label}</a>`,
    )
    .join(" &middot; ")}</p>
<p style="margin:0;font:12px/1.5 ${font};color:${color.muted}" class="muted">&copy; ${new Date().getUTCFullYear()} Mains</p>
</td></tr></table>
</body></html>`;
}

export interface RenderedBridgeMail {
  subject: string;
  text: string;
  html: string;
  /** In Resend's shape; the logo the HTML shows by its content id. */
  attachments: { filename: string; content: string; content_id: string }[];
}
export function renderBridgeMail(message: BridgeMail): RenderedBridgeMail {
  const value = content(message);
  return {
    subject: value.subject,
    text: value.text,
    html: html(value),
    attachments: [
      {
        filename: "mains.png",
        content: MAINS_LOGO_PNG_BASE64,
        content_id: MAINS_LOGO_CID,
      },
    ],
  };
}
