import { promises as fs } from "node:fs";
import path from "node:path";
import { coverPreset } from "@mains/contracts/atlas-covers";
import { getBackendRuntime } from "../../runtime/backend-runtime";

/** Where the bundled images are, in a source checkout, a Vite bundle or a packaged app. */
function coverDirectories(): string[] {
  const resourcesPath = getBackendRuntime().getResourcesPath();
  return [
    // Vite bundle (desktop `.vite/build`, standalone server `.vite/server`).
    path.join(__dirname, "atlas-covers"),
    // Packaged desktop app.
    resourcesPath ? path.join(resourcesPath, "atlas-covers") : null,
    // Source checkout: `src/modules/atlas` -> `assets/atlas-covers`.
    path.resolve(__dirname, "../../../assets/atlas-covers"),
  ].filter((directory): directory is string => directory !== null);
}

/** The catalog names the file; the id is never used as a path component. */
export async function readCoverPreset(id: string): Promise<Buffer> {
  const preset = coverPreset(id);
  if (!preset) throw new Error(`Unknown cover "${id}"`);
  for (const directory of coverDirectories()) {
    try { return await fs.readFile(path.join(directory, preset.file)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  throw new Error(`Cover image for "${id}" is not installed`);
}
