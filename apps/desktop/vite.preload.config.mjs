// Vite Preload configuration for the Preload Process
import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ command }) => ({
  build: {
    // Dev-only (`npm start`), so debugger breakpoints bind to the TS sources.
    sourcemap: command === 'serve',
    lib: {
      entry: 'src/preload/index.ts',
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
}));
