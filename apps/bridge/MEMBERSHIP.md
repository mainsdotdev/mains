# Bridge membership and revocation (stage 3 design)

Status: **accepted design**; slices 1, 2 and 4 are implemented (§13); slice 3 is not. Decisions are recorded in §12. It refines stage 3 of
[Authenticated writers](AUTHENTICATED-WRITERS.md) and borrows one piece of stage 4
(recovery signing authority), because stage 3 is not sound without it. Bridge has
not shipped; staging and production are reset before this lands, so there is no
migration or compatibility path.

## 1. What stages 1–2 leave open

Every record is signed by its writer's Ed25519 key, and the hub verifies the
signature before any state changes. But receivers learn *which* keys belong to the
account from the hub (`/v1/keys/writers`, D1 `bridge_writer_keys`). Only a device's
own keys are pinned locally (`local-writer-keys.json`). So a compromised hub can:

- **fabricate a member**: list its own signing key as a backend of the account;
- **keep a revoked device writing**: serve new records signed by a revoked key,
  backdated into an older state (revocation is only hub admission today);
- **roll a device back**: hide a revocation from a device that has not seen it.

A revoked device also keeps the account key. The recovery signing key is derived
from that account key (`bridgeRecoveryPublicKey`, HKDF of the account key), so a
revoked device can sign as the recovery authority today. Any membership rule that
lets the recovery authority add a device would let a revoked device re-add itself.

## 2. Goals and non-goals

Stage 3 guarantees, against a hub that is compromised and colluding with a revoked
device:

1. Every device derives account membership from a signed, hash-chained log whose
   start it pinned during an authenticated ceremony. The hub cannot add a member,
   substitute a key, reorder transitions or roll a device back without detection.
2. After a device learns of a revocation, it never accepts a record from the
   removed device that the revocation checkpoint did not already cover, including
   backdated tombstones and LWW winners in the account stream.
3. Two devices shown different membership histories (a fork) detect it as soon as
   either reads a record from the other.
4. Hub replay receipts can be compacted, so they stop growing forever.

Non-goals (unchanged from the stage doc): availability against a hostile hub;
instant discovery of a revocation hidden from an offline device; revoking
plaintext or keys a removed device already copied; rotating content keys (stage 4).

## 3. Membership log

One append-only log per account. The hub stores and orders it but cannot author it.

### Entry

```
MembershipEntry = {
  v: 1,
  accountId: string,
  seq: number,              // 0 is genesis; strictly +1
  prev: string | null,      // hash of entry seq-1; null only for genesis
  kind: "genesis" | "add" | "remove" | "recovery" | "checkpoint",
  body: object,             // per kind, below
  signer: { kind: "device", backendId, signingPublicKey }
        | { kind: "recovery", signingPublicKey },
  signature: string,        // Ed25519 over the signing message
}
signing message = UTF-8 JSON [1, "mains.bridge.v1/membership", accountId, seq, prev,
                              kind, canonical(body), signer.kind, signer.backendId ?? null,
                              signer.signingPublicKey]
hash(entry)     = base64url(SHA-256(signing message || signature))
```

`canonical(body)` uses fixed field order arrays, like `bridgeHeaderFields`, never
`JSON.stringify` of an object. The hash covers the signature, so the chain commits
to the exact signed bytes.

### Kinds

| kind | body | allowed signer (state before the entry) |
|------|------|------------------------------------------|
| `genesis` | `{ members: [Member], recovery: { signingPublicKey }, accountKeyCommitment }` | the single initial member |
| `add` | `{ member: Member, via: "approval" \| "recovery" }` | any member, or the recovery authority (`via: "recovery"` only) |
| `remove` | `{ backendId, checkpoint: Checkpoint }` | any member, including the removed one (sign-out) |
| `recovery` | `{ signingPublicKey }` (new recovery authority) | any member |
| `checkpoint` | `{ horizon: true }` or `{ runs: [RunFence] }` (§6, §8) | any member |

`Member = { backendId, publicKey, signingPublicKey }`. A removed backend id can be
added again only with new keys (both public keys must differ from every earlier
entry for that id), matching stage 1's "changing either key invalidates approval".

`accountKeyCommitment = base64url(HKDF-SHA256(accountKey, "mains.bridge.v3",
"account-commitment", 32))` replaces today's use of the recovery public key as an
account-key consistency check (`activate` compares `bridgeRecoveryPublicKey(key)`).

### Hub storage and ordering

The log lives in the account Durable Object (`membership(seq INTEGER PRIMARY KEY,
hash TEXT NOT NULL, entry TEXT NOT NULL)`), next to the record log, so appends are
serialized with publications without a cross-store transaction.

