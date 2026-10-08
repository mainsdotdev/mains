// Vite Main Process configuration
import { defineConfig } from 'vite';
import path from 'path';
import { copyFileSync, mkdirSync, readdirSync, existsSync, cpSync } from 'fs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// JSDOM resolves its worker file at runtime. Keep the server converter as real
// packages rather than flattening it into main.js, including nested versions.
function copyPageConverterDependencies(destinationRoot) {
  const sourceRoot = path.resolve('node_modules');
  const visited = new Set();
  function copyPackage(name, fromFile, optional = false) {
    const require = createRequire(fromFile);
    let entry;
    try { entry = require.resolve(`${name}/package.json`); }
    catch {
      try { entry = require.resolve(name); }
      catch {
        // Packages such as @tiptap/pm export only subpaths, so neither their
        // root nor package.json is resolvable through the exports map.
        entry = (require.resolve.paths(name) ?? []).map(root => path.join(root, name, 'package.json'))
          .find(manifest => existsSync(manifest));
        if (!entry) {
          if (optional) return;
          throw new Error(`Missing Page converter dependency: ${name}`);
        }
      }
    }
    let directory = path.dirname(entry);
    while (directory.startsWith(sourceRoot)) {
      const manifest = path.join(directory, 'package.json');
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        if (pkg.name === name) {
          if (visited.has(directory)) return;
          visited.add(directory);
          const destination = path.join(destinationRoot, path.relative(sourceRoot, directory));
          mkdirSync(path.dirname(destination), { recursive: true });
          cpSync(directory, destination, { recursive: true });
          for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }))
            copyPackage(dependency, manifest, !pkg.dependencies?.[dependency] && !!pkg.peerDependenciesMeta?.[dependency]?.optional);
          return;
        }
      }
      const parent = path.dirname(directory);
      if (parent === directory) return;
      directory = parent;
    }
  }
  for (const name of ['@blocknote/server-util', 'y-prosemirror'])
    copyPackage(name, path.resolve('package.json'));
}

