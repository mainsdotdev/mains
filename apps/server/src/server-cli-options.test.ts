import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultDesktopDatabasePath,
  defaultServerDataDir,
  findPackageRoot,
  parsePairCliOptions,
  parseServerCliOptions,
} from "./server-cli-options";

const temporaryDirectories: string[] = [];
const ownerToken = "a".repeat(32);

afterEach(() => {
  vi.unstubAllEnvs();
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
        `--token=${ownerToken}`,
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
      token: ownerToken,
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

  it.each([
    ["--token", ["--token", "--lan"]],
    ["--port", ["--port", "--tailscale-serve"]],
    ["--public-url", ["--public-url", "--no-pairing"]],
  ])("rejects %s when its value is another option", (name, argv) => {
    expect(() => parseServerCliOptions(argv)).toThrow(
      `${name} requires a value`,
    );
  });

  it("rejects empty, unknown, positional, and duplicate options", () => {
    expect(() => parseServerCliOptions(["--token="])).toThrow(
      "--token requires a value",
    );
    expect(() => parseServerCliOptions(["--wat"])).toThrow(
      "Unknown option: --wat",
    );
    expect(() => parseServerCliOptions(["unexpected"])).toThrow(
      "Unexpected argument: unexpected",
    );
    expect(() =>
      parseServerCliOptions(["--port", "8787", "--port=9000"]),
    ).toThrow("--port may only be specified once");
    expect(() => parseServerCliOptions(["--lan", "--lan"])).toThrow(
      "--lan may only be specified once",
    );
  });

  it("requires explicit owner tokens to be long and URL-safe", () => {
    expect(() => parseServerCliOptions(["--token=short"])).toThrow(
      "--token must be at least 32 URL-safe characters",
    );
    expect(() => parseServerCliOptions([`--token=${"a".repeat(31)}!`])).toThrow(
      "--token must contain only URL-safe characters",
    );

    vi.stubEnv("MAINS_SERVE_TOKEN", "short");
    expect(() => parseServerCliOptions([])).toThrow(
      "MAINS_SERVE_TOKEN must be at least 32 URL-safe characters",
    );
  });
});

describe("parsePairCliOptions", () => {
  it("parses the running server and repeatable reachable endpoints", () => {
    expect(
      parsePairCliOptions([
        "--server-url=http://127.0.0.1:9000",
        "--token",
        ownerToken,
        "--endpoint=http://192.168.1.5:9000",
        "--endpoint",
        "https://mains.example.com",
        "--data-dir=/tmp/mains",
        "--no-qr",
      ]),
    ).toEqual({
      controlUrl: "http://127.0.0.1:9000",
      token: ownerToken,
      endpoints: [
        "http://192.168.1.5:9000",
        "https://mains.example.com",
      ],
      dataDir: "/tmp/mains",
      printQr: false,
    });
  });

  it("rejects missing values and unsupported options", () => {
    expect(() => parsePairCliOptions(["--token", "--no-qr"])).toThrow(
      "--token requires a value",
    );
    expect(() => parsePairCliOptions(["--endpoint="])).toThrow(
      "--endpoint requires a value",
    );
    expect(() => parsePairCliOptions(["--lan"])).toThrow(
      "Unknown option: --lan",
    );
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
