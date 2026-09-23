import { spawn } from "child_process";

/**
 * Tailscale HTTPS exposure for `mains serve`. Shells out to the `tailscale` CLI
 * to run `tailscale serve`, which proxies the tailnet's HTTPS endpoint
 * (`https://<magic-dns>.ts.net`, with an automatically-provisioned TLS cert) to
 * the backend's loopback port. Tailnet peers then reach the backend over
 * `wss://` without any port-forwarding or manual certificates — the backend
 * itself keeps listening only on 127.0.0.1.
 *
 * No DB tables — this just wraps the external CLI (cf. the guards/browser
 * modules). See docs/design/remote-backend.md.
 */

const TAILSCALE_BIN =
  process.platform === "win32" ? "tailscale.exe" : "tailscale";
const DEFAULT_HTTPS_PORT = 443;

export interface TailscaleStatus {
  /** MagicDNS name without the trailing dot, e.g. `machine.tailnet.ts.net`. */
  magicDnsName: string | null;
  tailnetIps: string[];
  online: boolean;
}

// Track an active serve so shutdown can tear it down (it otherwise persists in
// the tailscaled daemon across restarts).
let activeServe: { httpsPort: number } | null = null;

function runTailscale(
  args: string[],
  timeoutMs = 10000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(TAILSCALE_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      const detail = (stderr || stdout).trim();
      reject(
        new Error(
          `tailscale ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s${
            detail ? ` — ${detail}` : ""
          }`,
        ),
      );
    }, timeoutMs);
    // `tailscale serve` doesn't exit when a tailnet feature (Serve/HTTPS) isn't
    // enabled — it prints an "enable here" URL and blocks. Bail early with that
    // message instead of waiting out the timeout.
    const checkActionRequired = () => {
      if (settled) return;
      const combined = `${stdout}\n${stderr}`;
      if (
        /is not enabled on your tailnet|To enable, visit:|https:\/\/login\.tailscale\.com\/f\//i.test(
          combined,
        )
      ) {
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(new Error(combined.trim()));
      }
    };
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
      checkActionRequired();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      checkActionRequired();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // ENOENT here means the tailscale CLI isn't installed / on PATH.
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export const tailscaleService = {
  /** Parse `tailscale status --json` → MagicDNS name + tailnet IPs. */
  async readStatus(): Promise<TailscaleStatus> {
    const { code, stdout } = await runTailscale(["status", "--json"], 5000);
    if (code !== 0) throw new Error("`tailscale status` failed");
    let json: {
      Self?: { DNSName?: string; TailscaleIPs?: string[]; Online?: boolean };
    };
    try {
      json = JSON.parse(stdout);
    } catch {
      // Daemon mid-restart / banner on stdout → non-JSON. Surface a clean error
      // instead of a raw SyntaxError that callers can't interpret.
      throw new Error("`tailscale status` returned invalid JSON");
    }
    const dns = json.Self?.DNSName?.replace(/\.$/, "") ?? "";
    return {
      magicDnsName: dns || null,
      tailnetIps: json.Self?.TailscaleIPs ?? [],
      online: json.Self?.Online ?? false,
    };
  },

  /**
   * `tailscale serve --bg --https=<httpsPort> http://127.0.0.1:<localPort>` —
   * exposes the loopback backend over the tailnet's HTTPS endpoint. Throws if the
   * CLI is missing, not logged in, or HTTPS isn't enabled for the tailnet.
   */
  async startServe(
    localPort: number,
    httpsPort = DEFAULT_HTTPS_PORT,
  ): Promise<void> {
    // First run provisions a Let's Encrypt cert for the MagicDNS name, which can
    // take a while and may block `serve` until it's ready — give it room.
    const { code, stderr } = await runTailscale(
      ["serve", "--bg", `--https=${httpsPort}`, `http://127.0.0.1:${localPort}`],
      60000,
    );
    if (code !== 0) {
      throw new Error(`\`tailscale serve\` failed: ${stderr.trim() || code}`);
    }
    activeServe = { httpsPort };
  },

  /** `tailscale serve --https=<httpsPort> off` */
  async stopServe(httpsPort = DEFAULT_HTTPS_PORT): Promise<void> {
    await runTailscale(["serve", `--https=${httpsPort}`, "off"], 10000);
    if (activeServe?.httpsPort === httpsPort) activeServe = null;
  },

  /** Best-effort teardown on shutdown; no-ops if serve was never started here. */
  async stopServeIfActive(): Promise<void> {
    if (!activeServe) return;
    const { httpsPort } = activeServe;
    activeServe = null;
    try {
      await runTailscale(["serve", `--https=${httpsPort}`, "off"], 5000);
    } catch {
      /* best effort — shutting down anyway */
    }
  },

  /** Public HTTPS base URL from the MagicDNS name (port omitted when 443). */
  resolveHttpsUrl(
    magicDnsName: string,
    httpsPort = DEFAULT_HTTPS_PORT,
  ): string {
    return httpsPort === DEFAULT_HTTPS_PORT
      ? `https://${magicDnsName}`
      : `https://${magicDnsName}:${httpsPort}`;
  },
};
