#!/usr/bin/env node
/**
 * Regenerates `../src/shapes.generated.ts` from the desktop app's icon
 * registry (`apps/desktop/src/renderer/lib/icon-registry.tsx`), so a space or project
 * icon picked on the Mac (`icon:rocket|pink`) draws the same glyph on every surface.
 *
 *   npm run generate   (in packages/icons; optional arg = path to the desktop app)
 *
 * The desktop icons are React SVG components; this pulls out each one's
 * `viewBox` and `<path>` data and emits plain objects for react-native-svg.
 * Until the two apps share a package, re-run it whenever the desktop registry
 * changes.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainsRoot = path.resolve(process.argv[2] ?? path.join(here, "..", "..", "..", "apps", "desktop"));
const iconsDir = path.join(mainsRoot, "src/renderer/components/ui/icons");
const registryFile = path.join(mainsRoot, "src/renderer/lib/icon-registry.tsx");
const outFile = path.join(here, "..", "src", "shapes.generated.ts");

/**
 * Icons whose desktop component is more than a plain `<svg><path/></svg>`.
 * - claude: the mark sits in a nested 100×100 svg.
 * - copilot: the registry points at an animated sprite; the phone takes the
 *   desktop's static mark (`CopilotStatic`, same one its settings use).
 * - cursor: two path variants for a flip animation; the first is the mark.
 * `fillRule` covers a rule set on the `<svg>` element rather than the path.
 */
const OVERRIDES = {
  claude: { viewBox: "0 0 100 100" },
  copilot: { source: { component: "CopilotStatic", fromSpace: false }, fillRule: "evenodd" },
  cursor: { viewBox: "0 0 24 24", pathLimit: 1, fillRule: "evenodd" },
};

const read = (file) => readFileSync(file, "utf8");

/** `export { default as Academy } from "./academy";` → Map(Academy → ./academy) */
function exportMap(indexFile) {
  const map = new Map();
  for (const m of read(indexFile).matchAll(/export \{ default as (\w+) \} from "([^"]+)"/g)) {
    map.set(m[1], m[2]);
  }
  return map;
}

const spaceExports = exportMap(path.join(iconsDir, "space/index.tsx"));
const rootExports = exportMap(path.join(iconsDir, "index.tsx"));

/** The `name: Icons.X` / `name: Codex` entries of `iconRegistry`, in order. */
function registryEntries() {
  const src = read(registryFile);
  const start = src.indexOf("export const iconRegistry");
  const end = src.indexOf("};", start);
  const block = src.slice(start, end);
  const entries = [];
  for (const m of block.matchAll(/^\s*([a-z0-9]+):\s*(?:Icons\.)?(\w+),/gm)) {
    entries.push({ name: m[1], component: m[2], fromSpace: m[0].includes("Icons.") });
  }
  return entries;
}

function componentFile(entry) {
  const map = entry.fromSpace ? spaceExports : rootExports;
  const rel = map.get(entry.component);
  if (!rel) throw new Error(`No export named ${entry.component} for icon "${entry.name}"`);
  return path.join(iconsDir, entry.fromSpace ? "space" : ".", `${rel}.tsx`);
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}

/** `style={{ fill: "currentColor", fillRule: "evenodd" }}` → { fill, fillRule } */
function styleAttrs(attrs) {
  const m = attrs.match(/style=\{\{([\s\S]*?)\}\}/);
  if (!m) return {};
  const out = {};
  for (const p of m[1].matchAll(/(\w+):\s*"([^"]*)"/g)) out[p[1]] = p[2];
  return out;
}

const KNOWN_ATTRS = new Set(["d", "fill", "fillRule", "clipRule", "style", "stroke", "strokeWidth"]);

function extractPaths(src, name) {
  const paths = [];
  for (const m of src.matchAll(/<path\b([\s\S]*?)\/?>/g)) {
    const attrs = m[1];
    for (const a of attrs.matchAll(/\b(\w+)=/g)) {
      if (!KNOWN_ATTRS.has(a[1])) console.warn(`  ${name}: ignoring <path ${a[1]}=…>`);
    }
    const style = styleAttrs(attrs);
    const d = attr(attrs, "d");
    if (!d) throw new Error(`${name}: <path> without d`);
    const fill = attr(attrs, "fill") ?? style.fill;
    if (fill && fill !== "currentColor") console.warn(`  ${name}: path fill "${fill}" will be tinted`);
    const p = { d: d.replace(/\s+/g, " ").trim() };
    const fillRule = attr(attrs, "fillRule") ?? style.fillRule;
    const clipRule = attr(attrs, "clipRule") ?? style.clipRule;
    if (fillRule) p.fillRule = fillRule;
    if (clipRule) p.clipRule = clipRule;
    paths.push(p);
  }
  return paths;
}

const shapes = [];
for (const entry of registryEntries()) {
  const override = OVERRIDES[entry.name] ?? {};
  const file = componentFile(override.source ? { ...entry, ...override.source } : entry);
  const src = read(file);
  const viewBoxes = [...src.matchAll(/viewBox="([^"]+)"/g)].map((m) => m[1]);
  const viewBox = override.viewBox ?? viewBoxes.at(-1);
  if (!viewBox) throw new Error(`${entry.name}: no viewBox in ${file}`);
  let paths = extractPaths(src, entry.name);
  if (override.pathLimit) paths = paths.slice(0, override.pathLimit);
  if (override.fillRule) paths = paths.map((p) => ({ fillRule: override.fillRule, ...p }));
  if (paths.length === 0) throw new Error(`${entry.name}: no paths in ${file}`);
  shapes.push({ name: entry.name, viewBox, paths });
}

const lines = [
  "// Generated by packages/icons/scripts/generate-shapes.mjs from",
  "// apps/desktop/src/renderer/lib/icon-registry.tsx — do not edit by hand.",
  "",
  'import type { IconShape } from "./registry";',
  "",
  "export const ICON_SHAPES: Record<string, IconShape> = {",
];
for (const shape of shapes) {
  lines.push(`  ${shape.name}: {`);
  lines.push(`    viewBox: ${JSON.stringify(shape.viewBox)},`);
  lines.push("    paths: [");
  for (const p of shape.paths) {
    const fields = [`d: ${JSON.stringify(p.d)}`];
    if (p.fillRule) fields.push(`fillRule: ${JSON.stringify(p.fillRule)}`);
    if (p.clipRule) fields.push(`clipRule: ${JSON.stringify(p.clipRule)}`);
    lines.push(`      { ${fields.join(", ")} },`);
  }
  lines.push("    ],");
  lines.push("  },");
}
lines.push("};");
lines.push("");

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n"));
console.log(`wrote ${shapes.length} icons to ${path.relative(process.cwd(), outFile)}`);
