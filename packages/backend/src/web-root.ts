import path from "node:path";
import { existsSync } from "node:fs";
import { getBackendRuntime } from "./runtime/backend-runtime";

/**
 * Locate the built web renderer (served over HTTP to remote/browser clients).
 *
 * `npm run build:web` writes it to `dist-web/` — a dedicated dir forge's `.vite`
 * cleaning never touches, so it survives. Only an unpackaged Electron checkout
 * searches `process.cwd()`, because there `app.getAppPath()` points at
 * `.vite/build` (the bundled main), not the project root. Every other host
 * resolves beside its app path: a CLI's working directory is wherever the user
 * happens to be, and a `dist-web/` found there would run as Mains on Mains'
 * origin, where it could spend a browser login code. Returns null when no build
 * is found (WS still works; static is skipped).
 */
export function resolveWebRoot(explicit?: string | null): string | null {
  const runtime = getBackendRuntime();
  const appPath = runtime.getAppPath();
  const fromWorkingDirectory =
    runtime.kind === "electron" && !runtime.isPackaged()
      ? (...segments: string[]) => [path.join(process.cwd(), ...segments)]
      : () => [];
  const candidates = explicit
    ? [explicit]
    : [
        ...fromWorkingDirectory("dist-web"),
        path.join(appPath, "dist-web"),
        ...fromWorkingDirectory(".vite", "renderer"),
        path.join(appPath, ".vite", "renderer"),
      ];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(path.join(resolved, "index.html"))) return resolved;
  }
  return null;
}
