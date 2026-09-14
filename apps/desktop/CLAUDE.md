# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It is kept byte-identical to `AGENTS.md` apart from this heading — update both together.

`CONTEXT.md` is the companion document: it holds the shared domain vocabulary (ServiceResponse, handle, aggregate modules, provider adapters, provider variants, transcript rows, run cache) with explicit _Avoid_ rules. Read it before making architectural changes — this file describes *what exists*, CONTEXT.md describes *what the words mean and which shapes are forbidden*.

## Development Commands

```bash
# Start development server
npm start                   # electron-forge start (raises ulimit to 65536)
npm run serve               # start with MAINS_SERVE=1 (backend exposed over WebSocket)
npm run serve:tailscale     # serve + MAINS_TAILSCALE_SERVE=1 (Tailscale HTTPS exposure)
npm run build:web           # build the renderer as a standalone web client → dist-web/

# Database operations
npm run db:generate     # Generate migrations from schema changes
npm run db:push         # Push schema to dev database
npm run db:studio       # Open Drizzle Studio (dev database)
npm run db:studio:runtime  # Open Drizzle Studio (runtime database)
npm run db:clean:dev    # Reset dev database
npm run db:clean:runtime  # Reset runtime database (~/Library/Application Support/mains/)
npm run db:clean:all    # Reset both databases

# Tests & types
npm test                # vitest run (auto-rebuilds better-sqlite3 first)
npm run test:watch      # vitest in watch mode
npm run test:coverage   # vitest with coverage
npm run typecheck       # tsc --noEmit across main, preload, and renderer tsconfigs

# Run a single test file or pattern
npx vitest run path/to/file.test.ts
npx vitest run -t "describes substring"

# Linting
npm run lint            # Run ESLint on src/
npm run lint:fix        # Run ESLint with auto-fix

# Build & Package
npm run package         # Package app for current platform
npm run make            # Create distributable
npm run publish         # Publish via electron-forge

# Codex app-server protocol
npm run codex:protocol:generate  # Regenerate the typed codex app-server protocol
npm run codex:protocol:smoke     # Smoke-test the generated protocol

# Maintenance
npm run clean           # Remove build artifacts (.vite, dist, out, caches)
npm run reset           # Rebuild better-sqlite3 + reset dev database
npm run hard-reset      # Full reset (reset + nuke node_modules + reinstall)
npm run licenses:generate  # Regenerate THIRD-PARTY-NOTICES.txt
```

Tests require `better-sqlite3` to be rebuilt against the local Node ABI — the `test*` scripts handle this automatically, but running `vitest` directly will fail if you skip that step (use `npm rebuild better-sqlite3` first). Tests live next to the file under test as `*.test.ts`; vitest config is `vitest.config.mts`, shared fixtures/factories live in `src/test/`.

## Architecture Overview

Mains is an Electron 41 desktop app (React 19 renderer, SQLite + Drizzle ORM). CommonJS package with ESM Vite configs (`.mjs`). **macOS only** (Apple Silicon and Intel) — Windows and Linux are not supported.

### Process Boundaries

**Main Process** (`src/main/`)
- Entry point: `src/main/index.ts` — initializes database, registers IPC handlers, registers the BrowserWindow event sink, creates the window
- Database client: `src/main/db/client.ts` — singleton with better-sqlite3, Drizzle ORM; runs migrations + seeds at init
- Modules: `src/main/modules/` — domain modules with layered architecture
- IPC plumbing: `src/main/ipc-kit/` — see **IPC Transport** below

**Preload** (`src/preload/index.ts`)
- Exposes `window.api` object with typed IPC methods
- Namespaced by domain: `api.account`, `api.app`, `api.appSettings`, `api.automations`, `api.backendAuth`, `api.browser`, `api.connections`, `api.documents`, `api.entities`, `api.fileExplorer`, `api.gitFlow`, `api.guards`, `api.imageProxy`, `api.issues`, `api.localBackend`, `api.platform`, `api.projects`, `api.providers`, `api.pullRequests`, `api.pulse`, `api.runs`, `api.runArtifacts`, `api.runContext`, `api.runTurns`, `api.shell`, `api.signals`, `api.space`, `api.ssh`, `api.stats`, `api.sync`, `api.tasks`, `api.terminal`, `api.toolCalls`, `api.updates`, `api.workspace`
- The `workspace` namespace is an aggregate — it covers workspace lifecycle plus reviews, review findings, diffs, and activity. Connection credentials/states are folded into `api.connections`; project resources and linked issues into `api.projects`.
- **There is no `api.git`.** The `git` module is main-process-internal (see **Git Module**); renderer git effects go through `api.workspace.*`, `api.gitFlow.*`, and `projects:listBranches`.
- After modifying preload, restart dev server to pick up changes

