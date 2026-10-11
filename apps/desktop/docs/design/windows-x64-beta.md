# Windows x64 beta

Base: local `v0.18` branch at `d0dbb194abe219ef808820ca47542eef60971dd2`.
Implementation branch: `codex/windows-x64-beta`. The base still declares package
version `0.17.0`; branching does not bump the version or create a release tag.

## Build and distribution

Build on a native Windows x64 runner (`windows-2022`, Node 24), with separate
dependency installs in `packages/backend` and `apps/desktop`. The workflow
`.github/workflows/windows-beta.yml` runs on this branch, relevant PRs, or manual
dispatch. It uploads `Mains-<version>-win32-x64-Setup.exe`, the Squirrel `.nupkg`
and `RELEASES` as one artifact. It does not publish a GitHub release.
If packaging succeeds but a later check fails, the artifact is named
`Mains-windows-x64-diagnostic-<sha>`; the run stays failed.

The Forge Windows maker uses Squirrel. The installer is unsigned for the beta;
an Authenticode certificate and a validated update feed are later release work.
Windows and preview builds use manual installer upgrades. Stable macOS builds
keep their public update service and Apple signing/notarization configuration.
Use the existing `-preview.N` version convention when cutting a preview; update
both desktop and server versions together through the repository release flow.

Vite copies the Windows x64 Claude SDK, Copilot SDK runtime, Copilot login CLI
and ripgrep packages into `.vite/build/node_modules`. ASAR keeps executable,
DLL and native module assets outside the archive. The native rebuild hook uses
the target architecture. The Windows icon reuses the existing iconset:
`npm run icons:windows`.

## Runtime adaptations

- Windows startup uses the PNG window icon without macOS preferences APIs.
  The Applications-folder move offer checks the OS before reading macOS-only
  Electron APIs.
  Native window borders remain on Windows. The preload exposes the local OS;
  capabilities distinguish desktop support from macOS-only features.
- Default shortcuts use Ctrl/Alt on Windows. Recorded custom bindings retain
  their exact meaning. OS-reserved shortcuts and conflict detection use the
  local OS, and key labels use Ctrl/Alt/Shift instead of Mac symbols.
- Provider sessions, discovery and one-shot commands share the same PATH.
  Windows PATHs use semicolons, include npm/Node/user CLI directories and avoid
  duplicate PATH keys. `cross-spawn` handles Windows `.cmd` launchers. Provider
  shutdown and timeouts terminate Windows process trees.
  Cursor discovery also checks `%LOCALAPPDATA%/cursor-agent` when a recently
  installed CLI is missing from the app's inherited PATH.
- Provider sign-in uses PowerShell's call operator and quoting. Windows has a
  basic PowerShell PTY. POSIX server inspection and zsh-based automatic idle
  cleanup are disabled; terminal tabs remain until explicitly stopped.
- MCP stdio bridges use a session-specific Windows named pipe and token.
  They use real Node.js, never an Electron RunAsNode fallback. Install Node.js
  and restart Mains for MCP tools (Cursor tools and Codex voice coordination).
- Renderer file handling accepts native Windows, UNC and POSIX backend paths,
  regardless of the client's OS. Local images keep their signed load path;
  network images, including UNC shares, keep explicit click-to-load. File URLs
  decode through native URL handling in the backend. Git write identities stay repository-relative
  with forward slashes, including outside-tree/different-drive rejection.
- Lens, Dock icon customization and macOS Open With integration are hidden on
  Windows. Tray icons use the color app icon, notifications open the requesting
  chat, and the Squirrel AppUserModelID is registered.

## Automated checks

Windows CI checks lint/types, build asset copying, keyboard and document UI,
native provider discovery/probes, literal CLI argv and process-tree cleanup,
real PowerShell invocation, MCP stdio/named-pipe isolation, Git behavior and
deliverable projection. The existing Linux suites remain the full regression
checks; the Windows job intentionally selects portable and Windows-specific
suites rather than executing Unix shell-fixture tests on Windows.

`npm run smoke:package` launches the packaged binary with isolated user data and
checks normal app initialization, SQLite's Electron ABI, PowerShell/node-pty,
the bundled Claude and Copilot runtime, ripgrep, preload and renderer mounting.
This check uses the app's normal Electron entry with its shipped fuses and ASAR.
No model prompt or release publication is performed.

