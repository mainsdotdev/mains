// Node 24+, Docker Engine and Compose. Uses disposable keys, ports and volumes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const relayDir = path.resolve(import.meta.dirname, "..");
setDefaultResultOrder("ipv4first");

function event(socket, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`WebSocket ${name} timed out`)), 10_000);
    const success = (value) => finish(null, value);
    const failure = () => finish(new Error(`WebSocket closed or failed before ${name}`));
    function finish(error, value) {
      clearTimeout(timer);
      socket.removeEventListener(name, success);
      socket.removeEventListener("error", failure);
      socket.removeEventListener("close", failure);
      if (error) reject(error);
      else resolve(value);
    }
    socket.addEventListener(name, success);
    socket.addEventListener("error", failure);
    socket.addEventListener("close", failure);
  });
}

async function probe(origin, secretFile) {
  let health;
  const deadline = Date.now() + 10_000;
  while (!health) {
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1_000) });
      assert.equal(response.status, 200);
      health = response;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(200);
    }
  }
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, protocol: 1 });
  const denied = await fetch(`${origin}/v1/device`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(denied.status, 401);

  const secret = readFileSync(secretFile, "utf8").trim();
  function ticket(role) {
    const body = Buffer.from(JSON.stringify({ v: 1, role, backendId: "deploy-smoke",
      ...(role === "device" ? { deviceId: "deploy-phone" } : {}),
      exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
    return `${body}.${createHmac("sha256", secret).update(`mains.relay.ticket.v1.${body}`).digest("base64url")}`;
  }
  const backend = new WebSocket(`${origin.replace("https:", "wss:")}/v1/backend`, ["mains-relay.v1", `ticket.${ticket("backend")}`]);
  let phone;
  try {
    await event(backend, "open");
    assert.equal(backend.protocol, "mains-relay.v1");
    const opened = event(backend, "message");
    phone = new WebSocket(`${origin.replace("https:", "wss:")}/v1/device`, ["mains-relay.v1", `ticket.${ticket("device")}`]);
    await event(phone, "open");
    assert.equal(phone.protocol, "mains-relay.v1");
    const opening = JSON.parse((await opened).data);
    assert.equal(opening.type, "open");
    assert.equal(opening.deviceId, "deploy-phone");
    assert.equal(typeof opening.id, "string");

    const payload = randomBytes(48).toString("base64url");
    const upstream = event(backend, "message");
    phone.send(payload);
    assert.deepEqual(JSON.parse((await upstream).data), { type: "data", id: opening.id, payload });
    const downstream = event(phone, "message");
    backend.send(JSON.stringify({ type: "data", id: opening.id, payload }));
    assert.equal((await downstream).data, payload);
    console.log("HTTPS health, routing authentication and bidirectional WSS forwarding passed.");
  } finally {
    phone?.close();
    backend.close();
  }
}

async function dockerSmoke() {
  const engine = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 });
  if (engine.error || engine.status !== 0) {
    throw new Error("Start Docker Engine and install Docker Compose before running this smoke check.");
  }
  const temporary = mkdtempSync(path.join(tmpdir(), "mains-relay-deploy-"));
  const project = `mains-relay-smoke-${process.pid}-${Date.now()}`;
  const secretFile = path.join(temporary, "routing.secret");
  const envFile = path.join(temporary, ".env");
  const rootCertificate = path.join(temporary, "root.crt");
  writeFileSync(secretFile, randomBytes(32).toString("hex"), { mode: 0o444 });
  chmodSync(secretFile, 0o444);
  writeFileSync(envFile, "", { mode: 0o600 });
  const env = { ...process.env, RELAY_DOMAIN: "localhost", RELAY_BIND_ADDRESS: "127.0.0.1",
    RELAY_HTTP_PORT: "0", RELAY_HTTPS_PORT: "0", RELAY_SECRET_FILE: secretFile, RELAY_IMAGE: project };
  const composeArgs = ["compose", "--env-file", envFile, "-p", project, "-f", path.join(relayDir, "compose.yaml")];
  function docker(args, capture = false) {
    const result = spawnSync("docker", args, { cwd: relayDir, env, encoding: "utf8", stdio: capture ? "pipe" : "inherit", timeout: 300_000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `docker ${args.join(" ")} failed${capture ? `: ${result.stderr}` : ""}`);
    return result.stdout?.trim();
  }
  const compose = (args, capture = false) => docker([...composeArgs, ...args], capture);
  function child(args) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: rootCertificate }, stdio: "inherit", timeout: 30_000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "TLS/WebSocket probe failed");
  }
  try {
    compose(["config", "--quiet"]);
    compose(["up", "-d", "--build", "--wait", "--wait-timeout", "120"]);
    assert.equal(compose(["exec", "-T", "relay", "id", "-u"], true), "65532");
    const container = compose(["ps", "-q", "relay"], true);
    assert.equal(docker(["inspect", "--format", "{{.HostConfig.ReadonlyRootfs}}", container], true), "true");
    const address = compose(["port", "caddy", "443"], true);
    const port = address.slice(address.lastIndexOf(":") + 1);
    assert.match(port, /^\d+$/);
    const origin = `https://localhost:${port}`;
    // Caddy's localhost CA is trusted only by the child probe, never the host OS.
    compose(["exec", "-T", "caddy", "sh", "-c",
      "for attempt in 1 2 3 4 5 6 7 8 9 10; do test -r /data/caddy/pki/authorities/local/root.crt && exit 0; sleep 1; done; exit 1"]);
    compose(["cp", "caddy:/data/caddy/pki/authorities/local/root.crt", rootCertificate]);
    child(["--probe", origin, secretFile]);

    // Force a proxy error and ensure its diagnostic logs cannot expose headers.
    compose(["stop", "relay"]);
    const marker = `ticket.smoke-redaction-${randomBytes(16).toString("hex")}`;
    child(["--probe-unavailable", origin, marker]);
    const logs = compose(["logs", "--no-color", "caddy"], true);
    assert.ok(logs.includes("502"), "Expected a proxy error to exercise log redaction");
    assert.ok(!logs.includes(marker), "A routing header leaked into proxy logs");
    console.log("Non-root/read-only container and proxy error-log redaction passed.");
  } finally {
    // Only this randomly named project and its disposable certificates are removed.
    const result = spawnSync("docker", [...composeArgs, "down", "--volumes", "--remove-orphans"],
      { cwd: relayDir, env, stdio: "inherit", timeout: 60_000 });
    const built = spawnSync("docker", ["image", "inspect", project], { stdio: "ignore" });
    let removed;
    if (built.status === 0) {
      removed = spawnSync("docker", ["image", "rm", project], { stdio: "inherit", timeout: 30_000 });
    }
    rmSync(temporary, { recursive: true, force: true });
    if (result.error || result.status !== 0) throw new Error(`Cleanup failed for ${project}`);
    if (removed?.error || (removed && removed.status !== 0)) throw new Error(`Could not remove the disposable image ${project}`);
  }
}

if (process.argv[2] === "--probe") {
  await probe(process.argv[3], process.argv[4]);
} else if (process.argv[2] === "--probe-unavailable") {
  const response = await fetch(`${process.argv[3]}/v1/backend`, {
    headers: { "Sec-WebSocket-Protocol": `mains-relay.v1, ${process.argv[4]}` }, signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 502);
} else {
  await dockerSmoke();
}
