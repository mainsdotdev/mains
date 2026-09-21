# CLAUDE.md

This file provides guidance to coding agents working with code in this repository. It is kept byte-identical to its companion instruction file apart from the heading — update both together.

## Repository layout

This is a monorepo:

- `apps/desktop` — the Mains desktop app (Electron). Its own `CLAUDE.md` / `AGENTS.md` / `CONTEXT.md` live there; read them before working on it.
- `apps/mobile` — the Mains mobile app (Expo / React Native), the desktop's remote control. Its own `CLAUDE.md` / `AGENTS.md` live there.
- `apps/server` — the standalone Node backend and browser UI package. It owns the headless composition root, CLI, packaging, and server release checks. Its own `CLAUDE.md` / `AGENTS.md` live there.
- `packages/backend` — the Electron-free backend implementation shared by the desktop and standalone server: database, domain modules, provider runtimes, transport-neutral IPC/WebSocket plumbing, and lifecycle orchestration. Its own `CLAUDE.md` / `AGENTS.md` live there.
- `packages/contracts` — the wire contract shared by both apps: IPC channel names, the WebSocket protocol, provider ids, modes, and the device-facing DTO types.

Each app and executable package installs its own dependencies (`npm install` in `apps/desktop`, `apps/server`, or `packages/backend`); there is no root install and no hoisting. `packages/backend` and `packages/contracts` are linked as `file:` dependencies, so editing them needs no build step in consumers.

Run every npm command from the directory of the app you are working on.
