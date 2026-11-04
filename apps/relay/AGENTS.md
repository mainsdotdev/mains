# AGENTS.md

This app owns the private Go relay gateway, not Bridge replication or agent execution.
Read README.md before changing its routing/authentication protocol.

Run `go test -race ./...`, `go vet ./...` and `go build -o bin/mains-relay ./cmd/mains-relay` here.
Go 1.24+ is required. Run the cross-language acceptance suite with `npm run test:relay`
from `../../packages/backend`; install `../../packages/relay` dependencies first.

- Forward opaque frames; never add plaintext application payloads or device tokens to routing headers/logs.
- Keep HMAC routing authorization distinct from encrypted paired-device authorization at the backend.
- Preserve per-backend isolation, limits, bounded queues, heartbeats and explicit WebSocket shutdown.
- TypeScript wire types live in `../../packages/contracts/src/relay.ts`; keep changes interoperable through acceptance tests.
- No database, offline command queue, public account signup, or automatic deployment in this preview.

Keep this file byte-identical to CLAUDE.md apart from its heading.
