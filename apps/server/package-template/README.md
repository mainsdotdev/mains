# Mains Server

The standalone Mains backend and web UI, without Electron. It keeps its own
SQLite database and exposes the same backend contract used by the desktop app.

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

The first run creates a pairing token in the server data directory and prints
the browser URL. Later runs reuse that token, so saved Mains Connect entries
continue to work.

Common options:

```bash
mains-server --help
mains-server --port 8787
mains-server --rotate-token
mains-server --tailscale-serve
```

By default the server listens only on `127.0.0.1`. For another machine, prefer
an SSH tunnel or Tailscale Serve. Binding to `0.0.0.0` exposes an unencrypted
WebSocket and should only be used on a trusted network or behind a TLS proxy.

The standalone server uses a separate state directory by default. Never point
it and the Electron app at the same SQLite database concurrently.
