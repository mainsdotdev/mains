# Mains Server

The standalone Mains backend and web UI, without Electron. It uses the existing
Mains data and exposes the same backend contract as the desktop app.

## Requirements

- Node.js 22.12 or newer
- macOS or Linux
- Git and any provider CLIs you use (`claude`, `codex`, `cursor-agent`, or `gh`)

## Install and run

Install the release asset directly:

```bash
npm install --global https://github.com/mainsdotdev/mains/releases/latest/download/mains-server.tgz
mains serve
```

The first run creates an owner token in the server data directory. It grants
full access and stays on the host; it is never placed in a browser URL or browser
storage. An interactive `mains serve`, or `mains web` on demand, prints a
five-minute, single-use browser login link. The browser exchanges that
origin-bound code for HttpOnly session cookies. The background service never
writes login codes to its logs. Phones continue to receive separate, revocable
device tokens by redeeming their own five-minute, single-use pairing links.

Common options:

```bash
mains --help
mains serve --lan --port 8787
mains web
mains pair
mains auth list
mains auth revoke <device-id>
mains serve --rotate-token
mains serve --tailscale-serve
```

By default the server listens only on `127.0.0.1`. For another machine, prefer
an SSH tunnel or Tailscale Serve. Binding to `0.0.0.0` exposes an unencrypted
WebSocket and should only be used on a trusted network or behind a TLS proxy.

`--lan` is the convenient `0.0.0.0` form. It prints a terminal QR code using
the detected private LAN addresses. `mains pair` creates a fresh link
without restarting the server. `mains web` creates a fresh browser login without
changing phone pairing; use `mains web --url https://mains.example` for an
explicit reverse-proxy or Tailscale origin.

## Existing desktop data

Mains Server opens the installed desktop app's existing user-data directory by
default. Workspaces, collections, runs, paired phones, and managed files remain
one history; there is no import step. Quit Mains Desktop before starting the
server, and stop the server before reopening Desktop. A database ownership lock
rejects concurrent backend processes before either can mutate SQLite.

Existing Electron-encrypted integration credentials remain in the database but
cannot be decrypted by the plain-Node host. Reauthorizing an integration in
Mains Server creates a separate `MNS1` credential for Server without replacing
Desktop's `safeStorage` credential; Desktop reauthorization likewise leaves the
Server credential intact. CLI-backed providers continue to use their normal host
authentication. Use `--data-dir` only when you intentionally want isolated data.

Keep the server available after closing the terminal:

```bash
mains service install --tailscale-serve
mains service status
mains service restart
mains service uninstall
```

On macOS this installs a user LaunchAgent; on Linux it installs a systemd user
unit. Uninstalling the service keeps the server data and paired-device records.

The standalone server and Electron app share the canonical Mains data directory
serially. Never run both backend processes at once.
