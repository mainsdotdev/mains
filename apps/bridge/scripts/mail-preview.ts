import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MAINS_LOGO_CID, renderBridgeMail, type BridgeMail } from "../src/mail-template";

/** Writes every account email, with sample values, to an ignored directory for viewing in a browser. */
const dir = resolve(".wrangler", "mail-preview"), url = "https://bridge.mains.dev/api/auth/magic-link/verify?token=preview-only&callbackURL=%2Fdevice";
const samples: BridgeMail[] = [{ kind: "sign-in", to: "you@example.com", url }, { kind: "verify-email", to: "you@example.com", url },
  { kind: "reset-password", to: "you@example.com", url }, { kind: "beta-invite", to: "you@example.com" }];
await mkdir(dir, { recursive: true });
for (const sample of samples) {
  const mail = renderBridgeMail(sample);
  // A browser cannot resolve the inline attachment, so the preview carries the logo as a data URI instead.
  const logo = mail.attachments.find((attachment) => attachment.content_id === MAINS_LOGO_CID)!;
  await writeFile(join(dir, `${sample.kind}.html`), mail.html.replace(`cid:${MAINS_LOGO_CID}`, `data:image/png;base64,${logo.content}`));
  await writeFile(join(dir, `${sample.kind}.txt`), `Subject: ${mail.subject}\n\n${mail.text}\n`);
}
console.log(`Wrote ${samples.length} previews to ${dir}`);
