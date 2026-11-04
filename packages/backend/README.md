# Mains Backend

The Electron-free execution backend shared by `apps/desktop` and
`apps/server`. It owns SQLite, domain modules, provider adapters, the
transport-neutral IPC registry, WebSocket hosting, and backend lifecycle.

Host applications install one adapter at the runtime seam before booting:

- Desktop installs the Electron runtime, real `ipcMain`, BrowserWindow event
  sink, native dialogs/protocols, and OS notifications.
- Server installs the Node runtime and starts the same backend over WebSocket.

Run checks from this directory:

First install the shared relay endpoint dependencies with `npm install` from
`../relay`; each package owns its own dependencies.

```bash
npm install
npm test
npm run typecheck
npm run lint
```

Optional private relay configuration and `npm run test:relay` acceptance checks
are documented in [Mains Relay](../../apps/relay/README.md).
