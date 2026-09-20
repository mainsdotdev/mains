// Vite Renderer configuration for the Renderer Process
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf-8'));

//  https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
  // `@mains/contracts` is a live `file:` dependency shared with the mobile app.
  // Pre-bundling it makes additions to the channel map invisible to an already
  // running renderer, so new IPC endpoints can be invoked with an `undefined`
  // channel until Vite's dependency cache is rebuilt.
  optimizeDeps: {
    exclude: ['@mains/contracts'],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  root: path.resolve(import.meta.dirname, 'src/renderer'),
  build: {
    outDir: path.resolve(import.meta.dirname, '.vite/renderer'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src/renderer'),
      // Through the node_modules symlink, Vite serves the contracts source as a
      // dependency: `?v=<browserHash>` plus a year-long immutable cache header.
      // The hash ignores the file's content, so the renderer's HTTP cache keeps
      // the old channel map across restarts and a new channel reads as
      // `undefined`. Aliasing to the real path serves it as plain source.
      '@mains/contracts': path.resolve(import.meta.dirname, '../../packages/contracts/src'),
    },
  },
  css: {
    postcss: path.resolve(import.meta.dirname, 'postcss.config.js'),
  },
});
