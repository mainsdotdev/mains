import { describe, expect, it } from "vitest";
import type { CliOptions } from "./server-cli-options";
import {
  renderLaunchAgent,
  renderSystemdUserUnit,
  serviceServerArgs,
} from "./service-manager";

function options(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    host: "127.0.0.1",
    port: 8787,
    dataDir: "/Users/test/Library/Application Support/Mains Server",
    rotateToken: false,
    tailscaleServe: false,
    publicUrls: [],
    printPairing: true,
    ...overrides,
  };
}

const definition = {
  nodePath: "/opt/node/bin/node",
  scriptPath: "/opt/mains/bin/mains-server.cjs",
  homeDir: "/Users/test",
  pathEnv: "/opt/homebrew/bin:/usr/bin:/bin",
};

describe("background service definitions", () => {
  it("builds stable serve arguments without embedding a token", () => {
    const args = serviceServerArgs(
      options({
        host: "0.0.0.0",
        tailscaleServe: true,
        tailscaleServePort: 8443,
        publicUrls: ["https://mains.example.com"],
      }),
    );
    expect(args).toEqual([
      "serve",
      "--host",
      "0.0.0.0",
      "--port",
      "8787",
      "--data-dir",
      "/Users/test/Library/Application Support/Mains Server",
      "--no-pairing",
      "--public-url",
      "https://mains.example.com",
      "--tailscale-serve",
      "--tailscale-serve-port",
      "8443",
    ]);
    expect(args.join(" ")).not.toContain("token");
  });

  it("renders a launchd user agent with restart and owner-only defaults", () => {
    const plist = renderLaunchAgent({ ...definition, server: options() });
    expect(plist).toContain("dev.mains.server");
    expect(plist).toContain("<key>SuccessfulExit</key>");
    expect(plist).toContain("<integer>63</integer>");
    expect(plist).toContain("server.stdout.log");
  });

  it("renders a systemd user service", () => {
    const unit = renderSystemdUserUnit({ ...definition, server: options() });
    expect(unit).toContain("ExecStart=\"/opt/node/bin/node\"");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("UMask=0077");
    expect(unit).toContain("WantedBy=default.target");
  });
});
