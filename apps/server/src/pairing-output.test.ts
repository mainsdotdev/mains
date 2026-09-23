import { describe, expect, it } from "vitest";
import { printPairingCode, renderTerminalQr } from "./pairing-output";

describe("pairing terminal output", () => {
  it("renders a compact QR and the copyable deep link", () => {
    const link =
      "mains://pair#code=secret&name=Mac&endpoint=http%3A%2F%2F192.168.1.5%3A8787";
    expect(renderTerminalQr(link)).toMatch(/[█▀▄]/);

    const lines: string[] = [];
    printPairingCode(
      { link, expiresAt: "2026-09-21T10:05:00.000Z" },
      { qr: false, write: (line) => lines.push(line) },
    );
    expect(lines).toContain(link);
    expect(lines.join("\n")).toContain("one-time link");
  });
});
