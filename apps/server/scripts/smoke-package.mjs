#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const appRoot = path.resolve(import.meta.dirname, "..");
const archive = path.join(appRoot, "dist", "mains-server.tgz");
const token = "standalone-package-smoke-owner-token";
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "mains-package-smoke-"),
);
const installationRoot = path.join(temporaryRoot, "install");
const installedPackageRoot = path.join(
  installationRoot,
  "node_modules",
  "@mains",
  "server",
);
const executable = path.join(installedPackageRoot, "bin", "mains.cjs");
const npmBinRoot = path.join(installationRoot, "node_modules", ".bin");
const installedCommand = path.join(
  npmBinRoot,
  process.platform === "win32" ? "mains.cmd" : "mains",
);
let child;
let serverOutput = "";

function waitForReady(processHandle) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Server did not become ready:\n${serverOutput}`));
    }, 20_000);

    const onData = (chunk) => {
      const text = chunk.toString();
      serverOutput += text;
      process.stdout.write(text);
      const match = serverOutput.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    };
    processHandle.stdout.on("data", onData);
    processHandle.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      serverOutput += text;
      process.stderr.write(text);
    });
    processHandle.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Server exited before it was ready (${signal ?? `code ${code}`}):\n${serverOutput}`,
        ),
      );
    });
    processHandle.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function waitForFile(filePath) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function describeBackend(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, [
      "mains.v1",
      `mains.token.${token}`,
    ]);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("Timed out waiting for backend:describe"));
    }, 10_000);
    socket.once("open", () => {
      socket.send(
        JSON.stringify({
          kind: "invoke",
          id: 1,
          channel: "backend:describe",
          args: [],
        }),
      );
    });
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.kind !== "response" || message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(message.result);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function describeBackendWithSession(port, origin, cookie) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/__mains/ws`,
      ["mains.v1"],
      { headers: { Origin: origin, Cookie: cookie } },
    );
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("Timed out waiting for cookie-authenticated backend"));
    }, 10_000);
    socket.once("open", () => {
      socket.send(
        JSON.stringify({
          kind: "invoke",
          id: 1,
          channel: "backend:describe",
          args: [],
        }),
      );
    });
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.kind !== "response" || message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(message.result);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function stopChild(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      processHandle.kill("SIGKILL");
      reject(new Error("Packaged server did not stop after SIGTERM"));
    }, 10_000);
    processHandle.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    processHandle.kill("SIGTERM");
  });
}

function probeInstalledDependencies() {
  const probePath = path.join(
    installedPackageRoot,
    "server",
    "dependency-smoke.cjs",
  );
  fs.writeFileSync(
    probePath,
    `const pty = require("node-pty");
