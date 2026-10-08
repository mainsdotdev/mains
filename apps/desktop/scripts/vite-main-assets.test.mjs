import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'vite';
import mainConfig from '../vite.main.config.mjs';

async function verifyRuntimeAssets(command) {
  const originalCwd = process.cwd();
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'mains-build-assets-'));
  const desktop = path.join(fixture, 'apps/desktop');
  const output = path.join(desktop, '.vite/build');
  const write = (filename, content) => {
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, content);
  };
  let watcher;

  try {
    write(path.join(desktop, 'package.json'), '{}');
    const entry = path.join(desktop, 'entry.js');
    write(entry, 'module.exports = true;');
    const migrations = path.join(fixture, 'packages/backend/src/db/migrations');
    write(path.join(migrations, '0000_initial.sql'), 'SELECT 1;');
    write(path.join(migrations, 'meta/_journal.json'), '{"entries":[]}');

    // Small packages exercise the actual copy hooks without copying installed
    // SDK binaries or touching the development app's build or database.
    for (const name of [
      '@blocknote/server-util', 'y-prosemirror', 'converter-dependency',
      'better-sqlite3', 'node-addon-api', 'node-pty', 'vscode-jsonrpc', 'zod', 'ws',
      '@anthropic-ai/claude-agent-sdk', '@github/copilot-sdk', '@github/copilot', '@vscode/ripgrep',
    ]) {
      const directory = path.join(desktop, 'node_modules', name);
      write(path.join(directory, 'package.json'), JSON.stringify({
        name,
        main: 'index.js',
        ...(name === '@blocknote/server-util' ? { dependencies: { 'converter-dependency': '*' } } : {}),
      }));
      write(path.join(directory, 'index.js'), 'module.exports = {};');
    }

    process.chdir(desktop);
    const ready = Promise.withResolvers();
    const copiesComplete = Promise.withResolvers();
    const requiredAssets = [
      'main.js',
      'db/migrations/0000_initial.sql',
      'db/migrations/meta/_journal.json',
      ...['better-sqlite3', 'node-pty', 'ws', '@blocknote/server-util', 'converter-dependency', '@github/copilot-sdk']
        .map(name => `node_modules/${name}/index.js`),
    ];

    const result = await build({
      configFile: false,
      root: desktop,
      logLevel: 'silent',
      build: {
        watch: command === 'serve' ? {} : null,
        outDir: output,
        lib: { entry, formats: ['cjs'], fileName: () => 'main.js' },
      },
      plugins: [
        // Forge prepends this hook and starts Electron as soon as it resolves.
        {
          name: '@electron-forge/plugin-vite:build-done',
          closeBundle() {
            ready.resolve(requiredAssets.filter(asset => !existsSync(path.join(output, asset))));
          },
        },
        ...mainConfig({ command }).plugins,
        { name: 'test-copies-complete', closeBundle() { copiesComplete.resolve(); } },
      ],
    });
    if (command === 'serve') {
      watcher = result;
      watcher.on('event', event => {
        if (event.code === 'ERROR') {
          ready.reject(event.error);
          copiesComplete.reject(event.error);
        }
      });
    }
    const [missingAtLaunch] = await Promise.all([ready.promise, copiesComplete.promise]);
    assert.deepEqual(missingAtLaunch, [], 'Forge must not launch Electron before its runtime assets are copied');
  } finally {
    await watcher?.close();
    process.chdir(originalCwd);
    rmSync(fixture, { recursive: true, force: true });
  }
}

for (const command of ['serve', 'build']) {
  const name = command === 'serve' ? 'watched development' : 'production';
  test(`runtime assets exist when Forge releases the ${name} build`, { timeout: 20_000 }, () => verifyRuntimeAssets(command));
}
