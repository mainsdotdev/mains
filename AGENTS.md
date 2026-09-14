# AGENTS.md

This file provides guidance to coding agents (Codex CLI, Claude Code, Copilot CLI, Cursor) when working with code in this repository. It is kept byte-identical to `CLAUDE.md` apart from this heading — update both together.

## Repository layout

This is a monorepo:

- `apps/desktop` — the Mains desktop app (Electron). Its own `CLAUDE.md` / `AGENTS.md` / `CONTEXT.md` live there; read them before working on it.
- `apps/mobile` — the Mains mobile app (Expo / React Native), the desktop's remote control. Its own `CLAUDE.md` / `AGENTS.md` live there.
- `packages/contracts` — the wire contract shared by both apps: IPC channel names, the WebSocket protocol, provider ids, modes, and the device-facing DTO types.

Each app installs its own dependencies (`npm install` inside the app directory); there is no root install and no hoisting. `packages/contracts` is linked into both apps as a `file:` dependency, so editing it needs no build step.

Run every npm command from the directory of the app you are working on.
