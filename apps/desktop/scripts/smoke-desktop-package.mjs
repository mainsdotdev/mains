import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const executable = process.argv[2] ?? (process.platform === 'win32'
  ? path.resolve('out/Mains-win32-x64/Mains.exe')
  : path.resolve(`out/Mains-darwin-${process.arch}/Mains.app/Contents/MacOS/Mains`));
assert(existsSync(executable), `Package the app first: ${executable}`);
const directory = mkdtempSync(path.join(os.tmpdir(), 'Mains Türkçe package smoke '));
const resultFile = path.join(directory, 'result.json');
const env = { ...process.env, MAINS_SMOKE_USER_DATA: directory, MAINS_SMOKE_RESULT: resultFile };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, ['--smoke-test'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let output = '';
child.stdout.on('data', chunk => { output = (output + chunk).slice(-16_000); });
child.stderr.on('data', chunk => { output = (output + chunk).slice(-16_000); });
const timeout = setTimeout(() => { child.kill(); }, 120_000);
try {
  const [code] = await once(child, 'close');
  const result = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : null;
  assert.equal(code, 0, `Packaged app exited ${code}: ${result?.error ?? output}`);
  assert(result?.success, `Package smoke failed: ${result?.error ?? output}`);
  console.log(`Package smoke passed (${result.platform}-${result.arch}): SQLite, Git init/clone, PTY, providers, search, preload, renderer.`);
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null) child.kill();
  rmSync(directory, { recursive: true, force: true });
}