**Renderer** (`src/renderer/`)
- React app with Redux Toolkit, React Router (HashRouter), `@/` alias → `src/renderer/`
- Routes: `/` (default route), `/code[/:workspaceId]` (unified agent workspace — all providers), `/settings`, `/plugins`, `/pulse`, `/relay`, `/tasks` (issue + pull-request inbox)
- `/code` hosts every agent provider; which provider it drives comes from the active space's `providerId` column (`claude_code`, `copilot_cli`, `codex`, `cursor`) — switching space via the space picker switches the provider. There are no per-provider routes.
- The space's `mode` column (`developer`, `work`, `chat` — see `@mains/contracts/modes`) selects the UI shape via `src/renderer/lib/mode-config.ts` (`MODE_CONFIGS`, read through `useModeConfig`): which route `/` redirects to, plus per-mode capability flags (`showGitActions`, `showTerminal`, `showChangesTab`, `showPermissionControls`, `showPlanControls`, `showGoalControls`). Developer is all-true; work hides the git ceremony; chat hides every write-adjacent affordance. The agent-side half of a mode is the **mode harness** (`src/shared/mode-harness.ts`, see Provider Adapters)
- Route table lives in `src/renderer/components/layout/main/main-routes.tsx`; page components in `src/renderer/routes/`

### IPC Transport (`src/main/ipc-kit/`, `@mains/contracts`)

The wire-level pieces — the channel map, the WS protocol, `ServiceResponse`, provider ids, modes, effort levels, run settings — live in the shared `@mains/contracts` package (`packages/contracts/src`, plain TS source linked via `file:`); `src/shared` keeps re-export shims at the old paths, so existing imports still resolve. New code imports from `@mains/contracts/...`.

The IPC layer is transport-agnostic so the same handlers can serve a local renderer *or* a remote client:

- `ipc-main.ts` — drop-in shim for Electron's `ipcMain` used by every `*.ipc.ts`. Each registration is also recorded in the handler registry. Import `ipcMain` from here, not from `electron`.
- `handler-registry.ts` — channel → handler map, keyed by `"domain:action"`. Handlers keep the `(ctx, ...args)` shape; `ctx` is the Electron `IpcMainInvokeEvent` locally or a synthetic `{ clientId }` over WebSocket. Handlers that genuinely need the Electron event (terminal streaming via `event.sender`) stay on raw `ipcMain` and are not registered.
- `handle.ts` — the wrapper at the IPC seam: resolved value → `ok(data)`, throw → log + `fail(message)`. Every `*.ipc.ts` handler uses it except the handful needing the invoke context (native dialog, terminal streaming, imageProxy signing, localBackend).
- `event-bus.ts` — the single outbound path for main → client events (`emit`), Electron-free. Sinks: `browser-window-sink.ts` (local renderer) and `websocket-sink.ts` (remote clients).
- `ws-server.ts` / `ws-server-host.ts` / `ws-auth.ts` — WebSocket router + in-process host + token auth; wire format in `@mains/contracts/ws-protocol`.

See `docs/design/remote-backend.md` for the full design.

### Module Architecture (`src/main/modules/`)

Each domain module follows a layered pattern (see `src/main/modules/account/` as reference):

| File | Role |
|------|------|
| `{name}.ipc.ts` | `registerXxxIpc()` / `unregisterXxxIpc()` using the `ipcMain` shim + `handle()` — calls `xxxService` directly |
| `{name}.service.ts` | Object literal with business logic, uses `this` for sibling calls. **Throw-style**: returns plain `T` / `T \| null` and throws on failure. |
| `{name}.repo.ts` | Object literal, calls `getDb()` per method, Drizzle queries. **Module-internal** — never exported from the barrel. |
| `{name}.dto.ts` | Types via `typeof table.$inferSelect`, formatter functions |
| `{name}.validation.ts` | Hand-rolled allowlist validation (no zod/yup) |
| `index.ts` | Barrel exports (service + dto + selected named functions; never the repo) |

**Critical**: All layers are **plain object literals**, never classes. No DI — repos call `getDb()` inline.

**Throw-style, not envelopes.** Services do *not* return `ServiceResponse`. They return plain values and throw; the `ok()`/`fail()` envelope is constructed once at the IPC seam by `handle()`. The **absence rule**: single-item *reads* return `T | null` (absence is a legitimate state); *mutations* whose target is missing throw (`"Workspace not found"`). Error messages travel to the renderer as-is — write messages users can read.

**No controller layer.** Earlier versions had a `{name}.controller.ts` between `ipc.ts` and `service.ts`. It was a pure pass-through and has been removed. Argument unpacking (e.g. `{ projectId, resourceId }` → two args) lives at the `ipc.ts` call site.

**Cross-module access** goes through service methods or named barrel functions (`logWorkspaceActivity`, `recordWorkspaceDiff`, `getConnectionWithSecrets`, `getIssuesByResourceIds`) — never another module's repo.

All modules: `account`, `appSettings`, `automations`, `backendAuth`, `browser`, `connections`, `entities`, `fileExplorer`, `git`, `gitFlow`, `guards`, `imageProxy`, `localBackend`, `projects`, `providers`, `pullRequests`, `pulse`, `runs`, `space`, `ssh`, `stats`, `sync`, `tailscale`, `terminal`, `tools`, `updates`, `workspace`

Not every module has all six files. Modules that own no tables skip `repo`/`dto` (`guards`, `browser`, `terminal`, `ssh`, `backendAuth`, `localBackend`, `imageProxy`, `gitFlow`, `pullRequests`), and `git` / `tailscale` have no `ipc.ts` at all (no IPC surface). When adding a module, match a sibling with similar responsibilities rather than blindly copying `account/`.

