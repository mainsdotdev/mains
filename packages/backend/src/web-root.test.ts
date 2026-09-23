import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestBackendRuntime } from "../test/backend-runtime";
import { resolveWebRoot } from "./web-root";

const temporaryDirectories: string[] = [];
let restoreRuntime: (() => void) | null = null;

function makeDirectory(name: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `mains-web-root-${name}-`));
  temporaryDirectories.push(directory);
  return directory;
}

function makeWebBuild(parent: string, ...segments: string[]): string {
  const directory = path.join(parent, ...segments);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "index.html"), "<main></main>");
  return directory;
}

/** A working directory holding a decoy build, as a cloned repo might. */
function enterDecoyProject(): string {
  const project = makeDirectory("project");
  vi.spyOn(process, "cwd").mockReturnValue(project);
  return makeWebBuild(project, "dist-web");
}

afterEach(() => {
  restoreRuntime?.();
  restoreRuntime = null;
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("resolveWebRoot", () => {
  it("serves the standalone server's own build, not the working directory's", () => {
    const appRoot = makeDirectory("package");
    const bundled = makeWebBuild(appRoot, "dist-web");
    restoreRuntime = installTestBackendRuntime({ kind: "node", getAppPath: () => appRoot });
    enterDecoyProject();

    expect(resolveWebRoot()).toBe(bundled);
  });

  it("finds no web UI rather than falling back to the working directory", () => {
    const appRoot = makeDirectory("package");
    restoreRuntime = installTestBackendRuntime({ kind: "node", getAppPath: () => appRoot });
    enterDecoyProject();

    expect(resolveWebRoot()).toBeNull();
  });

  it("keeps a packaged desktop app on its bundled renderer", () => {
    const appRoot = makeDirectory("app");
    const bundled = makeWebBuild(appRoot, ".vite", "renderer");
    restoreRuntime = installTestBackendRuntime({
      kind: "electron",
      isPackaged: () => true,
      getAppPath: () => appRoot,
    });
    enterDecoyProject();

    expect(resolveWebRoot()).toBe(bundled);
  });

  it("still finds dist-web beside an unpackaged Electron checkout", () => {
    const bundledMain = makeDirectory("vite-build");
    restoreRuntime = installTestBackendRuntime({
      kind: "electron",
      isPackaged: () => false,
      getAppPath: () => bundledMain,
    });
    const checkoutBuild = enterDecoyProject();

    expect(resolveWebRoot()).toBe(checkoutBuild);
  });

  it("honours an explicit web root", () => {
    const explicit = makeWebBuild(makeDirectory("explicit"), "web");
    restoreRuntime = installTestBackendRuntime({ kind: "node" });
    enterDecoyProject();

    expect(resolveWebRoot(explicit)).toBe(explicit);
  });
});
