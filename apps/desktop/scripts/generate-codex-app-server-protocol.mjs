#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(
  repoRoot,
  "src/main/modules/providers/adapters/codex-app-server-protocol/generated",
);
const codexBinary = process.env.CODEX_BINARY || "codex";
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "mains-codex-protocol-"),
);

// Keep this list focused on the protocol surfaces consumed as typed data by
// the Codex adapter. Transitive imports are discovered automatically.
const roots = [
  "InitializeParams.ts",
  "InitializeResponse.ts",
  "v2/ConfigValueWriteParams.ts",
  "v2/ConfigWriteResponse.ts",
  "v2/ExperimentalFeatureListParams.ts",
  "v2/ExperimentalFeatureListResponse.ts",
  "v2/GetAccountParams.ts",
  "v2/GetAccountResponse.ts",
  "v2/GetAccountRateLimitsResponse.ts",
  "v2/ModelListParams.ts",
  "v2/ModelListResponse.ts",
  "v2/PluginInstallParams.ts",
  "v2/PluginInstallResponse.ts",
  "v2/PluginInstalledParams.ts",
  "v2/PluginInstalledResponse.ts",
  "v2/PluginListParams.ts",
  "v2/PluginListResponse.ts",
  "v2/PluginReadParams.ts",
  "v2/PluginReadResponse.ts",
  "v2/PluginUninstallParams.ts",
  "v2/PluginUninstallResponse.ts",
  "v2/ReviewStartParams.ts",
  "v2/ReviewStartResponse.ts",
  "v2/SkillsListParams.ts",
  "v2/SkillsListResponse.ts",
  "v2/ThreadForkParams.ts",
  "v2/ThreadForkResponse.ts",
  "v2/ThreadArchiveParams.ts",
  "v2/ThreadArchiveResponse.ts",
  "v2/ThreadDeleteParams.ts",
  "v2/ThreadDeleteResponse.ts",
  "v2/ThreadGoalClearParams.ts",
  "v2/ThreadGoalClearResponse.ts",
  "v2/ThreadGoalGetParams.ts",
  "v2/ThreadGoalGetResponse.ts",
  "v2/ThreadGoalSetParams.ts",
  "v2/ThreadGoalSetResponse.ts",
  "v2/ThreadReadParams.ts",
  "v2/ThreadReadResponse.ts",
  "v2/ThreadResumeParams.ts",
  "v2/ThreadResumeResponse.ts",
  "v2/ThreadStartParams.ts",
  "v2/ThreadStartResponse.ts",
  "v2/ThreadUnarchiveParams.ts",
  "v2/ThreadUnarchiveResponse.ts",
  "v2/ThreadUnsubscribeParams.ts",
  "v2/ThreadUnsubscribeResponse.ts",
  "v2/TurnInterruptParams.ts",
  "v2/TurnInterruptResponse.ts",
  "v2/TurnStartParams.ts",
  "v2/TurnStartResponse.ts",
];

function normalizeVersion(rawVersion) {
  return rawVersion.match(/\d+\.\d+\.\d+(?:-[^\s]+)?/)?.[0] ?? rawVersion.trim();
}

function importedFiles(relativePath) {
  const absolutePath = path.join(temporaryRoot, relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const directory = path.posix.dirname(relativePath);
  const dependencies = [];
  for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
    const dependency = path.posix.normalize(
      path.posix.join(directory, `${match[1]}.ts`),
    );
    dependencies.push(dependency);
  }
  return dependencies;
}

try {
  execFileSync(
    codexBinary,
    // `--experimental` is required: `collaborationMode` (turn/start) and
    // `dynamicTools` (thread/start) are experimental fields, absent from the
    // stable schema. The driver declares `experimentalApi: true` at
    // initialize and sends both, so it must be typed against the same
    // surface it negotiates.
    ["app-server", "generate-ts", "--experimental", "--out", temporaryRoot],
    { stdio: "inherit" },
  );

  const pending = [...roots];
  const selected = new Set();
  while (pending.length > 0) {
    const relativePath = pending.pop();
    if (!relativePath || selected.has(relativePath)) continue;
    if (!fs.existsSync(path.join(temporaryRoot, relativePath))) {
      throw new Error(`Generated protocol file is missing: ${relativePath}`);
    }
    selected.add(relativePath);
    pending.push(...importedFiles(relativePath));
  }

  fs.rmSync(outputRoot, { recursive: true, force: true });
  for (const relativePath of [...selected].sort()) {
    const source = path.join(temporaryRoot, relativePath);
    const destination = path.join(outputRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  const cliVersion = normalizeVersion(
    execFileSync(codexBinary, ["--version"], { encoding: "utf8" }),
  );
  const files = [...selected].sort().map((relativePath) => {
    const contents = fs.readFileSync(path.join(outputRoot, relativePath));
    return {
      path: relativePath,
      sha256: crypto.createHash("sha256").update(contents).digest("hex"),
    };
  });
  fs.writeFileSync(
    path.join(outputRoot, "manifest.json"),
    `${JSON.stringify({ cliVersion, files }, null, 2)}\n`,
  );
  process.stdout.write(
    `Generated ${files.length} Codex app-server protocol files from CLI ${cliVersion}.\n`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
