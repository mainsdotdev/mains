import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { app } from "electron";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import { WS_PROTOCOL_VERSION } from "../../../shared/ipc-kit/ws-protocol";
import { registeredChannels } from "../../ipc-kit";
import { generateToken, hashToken, tokensMatch } from "../../ipc-kit/ws-auth";
import { appSettingsService } from "../appSettings";
import { backendRepo } from "./backend.repo";
import { parsePairDeviceInput } from "./backend.validation";
import type {
  BackendDescriptor,
  PairDeviceResult,
  PairedDevice,
  PairedDeviceAccess,
  PairedDeviceRecord,
  PairingCode,
} from "./backend.dto";

/**
 * What a paired device may invoke. Read-only for now: every mutation waits for
 * the commandId/receipt contract (mobile plan, phase 4) so a command retried
 * after a dropped connection can't run twice. Terminal, filesystem, git and
 * settings stay off this list for good — a phone in the wrong hands must not
 * become a shell on the Mac. Enforced by the WS router before any handler runs.
 */
export const PAIRED_DEVICE_CHANNELS: ReadonlySet<string> = new Set([
  CHANNELS.backend.describe,
  CHANNELS.account.get,
  CHANNELS.runs.getAll,
  CHANNELS.runs.listActive,
  CHANNELS.runs.listRecent,
  CHANNELS.runs.listArchived,
  CHANNELS.runs.getById,
  CHANNELS.runs.getDetails,
  CHANNELS.runs.getByWorkspace,
  CHANNELS.runs.listPendingApprovals,
  CHANNELS.runTurns.getByRun,
  CHANNELS.runToolCalls.getByRun,
  CHANNELS.runArtifacts.getByRun,
  // The pixels behind an image artifact, scaled down on the way — the one
  // thing a transcript needs that its rows don't carry.
  CHANNELS.runArtifacts.readImage,
  CHANNELS.runContext.getByRun,
  CHANNELS.workspace.list,
  CHANNELS.workspace.get,
  // The Code sidebar's workspace rows: current branch and the last diff's size.
  CHANNELS.workspace.listGitStates,
  CHANNELS.workspace.getLatestDiffSummary,
  CHANNELS.projects.list,
  CHANNELS.projects.get,
  CHANNELS.collections.list,
  // Starting a run needs a target: spaces carry provider + mode, providers
  // say which of them are enabled.
  CHANNELS.space.getAll,
  CHANNELS.providers.getEnabled,
  // The composer's model picker: what each provider can run, with the effort
  // levels each model supports.
  CHANNELS.providers.getModels,
  // The composer's context picker: the skills and slash commands a provider
  // offers, so a phone can attach one the way the desktop's "@" menu does.
  // Read-only listings — installing or editing a skill stays off this list.
  CHANNELS.providers.getSkills,
  CHANNELS.providers.getCommands,
]);

/**
 * Mutations a paired device may issue — only with a `commandId`, which the WS
 * router turns into exactly-once semantics through `command_receipts`. The
 * control loop's four verbs — answer a request, continue a run, start one,
 * branch one — plus the two picker writes the composer needs. Anything
 * touching files, git, terminal or settings stays out.
 */
export const PAIRED_DEVICE_COMMANDS: ReadonlySet<string> = new Set([
  CHANNELS.runs.toolApprovalResponse,
  CHANNELS.runs.continue,
  CHANNELS.runs.execute,
  // Branching a run reaches no further than continuing one: the fork inherits
  // the source's workspace, mode and policy snapshot wholesale, so a device
  // can't widen its own reach by forking.
  CHANNELS.runs.fork,
  // Stopping a run you can already start and continue takes nothing further —
  // it only ends work the device itself asked for.
  CHANNELS.runs.abort,
  // The desktop's mode picker is a space update; the phone's works the same way.
  CHANNELS.space.update,
  // The composer toolbar's settings (effort, permission mode, fast / goal /
  // plan) as one narrow patch: `providers:update` replaces the whole config,
  // credentials included, and stays desktop-only.
  CHANNELS.providers.updateRunSettings,
]);

