# Copilot Instructions — Mains

Mains is an Electron 41 desktop app (React 19 renderer, SQLite + Drizzle ORM). CommonJS package with ESM Vite configs (`.mjs`). macOS only (Apple Silicon and Intel).

## Build & Test

```bash
npm start              # Dev server (full restart needed for preload changes)
npm run lint           # ESLint on src/
npm run lint:fix       # Auto-fix
npm run db:generate    # Generate Drizzle migrations from schema changes
npm run db:push        # Push schema to dev DB (.data/mains.db)
npm run db:studio      # Open Drizzle Studio (dev database)
npm run db:studio:runtime  # Open Drizzle Studio (runtime database)
npm run db:clean:dev   # Reset dev database
npm run db:clean:runtime   # Reset runtime database
npm run db:clean:all   # Reset both databases
npm run package        # Package for current platform
npm run make           # Create distributable
```

## Architecture

Three Electron processes with strict boundaries:

- **Main** (`src/main/`) — DB, IPC handlers, business logic in domain modules
- **Preload** (`src/preload/index.ts`) — typed `window.api` bridge, namespace-per-domain
- **Renderer** (`src/renderer/`) — React + Redux Toolkit + HashRouter, `@/` alias → `src/renderer/`

## Module Pattern (`packages/backend/src/modules/{name}/`)

Every backend domain uses this exact structure (see `packages/backend/src/modules/account/` as reference):

| File | Role |
|------|------|
| `{name}.ipc.ts` | `registerXxxIpc()` / `unregisterXxxIpc()` using `ipcMain.handle` — calls the service directly (no controller layer) |
| `{name}.service.ts` | Object literal with business logic, uses `this` for sibling calls; returns `Promise<ServiceResponse<T>>` |
| `{name}.repo.ts` | Object literal, calls `getDb()` per method, Drizzle queries |
| `{name}.dto.ts` | Types via `typeof table.$inferSelect`, formatter functions |
| `{name}.validation.ts` | Hand-rolled allowlist validation (no zod/yup) |
| `index.ts` | Barrel exports |

**Critical**: All layers are **plain object literals**, never classes. No DI — repos call `getDb()` inline.

All modules: `account`, `appSettings`, `automations`, `browser`, `connections`, `entities`, `fileExplorer`, `git`, `guards`, `imageProxy`, `projects`, `providers`, `pulse`, `runs`, `skillsMarketplace`, `space`, `stats`, `sync`, `terminal`, `tools`, `updates`, `workspace`

## IPC Convention

Channel format: `"domain:action"` (e.g. `"runs:start"`, `"entities:getAll"`). All channels are defined once in `src/shared/ipc-kit/channels.ts` as a typed map (`CHANNELS.entities.getAll`) — never type the channel string literally. Referenced from three sites:

1. `src/preload/index.ts` — `ipcRenderer.invoke(CHANNELS.entities.getAll, ...)`
2. `packages/backend/src/modules/{name}/{name}.ipc.ts` — `ipcMain.handle(CHANNELS.entities.getAll, ...)`
3. `src/renderer/lib/redux/api/{name}Api.ts` — `{ handler: CHANNELS.entities.getAll }`

All IPC responses use the `ServiceResponse<T>` envelope, constructed via `ok(data)` → `{ success: true, data }` or `fail(msg)` → `{ success: false, error }` (from `src/shared/ipc-kit/service-response`).

## Database (`packages/backend/src/db/schema.ts`)

- Text primary keys (UUIDs or string literals), timestamps as `integer("col", { mode: "timestamp" })` with `default(sql\`(unixepoch())\`)`
- Snake_case SQL columns, camelCase TypeScript — Drizzle handles mapping
- Booleans: `integer("col", { mode: "boolean" })`, enums: `text("col", { enum: [...] })`
- Updates must manually set `updatedAt: sql\`(unixepoch())\``
- Index naming: `idx_{table}_{col}`, unique: `uniq_{table}_{desc}`

## Frontend Conventions

- **Redux**: RTK Query with custom `ipcBaseQuery` (no HTTP), `baseApi.injectEndpoints()` per domain
- **Hooks**: `use-kebab-case.ts` filenames, `useCamelCase` export names
- **Components**: `kebab-case.tsx` filenames in feature dirs under `src/renderer/features/{name}/components/`
- **Routing**: HashRouter — routes at `/`, `/settings`, `/copilot[/:workspaceId]`, `/claude[/:workspaceId]`, `/codex[/:workspaceId]`, `/cursor[/:workspaceId]`, `/plugins`, `/pulse`, `/relay`
- **Styling**: Tailwind CSS v4 (PostCSS-based)

## Code Style

- Strict TypeScript, but `any` is allowed (`no-explicit-any: off`)
- Unused vars prefixed with `_` (warn, not error)
- No Prettier — formatting via editor settings + ESLint
- No `import React` needed (`react-jsx` transform)

## Gotchas

- Preload changes require full dev server restart
- Dual DB paths: `.data/mains.db` (dev) vs `~/Library/Application Support/mains/mains.db` (packaged)
- Migration `.sql` files are copied into the build via Vite plugin and bundled as `extraResource`
