# CLAUDE.md

This package owns the Electron-free Mains execution backend. Read
`../../apps/desktop/CONTEXT.md` before changing its domain modules.

Run commands from `packages/backend`:

```bash
npm install
npm test
npm run typecheck
npm run lint
```

Keep Electron adapters in `apps/desktop`. Code in `src/` and `shared/` must not
import `electron`; both the desktop and standalone server compile this source.
The public module seams are declared in `package.json#exports`. Add a new export
only when a host genuinely needs it; keep repos and internal helpers private.

`@mains/contracts` owns wire contracts and DTOs. This package owns backend
implementation and shared provider/runtime types.