**Aggregate modules** — one folder owns several tables (details in CONTEXT.md):
- `workspace` → `workspaces`, `workspace_activity`, `workspace_diffs`, `reviews`, `review_findings`
- `connections` → `connections`, `connection_tokens`, `connection_states`
- `projects` → `projects`, `project_resources`

### IPC Convention

Channel format: `"domain:action"` (e.g. `"entities:getAll"`). All channels are defined once in `@mains/contracts/channels` as a typed map (`CHANNELS.entities.getAll`). Main, preload, and renderer all import and reference values from that map — never type the channel string literally. Adding a channel = one edit; renaming = one edit; typo = compile-time error.

Sites that reference the registry:

1. `src/preload/index.ts` — `ipcRenderer.invoke(CHANNELS.entities.getAll, ...)`
2. `src/main/modules/{name}/{name}.ipc.ts` — `ipcMain.handle(CHANNELS.entities.getAll, ...)`
3. `src/renderer/lib/redux/api/{name}Api.ts` — `{ handler: CHANNELS.entities.getAll }`

Channel namespaces: `account`, `app`, `appSettings`, `automations`, `backendAuth`, `browser`, `connections`, `documents`, `entities`, `fileExplorer`, `gitFlow`, `guards`, `imageProxy`, `issues`, `localBackend`, `projects`, `providers`, `pullRequests`, `pulse`, `runArtifacts`, `runContext`, `runToolCalls`, `runTurns`, `runs`, `shell`, `signals`, `space`, `ssh`, `stats`, `sync`, `tasks`, `terminal`, `toolCalls`, `updates`, `workspace`.

All IPC responses use the `ServiceResponse<T>` envelope: `{ success: true, data }` or `{ success: false, error }`, built by `ok()` / `fail()` from `@mains/contracts/service-response`. The renderer unwraps it exactly once, in `ipcBaseQuery` — never in `transformResponse`.

### Data Flow

1. **IPC Communication**: Renderer calls `window.api.namespace.method()` → Preload invokes IPC → handler registry → Main handles
2. **Module Flow**: IPC handler (`handle()`) → Service (throws) → Repository → Database
3. **Redux Integration**: `src/renderer/lib/redux/api/baseApi.ts` wraps IPC in RTK Query with custom `ipcBaseQuery` (no HTTP)
4. **State Management**: RTK Query for server state, Redux slices for UI state (`appSettingsSlice`, `backendsSlice`, `workspaceSlice`)

### Database Schema (`src/main/db/schema.ts`)

Conventions:
- Text primary keys (UUIDs or string literals), timestamps as `integer("col", { mode: "timestamp" })` with `default(sql\`(unixepoch())\`)`
- Snake_case SQL columns, camelCase TypeScript — Drizzle handles mapping
- Booleans: `integer("col", { mode: "boolean" })`, enums: `text("col", { enum: [...] })`
- Updates must manually set `updatedAt: sql\`(unixepoch())\``
- Index naming: `idx_{table}_{col}`, unique: `uniq_{table}_{desc}`
- JSON columns use `check()` constraints: `json_valid(col) OR col IS NULL`

Core tables:
- `accounts` — User profiles (display name, email, bio, avatar)
- `appSettings` — App-level config (activeSpaceId, enableWorktrees, seedVersion)
- `providers` — Agent runtimes; ids come from `@mains/contracts/provider-ids` (`copilot_cli`, `claude_code`, `codex`, `cursor`)
- `projects` — Groups workspaces by shared remote origin (rootPath, workspacesPath, defaultBranch, scripts)
- `projectResources` — Pivot linking projects to `connectionResources` (owned by the `projects` aggregate)
- `workspaces` — Local repos with status tracking (backlog → todo → in_progress → in_review → done → canceled → duplicate)
- `entities` — Unified canonical content (tasks, issues, etc.)
- `tasks` / `issues` — Domain-specific views on entities
- `signals` — Lightweight notification/event records surfaced in the UI
- `connections` / `connectionTokens` / `connectionResources` / `connectionStates` — External service connections, encrypted token blobs, linked resources, integration state
- `spaces` — User-defined UI/prompt configurations; `providerId` (agent engine) and `mode` (developer/work/chat) drive `/code`. Which modes a provider offers lives in `PROVIDER_MODES` (`@mains/contracts/modes`) — claude and codex drive all three, copilot and cursor are developer-only for now
- `runs` / `runTurns` / `runContext` / `runArtifacts` — Agent run flow with session resumption via `sessionId` and turn tracking
- `toolCalls` — Tool invocation tracking with nested calls (`parentToolCallId`). There is no `tools` table — the registry is in-code.
- `automations` / `automationRuns` — Scheduled/triggered automation definitions and their execution records
- `pulses` — Scheduled automation definitions backing the `/pulse` route; each carries a `mode` (fixed at creation) and targets a workspace (developer) or an optional collection (work/chat)
- `workspaceActivity` — Workspace activity log (types: diff, review, finding, commit, pr)
- `workspaceDiffs` — Git diffs captured per workspace/run (base ref, diff text, files, stats)
- `reviews` / `reviewFindings` — Workspace-level review notes (open → in_review → approved/rejected) and their findings