/**
 * Pushes a paired device receives. Everything else emitted on the bus —
 * terminal output, settings, window chrome — stays between the desktop's own
 * processes: the WebSocket sink drops events off this list for device
 * connections. Exactly the channels the phone subscribes to.
 */
export const PAIRED_DEVICE_EVENTS: ReadonlySet<string> = new Set([
  CHANNELS.runs.statusChanged,
  CHANNELS.runs.updated,
  CHANNELS.runs.ephemeralEvent,
  CHANNELS.runs.eventPersisted,
  CHANNELS.runs.toolApprovalRequest,
  CHANNELS.runs.toolApprovalResolved,
  CHANNELS.runs.diffUpdated,
  CHANNELS.providers.modelsUpdated,
  CHANNELS.workspace.gitStateChanged,
]);

/** Receipts older than this are forgotten; a device never retries that late. */
const COMMAND_RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * This install as a backend: who it is, and who may talk to it.
 *
 * **Identity** — `backendId`, minted once and persisted for good, plus the
 * descriptor a remote client reads first (`backend:describe`).
 *
 * **Trust** — pairing, with two credentials deliberately different in lifetime:
 *  - a **pairing code** — minted by the desktop, shown as a QR, valid for five
 *    minutes and for exactly one exchange. Lives only in memory: a restart
 *    during the window just means showing a new QR.
 *  - a **device token** — what the code is exchanged for. Long-lived, stored on
 *    the device, stored here only as a hash, revocable per device from the
 *    desktop. Presented on every WS handshake in place of the shared pairing
 *    token (see ws-server-host `verifyDeviceToken`).
 *
 * The desktop reaches the pairing side through the localBackend module (which
 * owns the exposure pairing rides on); the WS host reaches it through the hooks
 * localBackend/serve inject. See docs/design/mobile-app.md (§5.3, §10.1).
 *
 * Throw-style: methods return plain values and throw on failure; the
 * ServiceResponse envelope is applied by handle() / the localBackend handlers
 * at the IPC seam.
 */

// ── Identity ──

/** Namespace part of a `"domain:action"` channel. */
function namespaceOf(channel: string): string {
  return channel.split(":")[0];
}

function machineName(): string {
  return hostname().replace(/\.local$/i, "");
}

// Two clients describing an un-minted backend at once must not each mint their
// own id (the last write would win and the other client would key its saved
// backend on an id that never persists). Share the in-flight mint instead.
let minting: Promise<string> | null = null;

// ── Pairing codes ──

const CODE_TTL_MS = 5 * 60 * 1000;

interface IssuedCode {
  hash: string;
  expiresAt: number;
}

// A handful of short-lived entries at most; scanned with constant-time compares.
let issued: IssuedCode[] = [];

function pruneExpired(now: number): void {
  issued = issued.filter((entry) => entry.expiresAt > now);
}

/** Test seam — forget every outstanding pairing code. */
export function clearPairingCodes(): void {
  issued = [];
}

/**
 * The link a QR encodes. The secret rides in the fragment so it never lands in
 * a request log should the link ever be opened as an https URL.
 */
export function buildPairingLink(params: {
  code: string;
  name: string;
  endpoints: string[];
}): string {
  const query = new URLSearchParams();
  query.set("code", params.code);
  query.set("name", params.name);
  for (const endpoint of params.endpoints) query.append("endpoint", endpoint);
  return `mains://pair#${query.toString()}`;
}

function toPairedDevice(record: PairedDeviceRecord): PairedDevice {
  return {
    id: record.id,
    name: record.name,
    platform: record.platform,
    appVersion: record.appVersion,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
  };
}

