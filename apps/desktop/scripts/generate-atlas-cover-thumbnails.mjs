// Regenerates the Atlas cover gallery thumbnails from the bundled full-size covers.
// The renderer ships these small JPEGs so the gallery needs no backend round trip.
// Every thumbnail is the same size: the gallery tile's 2:1 shape, centre-cropped.
// macOS only (uses `sips`). Run after adding or replacing a cover:
//   npm run atlas:cover-thumbnails
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.resolve(root, "../../packages/backend/assets/atlas-covers");
const destination = path.resolve(root, "src/renderer/features/atlas/assets/cover-thumbs");
const WIDTH = 480;
const HEIGHT = 240;

if (process.platform !== "darwin") throw new Error("Cover thumbnails are generated with macOS sips");
if (!existsSync(source)) throw new Error(`Cover images not found: ${source}`);
mkdirSync(destination, { recursive: true });

function dimensions(file) {
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
  return [Number(/pixelWidth: (\d+)/.exec(out)?.[1]), Number(/pixelHeight: (\d+)/.exec(out)?.[1])];
}

const covers = readdirSync(source).filter((name) => /\.(png|jpe?g)$/i.test(name));
const wanted = new Set(covers.map((name) => `${path.parse(name).name}.jpg`));
for (const stale of readdirSync(destination)) {
  if (stale.endsWith(".jpg") && !wanted.has(stale)) rmSync(path.join(destination, stale));
}
for (const name of covers) {
  const input = path.join(source, name);
  const output = path.join(destination, `${path.parse(name).name}.jpg`);
  const [width, height] = dimensions(input);
  // Scale so the image covers the tile, then crop the centre.
  const scale = Math.max(WIDTH / width, HEIGHT / height);
  execFileSync("sips", ["--resampleHeightWidth", String(Math.max(HEIGHT, Math.round(height * scale))),
    String(Math.max(WIDTH, Math.round(width * scale))), "--cropToHeightWidth", String(HEIGHT), String(WIDTH),
    "-s", "format", "jpeg", "-s", "formatOptions", "70", input, "--out", output], { stdio: "ignore" });
}
console.log(`Generated ${covers.length} cover thumbnails in ${path.relative(root, destination)}`);
