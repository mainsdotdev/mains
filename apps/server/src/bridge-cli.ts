import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import WebSocket from "ws";
import { CHANNELS } from "@mains/contracts/channels";
import { buildSubprotocols, decodeWsMessage, encodeWsMessage } from "@mains/contracts/ws-protocol";
import { normalizeBridgeVerificationCode, type BridgeAuthStatus } from "@mains/contracts/bridge-auth";
import type { AdminClientOptions } from "./pairing-client";

export function parseBridgeArguments(argv: string[]) {
  const [action = "status", ...rest] = argv;
  const adminArgs: string[] = [], positional: string[] = [];
  let hubUrl: string | undefined, label: string | undefined, code: string | undefined;
  let includeExisting = true, removeSynced = false, replace = false, localOnly: boolean | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (["--hub", "--label", "--code", "--data-dir", "--server-url", "--token"].includes(arg)) {
      const next = rest[++i];
      if (!next || next.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--hub") hubUrl = next;
      else if (arg === "--label") label = next;
      else if (arg === "--code") code = next;
      else adminArgs.push(arg, next);
    } else if (arg === "--local-history") includeExisting = false;
    else if (arg === "--remove-synced") removeSynced = true;
    else if (arg === "--replace") replace = true;
    else if (arg === "--on" || arg === "--off") {
      if (localOnly !== undefined) throw new Error("Choose --on or --off once");
      localOnly = arg === "--on";
    }
    else if (arg.startsWith("--")) throw new Error(`Unknown Bridge option: ${arg}`);
    else positional.push(arg);
  }
  if (!["status", "login", "logout", "approve", "confirm", "reject", "revoke", "recover", "recovery", "projects", "local-only", "sync-history", "sync"].includes(action)) throw new Error("Unknown Bridge action");
  if (action === "login" && !hubUrl) throw new Error("Pass --hub <Bridge URL> to sign in");
  if (["approve", "reject", "revoke"].includes(action) && positional.length !== 1) throw new Error(`Pass the backend id to bridge ${action}`);
  if (action === "approve" || action === "confirm") {
    if (!code) throw new Error("Compare the devices and pass --code <12-character code>");
    code = normalizeBridgeVerificationCode(code);
  }
  if (action === "recovery" && !replace) throw new Error("Use bridge recovery --replace to replace the recovery code");
  if (action === "local-only" && (positional.length !== 1 || localOnly === undefined)) throw new Error("Use bridge local-only <project-id> --on|--off");
  if (localOnly !== undefined && action !== "local-only") throw new Error("--on and --off require local-only");
  if (positional.length && !["approve", "reject", "revoke", "local-only"].includes(action)) throw new Error("Unexpected argument. Recovery codes are read from stdin, never command-line arguments.");
  return { action, adminArgs, positional, hubUrl, label, code, includeExisting, removeSynced, localOnly };
}

