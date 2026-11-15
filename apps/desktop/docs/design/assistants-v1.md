# Assistants V1

## Scope

Assistants have a permanent identity and their own conversations, shared team memory and delegated assignments. `/assistants` owns the shared sidebar, with assistant rows only, styled like the existing workspace/chat items. The sidebar has no title, expansion arrows or nested chats. Its toolbar places New assistant on the left and a search icon on the right; search expands leftward over the action, filters assistant names/responsibilities, and clears/closes with Escape or the clear button. The navigation rail uses the shared Bot icon. Selecting an assistant restores its selected chat, defaulting to its latest conversation on first visit. The main header centers the assistant’s avatar/name profile, which toggles a nonmodal information panel on the right. Hover/focus shifts the avatar/name left and smoothly reveals a right-pointing chevron, with no layout-width change and reduced-motion support. Its background matches the main content surface and connects without a gap, with rounded top corners and the shared inverted corners at the bottom sides. It has no conversation tabs or new-chat/history controls; access to other chats will be designed separately. The existing top-right browser action remains independent. Selected conversations and legacy conversation identities persist locally per backend/account/assistant, and all history remains intact. The main pane uses Mains’ ordinary transcript, rich composer, attachments and approval controls. The welcome/sidebar monograms open the same right information panel with Details, Memory and Assignments tabs. It reuses the shared panel animation lifecycle, keeps the chat interactive, scrolls independently, and closes with its close action, Escape or the header toggle; focus returns to the header trigger. There is no secondary name/description/action toolbar in the chat. The panel explicitly owns its theme text colors, including headings and profile values. The route is independent of the navigation rail's active Space.

Particle avatars use closely spaced, separate square grains with subtly softened corners, following SquareSpinner’s cell style, to fill soft character silhouettes. Two larger, pale grains with dark outlines form expressive eyes; the surrounding grains leave room for their gaze. Particle size and drift keep visible gaps during working pulses. Compact views use fewer, larger grains and the creation preview uses finer grain; both include a filled center and stable eye identities. A steady particle base preserves the silhouette while two synchronized light waves sweep diagonally in alternating directions, following SquareSpinner’s phase pattern. Only body grains join the waves; eye grains retain their separate gaze, blink and tint clocks. CSS handles the waves and gentle body breathing; bounded pointer gaze updates only DOM variables. Visibility/intersection observation pauses hidden avatars, and reduced-motion rendering stays static. Direct/queued run activity and assignments keep the same character in its working state. Legacy circle/square profiles normalize to sphere/cube on read while retaining their colors; new selections persist canonical values.

Creation replaces the main content pane with a centered, scrollable page form while keeping the sidebar available; Cancel restores the selected conversation. It orders avatar (particle cube/sphere, eight colors), name, responsibility, instructions, then provider/model/effort. It uses the desktop component library and its shared model/effort dropdown. Team defaults server-side; no workspace is required. The assistant freezes the selected Space’s provider/instructions plus model and supported effort. Provider/model/effort handoff remains V2.

Mode/workspace are execution context on runs and assignments. A new standalone chat is Work with its own managed directory even when the stored Space is currently Code. Code calls inherit the source conversation’s workspace or validate an explicit target. Starting a new task does not mutate an existing conversation; continuation/fork retain their own execution snapshot. Migration 0045 preserves accepted old Code jobs using their worker/profile snapshots, retains the compatibility-only legacy profile columns, and adds the avatar without rebuilding tables or deleting children.

## Code calls

The normal Code composer’s existing `@` dropdown lists active assistant identities. A selected assistant is a Redux `ContextItem`, with a stable selection id and human-readable chip; its payload becomes an application-origin `assistant_mention` context. The backend stamps the exact source prompt id and text, validates account/identity and carries only explicit prompt context. The durable dispatcher admits a task only after the matching real user-prompt artifact exists. Replayed contexts and reconnects resolve to the same source-run/prompt/selection assignment. Uploads travel as durable file references rather than duplicated pixels in queue JSON.

The existing queue starts a normal worker run under the target assistant’s frozen provider/model/effort and the assignment’s execution. Same-workspace effects remain serialized. A source `assistant_assignment` artifact renders a live task card with status, result, evidence and an Open chat action. Reading by assignment id keeps historical cards usable beyond the bounded overview list. The ordinary source chat can continue after reports through the existing result-delivery receipt path. Code chats expose public task tools; memory, private history and reporting remain assistant-only. Team checks still apply to assistant-to-assistant delegation.

## First conversation

Creation transactionally reserves one welcome conversation in `assistant_welcomes`. A bounded background generator uses the assistant’s frozen model and effort, with a role/profile and bounded untrusted memory references. This isolated one-shot call disables work tools, MCP, hooks and plugin settings; it creates no interactive provider session. Its application-origin setup prompt stays in the local record and never becomes a user-prompt artifact.

The first tab displays one role-specific question using the shared question control: three suggested first tasks, free text and Skip. The question and its state survive navigation and backend restart. Skip persists a friendly idle response and exposes the ordinary composer without starting work. The first real answer starts the ordinary run under the reserved identity. Its welcome is saved ahead of the real user message in the existing transcript; an application-origin context note explains the question to the native session. Other conversations start ordinary independent chats and never repeat the welcome. Existing assistants are not retroactively initialized.

