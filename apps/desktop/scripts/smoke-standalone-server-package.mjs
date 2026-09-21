#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import WebSocket from "ws";

const appRoot = path.resolve(import.meta.dirname, "..");
const archive = path.join(appRoot, "dist-server", "mains-server.tgz");
const token = "standalone-package-smoke-token";
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
const executable = path.join(installedPackageRoot, "bin", "mains-server.cjs");
let child;

function waitForReady(processHandle) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`Server did not become ready:\n${output}`));
    }, 20_000);

    const onData = (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
      const match = output.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    };
    processHandle.stdout.on("data", onData);
    processHandle.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    processHandle.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Server exited before it was ready (${signal ?? `code ${code}`}):\n${output}`,
        ),
      );
    });
    processHandle.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
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
  const probePath = path.join(installedPackageRoot, "server", "dependency-smoke.cjs");
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
    throw new Error(`Could not install packaged server (npm exit ${installed.status})`);
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(installedPackageRoot, "package.json"), "utf8"),
  );
  probeInstalledDependencies();
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
      path.join(temporaryRoot, "data"),
    ],
    { cwd: temporaryRoot, stdio: ["ignore", "pipe", "pipe"] },
  );

  const port = await waitForReady(child);
  const response = await describeBackend(port);
  if (!response?.success || response.data?.appVersion !== packageJson.version) {
    throw new Error(
      `Unexpected backend descriptor: ${JSON.stringify(response, null, 2)}`,
    );
  }

  const page = await fetch(`http://127.0.0.1:${port}/`);
  if (!page.ok || !(await page.text()).includes("<div id=\"root\"></div>")) {
    throw new Error(`Packaged web UI failed its HTTP smoke test (${page.status})`);
  }

  console.log(
    `Packaged server smoke test passed (${response.data.appVersion}, protocol ${response.data.protocolVersion})`,
  );
} finally {
  if (child) await stopChild(child);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