async function connect(admin: AdminClientOptions) {
  const url = new URL(admin.controlUrl); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url, buildSubprotocols(admin.token), { handshakeTimeout: 10_000 });
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let nextId = 0;
  socket.on("message", (data) => {
    const message = decodeWsMessage(data.toString());
    if (message.kind !== "response") return;
    const pending = waiting.get(message.id); if (!pending) return;
    waiting.delete(message.id); clearTimeout(pending.timer);
    if (message.result.success) pending.resolve(message.result.data); else pending.reject(new Error(message.result.error));
  });
  socket.on("close", () => { for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error("Backend connection closed")); } waiting.clear(); });
  return {
    call<T>(channel: string, ...args: unknown[]): Promise<T> {
      return new Promise((resolve, reject) => {
        const id = ++nextId, timer = setTimeout(() => { waiting.delete(id); reject(new Error("Backend request timed out")); }, 45_000);
        waiting.set(id, { resolve: (result) => resolve(result as T), reject, timer });
        socket.send(encodeWsMessage({ kind: "invoke", id, channel, args, commandId: randomUUID() }));
      });
    },
    close() { socket.close(); },
  };
}
async function readRecoveryCode(): Promise<string> {
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const input = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
  try { const answer = input.question("Recovery code: "); muted = true; return (await answer).trim(); }
  finally { muted = false; input.close(); if (process.stdin.isTTY) process.stdout.write("\n"); }
}
export async function runBridgeCommand(options: ReturnType<typeof parseBridgeArguments>, admin: AdminClientOptions): Promise<void> {
  const client = await connect(admin);
  try {
    if (options.action === "status") {
      const status = await client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth), sync = await client.call(CHANNELS.bridge.getStatus);
      console.log(JSON.stringify({ ...status, sync }, null, 2)); return;
    }
    if (options.action === "projects") { console.log(JSON.stringify(await client.call(CHANNELS.bridge.getProjectScopes), null, 2)); return; }
    if (options.action === "local-only") { await client.call(CHANNELS.bridge.setProjectLocalOnly, options.positional[0], options.localOnly); console.log(options.localOnly ? "Project is Local only." : "Project sync resumed."); return; }
    if (options.action === "sync-history") { await client.call(CHANNELS.bridge.includeLocalHistory); console.log("Existing local history queued for sync."); return; }
    if (options.action === "sync") { await client.call(CHANNELS.bridge.syncNow); console.log("Sync complete."); return; }
    if (options.action === "confirm") {
      await client.call(CHANNELS.bridge.confirmAccountKey, options.code);
      console.log("Account key verified. Sync is enabled."); return;
    }
    if (options.action === "logout") { await client.call(CHANNELS.bridge.signOut, options.removeSynced); console.log("Signed out of Bridge. Stored keys and replicas removed."); return; }
    if (options.action === "recover") { const code = await readRecoveryCode(); await client.call(CHANNELS.bridge.enterRecoveryCode, code); console.log("Recovery complete. Sync is enabled."); return; }
    if (options.action === "recovery") { const code = await client.call(CHANNELS.bridge.regenerateRecoveryCode); console.log("Save this recovery code now. The previous code no longer works:"); console.log(code); return; }
    if (options.action === "revoke") { await client.call(CHANNELS.bridge.revokeBackend, options.positional[0]); console.log("Backend access revoked."); return; }
    if (options.action === "approve" || options.action === "reject") {
      const status = await client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth);
      const request = status.approvals.find((entry) => entry.backendId === options.positional[0]);
      if (!request) throw new Error("No pending approval exists for that backend");
      if (options.action === "approve") await client.call(CHANNELS.bridge.approveBackend, { ...request, code: options.code });
      else await client.call(CHANNELS.bridge.rejectBackend, request.requestId);
      console.log(options.action === "approve"
        ? `Backend approved. Trusted account fingerprint: ${status.accountFingerprint}. On the new device, enter it with mains bridge confirm --code <fingerprint-from-approved-device> before syncing.`
        : "Request declined."); return;
    }
    await client.call(CHANNELS.bridge.signIn, { hubUrl: options.hubUrl, label: options.label, includeExisting: options.includeExisting, flow: "device" });
    let status = await client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus);
    console.log(`Open ${status.login?.url}\nSign-in code: ${status.login?.code}`);
    while (status.state === "signing-in") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = await client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus);
    }
    if (status.state === "ready") {
      console.log("Signed in. Sync is enabled.");
      const recovery = await client.call<string | null>(CHANNELS.bridge.takeRecoveryCode);
      if (recovery) console.log(`Save this recovery code now; it is shown once:\n${recovery}`);
    } else if (status.state === "needs-approval") console.log(`Compare code ${status.verificationCode} on an approved backend, then approve ${status.backendId}.\nAfter approval, get the account fingerprint on an approved device and run mains bridge confirm --code <fingerprint-from-approved-device>.\nOr run mains bridge recover and enter your recovery code.`);
    else if (status.state === "needs-verification") console.log("Sync is paused. Get the account fingerprint from Settings > Bridge or mains bridge status on an approved device, then run mains bridge confirm --code <fingerprint-from-approved-device>.");
    else throw new Error(status.error ?? "Bridge sign-in failed");
  } finally { client.close(); }
}
