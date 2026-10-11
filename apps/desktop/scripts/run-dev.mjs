import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mode = process.argv[2] ?? 'start';
if (!['start', 'serve', 'tailscale'].includes(mode)) throw new Error('Unknown desktop start mode');
const args = [require.resolve('@electron-forge/cli/dist/electron-forge.js'), 'start', ...process.argv.slice(3)];
const env = { ...process.env };
if (mode !== 'start') env.MAINS_SERVE = '1';
if (mode === 'tailscale') env.MAINS_TAILSCALE_SERVE = '1';
// GUI development can exhaust macOS's low descriptor limit. Keep that setup
// on macOS and pass the executable/arguments separately on every platform.
const child = process.platform === 'darwin'
  ? spawn('/bin/sh', ['-c', 'ulimit -n 65536; exec "$@"', 'mains-dev', process.execPath, ...args], { env, stdio: 'inherit' })
  : spawn(process.execPath, args, { env, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
