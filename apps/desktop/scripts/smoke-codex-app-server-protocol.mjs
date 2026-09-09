#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";

const codexBinary = process.env.CODEX_BINARY || "codex";
const minimumVersion = "0.147.0";
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "mains-codex-smoke-"),
);

function numericVersion(version) {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Could not parse Codex CLI version: ${version}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const leftParts = numericVersion(left);
  const rightParts = numericVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

function assertContains(relativePath, snippets) {
  const source = fs.readFileSync(path.join(temporaryRoot, relativePath), "utf8");
  for (const snippet of snippets) {
    if (!source.includes(snippet)) {
      throw new Error(
        `${relativePath} no longer contains required protocol shape: ${snippet}`,
      );
    }
  }
}

async function smokeRuntime() {
  const child = spawn(codexBinary, ["app-server"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });
  const pending = new Map();
  let nextId = 1;
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  output.on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (!("id" in message) || "method" in message) return;
    const waiter = pending.get(String(message.id));
    if (!waiter) return;
    pending.delete(String(message.id));
    if (message.error) {
      waiter.reject(
        new Error(
          `${message.error.message} (code: ${message.error.code ?? "unknown"})`,
        ),
      );
    } else {
      waiter.resolve(message.result);
    }
  });

  const request = (method, params) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(String(id));
        reject(new Error(`Timed out waiting for ${method}. ${stderr}`));
      }, 10_000);
      pending.set(String(id), {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  };

  try {
    const initialized = await request("initialize", {
      clientInfo: {
        name: "mains-ci-smoke",
        title: "Mains CI smoke",
        version: "0.4.2",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    for (const field of [
      "userAgent",
      "codexHome",
      "platformFamily",
      "platformOs",
    ]) {
      if (typeof initialized?.[field] !== "string") {
        throw new Error(`initialize response is missing ${field}`);
      }
    }
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`,
    );

    const features = await request("experimentalFeature/list", { limit: 100 });
    if (!Array.isArray(features?.data)) {
      throw new Error("experimentalFeature/list did not return data[]");
    }
    const skills = await request("skills/list", {
      cwds: [process.cwd()],
      forceReload: false,
    });
    if (!Array.isArray(skills?.data)) {
      throw new Error("skills/list did not return data[]");
    }

    const models = await request("model/list", {});
    if (!Array.isArray(models?.data)) {
      throw new Error("model/list did not return data[]");
    }

    const started = await request("thread/start", {
      cwd: process.cwd(),
      ephemeral: true,
      dynamicTools: [{
        type: "function",
        name: "mains_ci_smoke",
        description: "Validates the experimental dynamic-tool contract.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      }],
    });
    if (
      typeof started?.thread?.id !== "string" ||
      typeof started?.model !== "string"
    ) {
      throw new Error("thread/start did not return thread.id and model");
    }
  } finally {
    output.close();
    child.kill("SIGTERM");
  }
}

try {
  const versionOutput = execFileSync(codexBinary, ["--version"], {
    encoding: "utf8",
  }).trim();
  if (compareVersions(versionOutput, minimumVersion) < 0) {
    throw new Error(
      `Codex CLI is below the Mains minimum ${minimumVersion}: ${versionOutput}`,
    );
  }

  execFileSync(
    codexBinary,
    [
      "app-server",
      "generate-ts",
      "--experimental",
      "--out",
      temporaryRoot,
    ],
    { stdio: "inherit" },
  );
  assertContains("InitializeCapabilities.ts", [
    "experimentalApi: boolean",
    "requestAttestation: boolean",
  ]);
  assertContains("ClientRequest.ts", [
    '"method": "initialize"',
    '"method": "thread/start"',
    '"method": "turn/start"',
    '"method": "skills/list"',
    '"method": "account/rateLimits/read"',
    '"method": "plugin/list"',
  ]);
  assertContains("v2/SkillsListParams.ts", [
    "cwds?: Array<string>",
    "forceReload?: boolean",
  ]);
  assertContains("v2/GetAccountRateLimitsResponse.ts", [
    "rateLimitsByLimitId:",
    "rateLimitResetCredits:",
  ]);
  assertContains("v2/ThreadStartParams.ts", [
    "dynamicTools?: Array<DynamicToolSpec>",
  ]);
  assertContains("v2/DynamicToolSpec.ts", ['"type": "function"']);
  assertContains("v2/TurnStartParams.ts", [
    "collaborationMode?: CollaborationMode",
  ]);
  assertContains("Settings.ts", [
    "model: string",
    "reasoning_effort: ReasoningEffort | null",
    "developer_instructions: string | null",
  ]);

  await smokeRuntime();
  process.stdout.write(`Codex app-server smoke passed for ${versionOutput}.\n`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
