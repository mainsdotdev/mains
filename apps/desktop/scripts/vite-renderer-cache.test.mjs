import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createServer, resolveConfig } from 'vite';

const desktop = path.resolve(import.meta.dirname, '..');

test('a separate Vite preview cannot invalidate the running renderer terminal imports', { timeout: 30_000 }, async () => {
  const data = path.join(desktop, '.data');
  await mkdir(data, { recursive: true });
  const fixture = await mkdtemp(path.join(data, 'vite-cache-test-'));
  const servers = [];
  try {
    const rendererRoot = path.join(fixture, 'renderer');
    const previewRoot = path.join(fixture, 'preview');
    for (const root of [rendererRoot, previewRoot]) await mkdir(root);
    await writeFile(path.join(rendererRoot, 'entry.js'), 'import { Terminal } from "@xterm/xterm"; export { Terminal };');
    await writeFile(path.join(previewRoot, 'entry.js'), 'import React from "react"; export { React };');

    const renderer = await resolveConfig({
      configFile: path.join(desktop, 'vite.renderer.config.mjs'),
      logLevel: 'silent',
    }, 'serve');
    const preview = await resolveConfig({ configFile: false, root: previewRoot, logLevel: 'silent' }, 'serve');

    // Preserve the real configurations' cache sharing, but run the experiment
    // entirely in temporary directories, away from the user's live cache.
    const caches = new Map();
    function isolatedCache(cacheDir) {
      if (!caches.has(cacheDir)) caches.set(cacheDir, path.join(fixture, `cache-${caches.size}`));
      return caches.get(cacheDir);
    }
    async function start(root, cacheDir, include) {
      const server = await createServer({
        configFile: false,
        root,
        publicDir: false,
        cacheDir: isolatedCache(cacheDir),
        logLevel: 'silent',
        optimizeDeps: { include, noDiscovery: true, force: true },
        server: { host: '127.0.0.1', port: 0, preTransformRequests: false },
      });
      servers.push(server);
      await server.listen();
      const address = server.httpServer.address();
      return `http://127.0.0.1:${address.port}`;
    }
    async function modulePath(origin, name) {
      const response = await fetch(`${origin}/entry.js`);
      assert.equal(response.status, 200);
      const source = await response.text();
      const module = [...source.matchAll(/from\s*["']([^"']+)["']/g)]
        .map((match) => match[1]).find((entry) => entry.includes(`/${name}.js`));
      assert.ok(module, `${name} must use Vite's optimized dependency`);
      return new URL(module, origin);
    }

    const appOrigin = await start(rendererRoot, renderer.cacheDir, ['@xterm/xterm', '@xterm/addon-fit']);
    const terminalUrl = await modulePath(appOrigin, '@xterm_xterm');
    // Match the first lazy terminal opening: the dependency is prebuilt, but
    // has not yet been requested/cached in the running server's transform map.
    await access(path.join(caches.get(renderer.cacheDir), 'deps', '@xterm_xterm.js'));

    const previewOrigin = await start(previewRoot, preview.cacheDir, ['react']);
    const reactUrl = await modulePath(previewOrigin, 'react');
    const previewResponse = await fetch(reactUrl);
    assert.equal(previewResponse.status, 200);
    await previewResponse.text();

    const after = await fetch(terminalUrl);
    await after.text();
    assert.equal(after.status, 200, 'starting a preview must not turn an existing terminal import into a 504');
  } finally {
    await Promise.allSettled(servers.map((server) => server.close()));
    await rm(fixture, { recursive: true, force: true });
  }
});
