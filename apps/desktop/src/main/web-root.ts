import path from "node:path";
import { existsSync } from "node:fs";
import { getBackendRuntime } from "./runtime/backend-runtime";

/**
 * Locate the built web renderer (served over HTTP to remote/browser clients).
 *
 * `npm run build:web` writes it to `dist-web/` — a dedicated dir forge's `.vite`
 * cleaning never touches, so it survives. In dev, `app.getAppPath()` points at
 * `.vite/build` (the bundled main), not the project root, so try `process.cwd()`
 * first. Returns null when no build is found (WS still works; static is skipped).
 */
export function resolveWebRoot(explicit?: string | null): string | null {
  const appPath = getBackendRuntime().getAppPath();
  const candidates = explicit
    ? [explicit]
    : [
        path.join(process.cwd(), "dist-web"),
        path.join(appPath, "dist-web"),
        path.join(process.cwd(), ".vite", "renderer"),
        path.join(appPath, ".vite", "renderer"),
      ];
  return (
    candidates.find((dir) => existsSync(path.join(dir, "index.html"))) ?? null
  );
}