Generation failures can retry text generation. A claimed answer is immutable; retries reconcile the same reserved run and never replay it under a new identity. Interrupted generation may restart safely because it has no production effects. Shutdown cancels generation and joins outstanding welcome delivery. Welcome records are local-only in Bridge V1.

## Domain

`assistants` owns teams, assistants, scoped memories and assignments/messages. V1 assistants belong to one team. Teams share knowledge across Developer and Work runs without turning a Collection into a git project. Run execution, provider sessions, history, approvals and artifacts remain in `runs`. References to runs do not create a second transcript.

Memories are individual or team-scoped, bounded, revision checked, and attributed to a user or source run. Important facts are pinned; a turn receives pinned and relevant records plus its team's roster. Authorized history reads use existing run history. Assignment status/results are separate from memory.

Assignments store the requesting run, target assistant, task key, parent, worker run, state, result and evidence. A durable message queue owns dispatch. Repeating a task key returns the original assignment. A worker uses its own assistant's frozen settings and permissions; delegation never inherits greater permissions from the requester. Same-workspace work is serialized. Cycles and excessive depth are rejected.

## Lifecycle

Queue delivery is `queued -> dispatching -> delivered`, or `uncertain` after a crash/dispatched failure. Commit a delivery claim and its preallocated run identity before starting provider effects. Recovery reconciles the stored run instead of repeating an uncertain action. Accepted but not yet dispatched work can retry. Stop closes admission and joins pending dispatch before database release. Closing the page does not stop work.

Assignment states are queued, running, blocked, uncertain, completed, failed and canceled. Provider turn completion does not prove task completion: workers report a result and evidence explicitly. Completion creates an idempotent result delivery back to the requester. A result contains reference data, never new authorization. Stopping a chat stops its current turn; incoming reports stay visible in assignments without restarting a canceled requester. Canceling an assignment also cancels its queued messages.

## Implementation / acceptance

1. Shared contracts, migration, profile validation and frozen run integration.
2. Scoped memory and per-turn context; own/authorized team conversation reads.
3. Durable assignment/message dispatch, result delivery, bounded delegation and restart reconciliation.
4. Assistants sidebar, creation page and ordinary conversation pane. Team memory, assignments and profile live in the right information panel. Reuse existing run history, stream reconciliation, rich composer and approval UI.
5. Backend lifecycle/IPC for desktop and standalone; typed renderer transport.
6. SQLite integration tests for profile freezing, account/team boundaries, memory conflicts, task deduplication, delegation loops, restart and shutdown; renderer typecheck and build.

V1 is local to the owning backend, accessible through desktop and authenticated web transport. Bridge replication, mobile-specific screens, scheduled/proactive assignments and execution-profile handoff are later work. New local tables are deliberately excluded from Bridge's replicated table manifest.

## Implementation status

Implemented on `codex/assistants-v1`, based on `feat/ios` at `2dbac5142f7d08b34f86370750ed2d1f4bdd1bbb`.

Validation: 394 backend tests across assistant integration, provider tool registration, run/Space behavior, Bridge schema classification and host lifecycle; 18 renderer tests covering navigation and mode configuration. Backend/desktop/server typechecks, changed-source lint, web build and standalone server build pass. An isolated browser preview verified assistant rows, conversation tabs, switching assistants without changing the rail Space, scoped draft restoration, creation and memory dialogs. Shared team memory was also verified between assistants.

Native provider execution is covered with a fake provider driver. A live Claude/Codex end-to-end delegation run remains to be exercised; the preview used disposable fixture data with providers disabled.

The sidebar/chat revision additionally passes 310 assistant/run backend tests, including ordinary composer context and attachment delivery under a frozen profile. 64 renderer tests cover sidebar layout, frozen composer controls, navigation, history and run caching.

Conversation selection: the assistant header now shows a profile instead of tabs. Route integration tests cover profile-to-panel entry, nonmodal chat access, keyboard close/focus return, creation/cancel, restoring each assistant’s selected conversation after switching, and preserving earlier history when a draft is sent. Other-chat navigation is intentionally deferred; persisted runs and selection are retained. The shared browser-new-tab control and shell header checks remain unchanged.

Information-panel validation: route integration checks cover header/sidebar entry, management tabs, expanded state, Escape and trigger toggling, focus return, and retaining the selected chat. Appearance is reviewed by the user; no browser verification is performed for these revisions.

Task-local execution and avatar validation: 358 backend tests cover migration preservation, standalone Work execution from a Code Space, multiple repository targets for one assistant, ordinary Code delegation, accepted-prompt matching, retry/restart deduplication and memory/task boundaries. 89 renderer tests cover avatar creation, keyboard selection in the `@` menu, readable persistent mention chips and shared input regressions. All 62 standalone server tests pass. Desktop typecheck, backend/changed-desktop lint and both web/server builds pass. An isolated preview verified creation in light/dark themes and a Code assistant selection with a completed task card. Native execution used fake drivers; no live provider request was made for this verification.