### Key Subsystems

**Sync System** (`src/main/modules/sync/`)
- `sync.service.ts` — Orchestrates fetching from all connections
- `connections/` — Provider-specific fetchers (GitHub, GitLab, Linear, Jira, Asana, Trello, Sentry), each with tests
- Produces `EntityInput[]` which gets persisted to the `entities` table

**Workspace System** (`src/main/modules/workspace/`)
- Aggregate module: workspaces + activity + diffs + reviews + findings under one 6-file layout and one `workspace:*` channel namespace
- **Workspace intake**: `workspace:createFromSource` turns a repo into a project + workspace pair. Four acquisitions (`folder`, `clone`, `init`, `worktree`) feed one shared intake tail (git import → `findOrCreateProject` → derive `workspacesPath` → assemble metadata → `createWorkspace`). Never re-inline this at call sites.
- **Workspace git operations**: `workspace:createBranch`, `workspace:renameBranch`, `workspace:switchBranch`, `workspace:discardPaths`, `workspace:listGitStates` (+ the `workspace:gitStateChanged` watcher event). The current branch is never persisted — it is read live from git.
- **Branch model**: `projects.defaultBranch` = repository integration branch; `workspaces.baseBranch` = that workspace's PR target (repointed at the parent branch by `workspace:createBranch`); the checked-out branch lives only in git.
- Cross-module writers use the named barrel functions `logWorkspaceActivity`, `recordWorkspaceDiff`, `clearWorkspaceDiff`.

**Runs System** (`src/main/modules/runs/`)
- Runs track agent sessions with turns, context, artifacts, and tool calls
- `run-session.ts` / `run-session-registry.ts` own the live session lifecycle and event persistence
- Tool approval broker (`user-input-broker.ts`) bridges main↔renderer for interactive tool approvals
- Runs support session resumption and continuation via `sessionId`
- Every run snapshots its space's `mode` (`runs.mode`) at start; `resolveRunMode` + the mode-harness composition in `runs.service` decide the prompt delta, tool policy, and config snapshot a run carries — resume and fork re-derive from the row, so a run keeps its harness even if the space's mode changes
- Run archiving: `runs:archive` / `runs:listArchived` / `runs:unarchive`, surfaced in Settings → Archive alongside archived workspaces. The service keeps the provider-side session in sync via the adapter's optional `archiveSession` / `unarchiveSession` (Codex threads are archived/unarchived on the app server)

**Projects System** (`src/main/modules/projects/`)
- Groups workspaces by shared git remote origin; owns `project_resources`
- Tracks rootPath, workspacesPath (worktree dir), branches, scripts (setup, run, archive)
- `findByRemoteOrigin`, `findOrCreate`, archive, `listBranchNames`, and the cross-aggregate `projects:listIssues` (project → resources → entities, orchestrated at the service layer)

**Provider Adapters** (`src/main/modules/providers/adapters/`)
- Unified `WorkRunAdapter` interface fronting four agent SDKs; typed events (log, tool_call, command, artifact, status, plan_update); optional `archiveSession` / `unarchiveSession` for providers with persisted server-side sessions (only the Codex driver implements them)
- `adapter.factory.ts` — creates the correct driver by provider id
- `claude.driver.ts` — Claude Code via `@anthropic-ai/claude-agent-sdk`
- `copilot.driver.ts` — GitHub Copilot CLI via `@github/copilot-sdk`
- `codex.driver.ts` — OpenAI Codex CLI, decomposed into `codex-app-server.client.ts` (process/transport), `codex-session-acquisition.ts` (create/resume/fork/review), `codex-run-coordinator.ts` (live run state, routing, finalization), `codex-capabilities.ts` (models/accounts/skills/plugins), `codex-event-mapper.ts` (notification → event projection), `codex-request-broker.ts` (server-request policy), plus the generated `codex-app-server-protocol/`
- `cursor.driver.ts` — Cursor agent via `@cursor/sdk`
- `fake.driver.ts` — in-memory driver used by tests
- `work-run-core.ts` — shared run loop / event plumbing used by every driver
- `adapter.shared.ts` — common helpers used by every driver
- `mains-mcp-server.ts`, `mains-tools.core.ts`, `mains-tools.schemas.ts`, `mains-tools.registry.ts` — in-process MCP server and the **mains tools** (`SaveReview`, `SaveFinding`, `SaveFindings`, `CheckPackage`). Handler logic lives once in core, the Zod schema once in schemas, assembly once in the registry with `providers` and `modes` allowlists (all of them developer-mode-only — work and chat expose no mains tool). Git is not among them: commits and PRs are the user's job through the git-actions panel, or the agent's through the shell. Never hand-write a tool definition inside a driver.
- **Mode harness** (`src/shared/mode-harness.ts`) — per-mode prompt delta, tool policy, and per-provider config defaults/overrides, resolved once per run in `runs.service` (never inside a driver, never via the cached `AdapterConfig`). Drivers receive the resolved values on the per-run request (`extraInstructions`, `toolPolicy`, `configSnapshot`) and apply them natively: claude appends to the `claude_code` system-prompt preset + allow/disallow lists, copilot layers the session `systemMessage` + PreToolUse deny, codex sends `developerInstructions` + sandbox override (chat = `read-only`) + `personality` (work/chat = `friendly`) + `planMode`/`goalMode` pinned off (plan in work/chat, goal in chat — on create, resume, and fork), cursor prefixes the prompt + agent mode (chat = `ask`). Continue/fork re-derive the harness from the run row's `mode` snapshot.
- Hook system for pre/post tool execution and subagent coordination; pre-approved tool list (Bash, Read, Glob, Grep, …) with interactive approval for others