- **Append** is compare-and-swap: accepted only if `entry.prev` equals the current
  head hash. On conflict the hub returns the current head; the client re-reads,
  re-checks that its intent still applies (the request is still pending, the target
  is still a member), signs on the new head and retries.
- The hub verifies signature and authorization exactly like clients do, so a
  bearer credential alone cannot append (defense in depth; clients never rely on it).
- **Pull** returns entries after a given seq. New entries are announced on the
  existing socket as a `membership` hint, like `changed`.
- D1 keeps credentials, pending requests and wraps. Its `approved`/`revoked` status
  becomes a projection the hub updates after a verified `add`/`remove`, for
  admission only. The writer directory (`/v1/keys/writers`, both
  `bridge_writer_keys` tables) is removed; keys come from the log.

## 4. Pinning: genesis, approval and recovery

### Genesis

The initializing backend (today's `/v1/keys/bootstrap`) creates the account key,
the recovery code and the genesis entry together, and appends genesis in the same
journaled step that uploads its wrap. It pins `(seq 0, hash)` locally before
anything else.

### Joining by approval

Today B confirms the *account fingerprint* that A displays. Stage 3 binds that
comparison to membership, not just to the key:

1. A verifies B's device code as today, then appends `add(B)` on its current head
   and uploads the wrap (journaled; §9).
2. A displays a **join code**: the first 60 bits of
   `HKDF-SHA256(accountKey, "mains.bridge.v3", ["join", accountId, B.backendId, hash(add(B))])`.
3. B pulls the log through the entry that adds B, verifies the whole chain from
   genesis (signatures, authorization, `accountKeyCommitment`), derives the same
   code, and activates only when the user-entered code matches.

B therefore pins exactly the history A had when it approved B. A hub that hides a
revocation from B, or shows B a forged chain, produces a different `add(B)` hash
and a different code. The code replaces today's static account fingerprint in the
approval flow (§12, decision 2).

### Recovery authority

The recovery signing key moves from the account key to the recovery code:
`seed = HKDF-SHA256(Argon2id(code, salt), "mains.bridge.v3", "recovery-signing")`.
It reuses the Argon2id work already spent to open the recovery wrap. Its public key
is pinned in genesis and replaced only by a member-signed `recovery` entry (when
the user regenerates the code). Consequences:

- A removed device that never saw the current code cannot sign as recovery.
- `/v1/keys/recovery/unlock` verifies against the log's current recovery key
  instead of D1's `recovery_public_key` (which becomes a projection).
- **Rollback limit:** a recovering device has no trusted member to compare with,
  so it trusts the newest chain the hub presents. A compromised hub can show it a
  chain that stops before a revocation. Stage 4's member-resealed recovery package
  should carry the head hash; until then this is a documented residual risk.
  Regenerating the recovery code after removing a device that may have seen it
  closes the authority side (§12, decision 3).

## 5. Records bind membership

Record signatures (stage 2 `auth`) gain the writer's current head:

```
auth = { v: 2, accountId, epoch: 1, membership: { seq, hash }, publicationId,
         signingPublicKey, signature }      // membership is inside the signed message
```

Receivers, before verifying any page:

- **Behind:** if a record binds `seq` above the local head, pull and verify the log
  through that seq first. If the hub cannot supply a valid extension, the page is
  not applied and sync reports a membership error (no partial apply).
- **Fork:** if a record binds a `seq` at or below the local head but a different
  hash, the account has two histories. Sync halts for the account and the user
  sees a membership conflict. Nothing is applied from the conflicting writer.
- **Author:** the signing key must belong to `origin` in the log. If `origin` was
  removed at seq `r`: a record bound to seq `≥ r` is rejected outright; a record
  bound below `r` is accepted only inside `r`'s checkpoint (§6).

Because active members write constantly, a lagging device learns of a new head
from the first record bound to it. The hub also verifies the binding on push
(`membership.hash` must equal its log at that seq), so stale or invented heads
are refused before storage.

## 6. Revocation checkpoints

Fencing a removed writer by stream position is not enough: compaction leaves
legitimate gaps in `seq`, and a hostile hub could later fill a gap with a
backdated record signed by the removed device. The checkpoint therefore commits
to **which publications** were accepted, not to a position.

### Account stream (exact)

Before signing `remove(X)`, the remover R performs a fresh full pull of the
account stream and collects the **signatures** of every record authored by X that
the pull returns (live registers and tombstones; compaction has dropped the rest).
Signatures rather than publication ids: X chooses its publication ids and could sign
a different record under an admitted one, but cannot produce an admitted signature
for any other message. The `remove` body carries:

```
account = { through: seq, count, root }   // root = SHA-256 over the JSON of the sorted signatures
```

The remover sends only the entry. The hub derives the sorted list from the
records of X it stores, appends the removal only if that list matches `count` and
`root` exactly, and stores it beside the entry
(`membership_fences(entry_seq, ordinal, signature)`) to serve on request; receivers
verify it against `count` and `root`. Nothing proportional to X's footprint is
uploaded, so request size limits never block a removal. Signatures are already visible to
the hub, so the list reveals nothing new. Its size is bounded by X's live footprint
in the account stream (roughly one per run root, owned aggregate and account object
X last wrote, plus X's tombstones), at most 100 000.

An honest hub therefore appends the removal only if the remover saw exactly the
records of X it still stores, and refuses publications from a backend that is not
a current member. A record X published after R's pull therefore makes R read again and sign
on the new head, so no device applies a record the fence later refuses.

After learning of the removal, a receiver accepts an X-authored account record
only if its signature is in the list. A record the hub withheld from R is not
in the list and is refused later; that is an availability loss, never a forged
write.

### Run streams (decision needed)

X's run streams are single-writer and affect only X's own runs (replicas are
read-only, and stage 2 already refuses remotely introduced execution roots). But
they can be large and lazily pulled, so no member may have them. Options:

- **A — partial:** exact sets for run streams R has cached; for the rest, freeze
  at hub-reported heads. Cheap, but a hostile hub could fill gaps below those
  heads with backdated transcript content attributed to X.
- **B — two-phase (recommended):** `remove(X)` fences the account stream at once.
  R then downloads X's remaining run streams in the background and appends a
  `checkpoint { runs: [{ runId, through, count, root }] }`. Until it lands,
  receivers hold (do not apply) X records from unfenced run streams; if R gives
  up, the user can discard that history instead.
- **C — discard:** after removal, X's run history that no member had downloaded
  is never trusted. Simplest and fully safe; a removed device's unopened
  transcripts disappear from other devices.

## 7. Offline catch-up and ordering

- Every sync cycle refreshes membership before records: pull and verify the log,
  apply removals and fences, then pull records. A device never pushes while its
  log is known to be behind (the hub rejects stale heads; §8).
- A device that finds itself removed stops replication and reports it, like a
  revoked credential today. Its local data is kept.
- Records already applied before a device learned of a removal are not re-judged.
  A hostile hub that hides a removal can therefore feed a lagging device the
  removed writer's new records until that device sees any newer head. Repairing
  those registers afterwards is a possible follow-up, not part of this stage.

## 8. Replay horizon and receipt compaction

Stage 2 keeps one permanent replay receipt per publication (256 bytes of quota
each). With records bound to a head, the hub can bound replay instead:

- The **horizon** is the newest membership entry at least 30 days old (hub time).
  The hub refuses publications bound below the horizon with a new
  `membershipStale { head }` result, and deletes receipts bound below it.
- Members append a `checkpoint { horizon: true }` entry when the newest entry is
  older than 7 days, so the horizon advances without membership changes.
- A device returning from a long offline period re-signs journaled publications on
  the current head (a new publication id; the stage 2 journal already re-signs
  when the image changes) and retries.

Replays are a token-holder threat at the hub; a compromised hub can re-serve old
records to clients regardless, where LWW and permanent tombstones already apply.

## 9. Interruption and journaling

Each membership action is journaled locally before any network call, with its
intended entry *content* (not its signature, which depends on the head):

- **approve(B):** pending → entry appended → wrap uploaded → join code shown. Restart
  resumes at the first incomplete step; a CAS conflict re-validates and re-signs.
- **remove(X):** fresh account pull → fence list → entry appended → fence list
  uploaded → (option B) run fence. The list upload is idempotent by entry hash.
- **sign-out:** self-removal is a `remove` signed by the leaving device; if it
  cannot be appended (offline), sign-out still completes locally and any member
  can remove the device later, as today.

## 10. Client changes (summary)

- New `bridge.membership.ts`: entry codec, verification, authorization, fork and
  rollback checks; persisted head and verified state in local tables
  (`bridge_membership`, `bridge_membership_fences`), cleared with other account
  state on account change, kept across sign-out like `local-writer-keys.json`.
- `bridge.signing.ts`: `allowed(origin, key)` reads the verified log instead of
  `bridge_writer_keys`; `auth` v2 binds the head.
- `bridge.identity.ts`: genesis at bootstrap, `add` on approve, join code instead
  of account fingerprint, recovery authority from the code.
- Replicator: membership refresh before each pull; `membershipStale` handling;
  `membership` hint.
- Hub: `membership` and `membership_fences` tables, append/pull RPC, verification,
  D1 projection of approval status, horizon enforcement and receipt compaction;
  remove `/v1/keys/writers`.

## 11. Verification plan

Adversarial tests against the real Worker and real hosts:

- Hub inserts a member, substitutes a key, reorders or truncates the log, or
  serves a log that does not extend a device's pinned head: rejected; no record
  from the affected writer applies.
- Fork: two devices shown divergent logs detect it on each other's first record.
- Approval: a hidden revocation or forged chain changes the join code; B never
  activates on a mismatch.
- Removed writer + account key + hostile hub: cannot add itself (recovery
  authority now needs the code), cannot publish a new or backdated account record
  or tombstone outside the fence, including into compaction gaps.
- Run streams: the chosen option's rules (held, fenced or discarded).
- Concurrency: simultaneous approve/remove on two devices, including mutual
  removal; CAS retries converge on one history.
- Interruption: each journaled step killed and resumed; lost responses.
- Offline catch-up across a removal and across the replay horizon; journaled
  publications re-signed and accepted.
- Recovery after a removal with and without a regenerated code.
- Receipt compaction: a captured publication bound below the horizon is refused.

## 12. Decisions (2026-10-19)

1. **Run stream history after removal:** option B, two-phase (§6).
2. **Approval UX:** the static account fingerprint is replaced by a per-approval
   join code, shown on the approving device after it approves (§4).
3. **Recovery code after removal:** prompt to regenerate it whenever the removed
   device may have seen it.
4. **Who may remove whom:** any member may remove any member, as today.
5. **Replay horizon:** 30 days, with heartbeat entries after 7 quiet days.

## 13. Implementation slices

1. Membership log, genesis, verification, pinning, join code, recovery authority
   from the code; records bind the head; fork/rollback detection; writer
   directory removed.
2. Removal with the exact account-stream fence; offline ordering; self-removal.
3. Run stream fencing per decision 1.
4. Replay horizon, `membershipStale`, receipt compaction.

Each slice lands with its adversarial tests before the next starts.

**Slice 1 as implemented.** Clients keep verified entries in `bridge/membership.json`
and pin the latest verified head inside the encrypted identity vault (not the SQLite
tables §10 sketches). Replication holds its own verified copy and reports each
verified extension to identity, which advances the pin; it never waits on identity's
queue. Records carry `auth` v2; the hub checks each binding against its log and the
session key, receivers check behind / fork / author before opening a page. The
writer directory, `local-writer-keys.json` and both `bridge_writer_keys` tables are
gone. Development tokens have no enrollment: the dev hub accepts signed entries on
`POST /v1/membership`, `dev:client` admits backends through an authority derived from
the account-key file, and test fixtures sign entries with their fixture keys.
**Slice 2 as implemented.** `remove` carries the account fence above; the remover reads
the account stream over a short-lived connection on every attempt, and the hub's
409 for a mismatched fence sends it back to read again. `DELETE /v1/backends/:id`
revokes a registration: it needs a signed removal only when that registration holds
the member's keys. Keys that no registration holds any more (the backend re-enrolled
with new ones) leave through `POST /v1/membership`, apart from any newer
registration, which a pending device can still cancel and an approver still revoke. Receivers load each
removal's list before their view exposes that removal, and refuse a removed
writer's account record outside it, however early it binds. The hub refuses pushes
from non-members, and removing a member revokes only the D1 registration holding
its keys. Approving a backend that re-enrolled with new keys while its old ones are
still admitted (its credential lapsed before it could remove itself) first removes
the old keys with their fence, which leaves the new registration pending. Sign-out
remains a fenced self-removal that needs the hub. Still open: a backend whose old
keys are admitted cannot recover by code alone, because the recovery authority only
admits and a pending device cannot read the account stream for a fence; another
member must approve it. Run streams are not fenced yet (slice 3).

**Slice 4 as implemented.** The hub stores each entry's append time and each receipt's
bound seq. A push bound below the horizon gets `membershipStale { head }` after the
receipt lookup (an exact retry whose receipt still exists stays an idempotent ACK)
and before any state change; the maintenance alarm, scheduled for when the horizon
next moves, deletes receipts below it in bounded batches. The engine forgets the
journaled envelope and kept tombstone of each stale write, refreshes membership and
retries the push once. The replicator appends the heartbeat when a refresh reports
the newest entry a week old (the hub's time, an unauthenticated hint), at most once
a day per device; a concurrent append simply loses the compare-and-swap. Members
append it through `POST /v1/membership`, restricted to `checkpoint`.
