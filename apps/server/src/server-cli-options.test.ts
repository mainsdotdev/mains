import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultDesktopDatabasePath,
  defaultServerDataDir,
  findPackageRoot,
  parsePairCliOptions,
  parseServerCliOptions,
} from "./server-cli-options";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("parseServerCliOptions", () => {
  it("uses the existing desktop data directory by default", () => {
    expect(path.join(defaultServerDataDir(), "mains.db")).toBe(
      defaultDesktopDatabasePath(),
    );
    expect(parseServerCliOptions([]).dataDir).toBe(defaultServerDataDir());
  });

  it("parses standalone server and token rotation options", () => {
    expect(
      parseServerCliOptions([
        "--host=0.0.0.0",
        "--port",
        "9000",
        "--token=secret",
        "--data-dir",
        "/tmp/mains-data",
        "--web-root=/tmp/mains-web",
        "--rotate-token",
        "--tailscale-serve",
        "--tailscale-serve-port=8443",
      ]),
    ).toEqual({
      host: "0.0.0.0",
      port: 9000,
      token: "secret",
      dataDir: "/tmp/mains-data",
      webRoot: "/tmp/mains-web",
      rotateToken: true,
      tailscaleServe: true,
      tailscaleServePort: 8443,
      publicUrls: [],
      printPairing: true,
    });
  });

  it("collects advertised URLs and can suppress startup pairing", () => {
    expect(
      parseServerCliOptions([
        "--public-url=https://one.example",
        "--public-url",
        "https://two.example",
        "--no-pairing",
      ]),
    ).toMatchObject({
      publicUrls: ["https://one.example", "https://two.example"],
      printPairing: false,
    });
  });

  it("rejects invalid ports", () => {
    expect(() => parseServerCliOptions(["--port", "65536"])).toThrow(
      "--port must be an integer between 0 and 65535",
    );
  });

  it("supports a safe explicit LAN shorthand", () => {
    expect(parseServerCliOptions(["--lan"]).host).toBe("0.0.0.0");
    expect(() =>
      parseServerCliOptions(["--lan", "--host", "192.168.1.4"]),
    ).toThrow("cannot be combined");
  });
});

describe("parsePairCliOptions", () => {
  it("parses the running server and repeatable reachable endpoints", () => {
    expect(
      parsePairCliOptions([
        "--server-url=http://127.0.0.1:9000",
        "--token",
        "secret",
        "--endpoint=http://192.168.1.5:9000",
        "--endpoint",
        "https://mains.example.com",
        "--data-dir=/tmp/mains",
        "--no-qr",
      ]),
    ).toEqual({
      controlUrl: "http://127.0.0.1:9000",
      token: "secret",
      endpoints: [
        "http://192.168.1.5:9000",
        "https://mains.example.com",
      ],
      dataDir: "/tmp/mains",
      printQr: false,
    });
  });
});

describe("findPackageRoot", () => {
  it("finds the nearest package from source or packaged layouts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mains-package-test-"));
    temporaryDirectories.push(root);
    const nested = path.join(root, "server", "nested");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"test"}\n');

    expect(findPackageRoot(nested)).toBe(root);
  });
});
