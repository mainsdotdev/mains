import qrcode from "qrcode-terminal";
import type { RemotePairingCode } from "./pairing-client";

export function renderTerminalQr(value: string): string {
  let rendered = "";
  qrcode.generate(value, { small: true }, (output) => {
    rendered = output;
  });
  if (!rendered) throw new Error("Could not render the pairing QR code");
  return rendered;
}

export function printPairingCode(
  pairing: Pick<RemotePairingCode, "link" | "expiresAt">,
  options: { qr?: boolean; write?: (line: string) => void } = {},
): void {
  const write = options.write ?? console.log;
  write("");
  write("Pair this phone with Mains:");
  if (options.qr !== false) write(renderTerminalQr(pairing.link));
  write(pairing.link);
  write(`Expires: ${new Date(pairing.expiresAt).toLocaleString()}`);
  write("Treat this one-time link like a password until it expires.");
  write("");
}