// https://vitejs.dev/config
export default defineConfig(({ command }) => {
  return {
  // The GitHub OAuth device-flow client id is a *public* identifier (device
  // flow has no client secret), but it has to travel with the bundle: every
  // other MAINS_* env var in the main process is read at runtime on the user's
  // machine, and a released app has no build-time environment to read from.
  // Baking it here is what turns the repo/CI secret into a working sign-in
  // button. Unset at build time it collapses to "", and the device-flow module
  // reports sign-in as unconfigured while the paste-a-token tab keeps working.
  define: {
    'process.env.MAINS_GITHUB_CLIENT_ID': JSON.stringify(
      process.env.MAINS_GITHUB_CLIENT_ID ?? '',
    ),
  },
  resolve: {
    // Some libs that can run in both Web and Node.js environments are shipped with both ESM and CJS, and make use of Node.js compatible modules.
    // In order to handle these modules, Electron needs to tell Vite to build for Node.js environments.
    // This is a workaround to avoid issues with modules that are shipped with both ESM and CJS.
    browserField: false,
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
  build: {
    // Dev-only (`npm start`), so debugger breakpoints bind to the TS sources.
    sourcemap: command === 'serve',
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: [
        'electron',
        'better-sqlite3',
        'node-pty',
        // `ws` conditionally require()s its optional native deps (bufferutil,
        // utf-8-validate). Externalize so rollup doesn't try to resolve them at
        // build time; ws falls back to pure JS when they're absent at runtime.
        'ws',
        'bufferutil',
        'utf-8-validate',
        '@anthropic-ai/claude-agent-sdk',
        '@anthropic-ai/claude-agent-sdk-darwin-arm64',
        '@anthropic-ai/claude-agent-sdk-darwin-x64',
        '@github/copilot-sdk',
        '@github/copilot-sdk-darwin-arm64',
        '@github/copilot-sdk-darwin-x64',
        '@github/copilot',
        '@github/copilot-darwin-arm64',
        '@github/copilot-darwin-x64',
        // Content search's ripgrep: the package resolves its per-arch binary
        // package at runtime, so neither can be inlined into main.js.
        '@vscode/ripgrep',
        '@vscode/ripgrep-darwin-arm64',
        '@vscode/ripgrep-darwin-x64',
        'vscode-jsonrpc',
        'zod',
        '@blocknote/server-util',
      ],
    },
  },
  // Forge resolves its initial watched build in closeBundle. Runtime files
  // must be ready in writeBundle, before that hook can launch Electron.
  plugins: [
    {
      name: 'copy-native-modules',
      writeBundle() {
        const destNodeModules = '.vite/build/node_modules';
        mkdirSync(destNodeModules, { recursive: true });
        copyPageConverterDependencies(destNodeModules);

        // Native modules and their dependencies that must be available at runtime
        const modulesToCopy = [
          'better-sqlite3',
          'node-addon-api',
          'node-pty',
          'vscode-jsonrpc',
          'zod',
          'ws',
        ];

        // Scoped packages need their parent @scope directory created.
        // Both darwin variants of each binary package (copilot, claude, ripgrep)
        // are listed: npm only installs the host-arch one, and CI force-installs
        // the cross-build target's variant.
        // Whichever variants exist get copied; forge's packageAfterPrune hook
        // strips the non-target one from the final bundle.
        const scopedModulesToCopy = [
          '@anthropic-ai/claude-agent-sdk',
          '@anthropic-ai/claude-agent-sdk-darwin-arm64',
          '@anthropic-ai/claude-agent-sdk-darwin-x64',
          '@github/copilot-sdk',
          '@github/copilot-sdk-darwin-arm64',
          '@github/copilot-sdk-darwin-x64',
          '@github/copilot',
          '@github/copilot-darwin-arm64',
          '@github/copilot-darwin-x64',
          '@vscode/ripgrep',
          '@vscode/ripgrep-darwin-arm64',
          '@vscode/ripgrep-darwin-x64',
        ];

        for (const mod of modulesToCopy) {
          const src = path.join('node_modules', mod);
          const dest = path.join(destNodeModules, mod);
          if (existsSync(src)) {
            cpSync(src, dest, { recursive: true });
            console.log(`  ✓ Copied ${mod}`);
          } else {
            console.warn(`  ⚠ ${mod} not found, skipping`);
          }
        }

        for (const mod of scopedModulesToCopy) {
          const src = path.join('node_modules', mod);
          const scopeDir = path.join(destNodeModules, mod.split('/')[0]);
          const dest = path.join(destNodeModules, mod);
          if (existsSync(src)) {
            mkdirSync(scopeDir, { recursive: true });
            cpSync(src, dest, { recursive: true });
            console.log(`  ✓ Copied ${mod}`);
          } else {
            console.warn(`  ⚠ ${mod} not found, skipping`);
          }
        }
      }
    },
    {
      name: 'copy-migrations',
      writeBundle() {
        const srcDir = '../../packages/backend/src/db/migrations';
        const destDir = '.vite/build/db/migrations';

        if (existsSync(srcDir)) {
          mkdirSync(destDir, { recursive: true });
          const items = readdirSync(srcDir, { withFileTypes: true });

          items.forEach(item => {
            const srcPath = path.join(srcDir, item.name);
            const destPath = path.join(destDir, item.name);

            if (item.isDirectory()) {
              // Copy meta directory
              mkdirSync(destPath, { recursive: true });
              readdirSync(srcPath).forEach(metaFile => {
                copyFileSync(path.join(srcPath, metaFile), path.join(destPath, metaFile));
              });
            } else if (item.name.endsWith('.sql')) {
              // Copy SQL files
              copyFileSync(srcPath, destPath);
            }
          });
          console.log('✓ Migrations copied to build directory');
        }
      }
    }
  ],
};
});
