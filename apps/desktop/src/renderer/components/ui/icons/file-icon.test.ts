import { describe, expect, it } from "vitest";
import { resolveFileIcon } from "./file-icon";
import {
  ClaudeFileIcon,
  DatabaseFileIcon,
  DockerFileIcon,
  DrizzleFileIcon,
  ElectronFileIcon,
  EnvFileIcon,
  JsonFileIcon,
  LicenseFileIcon,
  LockFileIcon,
  NodeFileIcon,
  PnpmFileIcon,
  PythonFileIcon,
  ShellFileIcon,
  TestFileIcon,
  TsFileIcon,
  TsconfigFileIcon,
  ViteFileIcon,
  VitestFileIcon,
  YamlFileIcon,
} from "@/components/ui/icons/file-icons";

/** How the callers derive the extension they hand us. */
const ext = (name: string) => name.split(".").pop();
const iconFor = (name: string) => resolveFileIcon(name, ext(name));

describe("resolveFileIcon", () => {
  it("resolves by extension", () => {
    expect(iconFor("runs.repo.ts")).toBe(TsFileIcon);
    expect(iconFor("main.py")).toBe(PythonFileIcon);
    expect(iconFor("deploy.sh")).toBe(ShellFileIcon);
    expect(iconFor("schema.sql")).toBe(DatabaseFileIcon);
    expect(iconFor("mains.db")).toBe(DatabaseFileIcon);
    expect(iconFor("ci.yml")).toBe(YamlFileIcon);
  });

  it("prefers an exact filename over its extension", () => {
    expect(iconFor("package.json")).toBe(NodeFileIcon);
    expect(iconFor("CLAUDE.md")).toBe(ClaudeFileIcon);
    // …and a plain .json still gets the json icon.
    expect(iconFor("data.json")).toBe(JsonFileIcon);
  });

  it("matches config families, not just the canonical name", () => {
    expect(iconFor("tsconfig.json")).toBe(TsconfigFileIcon);
    expect(iconFor("tsconfig.renderer.json")).toBe(TsconfigFileIcon);
    expect(iconFor("vite.config.ts")).toBe(ViteFileIcon);
    expect(iconFor("vite.renderer.config.mjs")).toBe(ViteFileIcon);
    expect(iconFor("drizzle.config.runtime.ts")).toBe(DrizzleFileIcon);
    expect(iconFor("forge.config.js")).toBe(ElectronFileIcon);
    expect(iconFor("electron.vite.config.ts")).toBe(ElectronFileIcon);
  });

  it("keeps vitest out of the vite family", () => {
    // Both patterns could plausibly claim this one; vitest is checked first.
    expect(iconFor("vitest.config.mts")).toBe(VitestFileIcon);
  });

  it("marks test files ahead of their language", () => {
    expect(iconFor("file-icon.test.ts")).toBe(TestFileIcon);
    expect(iconFor("session-panel.test.tsx")).toBe(TestFileIcon);
    expect(iconFor("codex-event-mapper.spec.js")).toBe(TestFileIcon);
    expect(iconFor("run-cache.test.mts")).toBe(TestFileIcon);
    // The config family keeps its own mark — `vitest.` is not `.test.`.
    expect(iconFor("vitest.config.ts")).toBe(VitestFileIcon);
    // …and a file merely named `test` is still plain TypeScript.
    expect(iconFor("test.ts")).toBe(TsFileIcon);
    expect(iconFor("latest.ts")).toBe(TsFileIcon);
  });

  it("covers the .env and Dockerfile families", () => {
    expect(iconFor(".env")).toBe(EnvFileIcon);
    expect(iconFor(".env.local")).toBe(EnvFileIcon);
    expect(iconFor("Dockerfile")).toBe(DockerFileIcon);
    expect(iconFor("Dockerfile.dev")).toBe(DockerFileIcon);
    expect(iconFor("docker-compose.yml")).toBe(DockerFileIcon);
  });

  it("marks lockfiles and licenses", () => {
    expect(iconFor("yarn.lock")).toBe(LockFileIcon);
    expect(iconFor("bun.lockb")).toBe(LockFileIcon);
    expect(iconFor("LICENSE")).toBe(LicenseFileIcon);
    expect(iconFor("LICENSE.md")).toBe(LicenseFileIcon);
    // package-lock.json is npm's, and reads better as a node file.
    expect(iconFor("package-lock.json")).toBe(NodeFileIcon);
  });

  it("gives pnpm's files pnpm's own mark", () => {
    // Both end in .yaml, so without exact entries they'd read as plain YAML.
    expect(iconFor("pnpm-lock.yaml")).toBe(PnpmFileIcon);
    expect(iconFor("pnpm-workspace.yaml")).toBe(PnpmFileIcon);
    expect(iconFor(".pnpmfile.cjs")).toBe(PnpmFileIcon);
  });

  it("returns null when only the generic page glyph applies", () => {
    expect(iconFor("notes.unknownext")).toBeNull();
    expect(resolveFileIcon(undefined, undefined)).toBeNull();
  });
});
