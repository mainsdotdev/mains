# Integration credentials, source sync and connection wizard

Inventory families **35, 36, 97** share connection identity, while keeping local
credential storage, provider discovery and durable sync checkpoints distinct.
No state-machine library or schema migration is needed.

| Owner | Transitions and rules | Implementation |
| --- | --- | --- |
| Connection mutation | Open → admit intent → validate → commit or fail → idle. One queue per provider; equal pending requests join. Every admitted intent changes the opaque revision immediately, retiring earlier reads. A newer intent supersedes earlier work before its commit. A stale explicit revision is rejected. The identical failed intent may retry only while it is still the latest intent. | `connections/connection-lifecycle.ts` |
| Credentials | Validate connection/provider and required fields → encrypt → atomically rotate this host's token format, update metadata/status and mark connected. The other host's encryption format remains current. Failure rolls back the whole activation. Local activation means credentials were stored; discovery verifies them with the provider. | Connections service/repository |
| Revoke/remove | Revoke atomically retires every token format, marks disconnected/revoked and removes resources and synced content. Resource removal atomically removes its content and row; foreign keys remove checkpoints. Old selection revisions cannot repopulate a revoked/reconnected connection. | Connections service/repository |
| Discovery/read | Admit read → bind active connection, provider, credential fingerprint and revision → call provider → recheck before returning. No provider may discover with another provider's connection id. A changed identity, status, token or metadata retires the response. | `getConnectionWithSecrets`, discovery service methods |
| Source sync | Idle → queued → fetching → guarded checkpoint → settled. Equal pending requests join through persistence; full and provider-specific requests share a queue. Unknown providers reject. Selection-read failures never become the provider's global fallback. A failed fetch contributes an error and supplies no cursor. | `sync/sync-lifecycle.ts`, fetcher runner |
| Checkpoint | Recheck the connection and selected-resource snapshots → transaction containing entities, subtype rows and cursors. An item failure rolls back that fetcher's whole batch, counts its errors and skips the other rolled-back items. A cursor-write failure rolls back records and throws. Empty successful incremental responses still checkpoint. Retired responses write nothing. | `syncRepo.commitBatch`, sync service |
| Wizard | Loading → credentials or manage; credentials → select only after successful discovery; select → manage or close; manage → discover/select, remove or revoke. One synchronous action gate covers every step. Errors preserve the form/selection. Back is blocked during an action. Credential values clear after successful discovery. | `connection-wizard-lifecycle.ts`, shared modal/hook |
| Wizard binding | Each open/provider/backend/account/transport generation owns a fresh view. Closure/disposal retires its await tails, chained requests and feedback. A transport A → B → A swap still retires the old view. Read cache keys include a view scope, so a replacement cannot join an old backend's pending query. The scope never enters wire arguments. Own credential activation does not restart initialization. | Shared modal/hook, connections API |
| Backend generation | Fence admission → drain admitted connection reads/mutations and source syncs → close database. Closing retires fetch publication immediately. Handler registration reopens fresh owners only after cleanup finishes. Both hosts use the same barrier. | Desktop and standalone composition roots |

`@mains/contracts/connection-lifecycle` owns optional revision fields. Older
clients and servers remain usable; clients without `expectedRevision` do not
receive the wizard's stale-selection protection. Runtime read guards also check
current database fingerprints, including changes outside the local mutation
queue. Revision admission is local to the owning backend generation.

Native requests already admitted may finish; retirement prevents their results
from being published and shutdown waits for the tracked work. This does not
claim cancellation of a provider's internal pagination or a transaction across
SQLite and the provider. A later sync retries any window whose checkpoint did
not commit. Existing provider cursor-overlap and bounded-fetch behavior remains.

Regression coverage uses disposable SQLite databases, real transactions with
controlled SQL failures, deferred provider results, and the real renderer
Redux/transport paths under Strict Mode. It covers revoke/save races, provider
mismatch, duplicate requests, rollback/retry, credential/resource drift, shutdown
and reopen, retired initialization/credential tails, and scoped discovery reads.
No live provider account or profile is used.
