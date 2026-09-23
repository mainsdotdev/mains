# Mains Backend

The Electron-free execution backend shared by `apps/desktop` and
`apps/server`. It owns SQLite, domain modules, provider adapters, the
transport-neutral IPC registry, WebSocket hosting, and backend lifecycle.

Host applications install one adapter at the runtime seam before booting:

- Desktop installs the Electron runtime, real `ipcMain`, BrowserWindow event
  sink, native dialogs/protocols, and OS notifications.
- Server installs the Node runtime and starts the same backend over WebSocket.

Run checks from this directory:

```bash
npm install
npm test
npm run typecheck
npm run lint
```
