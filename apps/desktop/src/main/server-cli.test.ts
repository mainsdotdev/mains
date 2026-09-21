import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findPackageRoot,
  parseServerCliOptions,
} from "./server-cli-options";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("parseServerCliOptions", () => {
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
    });
  });

  it("rejects invalid ports", () => {
    expect(() => parseServerCliOptions(["--port", "65536"])).toThrow(
      "--port must be an integer between 0 and 65535",
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
