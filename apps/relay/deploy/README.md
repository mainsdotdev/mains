# Single-host relay deployment

This installs the **private, operator-configured preview** on one Linux host.
It does not publish the service automatically or configure DNS. Agent execution
and the Mains backend stay on the user's Mac/server; this host only routes opaque
frames. Do not distribute the operator key to untrusted users or public apps.

## Prepare the host

Use a Linux host with Docker Engine and Docker Compose v2.20+ (or newer),
OpenSSL, a checkout of this repository, and available TCP ports 80 and 443.
Enable the Docker daemon at boot using the host's service manager. Compose
restarts containers after process failure and daemon/host restarts unless they
were explicitly stopped. A failed health check reports `unhealthy`; it does not
by itself restart a running process.

Point the DNS A record for `relay.mains.dev` to the host's public IPv4 address.
Only add an AAAA record if IPv6 reaches the same host. Allow inbound TCP 80/443
in the host/provider firewall. When using Cloudflare DNS, start with **DNS only**
for this record so the included Caddy service can obtain and serve its own
public certificate directly. No Cloudflare token is needed.

From `apps/relay` on that host:

```sh
sh deploy/init.sh
```

This creates `.env` from `.env.example` and a random routing key at
`deploy/secrets/routing.secret`. Repeating it preserves the existing values.
Edit `.env` if the hostname differs. The domain is configuration, not a key.

If retaining an existing operator key, securely copy its exact contents to
`deploy/secrets/routing.secret` **before** initialization instead of creating a
new one. The directory must remain mode `0700`. Initialization makes the file
`0444` inside that private directory: local Compose file secrets are bind mounts
and preserve host ownership, so the non-root container needs this read permission.
Other host users cannot traverse the parent directory. Keep backend copies in
their own private locations with mode `0600`.

## Start and verify

From `apps/relay`:

```sh
docker compose config --quiet
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d --build --wait --wait-timeout 120
docker compose ps
curl --fail https://relay.mains.dev/health
```

The health response is `{"ok":true,"protocol":1}`. Use your configured hostname
if different. Certificate issuance can take a little longer than container
startup; check `docker compose logs --tail 100 caddy` if HTTPS is not ready.

Caddy obtains/renews TLS certificates and proxies WebSocket upgrades. Only Caddy
publishes ports. The Go listener on 8791 is reachable only inside the Compose
network; its image runs as UID/GID 65532, with a read-only filesystem and dropped
capabilities. Its `/health` endpoint drives the container health check. Both
containers have bounded Docker logs. Caddy access logging is disabled and its
runtime error logger removes request headers, including routing tickets.

Certificate/account state persists in the `caddy_data` and `caddy_config` volumes.
Keep those volumes across updates; do not use `docker compose down --volumes` on
a real deployment. Only the relay service receives the routing key as a file at
`/run/secrets/relay_routing`; it is excluded from Git and the Docker build context.

## Connect Mains

Securely copy the same operator key to each trusted backend machine. Start Mains
Desktop or the standalone server with:

```sh
export MAINS_RELAY_URL=wss://relay.mains.dev
export MAINS_RELAY_SECRET_FILE=/absolute/private/path/to/routing.secret
```

Enable network access in Mains Connect for Desktop. Pair the updated phone app
over the trusted LAN once to receive the relay address, routing ticket and pinned
host identity. Previously paired phones need a fresh pairing. After that, the
backend and phone both connect outbound to the public relay; the backend machine
does not need a public listening port. The backend must stay online.

## Update, stop and rotate

After pulling reviewed changes, from `apps/relay`:

```sh
docker compose up -d --build --wait --wait-timeout 120
```

An updated relay briefly disconnects sessions; the existing clients reconnect.
For a Caddyfile change, also run `docker compose restart caddy`. To stop the
service while keeping certificates and keys, use `docker compose down`.

Do not rotate the routing key as part of a routine update. To rotate deliberately,
replace it on the relay host and every trusted backend, force-recreate the relay
container (`docker compose up -d --force-recreate relay`), restart the backends,
and pair phones again. Old routing tickets will no longer work.

## Check the deployment without a public domain

With Node 24+, Docker and Compose available, run from `apps/relay`:

```sh
node scripts/smoke-deployment.mjs
```

This builds the real image and starts this Compose stack with a disposable key,
`localhost` certificates, and random ports bound to loopback. It checks the
non-root/read-only relay container, HTTPS health, rejection without a routing
ticket, authenticated bidirectional WebSockets, and redaction of routing headers
during a forced proxy failure. TLS verification remains enabled; only the child
probe trusts the disposable CA. The script removes its own project, image and
volumes afterwards. It never invokes a model or changes the real deployment.
The relay CI job runs the same smoke check.

The encryption and paired-device authorization acceptance suite remains
`npm run test:relay` in `packages/backend`; this smoke check covers the added
container and reverse proxy boundaries.

References: [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/),
[Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https),
[Caddy WebSocket proxying](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming).
