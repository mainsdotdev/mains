# Contributing to Mains

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/mainsdotdev/mains.git
cd mains/apps/desktop
npm install
npm run db:push
npm start
```

**Requirements:** Node.js 22.12+, Git

## Project Structure

```
apps/desktop/      # Electron host, preload, and React renderer
apps/server/       # Standalone Node host, CLI, and release package
packages/backend/  # Shared Electron-free backend implementation
packages/contracts/# Shared wire contract
```

Each domain module in `packages/backend/src/modules/` follows the pattern:
**IPC → Service → Repository → DTO**

All layers are plain object literals — no classes, no dependency injection.

## Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run checks before committing:

```bash
npm run lint:fix    # Fix lint 
npm test            # Run all tests
```

4. Push and open a Pull Request

## Code Style

- **TypeScript** throughout, strict mode enabled
- **No Prettier** — formatting via ESLint + editor settings
- `any` is allowed (`no-explicit-any: off`)
- Unused vars prefixed with `_`
- No `import React` needed (jsx transform)
- Snake_case SQL columns, camelCase TypeScript — Drizzle handles mapping

## Writing Tests

- Test framework: **Vitest**
- DB tests use `createTestDb()` for in-memory SQLite
- Factory functions in `packages/backend/test/factories.ts` for backend test data
- Mock `getDb()` via `vi.mock("../../db/client", ...)`
- Use `vi.spyOn` for error path coverage

```bash
npm test                           # Run all tests
npm run test:watch                 # Watch mode
npm run test:coverage              # Coverage report
npx vitest run path/to/file.test.ts  # Single file
```

## Database Changes

1. Edit the schema in `packages/backend/src/db/schema.ts`
2. Generate a migration: `npm run db:generate`
3. Apply to dev DB: `npm run db:push`
4. If things break: `npm run db:clean:dev && npm run db:push`

## Adding a New Module

Create files in `packages/backend/src/modules/{name}/`:

| File | Role |
|------|------|
| `{name}.ipc.ts` | IPC handlers (`ipcMain.handle`) — call the service directly |
| `{name}.service.ts` | Business logic, returns plain values and throws on failure |
| `{name}.repo.ts` | Database queries (Drizzle) |
| `{name}.dto.ts` | Types and formatters |
| `{name}.validation.ts` | Input validation (hand-rolled, no zod) |
| `index.ts` | Barrel exports |

Then register the IPC handlers in `src/main/index.ts` and expose methods in `src/preload/index.ts`.

## IPC Channels

Channel format: `"domain:action"` (e.g. `"entities:getAll"`). Must stay in sync across:
1. `src/preload/index.ts`
2. `packages/backend/src/modules/{name}/{name}.ipc.ts`
3. `src/renderer/lib/redux/api/{name}Api.ts`

## Important Notes

- **Preload changes** require a full dev server restart
- All IPC responses use `ServiceResponse<T>`: `{ success, data }` or `{ success, error }`
- Repos call `getDb()` per method (no shared instance)
- Updates must manually set `updatedAt: sql\`(unixepoch())\``

## Reporting Issues

Use the [issue templates](https://github.com/mainsdotdev/mains/issues/new/choose) for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
