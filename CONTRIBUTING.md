# Contributing to Mains

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

**Requirements:** Git, and Node.js **22.17+** for the desktop app. The server package accepts Node.js 22.12+. The Expo app requires Node.js 24.20.

There is no root install. Each app and package has its own `node_modules`, so run every npm command from that directory. `packages/backend` and `packages/contracts` are linked with `file:` dependencies.

Desktop (the usual place to start):

```bash
git clone https://github.com/mainsdotdev/mains.git
cd mains/apps/desktop
npm install
npm start
```

The first launch applies database migrations. The desktop app is developed on macOS. The standalone server also runs on Linux.

Other apps:

| App | Start here |
|-----|------------|
| Standalone server | [apps/server/README.md](./apps/server/README.md) — install `apps/desktop` dependencies before `npm run serve` or `npm run package` |
| Expo iPhone and Android client | [apps/mobile/README.md](./apps/mobile/README.md) |
| Native SwiftUI iPhone app | [apps/ios/README.md](./apps/ios/README.md) |
| Bridge hub | [apps/bridge/README.md](./apps/bridge/README.md) |

## Project Structure

```
apps/desktop/       # Electron host, preload, and React renderer
apps/server/        # Standalone Node host, CLI, and release package
apps/mobile/        # Expo / React Native remote control (iOS and Android)
apps/ios/           # Independent SwiftUI iPhone app
apps/bridge/        # Ciphertext-only Bridge hub (Cloudflare Worker)
packages/backend/   # Shared Electron-free backend
packages/contracts/ # Shared wire contract: channels, WebSocket protocol, provider ids
packages/icons/     # Shared icon shapes for desktop and iPhone
```

Each domain module in `packages/backend/src/modules/` follows **IPC → Service → Repository → DTO**. All layers are plain object literals: no classes, no dependency injection. A module that owns no tables skips `repo` and `dto`. Electron-only adapters stay in `apps/desktop/src/main/modules/`.

## Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. From the package you changed, run its checks before committing:

```bash
npm run lint:fix    # desktop, or npm run lint in packages/backend
npm run typecheck
npm test
```

4. Push and open a Pull Request

`npm test` rebuilds `better-sqlite3` for the local Node ABI. Running `vitest` directly skips that rebuild.

## Code Style

- **TypeScript** throughout, strict mode enabled
- **No Prettier** — formatting via ESLint + editor settings
- `any` is allowed (`no-explicit-any: off`)
- Unused vars prefixed with `_`
- No `import React` needed (jsx transform)
- Snake_case SQL columns, camelCase TypeScript — Drizzle handles mapping
- Renderer colors come from theme tokens (`primary`, `accent`, `action`), not hex or Tailwind palette classes

## Writing Tests

- Test framework: **Vitest**
- Backend DB tests use `createTestDb()` from `packages/backend/test/setup-db.ts` (in-memory SQLite with migrations applied)
- Factory functions live in `packages/backend/test/factories.ts`
- Module tests mock the database client: `vi.mock("../../db/client", ...)` — adjust the relative path to the test file
- Use `vi.spyOn` for error path coverage
- Desktop-adapter tests sit next to the file under test. Shared backend tests live in `packages/backend`

```bash
npm test                              # Run all tests in this package
npm run test:watch                    # Watch mode
npm run test:coverage                 # Coverage report (desktop)
npx vitest run path/to/file.test.ts   # Single file, after npm rebuild better-sqlite3
```

## Database Changes

From `apps/desktop`:

1. Edit the schema in `packages/backend/src/db/schema.ts`
2. Generate a migration: `npm run db:generate`
3. Apply to the dev DB: `npm run db:push`
4. If things break: `npm run db:clean:dev && npm run db:push`

Startup runs committed migrations on its own. `db:push` is for the dev database while a schema change is in progress.

## Adding a New Module

Create the files the module needs in `packages/backend/src/modules/{name}/`:

| File | Role |
|------|------|
| `{name}.ipc.ts` | IPC handlers — call the service directly |
| `{name}.service.ts` | Business logic. Returns plain values and throws on failure |
| `{name}.repo.ts` | Database queries (Drizzle). Stays module-internal |
| `{name}.dto.ts` | Types and formatters |
| `{name}.validation.ts` | Hand-rolled input validation |
| `index.ts` | Barrel exports (service, dto, and selected functions — never the repo) |

Import `ipcMain` from `packages/backend/src/ipc-kit/ipc-main`, the shim shared by Electron and the WebSocket host. Wrap handlers with `handle()` from `ipc-kit/handle`.

Register a shared module in both composition roots: `apps/desktop/src/main/index.ts` and the `BACKEND_REGISTRATIONS` list in `packages/backend/src/serve.ts`. Electron-only adapters are registered only in the desktop root. Expose renderer methods in `apps/desktop/src/preload/index.ts`.

Domain `validation.ts` files stay hand-rolled. Zod is reserved for the agent tool schemas under the provider adapters.

## IPC Channels

Channel names are declared once in `packages/contracts/src/channels.ts` as `CHANNELS` (`"domain:action"`, for example `CHANNELS.entities.getAll`). Preload, IPC handlers, and RTK Query endpoints import that map. Add a channel by editing the map, then wire the handler, the preload method, and the renderer endpoint. Type the channel through `CHANNELS`, not as a string literal.

## Important Notes

- **Preload changes** require a full dev server restart
- Services return plain values and throw. `ServiceResponse<T>` (`{ success: true, data }` or `{ success: false, error }`) is built only at the IPC seam
- Repos call `getDb()` per method
- Updates must manually set `updatedAt: sql\`(unixepoch())\``
- Security reports go to [SECURITY.md](./SECURITY.md). Please don't open a public issue for them

## Reporting Issues

Use the [issue templates](https://github.com/mainsdotdev/mains/issues/new/choose) for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
