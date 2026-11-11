#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { discoverRuntimeDependencies } from "./runtime-dependencies.mjs";

const appRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(appRoot, "../..");
const desktopRoot = path.resolve(appRoot, "../desktop");
const serverBuild = path.join(appRoot, ".vite", "server");
const webBuild = path.join(desktopRoot, "dist-web");
const packageTemplate = path.join(appRoot, "package-template");
const outputRoot = path.join(appRoot, "dist");
const packageRoot = path.join(outputRoot, "package");
const appPackage = JSON.parse(
  fs.readFileSync(path.join(appRoot, "package.json"), "utf8"),
);

// These imports are deliberately hidden from the bundler so the providers can
// report a useful "not installed" error. They still belong in the archive.
const dynamicRuntimeDependencies = [
  "@anthropic-ai/claude-agent-sdk",
  // The SDK supplies the headless runtime; the matching full CLI is only
  // needed for device login. Both bring their platform packages into installs.
  "@github/copilot",
  "@github/copilot-sdk",
  // BlockNote's server converter loads this optional core peer at runtime.
  "y-prosemirror",
];

function assertDirectory(directory, label) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`${label} is missing: ${directory}`);
  }
}

function exactVersion(name) {
  const version = appPackage.dependencies?.[name];
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(
      `Standalone server imports ${name}, but apps/server/package.json does not declare an exact version`,
    );
  }
  return version;
}

function copyFile(source, destination) {
  if (!fs.existsSync(source)) {
    throw new Error(`Required file is missing: ${source}`);
  }
  fs.copyFileSync(source, destination);
}

function generateThirdPartyNotices(destination) {
  const generated = spawnSync(
    process.execPath,
    [
      path.join(desktopRoot, "scripts", "generate-third-party-notices.mjs"),
      "--project-root",
      appRoot,
      "--vendored-dir",
      path.join(desktopRoot, "src", "renderer", "public", "fonts"),
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
if (path.dirname(outputRoot) !== appRoot || path.basename(outputRoot) !== "dist") {
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

const dependencyNames = [...new Set([
  ...dynamicRuntimeDependencies,
  ...discoverRuntimeDependencies(serverBuild),
])].sort();
const undeclaredDependencies = dependencyNames.filter(
  (name) => !(name in (appPackage.dependencies ?? {})),
);
if (undeclaredDependencies.length > 0) {
  throw new Error(
    `Undeclared standalone runtime dependencies: ${undeclaredDependencies.join(", ")}`,
  );
}
const unusedDeclarations = Object.keys(appPackage.dependencies ?? {}).filter(
  (name) => !dependencyNames.includes(name),
);
if (unusedDeclarations.length > 0) {
  throw new Error(
    `Unused standalone runtime declarations: ${unusedDeclarations.join(", ")}`,
  );
}
const dependencies = Object.fromEntries(
  dependencyNames.map((name) => [name, exactVersion(name)]),
);
const serverPackage = {
  name: "@mains/server",
  version: appPackage.version,
  description: appPackage.description,
  license: appPackage.license,
  repository: appPackage.repository,
  homepage: appPackage.homepage,
  bugs: appPackage.bugs,
  type: "commonjs",
  bin: {
    mains: "bin/mains.cjs",
  },
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
fs.chmodSync(path.join(packageRoot, "bin", "mains.cjs"), 0o755);

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
