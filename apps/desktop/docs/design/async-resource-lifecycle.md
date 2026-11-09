# Async discovery and pricing lifecycle (104)

`packages/backend/src/runtime/async-resource-lifecycle.ts` owns keyed read
admission, shared pending requests, freshness, retry cooldown, consumer departure,
invalidation, publication ordering and permanent disposal. Provider adapters own
their native processes/RPCs, response validation and public fallback DTOs.
`shared/provider-catalog.ts` continues to decide which account, configuration,
plan or CLI changes invalidate discovery; it does not own freshness.

## Transitions

| Event | Rule |
| --- | --- |
| First read for a key | Claim its pending request before invoking any loader, including reentrant native acquisition. Different keys remain independent. |
| Optional disk preparation | Read once for that entry. Only finite, nonnegative, nonfuture timestamps can seed it. Fresh seeds avoid a network request. |
| Fresh read | Return the saved snapshot. The exact TTL boundary is expired; a clock rollback cannot make a future-dated snapshot fresh. |
| Concurrent read | Join the owned request, including a forced refresh. |
| Forced read | Bypass freshness and retry cooldown, while still joining any current request. |
| Current successful response | Validate/map it, publish if necessary, then save its completion timestamp and clear the failure cooldown. |
| Provider fallback/error DTO | Return it to its caller without publishing or freshening the previous snapshot. |
| Current failure | Retain the last good snapshot. Measure the optional cooldown from failure completion, not request start. |
| Read during cooldown | Return the saved failure to the adapter; the adapter decides whether to serve stale data or an unavailable/error response. No automatic timer issues another request. |
| One consumer leaves | Reject that consumer immediately; other consumers retain their request. |
| Last consumer leaves | Abort unused preparation/mapping. A native operation explicitly retained at dispatch stays shared until physical settlement. |
| Invalidate one/all keys | Remove those entries and abort their consumers immediately. Old native responses cannot map, publish, cache or release a replacement request. A later read can acquire a new entry. |
| Dispose | Invalidate all keys and permanently reject new reads for that resource instance. |

Every delayed native boundary checks its original read context. Cancellation
cannot undo an already admitted OS or RPC operation. Per-key publication waits
for an older admitted publication in the same owner; invalidation prevents its
memory result from being accepted. Native writers retain guards around their
own asynchronous effects. Consumer cancellation uses the caller's signal without
claiming that an uncancellable RPC was stopped.

## Bound resources

| Resource | Scope and freshness | Native/fallback policy |
| --- | --- | --- |
| Usage model prices | Backend runtime and user-data file; 24 hours; 60-second failure cooldown | Five-second fetch deadline, validated disk seed, last good offline table or unavailable. |
| Claude models | Driver; five minutes | One control query; SDK failure/empty response uses existing default models without caching that fallback. |
| Claude commands | Workspace; ten minutes | One control query, filtered against disk skills; an absent native command list remains retryable. |
| Claude disk skills | Workspace; five minutes | Existing configured user/project sources; failure returns an empty list. |
| Claude plugins | Driver; five minutes | Shared cancellable CLI pair. Only a mapped catalog becomes fresh; CLI error DTOs remain retryable. |
| Copilot models | Driver; one minute | Validate/acquire the native client before catalog admission. Share the uncached model RPC; transient failure keeps the last good list and authentication failures still propagate. |
| Copilot commands | Workspace; one minute | Share one temporary session per pending workspace read and release it once. Running sessions keep their own client ownership. |
| Codex plugin catalog | Driver; fifteen minutes | Retain an already dispatched, uncancellable raw `plugin/list` RPC for a returning consumer. Abandoned consumers do not read artwork or publish mapped results. |
| Codex installed plugins | Workspace; five minutes, with explicit forced refresh | Preserve install/uninstall overlays and stale/error response behavior. |
| Codex plugin capability | App-server generation; until invalidated | Share paged feature discovery. Failed probes remain retryable; repeated cursors fail. |
| Codex MCP ownership metadata | Plugin identity and marketplace path; until invalidated | Share plugin-detail reads and derive ownership using existing native identifiers. |
| Codex live MCP inventory | Pending read only | Publish only a complete paged inventory; retirement or a repeated cursor stops further paging. |

Plugin mutations retain the existing cross-cache invalidation boundaries.
Codex server closure invalidates discovery while shutdown disposes its owners.
Claude shutdown retires discovery and its native queries; the existing driver
can acquire a new generation after successful query cleanup. Copilot shutdown
disposes discovery together with its permanently stopped runtime. This module
does not rebuild adapters or change execution/session ownership.

Cursor/OpenCode execution caches and persisted effort/fast metadata retain their
separate runtime/file lifetimes. Renderer loading state, wire contracts, mobile,
pricing math and the actual pricing source are unchanged by this packet.

## Price persistence and host closure

Each price loader captures its own cache file. It writes a unique temporary file
and atomically renames it, with ownership checks before publication and cleanup
of the temporary file on failure. A storage error does not discard a valid
in-memory table. HTTP failures, malformed JSON and documents without valid rates
do not overwrite the table or its timestamp. A backend runtime/directory change
retires the previous loader before selecting the next one.

Stats registration reopens host pricing admission. Unregistration closes it,
disposes the loader and aborts pending fetches; reads during closure return
unavailable without creating another fetch. Both desktop and standalone server
use this same IPC lifecycle. Late retired responses are rejected before their
body is consumed or a cache file is written.

## Verification

The resource tests exercise reentrant admission, independent keys, exact TTL
expiry, forced refresh coalescing, failure completion cooldown, error DTOs,
consumer cancellation, retained native work, invalidation/replacement,
publication ordering, disposal and disk seed validity.

Adapter regressions use fake SDK/native protocol boundaries and temporary files
to verify concurrent model/command queries, workspace isolation, one-time session
release, plugin CLI cancellation/shutdown, failed feature-probe recovery,
retired asset suppression and paged MCP retirement/cursor handling. Pricing tests
cover offline restart, invalid responses, storage failure and backend replacement.
A real temporary standalone backend close verifies fetch cancellation and closed
admission. No real provider login, prompt, price network request or mobile
operation is required.
