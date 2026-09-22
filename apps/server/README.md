# Mains Server

The standalone Mains backend and browser UI. This app owns the Node entrypoint,
CLI, distributable npm archive, and server release checks; it never imports
Electron.

Install a packaged release once, then use the product CLI without npm's
argument separator:

```bash
npm install --global ./dist/mains-server.tgz
mains serve --lan --port 8787
```

The commands below are the source-development equivalents and rebuild before
starting.

```bash
npm --prefix ../desktop install
npm install
npm run serve -- --lan --port 8787
```

`--lan` listens on the machine's private network interfaces. On startup the
server prints a five-minute, single-use `mains://pair` link and a terminal QR
code. Scan it in the mobile app; the phone receives its own revocable device
token, so the full-access owner token never needs to leave the server machine.

Create another link or manage paired phones while the server keeps running:

```bash
npm run pair
npm run auth -- list
npm run auth -- revoke <device-id>
```

The server uses the existing Mains user-data directory by default, including
the same `mains.db`, workspaces, collections, and run history as the installed
desktop app. No import is required. Quit Mains Desktop before starting Mains
Server; quit Mains Server before reopening Desktop. A database ownership lock
rejects a second backend before it can open SQLite.

`--data-dir` remains available for tests or an intentionally isolated backend.
Existing Electron-encrypted integration credentials are preserved in the
shared database, but the plain-Node host cannot decrypt them. Reauthorizing an
integration in Mains Server creates a separate `MNS1` credential for Server;
it does not replace or deactivate Desktop's `safeStorage` credential. Desktop
reauthorization likewise leaves Server's credential intact. CLI-backed providers
use their normal host authentication.

For access away from the LAN, prefer Tailscale HTTPS:

```bash
npm run serve -- --tailscale-serve
```

Install the packaged/source server as a macOS LaunchAgent or Linux systemd user
service so Electron and the terminal can both stay closed:

```bash
npm run service -- install --tailscale-serve
npm run service -- status
npm run service -- restart
npm run service -- uninstall
```

Use `--lan` instead of `--tailscale-serve` for a trusted local network. Service
uninstall keeps the database, owner token, and logs. Do not configure the
background service to run while Mains Desktop is in use.

Build and verify the installable archive:

```bash
npm run package
npm run smoke:package
```

`npm run serve` and `npm run package` also build the web client in `../desktop`,
so the desktop dependencies must be installed when using either command from a
source checkout.

The executable host lives here; the shared implementation lives in
`packages/backend` and is consumed through `@mains/backend`. The backend package
has an ESLint guard against Electron imports, and this app's Vite build also
treats any reachable Electron import as a hard failure.

The generated owner token is stored mode `0600` in the server data directory.
It grants full backend access and authenticates local CLI administration. Pairing
links are separate, expire after five minutes, and may be redeemed only once.
