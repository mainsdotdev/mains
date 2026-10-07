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
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-Drizzle_ORM-003B57.svg?logo=sqlite&logoColor=white)](https://orm.drizzle.team/)

  </p>
</div>

---

Mains is a macOS app for working with AI agents — **Claude Code**, **OpenAI Codex**, **GitHub Copilot**, and **Cursor** — side by side. Each space picks an agent and a mode: **Code** for repositories, **Work** for documents and files, **Chat** for conversations that only read. Runs keep going in the background, you can answer them from a notification, the menu bar, or your iPhone, and the same backend can run on a Mac or a Linux machine without the desktop app.

📖 What's new: [mains.dev/changelog](https://mains.dev/changelog)

## Install

Download the latest DMG for Apple Silicon (`arm64`) or Intel (`x64`) from [Releases](https://github.com/mainsdotdev/mains/releases/latest) and move Mains to **Applications** — it updates itself from there.

**Platform:** macOS only (Apple Silicon and Intel). The [standalone server](#standalone-server) also runs on Linux.

### Agents

Onboarding shows where each agent stands and signs you in.

- **Claude Code** and **GitHub Copilot** come with Mains — nothing to install, just sign in.
- **OpenAI Codex** needs the [Codex CLI](https://developers.openai.com/codex/cli): `npm install -g @openai/codex`.
- **Cursor** needs the [Cursor Agent CLI](https://docs.cursor.com/en/cli/overview): `curl https://cursor.com/install -fsS | bash`.

## Features

### Agents

- **Four agents, one app** — Claude Code, Codex, Copilot, and Cursor, each in its own space; switch spaces to switch agents
- **Code, Work, and Chat modes** — the app and the agent's tools change with the mode; Chat is read-only for the agent, not just in the interface
- **Sessions** — resume, continue, and fork runs; every chat remembers its own model, effort, and permission settings
- **Approvals** — allow or deny tool calls in the chat, from a notification, or from the menu bar
- **Steering & queue (Codex)** — keep typing while a turn runs; steer the running turn or let messages queue
- **Voice (Codex, experimental)** — talk it through; bigger tasks run in their own chat while you keep talking
- **MCP** — extend agents with Model Context Protocol servers; MCP apps open beside a chat or full window

### Code

- **Git-backed workspaces** — local repositories with optional worktree isolation, grouped into projects by remote origin
- **Turn changes** — every turn's file changes as a card with a diff and an Undo, safe even when two agents share a worktree
- **Review** — every uncommitted change as one list of diffs, with line comments that go to the agent with your next message
- **Git actions** — commit, push, pull, and open pull requests with generated messages; a Markdown PR editor with screenshots and videos
- **Files** — an in-app editor, image preview, and content search across the workspace (respects `.gitignore`)

### Work & Chat

- **Collections** — group chats and attach shared files or text as sources
- **Documents** — Word, Excel, PowerPoint, PDF, and Markdown open inside the app
- **Sources & deliverables** — what went into a run and what came out of it, side by side

### Around the app

- **In-app browser** — tabs that belong to their chat, annotations you can send to the agent, device emulation, and a right-click menu
- **Search** (`⌘⌥K`) — commands, workspaces, runs, and documents, including what was said inside a run
- **Lens** (`⌘⇧Space`) — attach your frontmost Mac window to the next message
- **Pulse** — scheduled prompts that run on their own
- **Tasks** — issues and pull requests from your connected tools, with a full PR review view
- **Themes** — 31 presets, a theme per agent, your own accent, and UI and code fonts

### Integrations

- **Issue sync** — GitHub, GitLab, Linear, Jira, Asana, and Trello
- **Error tracking** — Sentry issues as signals with stack traces, affected users, and regression info
- **Dependency guards** — package security checks via Socket.dev before installs (npm, pip, cargo, go, gems)

### Anywhere

- **iPhone** — pair with a QR code to follow runs, send the next prompt, and answer approvals
- **Standalone server** — the same backend and web UI on macOS or Linux, without the desktop app
- **Remote access** — over your local network, Tailscale, or SSH

### Observability

- **Dashboard** — daily runs, cost by model, tool usage, and success rates per agent
- **Run artifacts** — patches, files, logs, reports, and command results per session
- **Cost tracking** — token usage and USD cost per run, with cache metrics

## Standalone server

Mains Server runs the backend and browser UI without Electron. Release builds
are portable npm packages; platform-specific dependencies are installed for the
host machine. Node.js 22.12+ is required.

```bash
npm install --global https://github.com/mainsdotdev/mains/releases/latest/download/mains-server.tgz
mains serve
```

The first run creates a persistent full-access owner token. To connect a phone
on the same trusted network, expose private interfaces and scan the printed,
five-minute pairing QR:

```bash
mains serve --lan
```

The phone exchanges that one-time code for its own revocable device token. Use
`mains pair` for another link, `mains web` for a one-use browser login, and
`mains auth list|revoke` to manage access without restarting the backend.

For remote access, use `mains serve --tailscale-serve`, or keep the default
loopback bind and use **Settings → Mains Connect → SSH** from the desktop app.
The standalone server can stay available without Electron or an open terminal:

```bash
mains service install --tailscale-serve
```

This installs a macOS LaunchAgent or Linux systemd user service. Direct public
exposure should sit behind a TLS proxy and be advertised explicitly with
`--public-url`.

By default the server opens the desktop app's Mains data directory, so existing
workspaces, collections, and run history appear without an import. Quit the
desktop app before starting the server, and stop the server before reopening
the app; an ownership lock rejects concurrent backend access. `--data-dir` opts
into isolated data.

Integration credentials saved in the desktop app are encrypted with the macOS
keychain, which the server can't read; signing an integration in on the server
adds a credential of its own instead of replacing the desktop's. CLI-backed
agents use their normal host authentication.

## Repository layout

| Path | What it is |
|------|------------|
| `apps/desktop` | The Electron desktop app (React 19 renderer, SQLite + Drizzle ORM) |
| `apps/server` | The standalone server: Node entrypoint, `mains` CLI, npm packaging |
| `apps/mobile` | The iPhone app (Expo / React Native), the desktop's remote control |
| `packages/backend` | The Electron-free backend shared by desktop and server: database, domains, agent runtimes, transport |
| `packages/contracts` | The wire contract shared by every app: IPC channels, WebSocket protocol, provider ids, modes |
| `packages/icons` | The desktop icon registry as data (SVG shapes + tint helpers), so the iPhone app draws space and project icons the same way |

Each app and package installs its own dependencies — there is no root install.
`packages/backend` and `packages/contracts` are linked as `file:` dependencies,
so editing them needs no build step.

## Development

**Prerequisites:** [Node.js](https://nodejs.org/) 22.12+, Git

```bash
git clone https://github.com/mainsdotdev/mains.git
cd mains/apps/desktop
npm install
npm start
```

Desktop commands (from `apps/desktop`):

```bash
npm start              # Start the Electron app
npm run lint:fix       # Lint with auto-fix
npm run typecheck      # Type-check main, preload, and renderer
npm test               # Run the tests
npm run package        # Package for current platform
npm run make           # Create distributable
```

Standalone server commands (from `apps/server`; packaging also needs
`apps/desktop` dependencies installed):

```bash
npm --prefix ../desktop install
npm install
npm run serve -- --lan         # Build, run, and print a phone pairing QR
npm run pair                    # Refresh the one-time pairing link
npm run service -- status       # Inspect the background service
npm run package                 # Build dist/mains-server.tgz
npm run smoke:package           # Clean-install and exercise WS/HTTP/CLI flows
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

For the iPhone app, see [apps/mobile/README.md](./apps/mobile/README.md).

### Database

From `apps/desktop`:

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
