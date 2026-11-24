# Mains Server

The standalone Mains backend and browser UI. This app owns the Node entrypoint,
CLI, distributable npm archive, and server release checks; it never imports
Electron.

Install a packaged release once, then use the product CLI without npm's
argument separator:

```bash
npm install --global ./dist/mains-server.tgz
mains serve --tailscale-serve --port 8787
```

The commands below are the source-development equivalents and rebuild before
starting.

```bash
npm --prefix ../desktop install
npm install
npm run serve -- --tailscale-serve --port 8787
```

Tailscale Serve provides a tailnet HTTPS endpoint. On startup the
server prints a five-minute, single-use `mains://pair` link and a terminal QR
code. Scan it in the mobile app; the phone receives its own revocable device
token, so the full-access owner token never needs to leave the server machine.

Create another link or manage paired phones while the server keeps running:

```bash
npm run pair
npm run web
npm run auth -- list
npm run auth -- revoke <device-id>
```

`mains web` (or `npm run web`) prints a five-minute, single-use browser login
link. Pass `--url https://your-browser-facing-origin` when the browser reaches
the server through an address that is not recorded in server state.

To sync this backend with another Mains backend, open Bridge in its
browser UI or run `mains bridge login --hub https://your-bridge-hub` while the
server stays running. Use `mains bridge status`, `mains bridge approve <id>
--code <matching-code>`, `mains bridge recover` and `mains bridge logout` for
headless management (`npm run bridge -- <action>` from a source checkout). Recovery secrets are read from stdin rather than command
arguments. `mains bridge projects` lists project scope; `mains bridge local-only
<project-id> --on|--off` changes it. `mains bridge sync-history` adds previously
excluded history, and `mains bridge sync` retries queued changes. Status includes
account storage usage and quota errors. Own data stays local on sign-out; unsent
edits survive optional synced-object removal. See [Bridge setup and key ceremonies](../bridge/README.md#sign-in-and-key-management-b7).

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

For direct LAN access, use `--lan --tls-cert <chain.pem> --tls-key <key.pem>`.
The certificate must be trusted by each client and cover the advertised IP, or use
`--public-url https://<certificate-hostname>:8787` for a matching DNS name.
Desktop reads the same paths from `MAINS_TLS_CERT` and `MAINS_TLS_KEY` when LAN access
is enabled. SSH and local CLI commands continue to use the loopback listener.
A proxy that terminates TLS can read Connect traffic. To keep contents private
from an intermediary, forward TCP through to the Mains TLS listener.
After upgrading a phone with only an old HTTP address, pair again over HTTPS.
Update both desktop and backend for owner-token connections.

Service uninstall keeps the database, owner token, and logs. Do not configure the
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
It grants full backend access and authenticates local CLI administration, but is
never placed in a browser URL or browser storage. Phone pairing links and browser
login links are separate credentials; both expire after five minutes and may be
redeemed only once. A browser exchanges its origin-bound `#login=` code for
random, eight-hour, HttpOnly, SameSite cookies used by the WebSocket and image
proxy. `mains serve` service logs and redirected startup output never contain a
browser login code.
