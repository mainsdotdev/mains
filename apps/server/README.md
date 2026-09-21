# Mains Server

The standalone Mains backend and browser UI. This app owns the Node entrypoint,
CLI, distributable npm archive, and server release checks; it never imports
Electron.

```bash
npm --prefix ../desktop install
npm install
npm run serve -- --port 8787
```

Build and verify the installable archive:

```bash
npm run package
npm run smoke:package
```

`npm run serve` and `npm run package` also build the web client in `../desktop`,
so the desktop dependencies must be installed when using either command from a
source checkout.

The executable host lives here; the shared implementation lives in
`packages/backend` and is consumed through `@mains/backend`. The backend package
has an ESLint guard against Electron imports, and this app's Vite build also
treats any reachable Electron import as a hard failure.
