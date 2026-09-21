#!/usr/bin/env node

import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";

const appRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(appRoot, "../..");
const serverBuild = path.join(appRoot, ".vite", "server");
const webBuild = path.join(appRoot, "dist-web");
const packageTemplate = path.join(appRoot, "server-package");
const outputRoot = path.join(appRoot, "dist-server");
const packageRoot = path.join(outputRoot, "package");
const lock = JSON.parse(
  fs.readFileSync(path.join(appRoot, "package-lock.json"), "utf8"),
);
const appPackage = JSON.parse(
  fs.readFileSync(path.join(appRoot, "package.json"), "utf8"),
);

// These imports are deliberately hidden from the bundler so the providers can
// report a useful "not installed" error. They still belong in the distributable.
const dynamicRuntimeDependencies = [
  "@anthropic-ai/claude-agent-sdk",
  "@github/copilot-sdk",
];

function assertDirectory(directory, label) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`${label} is missing: ${directory}`);
  }
}

function packageName(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function walkJavaScript(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkJavaScript(entryPath));
    else if (/\.(?:c?js|mjs)$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}

function discoverRuntimeDependencies() {
  const builtins = new Set([
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ]);
  const dependencies = new Set(dynamicRuntimeDependencies);
  const importPattern = /(?:require|import)\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

  for (const file of walkJavaScript(serverBuild)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (
        specifier.startsWith(".") ||
        path.isAbsolute(specifier) ||
        builtins.has(specifier)
      ) {
        continue;
      }
      dependencies.add(packageName(specifier));
    }
  }

  return [...dependencies].sort();
}

function exactVersion(name) {
  const installed = lock.packages?.[`node_modules/${name}`];
  if (!installed || typeof installed.version !== "string") {
    throw new Error(
      `Standalone server imports ${name}, but package-lock.json has no installed version`,
    );
  }
  return installed.version;
}

function copyFile(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Required file is missing: ${source}`);
  fs.copyFileSync(source, destination);
}

function generateThirdPartyNotices(destination) {
  const generated = spawnSync(
    process.execPath,
    [
      path.join(appRoot, "scripts", "generate-third-party-notices.mjs"),
      "--output",
      destination,
    ],
    { cwd: appRoot, encoding: "utf8" },
  );
  if (generated.status !== 0) {
    throw new Error(
      `Third-party notice generation failed:\n${generated.stderr || generated.stdout || "unknown error"}`,
    );
  }
}

assertDirectory(serverBuild, "Standalone server build");
assertDirectory(webBuild, "Web build");
assertDirectory(packageTemplate, "Standalone package template");

// Keep destructive cleanup pinned to this app's one known build directory.
if (
  path.dirname(outputRoot) !== appRoot ||
  path.basename(outputRoot) !== "dist-server"
) {
  throw new Error(`Refusing to clean unexpected output path: ${outputRoot}`);
}
fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(packageRoot, { recursive: true });

fs.cpSync(serverBuild, path.join(packageRoot, "server"), { recursive: true });
fs.cpSync(webBuild, path.join(packageRoot, "dist-web"), { recursive: true });
fs.cpSync(packageTemplate, packageRoot, { recursive: true });
copyFile(path.join(repositoryRoot, "LICENSE"), path.join(packageRoot, "LICENSE"));
generateThirdPartyNotices(
  path.join(packageRoot, "THIRD-PARTY-NOTICES.txt"),
);

const dependencyNames = discoverRuntimeDependencies();
const dependencies = Object.fromEntries(
  dependencyNames.map((name) => [name, exactVersion(name)]),
);
const serverPackage = {
  name: "@mains/server",
  version: appPackage.version,
  description: "Standalone Mains backend and web UI",
  license: appPackage.license,
  repository: appPackage.repository,
  homepage: appPackage.homepage,
  bugs: appPackage.bugs,
  type: "commonjs",
  bin: { "mains-server": "bin/mains-server.cjs" },
  files: [
    "bin",
    "server",
    "dist-web",
    "README.md",
    "LICENSE",
    "THIRD-PARTY-NOTICES.txt",
  ],
  engines: appPackage.engines,
  dependencies,
};
fs.writeFileSync(
  path.join(packageRoot, "package.json"),
  `${JSON.stringify(serverPackage, null, 2)}\n`,
);
fs.chmodSync(path.join(packageRoot, "bin", "mains-server.cjs"), 0o755);

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const packed = spawnSync(
  npmExecutable,
  ["pack", packageRoot, "--pack-destination", outputRoot, "--json"],
  { cwd: appRoot, encoding: "utf8" },
);
if (packed.status !== 0) {
  throw new Error(
    `npm pack failed:\n${packed.stderr || packed.stdout || "unknown error"}`,
  );
}
const packResult = JSON.parse(packed.stdout);
const versionedArchive = path.join(outputRoot, packResult[0].filename);
const stableArchive = path.join(outputRoot, "mains-server.tgz");
fs.copyFileSync(versionedArchive, stableArchive);

console.log(`Standalone server package: ${versionedArchive}`);
console.log(`Stable release asset: ${stableArchive}`);
console.log(`Runtime dependencies: ${dependencyNames.join(", ")}`);