if (typeof pty.spawn !== "function") throw new Error("node-pty did not load");
(async () => {
  const claude = await import("@anthropic-ai/claude-agent-sdk");
  if (typeof claude.query !== "function") throw new Error("Claude SDK did not load");
  const dynamicImport = new Function("specifier", "return import(specifier)");
  const copilot = await dynamicImport("@github/copilot-sdk");
  if (typeof copilot.CopilotClient !== "function") throw new Error("Copilot SDK did not load");
  // Construction resolves the bundled platform CLI. A plain import is not
  // enough: incompatible @github/copilot versions can install successfully
  // while omitting the /sdk export CopilotClient expects.
  new copilot.CopilotClient({ logLevel: "error" });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`,
  );
  const probe = spawnSync(process.execPath, [probePath], {
    cwd: temporaryRoot,
    stdio: "inherit",
  });
  if (probe.status !== 0) {
    throw new Error(`Installed dependency probe failed (exit ${probe.status})`);
  }
}

try {
  if (!fs.existsSync(archive)) {
    throw new Error(`Package archive is missing: ${archive}`);
  }
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const installed = spawnSync(
    npmExecutable,
    [
      "install",
      "--prefix",
      installationRoot,
      "--no-package-lock",
      "--no-save",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    { cwd: temporaryRoot, stdio: "inherit" },
  );
  if (installed.status !== 0) {
    throw new Error(
      `Could not install packaged server (npm exit ${installed.status})`,
    );
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(installedPackageRoot, "package.json"), "utf8"),
  );
  if (
    packageJson.bin?.mains !== "bin/mains.cjs" ||
    Object.keys(packageJson.bin ?? {}).length !== 1 ||
    !fs.existsSync(executable)
  ) {
    throw new Error(
      `Packaged CLI entrypoint is invalid: ${JSON.stringify(packageJson.bin)}`,
    );
  }
  const version = spawnSync(installedCommand, ["--version"], {
    cwd: temporaryRoot,
    encoding: "utf8",
  });
  if (version.status !== 0 || version.stdout.trim() !== packageJson.version) {
    throw new Error(
      `Packaged CLI version check failed for ${path.basename(installedCommand)}:\n${version.stderr || version.stdout || `exit ${version.status}`}`,
    );
  }
  probeInstalledDependencies();
  const dataDir = path.join(temporaryRoot, "data");
  // The server starts in a directory holding its own `dist-web`, as a cloned
  // project might. It must still serve the package's web UI, never this one.
  const decoyMarker = "mains-smoke-decoy-web-root";
  fs.mkdirSync(path.join(temporaryRoot, "dist-web"), { recursive: true });
  fs.writeFileSync(
    path.join(temporaryRoot, "dist-web", "index.html"),
    `<html><body>${decoyMarker}</body></html>`,
  );
  child = spawn(
    process.execPath,
    [
      executable,
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--token",
      token,
      "--data-dir",
      dataDir,
      "--public-url",
      "http://127.0.0.1:8787",
      "--no-pairing",
    ],
    { cwd: temporaryRoot, stdio: ["ignore", "pipe", "pipe"] },
  );

  const port = await waitForReady(child);
  await waitForFile(path.join(dataDir, "server-state.json"));
  const response = await describeBackend(port);
  if (!response?.success || response.data?.appVersion !== packageJson.version) {
    throw new Error(
      `Unexpected backend descriptor: ${JSON.stringify(response, null, 2)}`,
    );
  }

  const page = await fetch(`http://127.0.0.1:${port}/`);
  const pageText = await page.text();
  if (pageText.includes(decoyMarker)) {
    throw new Error("Packaged server served a web UI from its working directory");
  }
  if (!page.ok || !pageText.includes('<div id="root"></div>')) {
    throw new Error(
      `Packaged web UI failed its HTTP smoke test (${page.status})`,
    );
  }

  const paired = spawnSync(
    process.execPath,
    [
      executable,
      "pair",
      "--data-dir",
      dataDir,
      "--token",
      token,
      "--no-qr",
    ],
    { cwd: temporaryRoot, encoding: "utf8" },
  );
  if (paired.status !== 0 || !paired.stdout.includes("mains://pair#")) {
    throw new Error(
      `Packaged pairing command failed:\n${paired.stderr || paired.stdout || `exit ${paired.status}`}`,
    );
  }

  const browserOrigin = `http://127.0.0.1:${port}`;
  const browserLogin = spawnSync(
    process.execPath,
    [
      executable,
      "web",
      "--data-dir",
      dataDir,
      "--token",
      token,
      "--url",
      browserOrigin,
    ],
    { cwd: temporaryRoot, encoding: "utf8" },
  );
  const loginOutput = `${browserLogin.stdout}\n${browserLogin.stderr}`;
  const loginMatch = browserLogin.stdout.match(/(https?:\/\/\S+#login=[\w-]+)/);
  if (browserLogin.status !== 0 || !loginMatch || loginOutput.includes(token)) {
    throw new Error(
      `Packaged browser login command failed:\n${loginOutput || `exit ${browserLogin.status}`}`,
    );
  }
  const loginUrl = new URL(loginMatch[1]);
  const loginCode = new URLSearchParams(loginUrl.hash.slice(1)).get("login");
  const exchange = await fetch(`${browserOrigin}/__mains/web-session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginCode}`,
      Origin: browserOrigin,
    },
  });
  const setCookies =
    typeof exchange.headers.getSetCookie === "function"
      ? exchange.headers.getSetCookie()
      : (exchange.headers.get("set-cookie") ?? "").split(/,(?=\s*mains_)/);
  const sessionCookie = setCookies
    .find((value) => value.trim().startsWith("mains_web_"))
    ?.trim()
    .split(";", 1)[0];
  if (exchange.status !== 204 || !sessionCookie) {
    throw new Error(
      `Packaged browser login exchange failed (${exchange.status})`,
    );
  }
  const browserResponse = await describeBackendWithSession(
    port,
    browserOrigin,
    sessionCookie,
  );
  if (!browserResponse?.success) {
    throw new Error(
      `Cookie-authenticated browser socket failed: ${JSON.stringify(browserResponse)}`,
    );
  }

  const duplicate = spawnSync(
    process.execPath,
    [
      executable,
      "serve",
      "--port",
      "0",
      "--data-dir",
      dataDir,
      "--token",
      token,
      "--no-pairing",
    ],
    { cwd: temporaryRoot, encoding: "utf8" },
  );
  const duplicateOutput = `${duplicate.stdout}\n${duplicate.stderr}`;
  if (
    duplicate.status === 0 ||
    !duplicateOutput.includes("already in use by Mains CLI")
  ) {
    throw new Error(
      `Packaged ownership lock failed:\n${duplicateOutput || `exit ${duplicate.status}`}`,
    );
  }

  await stopChild(child);
  child = undefined;
  // stdout is a pipe here, exactly like a service log file.
  if (serverOutput.includes(token)) {
    throw new Error("Packaged server wrote its owner token to non-interactive output");
  }
  if (fs.existsSync(path.join(dataDir, "mains.db.backend.lock"))) {
    throw new Error("Packaged server left its database ownership lock behind");
  }

  console.log(
    `Packaged server smoke test passed (${response.data.appVersion}, protocol ${response.data.protocolVersion}, pairing + browser login + ownership lock)`,
  );
} finally {
  if (child) await stopChild(child);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