**Git Module** (`src/main/modules/git/`)
- **Main-process-internal**: no IPC channels, no preload namespace, no renderer caller. Do not re-add a `git:*` namespace.
- Git operations via `simple-git`: status, log, diff, branches, remotes, worktree create/remove, clone/init/import
- Throw-style pilot: methods return plain values and throw
- `captureDiffSnapshot(rootPath, baseRef)` is the single diff-capture operation (unified diff + synthetic untracked hunks + untracked-aware shortstat, all-or-throw). Do not hand-compose diffs elsewhere.
- `git-snapshot.ts` handles snapshot plumbing (including non-ASCII paths)
- Semantics-bearing methods are tested against real temporary git repos, not a mocked `simple-git`

**Git Flow Module** (`src/main/modules/gitFlow/`)
- Deterministic commit / push / pull / PR orchestration for the UI git-actions panel: `getStatus`, `generateCommitMessage`, `generatePrBody`, `commit`, `push`, `pull`, `createPr`, `publish`, `getPublishPreflight`
- The only home for that git work — there is no agent-facing commit/PR tool
- Stages with `simple-git`, generates messages via a one-shot headless `adapter.generateText` call, creates PRs with `gh`
- Renderer side: `features/workspace/components/session-panel/git-actions/` — one component per row (changes / branch / commit / pull / pr / publish), each owning its own form state (pull owns none — it is the one row that takes no input). `useGitActionsPanel` holds only what several rows share: the status query + `refreshStatus`, the accordion, and the single `pending` action. Publish replaces PR when the repo has no remote. See CONTEXT.md for the rules.

**Remote Backend** (`src/main/modules/localBackend/`, `ssh/`, `tailscale/`, `backendAuth/`)
- `localBackend` — turns the running desktop app into a backend other clients can drive (phone browser, LAN device, another mains over SSH), via an in-process WS host on a fixed port over the same handler registry + DB. Two access paths: network bind (token-gated) and Tailscale HTTPS.
- `tailscale` — wraps the `tailscale` CLI (`tailscale serve`) to expose an HTTPS MagicDNS URL; no DB tables
- `ssh` — local `ssh` client forwards a loopback port to a remote `mains serve`, so the renderer connects to `ws://127.0.0.1:<port>` with all traffic tunneled
- `backendAuth` — pairing tokens encrypted at rest via Electron `safeStorage`, stored under userData (never in renderer localStorage)
- Renderer state lives in `backendsSlice`; design notes in `docs/design/remote-backend.md`

**Terminal Module** (`src/main/modules/terminal/`)
- Pseudoterminal emulation via `node-pty`
- IPC channels: `terminal:create`, `terminal:write`, `terminal:resize`, `terminal:destroy`
- Streams output to renderer via `terminal:data` (hand-written handlers — these need the Electron `event.sender`)

**File Explorer Module** (`src/main/modules/fileExplorer/`)
- Secure filesystem operations within workspace boundaries
- Path traversal prevention, symlink escape detection, file size limits (2MB), binary detection
- `fileExplorer:writeFileText` backs auto-save in the code viewer: overwrites an existing regular file only (no creation), same 2MB cap as reads, optional `expectedMtimeMs` optimistic-concurrency guard ("File changed on disk") so a stale editor buffer can't clobber agent writes

**Space System** (`src/main/modules/space/`)
- User-defined profiles with systemPrompt, model, icon, themeConfig, `providerId`, `mode`, sortOrder, archive flag; `mode` is user-switchable via `SpaceModePicker` in the space customizer, and `systemPrompt` reaches every run through the mode-harness composition
- Space-level overrides for connections, resources, apps, and tool permissions
- Active space set via `appSettings.activeSpaceId`

**Tools System** (`src/main/modules/tools/`)
- Registry for local and provider-builtin tools; tool call tracking with nested calls (`parentToolCallId`)

**Guards Module** (`src/main/modules/guards/`)
- Pluggable package-safety adapters (`adapters/socketdev.adapter.ts` behind `adapter.factory.ts`) that score npm/PyPI/etc. packages and scan a workspace's manifests for risky dependencies. No DB tables — results stream back per call.
- Claude/Copilot enforce package safety through a PreToolUse Bash hook; Codex/Cursor expose the `CheckPackage` tool instead. This asymmetry is deliberate.

