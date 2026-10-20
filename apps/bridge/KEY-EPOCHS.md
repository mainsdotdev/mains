# Bridge key epochs (stage 4 design)

Status: **draft, deferred (2026-10-20)**; the decisions in §12 need confirmation before implementation.
It details stage 4 of [Authenticated writers](AUTHENTICATED-WRITERS.md) on top of
[Membership and revocation](MEMBERSHIP.md). Bridge has not shipped.

> **Deferred.** Not urgent: an honest hub already refuses a removed device, so the
> gap needs a compromised hub or leaked hub data as well. It remains a release
> gate. When picked up, consider a reduced first version before this full design:
> the remover rotates the key right after a removal and wraps it to the remaining
> members in the existing D1 wraps table (with an epoch column), records carry
> their epoch, and the recovery code is regenerated with every rotation instead of
> adding a recovery encryption key. Key packages in the Durable Object, hub epoch
> enforcement and file-specific rules come later.

## 1. What stage 3 leaves open

Every content key derives from one random 256-bit account key
(`deriveBridgeKeys`, `bridge.keys.ts`), and every record carries `epoch: 1`. A
removed device keeps that key. With the ciphertext of anything written after its
removal (a compromised hub, a leaked R2 bucket or hub backup) it decrypts all of
it: record bodies, files and value blobs. Removal stops the device's *access*;
it does not stop it from *reading* what it obtains later.

## 2. Goals and non-goals

Against a removed device that colludes with a compromised hub:

1. Records and files sealed after the account learns of a removal are sealed with
   keys the removed device never receives.
2. The hub cannot substitute a content key: every key is committed in the signed
   membership log, and devices verify what they unwrap against it.
3. Retained members, new members and recovery read the whole history; old keys
   are kept for historical reads only.
4. Rotation is automatic after every removal and needs no user action.

Non-goals: revoking plaintext or keys a removed device already copied; hiding
which rows or files change (§3, identity keys); instant discovery of a removal
hidden from an offline writer (MEMBERSHIP.md §2), which can still seal under the
old epoch until it sees the removal; availability against a hostile hub.

## 3. Keys

`K_e` is the random 256-bit key of epoch `e`. **`K_1` is today's account key**, and
every epoch-1 derivation below is byte-for-byte today's, so existing records,
tombstones and files are epoch 1 without any data migration.

| Key | Derivation | Rotates |
|-----|-----------|---------|
| record identity (`recordKey`) | `HKDF(K_1, "mains.bridge.v1", "mains.bridge.v1/record")` | never |
| file identity (`blobIdKey`) | `HKDF(K_1, "mains.bridge.v1", "mains.bridge.v1/blob-id")` | never |
| record bodies (`bodyKey_e`) | `HKDF(K_e, "mains.bridge.v1", "mains.bridge.v1/body")` | per epoch |
| file chunks | `HKDF(K_e, "mains.bridge.v1", "mains.bridge.v1/blob:" + blobId)`, `e` from the file's manifest entry | per epoch |
| commitment | `HKDF(K_e, "mains.bridge.v3", "account-commitment")` | per epoch |
| join code | today's formula, with `K_e` of the epoch in effect at the admitting entry | per epoch |

**Identity keys cannot rotate.** `rowKey`/`registerKey` are the hub's LWW,
ownership and permanent-tombstone identities; a new key would turn every row into
a different row. A removed device therefore keeps computing the opaque keys of
rows and files whose table/primary key or bytes it already knows, so it can tell
*that* such a row or file changed. It cannot read *what* changed. This is the
"stable record identity/index key" that AUTHENTICATED-WRITERS.md stage 4 asks for.

**History links.** Epoch `e ≥ 2` carries `link_e = XChaCha20-Poly1305(
HKDF(K_e, "mains.bridge.v4", "epoch-link"), nonce, aad = [4, "mains.bridge.v4/epoch-link",
accountId, e])` sealing `K_{e-1}`. Holding the newest key yields every older one,
each checked against its commitment, so a member needs exactly one wrap: the
newest epoch's.

