import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SourceTextModule } from "node:vm";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist-web");
const assetsDir = join(distDir, "assets");
const shouldBuild = !process.argv.includes("--no-build");
const shouldAssert = process.argv.includes("--assert");

// This is a startup budget, not a total-app budget: optional UI should live in
// async chunks and only the code needed to render the initial shell belongs in
// the HTML entry module. Keep the threshold comfortably above the measured
// optimized result so normal minifier drift does not make the gate flaky.
const ENTRY_BUDGET = {
  rawBytes: 2_500_000,
  gzipBytes: 760_000,
};

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function compileSamples(source, count = 20) {
  const samples = [];
  for (let i = 0; i < count + 3; i++) {
    const startedAt = performance.now();
    // Constructing a SourceTextModule parses and compiles the complete entry
    // without linking or executing browser-only imports. Unique identifiers
    // prevent filename-keyed reuse between samples.
    new SourceTextModule(source, { identifier: `renderer-entry-${i}.mjs` });
    const elapsed = performance.now() - startedAt;
    if (i >= 3) samples.push(elapsed);
  }
  return {
    medianMs: percentile(samples, 0.5),
  };
}

let buildMs = null;
if (shouldBuild) {
  const startedAt = performance.now();
  const result = spawnSync("npm", ["run", "build:web"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  buildMs = performance.now() - startedAt;
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

const html = readFileSync(join(distDir, "index.html"), "utf8");
const entryMatch = html.match(/<script[^>]+src="([^"]+\.js)"/);
if (!entryMatch) throw new Error("Could not locate the renderer entry module");

const entryFile = entryMatch[1].replace(/^\//, "");
const entryPath = join(distDir, entryFile);
const source = readFileSync(entryPath, "utf8");
const rawBytes = Buffer.byteLength(source);
const gzipBytes = gzipSync(source, { level: 9 }).byteLength;
const brotliBytes = brotliCompressSync(source, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}).byteLength;
const compile = compileSamples(source);

const map = JSON.parse(readFileSync(`${entryPath}.map`, "utf8"));
const mappedSources = map.sources.map((name, index) => ({
  name,
  bytes: Buffer.byteLength(map.sourcesContent?.[index] ?? ""),
}));
const sourceBytes = (pattern) =>
  mappedSources
    .filter(({ name }) => pattern.test(name))
    .reduce((total, item) => total + item.bytes, 0);

const asyncJsBytes = readdirSync(assetsDir)
  .filter((name) => name.endsWith(".js") && name !== entryFile.split("/").at(-1))
  .reduce((total, name) => total + statSync(join(assetsDir, name)).size, 0);

const measurements = {
  entry: entryFile,
  buildMs,
  rawBytes,
  gzipBytes,
  brotliBytes,
  compileMedianMs: compile.medianMs,
  asyncJsBytes,
  entrySourceBytes: {
    xterm: sourceBytes(/node_modules\/@xterm\//),
    pierreDiffs: sourceBytes(/node_modules\/@pierre\/diffs\//),
    shiki: sourceBytes(/node_modules\/(?:@shikijs|shiki)\//),
    onboarding: sourceBytes(/src\/renderer\/features\/onboarding\//),
  },
};

console.log("Renderer startup benchmark");
console.log(`  entry                 ${measurements.entry}`);
if (buildMs !== null) console.log(`  production build      ${buildMs.toFixed(1)} ms`);
console.log(`  entry raw             ${formatBytes(rawBytes)}`);
console.log(`  entry gzip            ${formatBytes(gzipBytes)}`);
console.log(`  entry brotli          ${formatBytes(brotliBytes)}`);
console.log(`  V8 compile median     ${compile.medianMs.toFixed(2)} ms`);
console.log(`  async JavaScript      ${formatBytes(asyncJsBytes)}`);
console.log("  optional source retained in entry map");
console.log(`    xterm               ${formatBytes(measurements.entrySourceBytes.xterm)}`);
console.log(`    @pierre/diffs       ${formatBytes(measurements.entrySourceBytes.pierreDiffs)}`);
console.log(`    Shiki               ${formatBytes(measurements.entrySourceBytes.shiki)}`);
console.log(`    onboarding          ${formatBytes(measurements.entrySourceBytes.onboarding)}`);
console.log(`BENCHMARK_JSON ${JSON.stringify(measurements)}`);

if (shouldAssert) {
  const failures = [];
  if (rawBytes > ENTRY_BUDGET.rawBytes) {
    failures.push(`raw entry ${formatBytes(rawBytes)} > ${formatBytes(ENTRY_BUDGET.rawBytes)}`);
  }
  if (gzipBytes > ENTRY_BUDGET.gzipBytes) {
    failures.push(`gzip entry ${formatBytes(gzipBytes)} > ${formatBytes(ENTRY_BUDGET.gzipBytes)}`);
  }
  if (failures.length > 0) {
    console.error(`Renderer startup budget failed: ${failures.join("; ")}`);
    process.exit(1);
  }
}
