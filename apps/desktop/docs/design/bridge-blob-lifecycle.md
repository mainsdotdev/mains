# Bridge client blob lifecycle (inventory 67)

The shared backend owns these rules in
`packages/backend/src/modules/bridge/bridge.blob-lifecycle.ts`.
`bridge.blobs.ts` performs filesystem, cryptography and HTTP effects;
`bridge.blob-records.ts` and `bridge.value-blobs.ts` use the same publication
generation guard. This change adds no mobile code, wire fields or database schema.

## Transfer ownership

| State / event | Transition and effects |
| --- | --- |
| Active / capture, publish, resolve, cache verification | Claim an operation before any asynchronous work. Copy caller bytes, metadata and descriptors at admission. |
| Active / duplicate resolve | Share the promise for the same content identity, size and safe extension. Different extensions retain their own paths and share one content download. |
| Active / content download | Claim one of two slots, or wait in order. Count target and partial-file pins independently of the slot. Release each claim once. |
| Active / Stop | Close admission synchronously; abort network requests and credential waits, reject queued downloads and join every admitted operation. |
| Stopping / new work | Reject without starting I/O. Repeated Stop shares teardown. A late credential receipt cannot restart a request. |
| Stopping / disk work completes | Finish atomic writes and temporary-file cleanup before destroying cryptographic keys and entering Stopped. Interrupted network work rejects. |
| Stopped / file-open permission check | Return false. No new cache verification or transfer can use disposed keys. |

An admitted capture may finish its immutable staging write during Stop. This is
why disk operations drain rather than being abandoned when the network aborts.
`releaseCaptured` is the deliberate exception to transfer admission: an already
accepted metadata ACK may delete staged files after transfer shutdown. It uses no
keys and starts no network requests.

## Cache and interrupted transfer

Cache files are disposable; `bridge/uploads` snapshots are durable publication
inputs and are outside the LRU. Cache reads verify size and the account-private
content HMAC; downloaded chunks also verify AEAD identity, position and size.
Interrupted downloads keep authenticated encrypted parts. Retry authenticates
each saved part again and fetches only missing or damaged parts.

Cache pins are reference counts. Finishing a cache hit cannot release an
overlapping publisher's pin. LRU trimming skips all active target/source pins and
active partial directories. Once the last pin is released, later trimming may
evict those files. The cache limit may temporarily be exceeded by active work or
the file currently being saved.

## Publication and ACK

| Event | Rule |
| --- | --- |
| Capture | Freeze exact bytes and output metadata before returning a manifest. |
| Upload failure, interrupted receipt or quota denial | Keep the durable output snapshot and queued metadata; retry the same identity. |
| Upload finishes after a local edit | Bind the uploaded manifest only if the original register clock still owns the row. File and large-value publications use one guard. |
| Exact metadata generation acknowledged | The existing sync lifecycle removes only that outbox generation first. |
| Snapshot cleanup after ACK | Remove a captured output only when no remaining durable outbox record references its blob id, in either a prepared manifest or unprepared output metadata. |
| Another queued output shares the snapshot | Retain the snapshot until its last referencing publication acknowledges. An edited source path must not substitute newer bytes. |

The hub's chunk receipt and a metadata ACK are separate events. Upload success
alone never releases the staged output. Existing retry/rebuild, alias and
deletion rules remain owned by the sync/receive lifecycles.

## Verification

`bridge.blob-ownership.test.ts` exercises the public client with real temporary
files, encryption and loopback HTTP: disk-write draining, closed admission,
credential retirement, immutable inputs, shared downloads, two-slot cancellation,
partial resume and overlapping cache pins. Its filesystem gate delays a real
write; it does not replace the storage implementation.

`bridge.blobs.test.ts` exercises the real local Worker/R2 and independent SQLite
backends. The shared-snapshot regression verifies that the first ACK cannot
remove bytes still needed by an unprepared second publication, even after the
source file changes. Existing cases cover generation changes during upload,
restart/resume, cache integrity, large values, republishing and cache eviction.