**Wraps (v2).** Today's X25519 sealed box with AAD `[2, "mains.bridge.v4/epoch-key",
accountId, epoch, recipientPublicKey, ephemeralPublicKey]`, so a wrap cannot be
replayed for another account or epoch. The commitment check stays authoritative.

## 4. Membership log changes

State gains:

```
epoch: number                         // current epoch; genesis starts epoch 1
epochs: { epoch, from, commitment }[] // from = seq of the entry that started it
rekeyDue: boolean                     // a removal or recovery rotation since the last rekey
recoveryEncryptionPublicKey: string   // see §8 and decision D4
```

`accountKeyCommitment` remains `epochs[0].commitment`; replication still checks
genesis against it.

New kind:

| kind | body | allowed signer |
|------|------|----------------|
| `rekey` | `{ epoch, accountKeyCommitment }` with `epoch = state.epoch + 1` | any current member |

Rules: `remove` and `recovery` set `rekeyDue`; `rekey` clears it and starts the next
epoch. `genesis` and `recovery` bodies gain `recoveryEncryptionPublicKey`. A device
that removes itself cannot rekey (it would know the next key), so whoever sees
`rekeyDue` rotates (§9).

## 5. Key packages on the hub

Key material moves from D1 into the account Durable Object, stored in the same
transaction as the entry that needs it, as removal fences already are. This ends
the log/D1 split for keys that caused the interrupted-revocation and bootstrap
bugs: an entry and its keys land together or not at all.

```
KeyPackage = {
  epoch,
  wraps: [{ publicKey, wrap }],     // X25519 recipient public key → wrap v2 of K_epoch
  recovery?: { kdf, wrap },          // K_epoch sealed to the recovery encryption key (§8)
  link?: { nonce, payload },         // link_epoch (§3)
}
membership_keys(entry_seq, recipient, value, PRIMARY KEY(entry_seq, recipient))
  // recipient = a member's X25519 public key, "recovery" or "link"
