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
mains-server
```

The first run creates an owner token in the server data directory. It grants
full access and stays on the host. Phones receive separate, revocable device
tokens by redeeming five-minute, single-use pairing links.

Common options:

```bash
mains-server --help
mains-server --lan --port 8787
mains-server pair
mains-server auth list
mains-server auth revoke <device-id>
mains-server --rotate-token
mains-server --tailscale-serve
```

By default the server listens only on `127.0.0.1`. For another machine, prefer
an SSH tunnel or Tailscale Serve. Binding to `0.0.0.0` exposes an unencrypted
WebSocket and should only be used on a trusted network or behind a TLS proxy.

`--lan` is the convenient `0.0.0.0` form. It prints a terminal QR code using
the detected private LAN addresses. `mains-server pair` creates a fresh link
without restarting the server.

## Existing desktop data

Mains Server opens the installed desktop app's existing user-data directory by
default. Workspaces, collections, runs, paired phones, and managed files remain
one history; there is no import step. Quit Mains Desktop before starting the
server, and stop the server before reopening Desktop. A database ownership lock
rejects concurrent backend processes before either can mutate SQLite.

Existing Electron-encrypted integration credentials remain in the database but
cannot yet be decrypted by the plain-Node host. CLI-backed providers continue
to use their normal host authentication. Use `--data-dir` only when you
intentionally want isolated data.

Keep the server available after closing the terminal:

```bash
mains-server service install --tailscale-serve
mains-server service status
mains-server service restart
mains-server service uninstall
```

On macOS this installs a user LaunchAgent; on Linux it installs a systemd user
unit. Uninstalling the service keeps the server data and paired-device records.

The standalone server and Electron app share the canonical Mains data directory
serially. Never run both backend processes at once.
