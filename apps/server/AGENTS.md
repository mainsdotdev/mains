# AGENTS.md

This file provides guidance to coding agents (Codex CLI, Claude Code, Copilot CLI, Cursor) when working with the standalone Mains server.

## Commands

Run every command from `apps/server`.

```bash
npm install
npm run serve -- --lan --port 8787
npm run pair
npm run auth -- list
npm run service -- status
npm run build
npm test
npm run typecheck
npm run lint
npm run package
npm run smoke:package
```

Serving and packaging also build `apps/desktop/dist-web`, so install the desktop app's dependencies before running `npm run serve` or `npm run package` from a fresh checkout.

## Boundaries

- This app owns the standalone Node composition root, CLI, package template, build, smoke test, and release archive.
- Never import Electron. The Vite build deliberately fails if any module in the reachable server graph imports it.
- Consume backend implementation only through `@mains/backend`. Domain modules, database code, provider runtimes, and transport-neutral IPC/WebSocket plumbing belong in `packages/backend`; Electron adapters belong in `apps/desktop`.
- `packages/contracts` owns the wire protocol and DTO contract. It is bundled into the server artifact and must not become a published runtime dependency.
- Keep this package's version aligned with `apps/desktop/package.json`; release CI enforces both against the tag.
- Desktop and standalone use the canonical Mains data directory by default. Exactly one backend process may own it; keep the database ownership lock in the shared backend and never bypass it.
