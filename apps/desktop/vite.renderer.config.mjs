// Vite Renderer configuration for the Renderer Process
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf-8'));

//  https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
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
    },
  },
  css: {
    postcss: path.resolve(import.meta.dirname, 'postcss.config.js'),
  },
});