export const backendService = {
  // ── Identity ──

  /** This install's stable id — minted on first use, then persisted for good. */
  async getBackendId(): Promise<string> {
    const settings = await appSettingsService.getSettings();
    if (settings.backendId) return settings.backendId;
    if (!minting) {
      minting = (async () => {
        const backendId = randomUUID();
        await appSettingsService.setBackendId(backendId);
        return backendId;
      })().finally(() => {
        minting = null;
      });
    }
    return minting;
  },

  /**
   * A paired device sees only the namespaces it may actually reach, so the
   * phone can hide features (terminal, files) it would be refused anyway.
   */
  async describe(
    options: { pairedDevice?: boolean } = {},
  ): Promise<BackendDescriptor> {
    const backendId = await this.getBackendId();
    const served = registeredChannels();
    const reachable = options.pairedDevice
      ? served.filter(
          (channel) =>
            PAIRED_DEVICE_CHANNELS.has(channel) || PAIRED_DEVICE_COMMANDS.has(channel),
        )
      : served;
    const capabilities = [...new Set(reachable.map(namespaceOf))].sort();
    return {
      backendId,
      name: machineName(),
      appVersion: app.getVersion(),
      protocolVersion: WS_PROTOCOL_VERSION,
      capabilities,
      serverTime: new Date().toISOString(),
    };
  },

  // ── Pairing ──

  /**
   * Mint a one-time code. `endpoints` are the URLs a phone could reach this
   * backend on (http(s)://host:port), most private first.
   */
  async createPairingCode(endpoints: string[]): Promise<PairingCode> {
    if (endpoints.length === 0) {
      throw new Error(
        "No address a phone could reach — turn on network access or Tailscale HTTPS first",
      );
    }
    const now = Date.now();
    pruneExpired(now);
    const code = generateToken();
    const expiresAt = now + CODE_TTL_MS;
    issued.push({ hash: hashToken(code), expiresAt });
    const { name } = await this.describe();
    return {
      code,
      link: buildPairingLink({ code, name, endpoints }),
      expiresAt: new Date(expiresAt),
    };
  },

  /** Exchange a code for a device token. The code is spent whether or not the insert succeeds. */
  async pairDevice(input: unknown): Promise<PairDeviceResult> {
    const parsed = parsePairDeviceInput(input);
    pruneExpired(Date.now());
    const presented = hashToken(parsed.code);
    const index = issued.findIndex((entry) => tokensMatch(entry.hash, presented));
    if (index === -1) {
      throw new Error("Pairing code is invalid or has expired");
    }
    issued.splice(index, 1);

    const deviceToken = generateToken();
    const deviceId = randomUUID();
    await backendRepo.insertPairedDevice({
      id: deviceId,
      name: parsed.deviceName,
      platform: parsed.platform,
      appVersion: parsed.appVersion ?? null,
      tokenHash: hashToken(deviceToken),
    });
    return { deviceId, deviceToken, backend: await this.describe() };
  },

  /** Resolve a presented device token, recording the sighting. Null when unknown or revoked. */
  async verifyDeviceToken(token: string): Promise<PairedDeviceAccess | null> {
    const device = await backendRepo.findActivePairedDeviceByTokenHash(
      hashToken(token),
    );
    if (!device) return null;
    await backendRepo.touchPairedDeviceLastSeen(device.id);
    return {
      deviceId: device.id,
      channels: PAIRED_DEVICE_CHANNELS,
      commandChannels: PAIRED_DEVICE_COMMANDS,
      eventChannels: PAIRED_DEVICE_EVENTS,
    };
  },

  // ── Command receipts (the WS router's idempotency store) ──

  commandReceipts: {
    find(deviceId: string, commandId: string): Promise<string | null> {
      return backendRepo.findCommandReceipt(deviceId, commandId);
    },
    async record(
      deviceId: string,
      commandId: string,
      channel: string,
      result: string,
    ): Promise<void> {
      await backendRepo.insertCommandReceipt({ deviceId, commandId, channel, result });
      // Piggyback the sweep on writes: cheap (indexed) and needs no timer.
      await backendRepo.pruneCommandReceipts(new Date(Date.now() - COMMAND_RECEIPT_TTL_MS));
    },
  },

  async listPairedDevices(): Promise<PairedDevice[]> {
    const records = await backendRepo.listActivePairedDevices();
    return records.map(toPairedDevice);
  },

  async revokePairedDevice(id: string): Promise<void> {
    const revoked = await backendRepo.revokePairedDevice(id);
    if (!revoked) throw new Error("Paired device not found");
  },
};
