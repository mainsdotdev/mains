# Bridge authenticated writers

Bridge has not shipped. This work introduces one mandatory security model; it
does not migrate unsigned Bridge data, preserve old identity formats, or allow
downgrades. Existing local application data is not reset by this work.

## Security boundary

The hub routes ciphertext and enforces admission, but it is not the source of
trust for a record's author. An account encryption key must not let its holder
impersonate a different backend. A bearer credential must not let its holder
poison permanent tombstones or LWW state without the backend's signing key.
Revocation must exclude the backend from authenticated hub access and subsequent
membership changes. Content-key rotation is deferred hardening for the initial
personal-device release; stage 4 describes its additional protection for later
ciphertext. Revocation cannot erase plaintext or keys already copied by that backend.

## Implementation sequence

1. **Device identity (complete).** Generate independent X25519 encryption and
   Ed25519 signing key pairs. Encrypt both private keys in identity storage.
   Bind approval codes and recovery recipient proofs to the account id, backend
   id, and both public keys. Registration and approval snapshots require both
   keys; changing either key invalidates approval. Do not expose private keys
   through status, IPC, notifications, CLI, or diagnostics.
2. **Signed records (complete).** Persist each outgoing signed envelope before publication.
   Bind the account, epoch, writer identity, replay identifier, complete routing
   header, nonce and ciphertext. Hub verification precedes all LWW/tombstone
   mutations; receiver verification precedes clock advancement and SQL apply.
   ACKs identify the accepted envelope; an invalid deletion never clears an
   outbox entry. An incoming owner field alone cannot authorize local execution.
3. **Membership and revocation.** Pin the account's authenticated membership
   genesis. Sign membership transitions and persist the latest verified state.
   Reject rollback and signer substitution. Define replay/equivocation handling
   that works with lazy streams and compaction. Account-stream revocation
   checkpoints commit accepted history; run-stream checkpoints are deferred
   hardening for the initial personal-device release.
   Design: [Membership and revocation](MEMBERSHIP.md).
4. **Epoch keys and recovery (deferred hardening).** Use a stable record identity/index key and fresh
   random content keys per epoch. Scope new blob encryption/storage to its epoch;
   keep historical keys only for historical reads. Distribute new keys only to
   retained members. Recovery authority is independent of account content keys;
   retained members can seal new recovery packages to its public encryption key.
   Journal transitions before network calls and resume the same proposal after
   interruption. Offline retained devices refresh membership before publishing.
   Design draft: [Key epochs](KEY-EPOCHS.md).

Stage 3 slice 1 authenticates membership: every writer key, the local writer's
earlier keys included, comes from the signed, hash-chained log
([Membership and revocation](MEMBERSHIP.md)), and every record binds the writer's
head. Slice 2 fences a removed writer's account stream to the records its remover
saw. Keys are not yet rotated on revocation, and a compromised hub can still
deliver run-stream records a removed writer bound before its removal until slice 3
fences those too. Run-stream fences (stage 3 slice 3) and content-key rotation
(stage 4) are deferred hardening for the initial personal-device release, as
recorded in [Membership and revocation](MEMBERSHIP.md) and [Key epochs](KEY-EPOCHS.md).
The implemented membership and account-stream fences retain their adversarial
regression requirements.
Full protection against a removed device obtaining later ciphertext also needs
stage 4. Compromised delivery
can still withhold messages; signed state does not guarantee availability or
instant discovery of a revocation hidden from an offline device.

Stage 1 verification passed: 205 backend tests, 165 hub tests, 32 settings UI
tests, and 4 real-host acceptance tests. Backend, hub, desktop and server type
checks passed, as did the relevant lint checks, server build and Worker dry-run
build. Regression coverage includes either public key changing during approval,
hub substitution of the local signing key, recovery recipient substitution,
invalid or reused private keys, and encrypted identity persistence across restart.

Stage 2 uses a fixed epoch 1 and mandatory Ed25519 envelope signatures. The
random 256-bit publication id is signed and journaled with the exact nonce and
ciphertext. Both success and deleted ACKs bind it; invalid deletions cannot retire
the write. Hub replay receipts survive retention/compaction and each carries a
256-byte quota charge until the replay horizon (stage 3, slice 4) passes the
membership head its publication bound; the hub then refuses that binding and drops
the receipt.
Unsigned network envelopes have no compatibility path. The encryption-only codec
and plaintext in-memory codec remain low-level test primitives; runtime replication
always composes the device-signature codec around encryption.

Stage 2 verification passed: 230 backend tests, 184 hub tests, 140 real-network
replication tests, and 15 real-host acceptance tests. Backend, hub, desktop and
server type checks passed; backend/hub lint, server build and Worker dry-run build
passed. The backend suite ran with `--maxWorkers=1 --testTimeout=15000`: its
unchanged 2 MiB encoding assertion exceeded the default five-second deadline
during concurrent Worker/host runs. No assertion or production timeout was relaxed.
New adversarial coverage checks every signature field, real D1 credential/key
binding, complete-batch rejection, token-only tombstones/clock changes, replay
after expiry/restart, mismatched ACKs, lost ACK/restart persistence, and incoming
locally owned run/pulse roots without local provenance.

Own records keep verifying through sign-out, restart and re-enrollment with fresh
random keys, because each earlier key keeps its interval in the membership log. Both logout options
must restore/retain own collections and Atlas records without parked rejections.
Historical self-signatures still cannot introduce executable roots without local
provenance. Live hints reuse the verified membership and refresh it only for a
record bound to a newer head. Rejected registration responses revoke the requested pending backend with
its issued credential, including when local enrollment persistence fails.

## Required verification

- Changing either device public key, account id, or backend id changes approval.
- Missing, malformed, reused, mismatched, or unsupported private identities fail
  closed; secure storage has no plaintext fallback.
- A bearer credential cannot publish an unsigned/altered record or tombstone.
- An account key plus a malicious hub cannot impersonate another writer or
  introduce an executable pulse on its behalf.
- Invalid future clocks and invalid deletion ACKs cannot retire valid writes.
- Replay, membership rollback, backdated revoked writes, interrupted rotation,
  offline catch-up, recovery, permanent deletes and blob GC retain their rules.

Reference: [RFC 9420, delivery/authentication service compromise](https://www.rfc-editor.org/rfc/rfc9420.html#section-16.9).
