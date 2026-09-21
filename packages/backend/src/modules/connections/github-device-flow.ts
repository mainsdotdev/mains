// ─────────────────────────────────────────────────────────────
// GitHub OAuth Device Flow (RFC 8628)
//
// Lives in the main process because github.com's OAuth endpoints
// send no CORS headers — the renderer cannot call them directly.
// Device flow is built for public clients: only the client id ships
// with the app, there is no client secret. The renderer drives the
// start/poll loop; on success it receives a plain access token and
// saves it through the same `connections:saveCredentials` path the
// paste-a-token flow uses.
// ─────────────────────────────────────────────────────────────

// Register at github.com → Settings → Developer settings → OAuth Apps and
// enable "Device Flow". Unlike every other MAINS_* env var in the main
// process, this one is read at *build* time: vite.main.config.mjs replaces it
// with the value present in the build environment (`.env.local` locally, the
// MAINS_GITHUB_CLIENT_ID repo secret in the release workflow), because a
// released app has no build environment left to read. Empty at build time →
// requireClientId throws and the paste-a-token tab carries the flow.
const GITHUB_DEVICE_CLIENT_ID = process.env.MAINS_GITHUB_CLIENT_ID ?? "";

/** Same scopes the PAT instructions ask for. */
const GITHUB_DEVICE_SCOPE = "repo read:user";

export interface GitHubDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds until the user code expires. */
  expiresIn: number;
  /** Minimum seconds between polls. */
  interval: number;
}

export type GitHubDevicePollResult =
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "success"; token: string };

function requireClientId(): string {
  if (!GITHUB_DEVICE_CLIENT_ID) {
    throw new Error(
      "GitHub sign-in is not configured in this build. Use a personal access token instead.",
    );
  }
  return GITHUB_DEVICE_CLIENT_ID;
}

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!response.ok) {
    throw new Error(`GitHub responded with ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

export async function startGitHubDeviceFlow(): Promise<GitHubDeviceAuthorization> {
  const clientId = requireClientId();
  const data = await postForm("https://github.com/login/device/code", {
    client_id: clientId,
    scope: GITHUB_DEVICE_SCOPE,
  });

  if (
    typeof data.device_code !== "string" ||
    typeof data.user_code !== "string" ||
    typeof data.verification_uri !== "string"
  ) {
    throw new Error("GitHub returned an unexpected device authorization response");
  }

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 900,
    interval: typeof data.interval === "number" ? data.interval : 5,
  };
}

export async function pollGitHubDeviceFlow(
  deviceCode: string,
): Promise<GitHubDevicePollResult> {
  if (typeof deviceCode !== "string" || !deviceCode) {
    throw new Error("Device code is required");
  }
  const clientId = requireClientId();
  const data = await postForm("https://github.com/login/oauth/access_token", {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });

  if (typeof data.access_token === "string" && data.access_token) {
    return { status: "success", token: data.access_token };
  }

  switch (data.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return {
        status: "slow_down",
        interval: typeof data.interval === "number" ? data.interval : 10,
      };
    case "expired_token":
      return { status: "expired" };
    case "access_denied":
      return { status: "denied" };
    default:
      throw new Error(
        typeof data.error_description === "string"
          ? data.error_description
          : "GitHub sign-in failed",
      );
  }
}