Local verification on macOS arm64 (2026-10-11): full desktop and backend
regressions passed over 5,600 tests, with lint/types and build asset checks
passing. Final affected suites also passed after the path and process changes.
The packaged macOS app passed the native startup smoke check. Windows-specific
tests are retained for the native CI job and were skipped on macOS.

Native Windows x64 verification (2026-10-11), commit
`65856fc251a6925f94403a27d0b03862a2d3c4f9`: [CI run, successful second
attempt](https://github.com/mainsdotdev/mains/actions/runs/38169192515).
Lint/types, build asset checks, 239 tests and the packaged application smoke
passed; five macOS-only tests were skipped. The Squirrel installer and update
assets are retained for 14 days. The first attempt hit a transient Electron
download failure; rerunning the same commit passed.

The native run also exposed and verified fixes for Git's Windows root spelling
and the macOS Applications-folder API being read during Windows startup. Test
fixtures now use native canonical paths and a Windows-valid literal glob
filename.

Parallels verification (2026-10-11): Windows 11 Pro `10.0.26300`, ARM64,
Parallels Desktop `27.0.3 (58680)`, 4 vCPUs and 6 GB RAM. Node.js
`24.21.0` x64 and Git `2.56.0.windows.2` x64 were installed in the guest.
The installer exited successfully and the installed app at
`%LOCALAPPDATA%\Mains\app-0.17.0\Mains.exe` passed the same packaged smoke
under x64 emulation. Normal launch displayed the Windows onboarding window
with native borders and the Mains taskbar icon.

Installer SHA-256:
`8c7912504f16c14fc6f69acd6d6cbb7342804ceba579b639d6ac638053e16de9`.
The local installer is retained under
`out/windows-beta/65856fc2/Mains-0.17.0-win32-x64-Setup.exe` and a copy is in
the guest's `%USERPROFILE%\mains-beta-test` directory. The fixture repo is
`%USERPROFILE%\mains-beta-test\Türkçe Proje`.

## Manual beta acceptance

After the Windows workflow succeeds, test the installer in a clean Windows 11
x64 VM or machine. CI cannot verify interactive installer and authenticated
provider behavior by itself.

On an Apple Silicon Mac, Parallels installs Windows 11 ARM. Run the same x64
installer through Windows emulation and install x64 Node.js and Git for the
test environment. Keep repos on the guest's local disk, including a path with
spaces and Turkish characters. Native Windows CI covers x64 execution;
Parallels covers x64 emulation and interactive Windows 11 behavior.

1. Install, launch, complete onboarding, close and reopen; confirm state persists.
2. Sign into enabled providers; start, continue, stop and restart a conversation.
3. Open/clone a repository and create a worktree under a path with spaces and
   Turkish characters. Check Git diff, branch switch, discard and turn undo.
4. Open PowerShell, execute a long-running command, switch tabs, then explicitly
   stop it. Confirm provider/terminal child processes do not survive app exit.
5. Open files and Windows file links, relative document images and delivered
   PDFs/Office files; confirm remote images require approval to load.
6. Test tray and notification click-to-open, Ctrl shortcuts and a manual upgrade
   over the previous installer without losing the database.

The native Windows build, packaged smoke and installed Parallels smoke passed.
Interactive onboarding completion, repo/file/shortcut flows, authenticated
provider conversations, tray notifications and upgrades from a previous
Windows installer remain manual acceptance work. The ARM guest does not add
a native Windows 11 x64 hardware result; the native x64 runtime result is from
the `windows-2022` CI runner.

## References

- [Forge Squirrel maker](https://www.electronforge.io/config/makers/squirrel.windows)
- [Node-PTY Windows prerequisites](https://github.com/microsoft/node-pty#dependencies)
- [Windows runner toolchain](https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md)
- [Node IPC endpoints](https://nodejs.org/api/net.html#ipc-support)
- [Cursor's Windows installer](https://cursor.com/install?win32=true)
- [Public updater release handling](https://github.com/electron/update-electron-app#how-does-this-module-handle-github-release-states)
