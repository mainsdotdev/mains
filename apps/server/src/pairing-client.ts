export interface RemotePairingCode {
  code: string;
  link: string;
  expiresAt: string;
}

export interface RequestPairingCodeOptions {
  controlUrl: string;
  token: string;
  endpoints: readonly string[];
  fetchImpl?: typeof fetch;
}

export interface RemotePairedDevice {
  id: string;
  name: string;
  platform: "ios" | "android" | "web" | "unknown";
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface AdminClientOptions {
  controlUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

function adminUrl(controlUrl: string, pathname: string): URL {
  return new URL(pathname, `${controlUrl.replace(/\/$/, "")}/`);
}

async function adminFetch(
  options: AdminClientOptions,
  pathname: string,
  init: RequestInit = {},
): Promise<{ response: Response; payload: unknown }> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${options.token}`);
  const response = await (options.fetchImpl ?? fetch)(
    adminUrl(options.controlUrl, pathname),
    {
      ...init,
      headers,
      signal: AbortSignal.timeout(8_000),
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Server administration request failed (${response.status})`;
    if (response.status === 401) {
      throw new Error(
        `${message}. The running server uses a different token; pass --token or restart it with the stored token.`,
      );
    }
    throw new Error(message);
  }
  return { response, payload };
}

function isRemotePairingCode(value: unknown): value is RemotePairingCode {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.code === "string" &&
    typeof result.link === "string" &&
    typeof result.expiresAt === "string"
  );
}

export async function requestPairingCode(
  options: RequestPairingCodeOptions,
): Promise<RemotePairingCode> {
  const { payload } = await adminFetch(
    options,
    "/__mains/admin/pairing-code",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ endpoints: options.endpoints }),
    },
  );
  if (!isRemotePairingCode(payload)) {
    throw new Error("The running server returned an invalid pairing code");
  }
  return payload;
}

function isRemotePairedDevice(value: unknown): value is RemotePairedDevice {
  if (!value || typeof value !== "object") return false;
  const device = value as Record<string, unknown>;
  return (
    typeof device.id === "string" &&
    typeof device.name === "string" &&
    typeof device.platform === "string" &&
    (typeof device.appVersion === "string" || device.appVersion === null) &&
    typeof device.createdAt === "string" &&
    (typeof device.lastSeenAt === "string" || device.lastSeenAt === null)
  );
}

export async function listPairedDevices(
  options: AdminClientOptions,
): Promise<RemotePairedDevice[]> {
  const { payload } = await adminFetch(
    options,
    "/__mains/admin/devices",
  );
  if (!Array.isArray(payload) || !payload.every(isRemotePairedDevice)) {
    throw new Error("The running server returned an invalid device list");
  }
  return payload;
}

export async function revokePairedDevice(
  options: AdminClientOptions,
  deviceId: string,
): Promise<void> {
  await adminFetch(
    options,
    `/__mains/admin/devices/${encodeURIComponent(deviceId)}`,
    { method: "DELETE" },
  );
}
