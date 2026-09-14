require('dotenv').config({ path: '.env.local' });
const { version } = require('./package.json');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');

module.exports = {
  hooks: {
    packageAfterPrune: async (_forgeConfig, buildPath, electronVersion, platform, arch) => {
      const { rebuild } = require('@electron/rebuild');
      const path = require('path');

      // `arch` must come from the hook args, not process.arch: CI cross-builds
      // x64 on arm64 runners, where process.arch would target the wrong CPU.
      await rebuild({ buildPath, electronVersion, arch, force: true });

      // Rebuild native modules inside .vite/build/node_modules
      // (Vite copies pre-built modules from project node_modules which target
      // the system Node.js, not Electron)
      const fs = require('fs');
      const viteBuildPath = path.join(buildPath, '.vite', 'build');
      const vitePkgJson = path.join(viteBuildPath, 'package.json');
      fs.writeFileSync(vitePkgJson, JSON.stringify({
        dependencies: {
          'better-sqlite3': '*',
          'node-pty': '*',
        }
      }));
      console.log('Rebuilding native modules in .vite/build/node_modules...');
      await rebuild({ buildPath: viteBuildPath, electronVersion, arch, force: true });
      fs.unlinkSync(vitePkgJson);

      console.log('Native modules rebuilt successfully');

      // Strip prebuilt binaries for other platforms to reduce bundle size
      const targetPlatform = `${platform}-${arch}`;
      console.log(`Stripping non-${targetPlatform} binaries...`);

      const viteNodeModules = path.join(buildPath, '.vite', 'build', 'node_modules');
      let totalSaved = 0;

      const stripDirs = [
        // node-pty prebuilds (~58 MB on darwin-arm64)
        path.join(viteNodeModules, 'node-pty', 'prebuilds'),
        // @github/copilot prebuilds (~24 MB)
        path.join(viteNodeModules, '@github', 'copilot', 'prebuilds'),
        // @github/copilot ripgrep binaries (~20 MB)
        path.join(viteNodeModules, '@github', 'copilot', 'ripgrep', 'bin'),
      ];

      const getDirSize = (dir) => {
        let size = 0;
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
            if (entry.isFile()) {
              try { size += fs.statSync(path.join(entry.parentPath || entry.path, entry.name)).size; } catch {}
            }
          }
        } catch {}
        return size;
      };

      for (const parentDir of stripDirs) {
        if (!fs.existsSync(parentDir)) continue;
        for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name !== targetPlatform) {
            const fullPath = path.join(parentDir, entry.name);
            const size = getDirSize(fullPath);
            fs.rmSync(fullPath, { recursive: true, force: true });
            totalSaved += size;
            console.log(`  ✓ Removed ${path.relative(viteNodeModules, fullPath)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
          }
        }
      }

      // Strip stale per-arch build outputs (bin/<platform>-<arch>-<abi>) that
      // were copied from project node_modules — prior local builds for another
      // arch leave their binaries behind (e.g. bin/darwin-arm64-145 in an x64 build).
      for (const mod of ['node-pty', 'better-sqlite3']) {
        const binDir = path.join(viteNodeModules, mod, 'bin');
        if (!fs.existsSync(binDir)) continue;
        for (const entry of fs.readdirSync(binDir, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith(`${targetPlatform}-`)) {
            const fullPath = path.join(binDir, entry.name);
            const size = getDirSize(fullPath);
            fs.rmSync(fullPath, { recursive: true, force: true });
            totalSaved += size;
            console.log(`  ✓ Removed ${path.relative(viteNodeModules, fullPath)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
          }
        }
      }

      // Strip the copilot native-binary packages for other platforms/arches
      // (vite copies every @github/copilot-<platform>-<arch> package present;
      // only the target one should ship). Careful: @github/copilot-sdk also
      // lives under @github and must survive.
      const githubScope = path.join(viteNodeModules, '@github');
      if (fs.existsSync(githubScope)) {
        for (const entry of fs.readdirSync(githubScope, { withFileTypes: true })) {
          const isNativeBinaryPkg = /^copilot-(darwin|linux|linuxmusl|win32)-/.test(entry.name);
          if (entry.isDirectory() && isNativeBinaryPkg && entry.name !== `copilot-${targetPlatform}`) {
            const fullPath = path.join(githubScope, entry.name);
            const size = getDirSize(fullPath);
            fs.rmSync(fullPath, { recursive: true, force: true });
            totalSaved += size;
            console.log(`  ✓ Removed ${path.relative(viteNodeModules, fullPath)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
          }
        }
      }

      // @github/copilot ships a MediaRemoteAdapter.framework (macOS "now
      // playing" integration) whose bundle seal — _CodeSignature/CodeResources
      // — does not survive npm packaging, so notarization rejects it:
      // "The signature of the binary is invalid." Re-signing the inner binary
      // cannot restore a bundle seal, and the CLI feature-detects the adapter
      // (no mediaremote-adapter.pl on disk = the integration stays off), so the
      // fix is to not ship it.
      if (fs.existsSync(githubScope)) {
        for (const entry of fs.readdirSync(githubScope, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const adapterDir = path.join(
            githubScope, entry.name, 'prebuilds', targetPlatform, 'mediaremote-adapter',
          );
          if (!fs.existsSync(adapterDir)) continue;
          const size = getDirSize(adapterDir);
          fs.rmSync(adapterDir, { recursive: true, force: true });
          totalSaved += size;
          console.log(`  ✓ Removed ${path.relative(viteNodeModules, adapterDir)} (${(size / 1024).toFixed(0)} KB)`);
        }
      }

      // Keep only the Claude Agent SDK native binary for the target arch.
      const anthropicScope = path.join(viteNodeModules, '@anthropic-ai');
      if (fs.existsSync(anthropicScope)) {
        for (const entry of fs.readdirSync(anthropicScope, { withFileTypes: true })) {
          const isNativeBinaryPkg =
            /^claude-agent-sdk-(darwin|linux|linuxmusl|win32)-/.test(entry.name);
          const targetPkg = `claude-agent-sdk-${platform}-${arch}`;
          if (entry.isDirectory() && isNativeBinaryPkg && entry.name !== targetPkg) {
            const fullPath = path.join(anthropicScope, entry.name);
            const size = getDirSize(fullPath);
            fs.rmSync(fullPath, { recursive: true, force: true });
            totalSaved += size;
            console.log(`  ✓ Removed ${path.relative(viteNodeModules, fullPath)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
          }
        }
      }

      // Strip node-pty source/build artifacts not needed at runtime
      const ptyExtras = ['third_party', 'deps', 'src', 'scripts', 'node-addon-api'].map(
        d => path.join(viteNodeModules, 'node-pty', d)
      );
      for (const dir of ptyExtras) {
        if (fs.existsSync(dir)) {
          const size = getDirSize(dir);
          fs.rmSync(dir, { recursive: true, force: true });
          totalSaved += size;
          console.log(`  ✓ Removed node-pty/${path.basename(dir)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
        }
      }

      console.log(`Total saved: ${(totalSaved / 1024 / 1024).toFixed(1)} MB`);
    },
  },
  packagerConfig: {
    name: 'Mains',
    // No executableName override: @electron/packager uses it verbatim as
    // CFBundleDisplayName (Dock, ⌘-Tab, menu bar, TCC dialogs), so a
    // lowercase binary name leaks into every user-visible surface. Leaving
    // it unset derives both the executable and display name from `name`.
    appBundleId: 'dev.mains.app',
    // TCC: Apple Events (kTCCServiceAppleEvents), screen capture (kTCCServiceScreenCapture).
    extendInfo: {
      NSAppleEventsUsageDescription:
        'Mains needs permission to send Apple events to control other apps for desktop automation.',
      NSScreenCaptureUsageDescription:
        'Mains may capture the screen when you use features or connected tools that need a visual of your desktop.',
    },
    asar: {
      unpack: '{**/*.node,**/claude,**/copilot,**/spawn-helper,**/rg,**/*.wasm}',
      unpackDir: '.vite/build/node_modules/{node-pty,@github/copilot-darwin-arm64,@github/copilot-darwin-x64,@github/copilot/prebuilds,@github/copilot/ripgrep,@anthropic-ai/claude-agent-sdk-darwin-arm64,@anthropic-ai/claude-agent-sdk-darwin-x64}',
    },
    icon: 'src/renderer/public/icon',
    extraResource: [
      'src/main/db/migrations',
      'src/renderer/public/icon.png',
      // Menu-bar icon: both representations, so the packaged app resolves them
      // from `resourcesPath` instead of falling through to the renderer build.
      'src/renderer/public/menu-iconTemplate.png',
      'src/renderer/public/menu-iconTemplate@2x.png',
      'THIRD-PARTY-NOTICES.txt',
    ],
    ...((() => {
      const hasSigningVars = process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID;
      const isRelease = process.env.CI || process.env.RELEASE;

      if (isRelease && !hasSigningVars) {
        throw new Error('Release build requires APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID for code signing');
      }
      if (!hasSigningVars) {
        console.warn('⚠ Skipping code signing — APPLE_ID not set (local dev build)');
        return {};
      }
      return {
        osxSign: {
          // @electron/packager defaults osx-sign to `continueOnError: true`, so
          // a signing failure is downgraded to a warning and the build limps on
          // to notarization — which then dies on the unsigned app with the
          // misleading "code has no resources but signature indicates they must
          // be present". Fail at the step that actually broke instead.
          continueOnError: false,
          // Signing cert comes from the env so forks/CI aren't tied to one
          // person's certificate. When unset, osx-sign auto-discovers the
          // Developer ID identity in the keychain.
          ...(process.env.APPLE_SIGNING_IDENTITY
            ? { identity: process.env.APPLE_SIGNING_IDENTITY, identityValidation: false }
            : {}),
          optionsForFile: () => ({
            hardenedRuntime: true,
            entitlements: 'entitlements.plist',
            'entitlements-inherit': 'entitlements.plist',
          }),
        },
        osxNotarize: {
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_PASSWORD,
          teamId: process.env.APPLE_TEAM_ID,
        },
      };
    })()),
  },
  rebuildConfig: {
    force: true,
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        title: 'Install Mains',
        format: 'UDZO',
        background: 'src/renderer/public/dmg-background-v4.png',
        icon: 'src/renderer/public/icon.icns',
        iconSize: 112,
        contents: (opts) => [
          { x: 160, y: 200, type: 'file', path: opts.appPath },
          { x: 500, y: 200, type: 'link', path: '/Applications' },
        ],
        additionalDMGOptions: {
          'background-color': '#faf7f3',
          window: { size: { width: 660, height: 400 } },
        },
      },
    },
  ],
  publishers: [
    {
      // Release flow: tag push → CI builds + uploads assets to a DRAFT release.
      // Auto-updater (update.electronjs.org) only sees PUBLISHED, non-prerelease
      // releases, so after CI finishes you must manually click "Publish release"
      // on GitHub. Preview builds go out as prereleases, which keeps them out of
      // the auto-updater's sight — preview users install the DMG by hand.
      // Repo must be public for ElectronPublicUpdateService to read it.
      name: '@electron-forge/publisher-github',
      config: {
        repository: { owner: 'mainsdotdev', name: 'mains' },
        prerelease: version.includes('-preview.'),
        draft: true,
      },
    },
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    {
      name: '@electron-forge/plugin-vite',
      config: {
        // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
        // If you are familiar with Vite configuration, it will look really familiar.
        build: [
          {
            // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
            entry: 'src/main/index.ts',
            config: 'vite.main.config.mjs',
            target: 'main',
          },
          {
            entry: 'src/preload/index.ts',
            config: 'vite.preload.config.mjs',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'renderer',
            config: 'vite.renderer.config.mjs',
          },
        ],
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
