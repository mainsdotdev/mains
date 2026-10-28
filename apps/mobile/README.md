# mobile

Expo/React Native client for controlling a Mains backend from iOS and Android.

## Requirements

- Node 24.20.0 (see `.node-version` or `.nvmrc`)
- npm
- An Expo account for cloud builds
- Xcode for local iOS builds
- Android Studio, Android SDK Platform 36 and JDK 17 for local Android builds

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
# Android device or ARM64 emulator:
npm run android
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

# Android: development client, installable preview APK, or store AAB
npm run build:android:development
npm run build:android:preview
npm run build:android:production
```

After Apple submission credentials are configured, build and upload the App Store binary with:

```bash
npm run release
```

`release` uploads the binary to App Store Connect; it does not bypass TestFlight, store metadata, or app review.

## Native project policy

This project uses Expo Continuous Native Generation. The `ios/` and `android/` directories are generated and ignored. Keep native configuration in `app.config.ts` or config plugins so prebuild remains reproducible.

Android uses the same variant identifiers as iOS, Material icons for the existing
symbol names, and native header actions for conversation outputs and sync.
Camera and photo access do not request microphone or video access. Android 13+
requests only the photo permission, including the user's limited-photo choice.
For terminal builds, set `JAVA_HOME` to JDK 17 and `ANDROID_HOME` to the SDK folder.
`npm run android:prebuild` regenerates Android configuration without touching iOS.

After upgrading native Expo/React Native packages, an existing `ios/Podfile.lock`
can still pin the previous versions. If `npm run ios` fails at `pod install`
with a changed local podspec, regenerate the development native project:

```bash
npm run ios:prebuild
npm run ios
```

`ios:prebuild` replaces the generated `ios/` directory from the app config. Keep
native customizations in config plugins so they survive regeneration.

The local Expo module in `modules/mains-document-preview` supplies iOS Quick
Look for PDF, Word, Excel and PowerPoint outputs. It autolinks during prebuild
and CocoaPods installation. Rebuild the native client after adding or changing
this module; an OTA JavaScript update cannot install it. Older clients still
offer Share / Save to Files when native preview is unavailable. Android opens
downloaded PDF/Office files in a compatible installed application using a
temporary read grant for that cache file. If no viewer is installed, the app
offers sharing. Images and text/Markdown stay in the app. Android file sharing
uses a content URI; iOS retains its existing share sheet.


## Current features

The app pairs with a backend through its QR code, stores its device token in
platform SecureStore, reconnects automatically, and maintains a disposable SQLite
projection of runs, workspaces, models, and conversation history. It can start,
continue, fork, and stop runs, answer approval requests, and attach photos and
skills. Demo Mode works on the phone without a backend.

Connection attempts time out after 10 seconds. After at most 30 seconds of
visible recovery, the app shows Unreachable and continues silent probes after
30-second waits, rotating saved addresses. Try again, network recovery, and
returning to the foreground trigger an immediate attempt. Offline/background
states pause retry timers; authorization/version failures require re-pairing
or an update instead of repeated attempts.

Conversation headers expose Outputs, and transcript document cards open the
same file viewer. PDF and Office outputs use Quick Look on iOS and a compatible
installed viewer on Android; images, Markdown,
TXT and CSV open in the app. Share / Save to Files keeps the original filename.
Downloads are chunked, capped at 100 MiB per file, and cached separately from
SQLite in a 200 MiB cache. Downloaded outputs can open offline until evicted.
The backend must include `runs:listOutputs` and `runs:readOutputFile`; these
read-only handlers expose selected conversation outputs without filesystem access.
Demo Mode includes a small PDF and Markdown output for checking this flow.
HTML and interactive visualization outputs currently show **See on desktop**
without a mobile preview, download or share action.

Documents sent from mobile or desktop also appear as cards on their user
messages, including messages with no text. Cards open the same viewer and
support sharing and cached offline copies. The backend must include
`runArtifacts:describeAttachmentFile` and `runArtifacts:readAttachmentChunk`.
Legacy uploads without a durable attachment id remain visible with Preview
unavailable. Demo conversations include a bundled PDF attachment.
For an older backend with only the original-file reader, known document
attachments up to 2 MiB can still open. Larger files require an updated,
restarted desktop backend; the phone displays that requirement explicitly.

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

Tap an edited file below a completed turn to open its saved diff, with line
numbers, colored additions/deletions and word emphasis. Large diffs use bounded
pages; binary changes stay on desktop. This uses the existing history-content
reader and does not read or modify the current working tree.

CI installs the mobile lockfile, runs its tests, typecheck and lint, verifies
Expo package compatibility, and exports an iOS JavaScript bundle. Native builds
and device pairing still need the development client or an EAS build.