```

| entry | package (validated by the hub against the state before the entry) |
|-------|------|
| `genesis` | wraps = {initializer}; recovery; no link |
| `add` via approval | wraps = {new member}, epoch = current |
| `add` via recovery | none (the device opened the recovery package) |
| `rekey` | wraps = exactly the current members' public keys; recovery; link |
| `recovery` | recovery package of the current epoch for the new recovery key |
| `remove`, `checkpoint` | none |

The hub verifies recipient sets and formats only; devices verify contents through
commitments. Routes:

- `GET /v1/keys/epochs?after=e` (members): for every epoch above `e`, the caller's
  wrap if it was a recipient, and the link.
- `GET /v1/keys/recovery` (pending devices too): the newest recovery package with
  its epoch and the entry it belongs to.
- `/v1/keys/bootstrap`, `/v1/keys/wraps`, `PUT /v1/keys/recovery` and
  `POST /v1/membership` (for `rekey`) carry the package with their entry.

D1 keeps credentials, approval status and `bridge_accounts` bookkeeping only;
`bridge_key_wraps` and the recovery columns are dropped (decision D1). The new
table joins the backup and staging-reset table lists.

## 6. Records

- **Writers** seal with `K_{state.epoch}` of their newest verified head and sign
  `auth.epoch = state.epoch`. While their verified state has `rekeyDue` they do
  not seal at all: they rotate first (§9). This is enforced locally, because a
  hostile hub would accept anything.
- **Hub** (defense in depth, honest hub): after the receipt lookup that keeps exact
  retries idempotent, a push must have `auth.epoch == state.epoch ==` the epoch in
  effect at its bound head. Otherwise `{ error: "epochStale", head }`; while
  `rekeyDue`, `{ error: "rekeyRequired", head }`. An honest hub therefore stores
  nothing new under an old key once a rekey has landed.
- **Receivers** accept epoch `e` only if it is the epoch in effect at the record's
  bound head, and open it with `K_e`. Old records, tombstones and deleted-ACK
  envelopes keep opening with their own epoch's key.
- **Engine**: `epochStale` is handled like `membershipStale` today: forget the
  journaled envelope (and a kept tombstone), refresh membership and keys,
  re-capture from SQLite and seal under the new epoch. `rekeyRequired` asks
  identity to rotate, then retries once.

## 7. Files

File identity stays stable (§3): the same bytes keep the same `blobId` and R2
object key, so retries, `republish` and dedup work as today. Only encryption is
epoch-scoped:

- The manifest entry (`BridgeBlobRef`, inside the encrypted record body) gains
  `epoch`, absent meaning 1. It is the epoch whose key sealed the chunks.
- An upload seals with the current epoch and writes that epoch into the manifest.
- A blob already stored in R2 (immutable) is reused with the epoch that sealed it.
  It was uploaded before this device learned of any later removal, so it is
  history, not new content.
- Readers decrypt with the manifest's epoch. Refs embedded in row values (for
  example captured outputs in `run_artifacts.metadata`) are matched to manifest
  entries by `blobId` before resolving.

## 8. Recovery

The recovery code's Argon2id output already yields the recovery signing key. It
also yields an X25519 key: `HKDF(stretched, "mains.bridge.v3", "recovery-encryption")`.
Its public key is pinned in `genesis` and `recovery` entries. Members seal each
epoch's key to it without ever knowing the code, as AUTHENTICATED-WRITERS.md
stage 4 asks. A recovery package carries its Argon2id parameters (`kdf`), so the
code alone opens it.

- **Recovering**: open the newest recovery package, verify `K_n` against epoch `n`'s
  commitment, sign the `add` with the recovery authority as today, then walk the
  links back to `K_1`.
- **Regenerating the code** appends `recovery` with a package for the current
  epoch and sets `rekeyDue`. The rotating device rekeys right after, so the next
  epoch is sealed only to the new code. A hub that keeps old recovery packages
  can then give an old code's holder nothing newer than the epoch it already had.
- MEMBERSHIP.md decision 3 (prompt to regenerate the code after removing a device
  that may have seen it) stays; it is now also what locks that device out of
  later epochs through recovery.
- The recovery rollback limit of MEMBERSHIP.md §4 remains: a recovering device
  still trusts the newest chain the hub presents.

## 9. Rotation procedure

Triggered by the verified state's `rekeyDue` on any member: right after its own
`remove` or `recovery` entry, when a refresh shows another device's removal
(self-removal included), or on a `rekeyRequired` refusal.

1. **Journal before network.** Generate `K_{n+1}` and save it in the identity vault
   as `pendingRekey { epoch, key }` before the first request. A lost reply is
   resent unchanged or found accepted (the bootstrap fix's pattern).
2. **Build** wraps for every current member (keys from the verified log, this
   device included), the recovery package and `link_{n+1}`.
3. **Sign** `rekey { epoch: n+1, commitment }` on the current head and send the
   entry with its package.
4. **Compare-and-swap.** On a moved head, re-read the log. If another device's
   `rekey` to `n+1` landed, drop the proposal (its key was never used) and fetch
   that epoch's wrap instead. Otherwise re-sign on the new head, with recipients
   recomputed for any member added meanwhile.
5. **Adopt** `K_{n+1}` into the keyring only once the entry is in the log, then
   clear `pendingRekey`.

Other members adopt epochs on their membership refresh: fetch their wrap, verify
the commitment, extend the keyring. A member that was not a recipient (a hostile
hub, or added in a race) reports an error and does not publish.

## 10. Changes by package

- **Contracts**: `auth.epoch` becomes a positive safe integer; the `rekey` kind and
  state fields; package types and validation; wrap v2; manifest `epoch`;
  `epochStale` and `rekeyRequired` push results.
- **Hub**: `membership_keys` written atomically with entries; recipient-set
  validation; the routes in §5; push epoch rules; backup and reset lists; a D1
  migration that drops key material.
- **Backend crypto**: a keyring (`current()`, `get(epoch)`, identity keys) replaces
  the single `accountKey` in `BridgeDevConfig`, the sealing, signing and blob codecs
  and `createBridgeBlobs`. The service's restart fingerprint hashes the identity
  key, so adopting an epoch never restarts replication.
- **Identity**: the vault holds the keyring and `pendingRekey`; bootstrap, approval
  and recovery move to packages; rotation and adoption (§9); join codes per epoch.
- **Engine and replicator**: the refusals in §6; key adoption after membership
  refresh; local refusal to seal while `rekeyDue`.
- **Desktop**: a short "securing the account after a removal" status during
  rotation; recovery-code copy explains that regenerating also rotates keys.
- **Dev tooling**: `dev:client` and the fixture hub sign packages with fixture keys.

## 11. Residual risks

- Metadata through identity keys (§3): change correlation for rows and files a
  removed device already knows.
- A writer that has not yet seen a removal hidden by a hostile hub seals under the
  old epoch (non-goal; the same window as MEMBERSHIP.md §7).
- A file uploaded in the moment between a removal and this device learning of it
  stays sealed under the old epoch; it is reused, not re-sealed (§7).
- The recovery rollback limit (§8).

## 12. Decisions needed

- **D1. Clean break.** Key material moves to the Durable Object and the recovery
  encryption key is new in `genesis`, so existing staging accounts cannot rotate.
  Recommended: reset staging and production again, as stage 3 did. Alternative:
  read legacy D1 wraps as epoch 1 and make an account's first rekey also rotate the
  recovery code. That works without a reset but forces a new code on every
  existing account and keeps two key stores.
- **D2. File identity.** Recommended: stable `blobId` with epoch-scoped encryption
  (§7). Alternative: per-epoch `blobIdKey`. That hides even file existence from a
  removed device, but every file captured and not yet uploaded at a rotation must
  be re-identified, and its refs rewritten in register clocks and row values.
- **D3. Blocking publication while `rekeyDue`.** Recommended: yes, on hub and
  writers; rotation is automatic and takes one round trip. Alternative: let writers
  keep sealing under the old epoch until the rekey lands, which leaves a window
  after every removal.
- **D4. Recovery encryption key.** Recommended: a separate X25519 key from the
  Argon2id output, pinned in the log. Alternative: convert the existing Ed25519
  recovery key to X25519, which needs no new log field but reuses one key pair
  for signing and encryption.
- **D5. Time-based rotation.** Recommended: not now; rotate on removal and
  recovery-code changes only.

## 13. Verification plan

Adversarial tests against the real Worker and real hosts:

- A removed device with every old key and a hostile hub that hands it all
  ciphertext cannot open a record, tombstone, file or value blob sealed after the
  rekey.
- A hub that substitutes a wrap, a link or a recovery package, or serves another
  account's or epoch's, is refused through commitments and AAD.
- An honest hub refuses old-epoch publications and anything while `rekeyDue`; the
  engine re-seals journaled writes and tombstones and they are accepted.
- Concurrent rotations converge on one epoch; a member added during a rotation is
  a recipient of the winner; a lost rekey reply resumes the same key after restart.
- Self-removal is followed by another member's rotation; removal of the last
  member is followed by rotation on the first device recovered.
- Recovery after one and several rotations reads full history; an old code opens
  nothing past the epoch that was current when it was replaced.
- An offline device catches up across several epochs; approval during
  `rekeyDue`; files reused across epochs; epoch-1 data from before this change
  still opens.

## 14. Implementation slices

1. Contracts and crypto: keyring, epoch derivations (epoch 1 unchanged), wrap v2,
   links, recovery encryption key, `rekey` kind and state.
2. Hub: key packages with entries, routes, push epoch rules, D1 cleanup.
3. Identity: packages for bootstrap, approval and recovery; journaled rotation and
   adoption; keyring in the vault.
4. Engine, replicator and files: epoch sealing, refusals, manifest epochs.
5. Desktop copy, dev tooling, README and AUTHENTICATED-WRITERS.md status.

Each slice lands with its adversarial tests before the next starts.