**Pull Requests Module** (`src/main/modules/pullRequests/`)
- Live PR inbox behind the `/tasks` screen — no DB tables (PRs are view models, never entities; see CONTEXT.md). Channels: `pullRequests:getAvailability`, `pullRequests:search`, `pullRequests:getDetail`, `pullRequests:getDiff` (unified diff, truncated at a file boundary past 300k chars), plus the actions `pullRequests:merge`, `pullRequests:markReady`, `pullRequests:addComment`, `pullRequests:addReviewComment` (new review thread on a diff line), `pullRequests:replyToThread`, `pullRequests:resolveThread`.
- `sources/` holds the per-provider `PrSource` interface (mirrors sync's `ResourceFetcher` pattern): `github.source.ts` runs GraphQL search/detail and the write mutations with the stored connection token via `getConnectionWithSecrets` — no `gh` CLI dependency. GitLab/Bitbucket land as new source files behind `source.factory.ts`.
- Search defaults to the repos selected on the connection (the same set issue sync pulls from, via `getSelectedResources`); with none selected it falls back to a global `involves:@me` search. An explicit `repos` filter overrides the default scope.

**Browser Module** (`src/main/modules/browser/`)
- Drives an embedded `WebContentsView` panel inside the Electron window — attach/detach, set bounds, navigate, capture screenshots
- `inspector.script.ts` is injected into the guest page for select-mode (DOM element picking); `browser:navState` streams nav state changes to the renderer

**Automations Module** (`src/main/modules/automations/`)
- User-defined scheduled / triggered automations (cron-style routines that fan out into runs) plus their run records

**Pulse Module** (`src/main/modules/pulse/`)
- Scheduled prompts that fan out into runs — backs the `/pulse` route (templates, single-timer scheduler, catch-up on start)
- Mode-aware: a pulse snapshots its `mode` at creation and executes under a space of that provider+mode pair. Developer pulses require a workspace; work/chat pulses run workspace-less (managed execution dir) and may target a collection, whose sources travel into the run. Templates carry a `modes` allowlist (`features/pulse/templates.ts`) — the original corpus is developer-only, work/chat get folder/source-centric sets

**Image Proxy** (`src/main/modules/imageProxy/`)
- Custom protocol handler that fetches and serves remote images to the renderer (avoids CSP / mixed-content issues)
- Pairs with `src/renderer/lib/proxied-image-src.ts` + `local-image-url.ts` and the `useLocalImageUrl` hook — use these instead of `<img src={remoteUrl}>`
- Backs the in-app **document viewer** too (`documents:sign`): Office formats (`.docx/.xlsx/.pptx`) render from bytes behind a shadow root, markdown renders as React through the shared markdown components. `classifyDocType` (`renderer/lib/document-viewer.ts`) is the one table saying what the viewer can show
- Also backs the `api.documents` namespace (`documents:sign`) for serving local document files

**Stats Module** (`src/main/modules/stats/`) — Dashboard statistics and analytics (joins `workspace_diffs` via its own repo)

**Updates Module** (`src/main/modules/updates/`) — Application update checking and management

**Database Seeding** (`src/main/db/seeds/`)
- Not a domain module and has no IPC surface. A versioned, idempotent runner: each `v{N}.ts` exports `run(db)`, the runner tracks `appSettings.seedVersion`, and `db/client.ts` calls `runSeeds(db)` at init. Fixtures live in `src/main/db/data/` (accounts, connectionStates, providers, spaces).

### Configuration

- `drizzle.config.ts` — Drizzle Kit config (dev database: `.data/mains.db`)
- `drizzle.config.runtime.ts` — Runtime database config (`~/Library/Application Support/mains/mains.db`)
- Migration `.sql` files are copied into the build via Vite plugin and bundled as `extraResource`
- `forge.config.js`, `vite.{main,preload,renderer}.config.mjs`, `entitlements.plist`

### Frontend Conventions

- **Redux**: RTK Query with custom `ipcBaseQuery`, `baseApi.injectEndpoints()` per domain
- **Redux API files** (`src/renderer/lib/redux/api/`): `accountApi`, `appSettingsApi`, `automationsApi`, `connectionsApi`, `entitiesApi`, `gitFlowApi`, `guardsApi`, `projectsApi`, `providersApi`, `pullRequestsApi`, `pulseApi`, `runsApi`, `shellApi`, `signalsApi`, `spaceApi`, `statsApi`, `syncApi`, `toolsApi`, `updatesApi`, `workspaceApi` — all built on `baseApi.ts`. The barrel is `export * from "./xApi"` per file — adding an endpoint is one edit, in the file that owns it; only `baseApi` itself is re-exported explicitly, since its IPC base query is not public. Aggregate APIs use split RTK Query tag types (e.g. `workspaceApi`: `Workspace`, `WorkspaceActivity`, `WorkspaceDiff`, `WorkspaceReview`, `WorkspaceFinding`) so UI sections refresh independently.
- **Redux slices** (`src/renderer/lib/redux/slices/`): `appSettingsSlice`, `backendsSlice`, `workspaceSlice`
- **Hooks**: `use-kebab-case.ts` filenames, `useCamelCase` export names
- **Components**: `kebab-case.tsx` filenames in feature dirs under `src/renderer/features/{name}/components/`
- **Feature dirs**: `onboarding`, `pulse`, `relay`, `settings`, `stats`, `tasks`, `workspace`
- **Feature internals**: a feature dir holds `components/`, `hooks/`, `lib/`, and `types/`. Non-component logic goes in `lib/` — there is no separate `utils/` (`features/workspace` had both, with no rule telling them apart, and they imported each other). Tests sit next to the file under test.
- **Layering**: `components/ui/` holds feature-agnostic primitives and may NOT import from `@/features/` (ESLint-enforced). `components/layout/` is the app shell — `main/`, `sidebar/`, `right-panel/`, `page-shell`, `resize-handle` — and composing features there is correct. Feature panels do not belong in `layout/`: the session panel (git actions) and subagent panel live under `features/workspace/components/` and are rendered from `App.tsx`.
- **Shared input UI**: `src/renderer/components/ui/input/` (`input-form`, `rich-input-form`, `permission-mode-dropdown`, `model-select-dropdown`, `fast-mode-button`, `goal-button`, `dictation-button`, `file-upload-dropdown`, `compact-composer-controls`, `send-button`)
- **Routing**: HashRouter — page components in `src/renderer/routes/`
- **Settings Routing**: `/settings?section={id}` — section ids live in `src/renderer/features/settings/settings-sections.tsx`: `general`, `git`, `connections`, `backends`, `dashboard`, `archive`, `claude`, `codex`, `codex-plugins`, `copilot`, `cursor`, `notifications`, `personalization`, `schedules`, `security`, `projects`
- **Styling**: Tailwind CSS v4 (PostCSS-based)

### Provider Variants (renderer)

The four agent UIs share the single `/code` route and are distinguished by a **provider variant** — `claude | copilot | codex | cursor` (distinct from the DB `ProviderId`: `claude_code`, `copilot_cli`, `codex`, `cursor`). The active variant comes from the active space's `providerId` via `useSpaceProviderVariant`, not from the pathname.

`src/renderer/lib/provider-variants.ts` is the single **variant descriptor** table: each variant's `providerId`, icon/accent classes, and capability facts (`permissionKey`, `permissionDefault`, `effortKey`, `thinkingCoupledToEffort`, `fastMode`, `authLoginCommand`, `supportsUltracode` / `supportsPlanMode` / `supportsGoalMode` / `supportsSkills`, plus `/code` wiring like `planExit`, `enableForkRun`, `enableSuggestions`). Read fields from `getProviderVariant(variant)` — never branch with an inline `variant === "..."` ternary or re-declare the union.

### Icon System

- Icon registry: `src/renderer/lib/icon-registry.tsx` — maps icon names to components in `src/renderer/components/ui/icons/`
- Stored icon values take the form `emoji:<char>`, `icon:<name>`, or `icon:<name>|<color>`. `parseIcon()` returns `{ type: "emoji", value }` or `{ type: "icon", value: Component, color? }`; `formatIcon(mode, value, color)` builds the stored value (the default tint is omitted).
- Colors come from `ICON_COLORS`; `iconColorClass(color)` resolves the text class
- To add an icon: drop the component in `components/ui/icons/` and register it in `iconRegistry`

**App Icon Generation** (macOS)
```bash
# From src/renderer/public/ — regenerate iconset from icon.png (must be 1024x1024+)
sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32 icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32 icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64 icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
```

### Input Toolbar (`src/renderer/features/workspace/components/input-toolbar.tsx`)

- Shared toolbar across all four variants (`claude | copilot | codex | cursor`), feature-gated through the variant descriptor rather than inline branching
- **Permission modes**: `default`, `acceptEdits`, `plan`, `bypassPermissions`, `dontAsk`, `auto` — each has a distinct icon and color (`bypassPermissions` uses yellow); rendered by `permission-mode-dropdown.tsx`
- **Effort levels**: `minimal`, `low`, `medium`, `high`, `max`, `xhigh` — display `xhigh` as "Extra High" in UI; per-model availability comes from `modelEffortLevelsByDisplayName`
- **Fast mode**: gradient-styled button (orange→yellow) with animated Bolt icon; boolean for most providers, `serviceTier` for Codex
- **Ultracode**: Claude only — bottom entry of the effort dropdown
- **Thinking mode**: orange-themed toggle with Brain icon plus effort dropdown

### Transcript & Run State (renderer)

- `features/workspace/lib/transcript-rows.ts` — pure (React-free) layout plan for the run transcript. Public: `buildTurnRenderRows(groups)` and `matchTurnsToGroups(...)`; everything else is an internal seam. Keep turn-grouping / accordion / session-bar math out of `workspace-events.tsx`.
- `features/workspace/lib/run-cache.ts` — `createRunCache()` factory owning the retained-run LRU, incremental-sync cursors, loaded/finalized sets, and in-flight dedup behind `use-workspace-runs.ts`. Cursors are monotonic (`Math.max`); `touch(runId)` prunes evicted runs' cursors.
- `use-workspace-runs.ts` holds run state + loading and delegates two subjects: `use-run-operations.ts` (execute / continue / fork / review / canResume, plus the `isLoading` + `error` they drive) and `use-run-sync.ts` (transcript push, status push, polling fallback, `finalizeRun`). Both reach back through exactly three callbacks — `registerNewRun`, `loadRunDetails`, `onRunUpdated` — never raw setters.
- **Structural plan snapshots** arrive as `plan_update` adapter events and are merged into `run_turns.metadata.codexPlan`, so `TodoSummaryBar` recovers state after reload — not stored as fake tool calls.

### Composer Context (renderer)

Everything the composer attaches to the next message — files, issues, signals, skills, browser selections, code selections — is one tagged union, not six parallel lists. See CONTEXT.md for the vocabulary.

- `features/workspace/lib/composer-context.ts` — the `ContextItem` union plus its identity rules (`contextItemKey` for removal, `isSameContextItem` for dedupe) and `groupContextItems` for the per-kind views. The only home for these types.
- `features/workspace/hooks/use-composer-context.ts` — the read path (`items`, the grouped views, `add` / `remove` / `clear`). Components read it directly; never pass context lists or `onRemoveContextX` down as props. A component that only attaches dispatches `addContextItem` instead of subscribing.
- `features/workspace/lib/run-context-payload.ts` — `buildRunContextPayload(items, uploads)` shapes context for `runs:execute` / `runs:continue`. `executeRun` / `continueRun` take one `ContextItem[]`, never per-kind parameters.
- Store side: a single `workspace.contextItems` array behind `addContextItem` / `removeContextItem` / `clearContextItems`.

### Code Style

- Strict TypeScript, but `any` is allowed (`no-explicit-any: off`)
- Unused vars prefixed with `_` (warn, not error)
- No Prettier — formatting via editor settings + ESLint
- No `import React` needed (`react-jsx` transform)

### Connections (External Services)

Each connection type has:
- Modal in `src/renderer/features/settings/components/connections/`
- Fetcher in `src/main/modules/sync/connections/`
- Channels under `connections:*` for credentials, resources, and states

Supported: GitHub, GitLab, Linear, Jira, Asana, Trello, Sentry (+ Socket.dev for the guards module).

GitHub additionally offers **OAuth device flow** sign-in next to the PAT form (`connections:githubDeviceStart` / `connections:githubDevicePoll`, main-process only because GitHub's OAuth endpoints send no CORS headers). The flow yields a plain access token that the renderer saves through the normal `connections:saveCredentials` path — storage, sync, and the PR inbox are method-agnostic. Requires a GitHub OAuth App client id, supplied as `MAINS_GITHUB_CLIENT_ID` at **build** time — `.env.local` locally (loaded by `forge.config.js`), the repo secret of the same name in `release.yml`. It is the one MAINS_* env var the main process does not read at runtime: `vite.main.config.mjs` bakes it into the bundle via `define`, because a released app has no build environment left to read. Unset, the button reports sign-in as unconfigured and the token tab still works. The credential-step tabs come from `ResourceWizardConfig.credentialAlternative` — provider-agnostic, GitHub is just the first user.

**Credential Storage (Encrypted JSON Blob)**

All provider secrets are stored as a single encrypted JSON blob in `connectionTokens.accessTokenEnc`. Each provider declares its secret fields in `PROVIDER_SECRET_FIELDS` (`connections.utils.ts`), shaped as `{ required: string[]; optional?: string[] }`:

| Provider  | Secret fields | Non-secret metadata |
|-----------|--------------|---------------------|
| GitHub    | `token` | — |
| Linear    | `apiKey` | — |
| Jira      | `apiToken` | `domain`, `email` |
| GitLab    | `token` | `domain` |
| Asana     | `accessToken` | — |
| Trello    | `token`, `apiKey` | — |
| Sentry    | `token` | — |
| Socket.dev | `apiToken` | — |

Key functions (in `connections.utils.ts` unless noted):
- `encryptSecrets(secrets)` / `decryptSecrets(buffer)` — encrypt/decrypt the JSON blob
- `parseProviderCredentials(provider, credentials)` — validates and extracts secrets per provider config
- `createTokenHash`, `parseConnectionMetadata` — module-internal helpers, not re-exported
- `getConnectionWithSecrets(provider)` (in `connections.service.ts`, exported from the barrel) — returns `{ id, secrets, metadata }` for sync fetchers and guards
- `getConnectionAndSecrets(connectionId)` — same pattern for connection operations

To add a new provider's secrets: add an entry to `PROVIDER_SECRET_FIELDS`. Non-secret fields (domain, email) go in `PROVIDER_METADATA_FIELDS` in `connections.service.ts`. Never import the crypto helpers across modules — call `getConnectionWithSecrets`.

### Troubleshooting

- **Preload changes not taking effect**: Restart the dev server completely; changes to `src/preload/index.ts` require a full restart
- **Database locked errors**: Close all app instances, then `npm run db:clean:dev && npm run db:push`
- **Dual DB paths**: `.data/mains.db` (dev) vs `~/Library/Application Support/mains/mains.db` (packaged)
- **`vitest` fails on better-sqlite3**: run `npm rebuild better-sqlite3` (the `npm test` scripts do this for you)
