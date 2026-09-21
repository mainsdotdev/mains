<div align="center">
  <br />
  <a href="https://github.com/mainsdotdev/mains">
    <img src="icon.png" width="100" alt="Mains" />
  </a>
  <br />
  <br />
  <p>
    <h3>
      <b>Mains</b>
    </h3>
  </p>
  <p>
    <b>
      Home for agents
    </b>
  </p>
  <p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Electron](https://img.shields.io/badge/Electron-41-47848F.svg?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-Drizzle_ORM-003B57.svg?logo=sqlite&logoColor=white)](https://orm.drizzle.team/)

  </p>
</div>

---

Mains is a desktop app for running AI coding agents in managed workspaces. It wraps the **GitHub Copilot**, **Claude Code**, and **Cursor** SDKs and the **OpenAI Codex** app server, tracks every run with full observability, and syncs issues from the tools you already use — all from one place.

```
npm install
npm start
```

## Features

### Agents

- **Multi-Agent** - Run GitHub Copilot, Claude Code, OpenAI Codex, and Cursor side by side
- **Session Management** - Resume, continue, and fork agent sessions across runs
- **Tool Approval** - Interactive approve/deny flow for agent tool calls with pre-approved tool lists
- **Structured Output** - Define JSON schemas to constrain Claude agent output format
- **MCP Support** - Extend agents with Model Context Protocol servers

### Workspaces & Projects

- **Git-backed Workspaces** - Status tracking (backlog → todo → in_progress → in_review → done), worktree isolation, and per-run diffs
- **Projects** - Group workspaces by remote origin with setup/run/archive scripts and shared commit/PR instructions
- **Code Reviews** - Request structured reviews with severity-tagged findings, file locations, and suggestions
- **Context Injection** - Attach files, diffs, selections, terminal output, linked issues, and Sentry errors as run context
- **Activity Log** - Automatic tracking of commits, reviews, findings, and PRs per workspace

### Integrations

- **Issue Sync** - GitHub, GitLab, Linear, Jira, Asana, and Trello
- **Error Tracking** - Sentry issues synced as signals with stack traces, affected users, and regression info
- **Dependency Guards** - Package security checks via Socket.dev before installs (npm, pip, cargo, go, gems)

### Observability

- **Stats Dashboard** - Daily runs, cost breakdown by model, tool usage analytics, and success rates per provider
- **Run Artifacts** - Collected patches, files, logs, reports, and command results per session
- **Cost Tracking** - Token usage and USD cost per run with cache metrics


## Quick Start

**Desktop platform:** macOS only (Apple Silicon and Intel). The standalone
server below also targets Linux.

**Prerequisites:** [Node.js](https://nodejs.org/) 22.12+, Git

```bash
git clone https://github.com/mainsdotdev/mains.git
cd mains/apps/desktop
npm install
npm start
```

1. Open **Settings** and configure a provider (Copilot, Claude, Codex, or Cursor)
2. Add a local git repository as a workspace
3. Open the Copilot, Claude, Codex, or Cursor view and start an agent run

For Copilot, you'll need [GitHub CLI](https://cli.github.com/) authenticated (`gh auth login`).
For Claude, you'll need [Claude Code](https://docs.anthropic.com/en/docs/claude-code) authenticated (`claude login`).
For Codex, you'll need [Codex CLI](https://github.com/openai/codex) authenticated (`codex auth login`).
For Cursor, you'll need the [Cursor Agent CLI](https://cursor.com/cli) installed (`curl https://cursor.com/install -fsS | bash`) and authenticated (`cursor-agent login`).

## Standalone server

Mains Server runs the backend and browser UI without Electron. Release builds
are portable npm packages; platform-specific dependencies are installed for the
host machine. Node.js 22.12+ is required.

```bash
npm install --global https://github.com/mainsdotdev/mains/releases/latest/download/mains-server.tgz
mains-server
```

The first run creates a persistent pairing token and prints a local browser URL.
Use `mains-server --help` for bind, port, data-directory, token-rotation, and
Tailscale options.

For remote access, keep the default loopback bind and use **Settings → Mains
Connect → SSH** from the desktop app. A typical SSH launch command is
`mains-server --port 8787`; Mains creates the tunnel and supplies an ephemeral
token. For an already-running server reached through Tailscale or another TLS
proxy, add its `wss://` URL and the token printed by the server.

The standalone server currently targets macOS and Linux. It uses a separate
state directory by default; never point it and the Electron app at the same
SQLite database concurrently.

## Development

Desktop commands (from `apps/desktop`):

```bash
npm start              # Start the Electron app
npm run lint:fix       # Lint with auto-fix
npm run package        # Package for current platform
npm run make           # Create distributable
```

Standalone server commands (from `apps/server`; packaging also needs
`apps/desktop` dependencies installed):

```bash
npm --prefix ../desktop install
npm install
npm run serve -- --port 8787  # Build and run without Electron
npm run package               # Build dist/mains-server.tgz
npm run smoke:package         # Clean-install and exercise WS + HTTP
```

The standalone development server exposes the Mains protocol over a
token-gated WebSocket. Its executable composition root stays in `apps/server`;
the Electron-free database, domain services, provider runtimes, and transport
implementation shared with desktop live in `packages/backend`.

Shared backend checks (from `packages/backend`):

```bash
npm install
npm run typecheck
npm run lint
npm test
```

### Database

```bash
npm run db:push        # Push schema changes
npm run db:studio      # Open Drizzle Studio
npm run db:generate    # Generate migrations
npm run db:clean:dev   # Reset dev database
```

### Troubleshooting

- **Database locked** — Close all instances, run `npm run db:clean:dev && npm run db:push`
- **Preload changes not working** — Full restart required for `src/preload/index.ts` changes
- **better-sqlite3 mismatch** — Run `npm run reset`
- **Full reset** — Run `npm run hard-reset`

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) &copy; [Mains](https://github.com/mainsdotdev)
