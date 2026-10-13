# mobile

Expo/React Native client for controlling a Mains desktop backend from iOS. Android support is planned for a later release.

## Requirements

- Node 24.20.0 (see `.node-version` or `.nvmrc`)
- npm
- An Expo account for cloud builds
- Xcode when building the app locally

## Development

Install dependencies and verify the project:

```bash
npm install
npm run doctor
npm test
npm run typecheck
npm run lint
```

The app uses a custom development client rather than Expo Go:

```bash
npm run build:development
npm start
```

For local native builds:

```bash
npm run ios
```

## App variants

| Profile | App name | Identifier | Update channel |
|---|---|---|---|
| `development` | Mains Dev | `dev.mains.mobile.dev` | `development` |
| `preview` | Mains Preview | `dev.mains.mobile.preview` | `preview` |
| `production` | Mains | `dev.mains.mobile` | `production` |

Development and preview builds permit plain local-network traffic for connecting to a Mac over LAN. Production expects a secure `wss://` endpoint such as Tailscale HTTPS.

## EAS setup

Authenticate once and link this repository to an Expo project:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest update:configure
```

Then create builds with:

```bash
npm run build:development
npm run build:preview
npm run build:production
```

After Apple submission credentials are configured, build and upload the App Store binary with:

```bash
npm run release
```

`release` uploads the binary to App Store Connect; it does not bypass TestFlight, store metadata, or app review.

## Native project policy

This project uses Expo Continuous Native Generation. The `ios/` directory is generated and ignored. Keep native configuration in `app.config.ts` or config plugins so a clean prebuild remains reproducible.

After upgrading native Expo/React Native packages, an existing `ios/Podfile.lock`
can still pin the previous versions. If `npm run ios` fails at `pod install`
with a changed local podspec, regenerate the development native project:

```bash
npm run ios:prebuild
npm run ios
```

`ios:prebuild` replaces the generated `ios/` directory from the app config. Keep
native customizations in config plugins so they survive regeneration.


## Current features

The app pairs with a backend through its QR code, stores its device token in
the iOS Keychain, reconnects automatically, and maintains a disposable SQLite
projection of runs, workspaces, models, and conversation history. It can start,
continue, fork, and stop runs, answer approval requests, and attach photos and
skills. Demo Mode works on the phone without a backend.

Model, effort, permissions, speed, Plan, and Goal belong to each conversation.
Existing chats load and persist their next-message preferences through
`runs.configSnapshot.conversationSettings`. Saving preferences does not change
the active turn or provider defaults. New chats inherit the phone's last
accepted preferences for that backend/provider, with Plan and Goal off.
The paired backend must support `runs:updateConversationSettings` to save edits
from the model and run-options sheets.

Startup sync fetches conversation metadata, targets and models. Provider context
catalogues wait until the picker opens; history is fetched only for the visible
conversation. Bulk writes coalesce sidebar/composer refreshes instead of running
a query for every changed row.

Phone history uses chronological pages of at most 200 rows and 1 MiB, including
conversations with many tools under a single prompt. Image pixels and duplicate
turn bodies are excluded. Large messages and tool bodies are previews; their
full text stays on the backend and is read through `runs:readHistoryContent` in
8,192-character chunks without accumulating previous chunks on the phone. Old
phone caches also project bounded previews before the first render. Use a
backend containing these handlers when testing this behavior; older backends
may not support the full-content reader. Oversized responses/events have a
separate device transport limit.

CI installs the mobile lockfile, runs its tests, typecheck and lint, verifies
Expo package compatibility, and exports an iOS JavaScript bundle. Native builds
and device pairing still need the development client or an EAS build.
