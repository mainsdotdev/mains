# Mains Relay (private preview)

A Go WebSocket gateway for live control of an online Mains backend from a paired
phone. Desktop and standalone server keep an outbound connection to the gateway;
the phone connects through it without exposing a port on the backend's machine.
The Go process forwards opaque frames. Agent execution, permissions, event
allowlists and command receipts remain in the existing Mains backend.

This first version is an **operator-configured private relay**, independent of
Bridge's Cloudflare sync hub. It does not yet authenticate through a Mains
account, queue commands for an offline backend, or provide push notifications.
An online backend is required. Browser UI hosting remains on the backend.

## Run

Install Go 1.24 or later. Run Go commands from `apps/relay`:

```sh
node -e "require('node:fs').writeFileSync('routing.secret', require('node:crypto').randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 })"
go run ./cmd/mains-relay -secret-file ./routing.secret
```

The default listener is `127.0.0.1:8791`; `GET /health` returns protocol version
1. The secret file is ignored and never printed. To deploy, build a binary with
`go build -o bin/mains-relay ./cmd/mains-relay`, run it behind a TLS reverse proxy
with WebSocket upgrades, and expose a `wss://` origin. `-listen` selects the
interface/port. `MAINS_RELAY_SECRET_FILE` can replace `-secret-file`.

The relay server and each backend need the same operator routing secret. Keep
it only on trusted machines; it is never included in the mobile app or pairing
reply. Each backend has its own encrypted-at-rest X25519 identity. This preview
is not a public multi-tenant service for untrusted backend operators.
The identity envelope records its host secret-storage format. Desktop and Node
cannot read each other's protected identity; use a separate `--data-dir` and pair
that backend independently when switching runtime. A foreign/corrupt identity
fails closed and is never silently overwritten.

## Connect a backend and phone

Install `packages/relay` dependencies before installing backend/mobile
dependencies: run `npm install` in each package's own directory. From the
backend machine, provide the following environment when starting `mains serve`
or the desktop development app:

```sh
export MAINS_RELAY_URL=wss://relay.example.com
export MAINS_RELAY_SECRET_FILE=/absolute/path/to/routing.secret
```

For Desktop, enable network access in Mains Connect. Initially pair the phone
directly using the existing LAN/Tailscale QR flow. The authenticated pairing
reply now adds the relay origin, routing ticket and pinned backend public key.
Existing phones need to pair again once to receive these fields. Update/rebuild
the native mobile app after adding its new `expo-crypto` native dependency.

Once paired, the phone tries the relay first, then its saved direct endpoints
through the existing recovery supervisor. The direct paths keep their existing
behavior when no relay is configured. A public relay origin requires WSS; plain
WS is accepted only for loopback automated/local tests. A phone cannot reach a
Mac's loopback address: use a reachable WSS deployment for a real device.

The device's routing ticket lasts one year; re-pair before it expires in this
preview. The backend's hourly ticket refreshes on reconnect. Ticket expiry and
relay restart close sockets so the existing supervisor can recover. Revoking a
paired device disconnects direct and relayed sessions; its still-valid routing
ticket cannot authorize the encrypted application connection.

## Docker deployment

The multi-stage `Dockerfile` builds a static Go binary for the target platform
and runs it as a non-root user. `compose.yaml` adds a Caddy TLS/WebSocket proxy,
persistent certificate volumes, file-based routing secrets, health checks,
restart policies and bounded logs. No host port is published for the Go process.

See [the single-host setup guide](deploy/README.md) for DNS, initialization,
startup, backend configuration, updates and the local HTTPS/WebSocket smoke
check (`node scripts/smoke-deployment.mjs`). Deployment is an explicit operator
action; CI builds/tests disposable containers and never publishes the service.

## Protocol and bounds

- `/v1/backend` and `/v1/device` require `mains-relay.v1` plus a `ticket.<token>`
  WebSocket subprotocol. Tokens never appear in URLs or the selected protocol.
- HMAC-SHA256 tickets bind version, backend, role, device (when applicable) and
  expiry. Browser upgrades use the library's same-origin policy.
- The backend connection multiplexes `open`, `data` and `close` frames by a
  relay-generated connection id. Device-supplied ids cannot select another
  backend or device. Contract types are in `@mains/contracts/relay`.
- Endpoints use X25519, HKDF-SHA256 and XChaCha20-Poly1305 from noble. Fresh
  client AND backend nonces produce separate directional keys. The backend
  proves possession of the key pinned at pairing before the phone sends its
  device credential. Strict counters reject replay/reordering/reflection; the
  transcript binds backend and device. The backend validates the encrypted
  device credential and its device id before registering the normal WS router.
  This static host identity handshake does not promise forward secrecy after
  compromise of that identity. Initial pairing must use a trusted direct path.
- Default limits: 128 total sockets, 16 device sockets per backend, 6 MiB wire
  frames, 16 queued frames and 8 MiB queued bytes per socket. Application
  plaintext remains capped at the existing 4 MiB device limit. Slow recipients
  are disconnected rather than growing a queue without bound.
- Ping interval is 25 seconds, with 10-second ping/write deadlines. Host
  reconnect backs off from 1 to 30 seconds. Device recovery remains owned by the
  existing foreground/network-aware phone supervisor. Shutdown closes upgraded
  sockets explicitly before draining HTTP.

## Verify

From `apps/relay`:

```sh
go test -race ./...
go vet ./...
go build -o bin/mains-relay ./cmd/mains-relay
```

From `packages/relay`, run `npm test` for encryption boundaries, direction and
replay tests. From `packages/backend`, run `npm run test:relay` (Go must be on
PATH, or set `MAINS_GO` to its executable). This builds a temporary Go binary and
tests real Go/Node WebSockets with the same transport the phone uses: direct
pairing, encrypted authentication, prompts/stop/approval commands, event delivery,
allowlists, receipt replay, wrong credentials/keys, revocation and process
restart. Test profiles and routing secrets are disposable; no model is invoked.

Also run the normal backend/mobile/desktop type, lint and test checks. Go unit
tests cover routing isolation, authentication/origin rejection, capacity, frame
limits, disconnects and delivery of the final rejection before socket closure.
