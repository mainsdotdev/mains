# Mains for iPhone

An independent SwiftUI client for the existing Mains backend. Requires iOS 18+
and Xcode 26+ with Swift 6. No third-party iOS runtime dependencies.
`apps/mobile` remains the separate Expo/React Native app for iOS and Android.

## Run

Open `Mains.xcodeproj`, select the **Mains** scheme and an iPhone simulator or
connected iPhone, and Run. The checked-in development team matches the existing
mobile configuration; choose your own team if necessary.

Debug installs as `dev.mains.ios.dev` and Release as `dev.mains.ios`, both named
**Mains Native**. These are independent of the Expo app's bundle identifiers,
Keychain service and cache. Both apps can be installed together. The native app
needs its own pairing code from the computer; it does not read Expo credentials.

In Mains on the computer, create a pairing code in device settings. Scan its QR
code in this app, or paste the complete `mains://pair#…` link. The in-app scanner
accepts `mains`, `mains-dev`, `mains-preview` and `mains-native` schemes. This app
registers only `mains-native` for direct URL opening to avoid taking over the
existing app's links. Never commit or log a real pairing link or device token.

Debug permits local HTTP/WS pairing, including LAN IP addresses. Release retains
normal App Transport Security and requires HTTPS/WSS. The computer must be
reachable from the iPhone; this does not add a new mobile Bridge transport.

```sh
xcodebuild -project Mains.xcodeproj -scheme Mains \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

## Current scope

- The unpaired home keeps its sidebar and composer, with a connection card above
  the composer. Scan opens a dismissible pairing sheet with a square QR preview
  or manual/paste entry. Detected computer details, retry and explicit pairing
  confirmation stay inline. Credentials remain in Keychain; Forget uses a centered
  Cancel/Forget alert.
- Offline Demo Mode is available on the unpaired home and pairing screen. A Swift
  backend supplies the same session channels, seeded conversations, five providers,
  mutable mode/model/permission choices, replayed streaming messages and tool calls,
  and native image/PDF/Markdown previews. It never opens a socket, starts a provider
  or executes a tool. Live-to-durable messages retain their stream identity.
  The Demo Mac identity, imported attachments, command receipts and new conversations
  stay in memory; explicit file previews use the normal protected temporary files.
  Only a separate demo-enabled flag survives app termination. A new
  launch restores fresh sample data. Demo does not write the real pairing, snapshot
  or provider consents. A saved real pairing always takes priority. Replay pauses
  in the background and resumes on foreground, including without network access.
  Settings offers Exit Demo Mode or pairing a real computer. Demo disclosures use
  Continue Demo and never authorize real sharing. Plugin and approval flows are
  intentionally absent until native iOS supports them.
- A sliding sidebar with provider/space discs, Code workspaces and branch
  information, and Work/Chat project groups and recent conversations.
- Code / Work / Chat tabs sit under the Mains title in the sidebar. Selection
  persists through `space:update` on the computer and updates the list while
  keeping the sidebar open. Unsupported experiences are hidden for code-only providers.
- A centered home-header capsule shows the computer name and connection state
  while disconnected or syncing, opens Settings, and hides once live.
- Settings opens as a native page with grouped cards for computer/connection details,
  manual sync and diagnostics, persistent System/Light/Dark appearance, phone/app
  information and legal/support links. Pairing and last successful sync timestamps
  are local metadata; existing pairings without a saved date show a dash.
  AI Data Sharing lets you revoke one provider or reset permissions for this computer.
- Search across synced spaces and workspaces, workspace conversations, pull to refresh and
  read-only replicas. Conversation descriptors remain bounded to 100 entries.
- Search slides in through the main pane as the sidebar slides left in one coordinated
  transition. Closing reverses the movement and leaves the sidebar open. The keyboard
  opens with the transition, above the floating bottom search/close bar.
  Chats show their workspace/project, mode and age before workspace results; clear
  keeps focus, and either result opens in the main navigation after search closes.
- An in-place new conversation composer, remembered per-space workspace/project
  targets, and drafts scoped to the paired computer and selected space.
- Shared two-row glass composer for home and conversations, with provider-coloured
  prompt bubbles, a native title/Outputs/New/More toolbar and a circular Latest control.
- Live model catalogues, model-specific effort and provider-specific permissions.
  Model and run-options lists use compact rows. Effort opens as a large floating
  control with a soft material halo confined to the component; the rest of the
  conversation stays visible and mounted. Its position follows the live keyboard
  safe area, moving back down when the keyboard closes. Opening effort preserves the
  composer's keyboard focus and positions the control just above the keyboard. It grows from the composer’s model
  button, with an opacity transition for Reduce Motion. Tapping the model name opens a card catalogue sheet
  with provider-supplied descriptions. A confirmed selection or closing that
  sheet returns to effort.
  Effort uses a stepped
  yellow-to-violet scale, a Thinking switch for on/off models,
  or a menu for more than six stops, following Expo's capability rules. Claude's
  Ultracode stays separate. Dragging previews locally and saves only on release;
  accessibility adjustments use the same stops.
  Codex permissions respect the computer’s managed profile/sandbox policy. New-chat
  choices travel in `conversationSettings`; they do not change provider defaults
  or existing conversations. Existing-chat choices are saved through
  `runs:updateConversationSettings` and included in that conversation’s next message.
  A late snapshot cannot overwrite a confirmed save. Unknown saves retain their
  original command identity for Check settings and block fresh settings/sends.
  Selection preferences survive through disposable cache.
- Photos, Files and device Camera attachments in both composers (up to five,
  2 MB total). Attachment bytes stay in memory while composing and sending.
- The + menu grows from its composer button. Camera and Photos grow out of that
  menu into matching partial-height panels; Back reverses to the menu, while Close,
  backdrop taps and a completed import shrink back along the same path before
  removing the overlay. Reduce Motion uses a short fade. Camera has shutter,
  flash and front/back controls; Photos has a three-column paged recents grid,
  ordered multi-selection and an All Photos system picker. Limited or denied
  library access still allows explicit selections through All Photos. Selected
  photos are downsampled without cropping and encoded as JPEGs within the shared
  attachment budget; file imports retain their data. The composer shows fixed
  104-point square image previews in one horizontal strip and documents separately.
- Text continuation, stop, cumulative live replies and durable stream acknowledgement.
- Per-computer/provider AI data-sharing consent before sending.
- Bounded mobile history, earlier/newer pages and chunked full-message reading.
- Foreground/network recovery, endpoint rotation, 30-second visible recovery budget
  and slower silent probes. No retry timers or sockets while offline/backgrounded.
- Stable command identities across reconnects. Timeout/refusal does not
  automatically start a new command. Unconfirmed delivery retains the original
  identity for **Check delivery**; this is not permission to resend after the
  backend's seven-day receipt retention.
- Up to 100 conversation descriptors and four bounded history pages in a
  disposable cache. Live text is memory-only. Losing the cache simply refetches.
- System typography, Dynamic Type, native navigation/sheets, selectable inline
  Markdown, headings, lists, quotes and fenced code, interactive keyboard dismissal
  and a latest-message control.
- Folded intermediate assistant/tool work, with the final answer always visible;
  active turns stay expanded and errors stay outside the fold.
- Native output listing, Markdown/text previews (2 MB) and Quick Look document/image
  previews/sharing (25 MB), read in
  version-checked 128 KB chunks only when opened. Temporary previews are private
  and removed when closed. The output list keeps one page of up to 100 descriptors.
- A floating material composer, expandable tool activity,
  message/code copy actions and explicit sending/stopping/error states.
- Sending clears the composer immediately. Acknowledgements preserve anything typed
  next; definite failures restore the original input or keep it available to copy.
  Conversation drafts survive navigation in memory, scoped to the paired computer;
  they are not persisted across an app termination.
- Touch and momentum pause following. Only an upward departure leaves live-follow
  mode; content growth and keyboard resizing do not. Reading freezes history refresh
  bounds, and Latest starts following only after its requested page is confirmed.
  Sending from a historical page first opens the latest page; subsequent send
  acknowledgements respect any new reading gesture instead of forcing another jump.

Consecutive tool calls share a work summary. Each row shows its command, file or
search pattern, status, error and available line/diff counts. Opening a row shows
up to 40 output lines; deferred input/output opens a separate bounded reader.
Conversation images load small previews on demand, preserve their aspect ratio
and open larger native previews. Prompt documents and selected agent outputs use
file cards; PDFs open in the native viewer with sharing. Downloads use run-scoped
attachment/output descriptors and version-checked 128 KB chunks, up to 25 MB
(2 MB for text). No host path is used as a download URL. Temporary preview files
are protected and removed when the viewer closes. Older attachments without a
durable reference remain visible with an unavailable-preview label.

Messages to active turns currently require waiting or stopping; mid-turn steer
is not implemented. Approval/question replies, plugins, rich Markdown tables
and math remain on the computer or Expo app.

## Validate

Portable protocol/transcript tests run without Xcode simulators or a backend:

```sh
swift test
```

The integration/UI fixture imports the actual TypeScript WebSocket codec and
channel constants from `packages/contracts`. It uses `ws` from the standalone
server's dependencies (install those in `apps/server` first if absent). No real
AI requests, accounts, databases or workspaces are used.

In one terminal, from `apps/ios`:

```sh
node scripts/mock-backend.mjs
```

In another, run the core integration tests, then UI tests sequentially (both use
and reset the same deterministic fixture):

```sh
MAINS_TEST_BACKEND=http://127.0.0.1:18787 swift test
xcodebuild -project Mains.xcodeproj -scheme Mains \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -resultBundlePath TestResults/NativeFlow.xcresult test
```

Choose an installed iPhone simulator name. Remove or rename a previous result
bundle before reusing that path. UI tests only reset a pairing named **Test Mac**;
use a dedicated simulator if the native app is paired with a real computer there.
Keep simulator signing enabled when running: Keychain needs the simulator's
application-identifier entitlement. `CODE_SIGNING_ALLOWED=NO` is only for the
compile-only check above, not for running pairing or UI tests.
QR camera capture and real-device LAN/privacy prompts need physical-device QA.

The attachment UI test needs at least five library photos. Before running it,
seed only your dedicated QA simulator and grant that test app library access:

```sh
swift scripts/make-photo-fixtures.swift
xcrun simctl addmedia <qa-simulator-udid> /tmp/mains-attachment-fixtures/*.png
xcrun simctl privacy <qa-simulator-udid> grant photos dev.mains.ios.dev
```

It verifies partial panel sizing, ordered photo import, uniform horizontal
previews, removal, draft preservation and the actual send payload. Camera hardware,
flash, front/back switching and the first-use permission prompts need a real iPhone.

The integration tests cover home selection persistence, account-scoped projects,
Code/Work target routing, model/effort/permission and attachment payloads,
managed Codex policies, pairing, consent, stream settlement/acknowledgement,
conversation-scoped settings and original-id recovery, stale snapshot fencing,
Markdown structure, collapsed turn boundaries and chunked output reads,
late deltas, reconnect with the original command identity, foreground/network
recovery, cache restore, forgetting, timeouts, refusal and cancellation. The UI
test follows pairing → conversation → send → live reply → durable reply → relaunch.
The chat interaction test also checks refusal recovery, a draft written during a
reply, stopping without losing the reading position, Latest, draft navigation and
a real socket interruption/recovery against the fixture. The home UI test opens
both sidebar layouts, changes all three modes, selects a workspace/model/effort/
permission, starts a conversation, checks its actual wire payload and relaunches
to verify saved preferences.
The home recovery test interrupts the socket, checks Reconnecting → Syncing → Live,
opens computer details from the status capsule, and verifies the draft survives.
The effort UI test switches model capabilities, toggles Thinking, drags the scale,
checks persistence after relaunch and verifies all six Claude permissions fit initially.
The conversation UI test checks the reference-style transcript and execution fold,
native model/effort/permission sheets, output download/preview, the actual continuation
payload, syncing and the New action without changing home’s selected experience.
Use a dedicated simulator
(for example **Mains Native QA**) so test pairing cannot replace a real computer.

## Source layout

The native demo resource is generated from the sanitized Expo fixture, with the
native model/provider catalogue applied. Regenerate or verify it from apps/ios:

```sh
node scripts/sync-demo.mjs
node scripts/sync-demo.mjs --check
```

Demo unit/session tests run without a fixture server. The UI case
`testDemoModeEntryReplayMediaAndExit` also works without a server; it exercises
both entry buttons, relaunch, search, real file previews, the demo disclosure,
simulated messaging and exit. Use the dedicated QA simulator as for other UI tests.

`Sources/MainsCore` is the portable Foundation/Observation layer, compiled by both
the app and `Package.swift`. `Sources/MainsApp` contains SwiftUI screens and iOS
adapters. Swift models are a manually maintained subset of `packages/contracts`;
they do not introduce a second backend API. Dates preserve the existing `$date`
wire tag, and arbitrary JSON preserves `$undefined` markers.

The Xcode project and shared scheme are committed. After adding/removing Swift
files, update them in Xcode or regenerate with `ruby scripts/generate-project.rb`
(the `xcodeproj` gem is needed only for regeneration). Vector icons are rendered
directly from desktop's current `iconRegistry` into the asset catalogue with
`node scripts/sync-icons.mjs`. This includes new names, strokes and masks;
full-viewport SVG wrappers are flattened for native template rendering.
The Bridge status mark is included from its desktop component as well.
Current-colour alpha masks use white mask paint so native luminance rendering
does not erase outlined marks such as Mains.
Existing legacy assets remain available for previously saved tokens.
`node scripts/sync-icons.mjs --check` verifies every current icon and colour
against desktop without rewriting assets. Colour names and shade choices come directly
from desktop's `ICON_COLORS`, resolved through its installed Tailwind theme.
Regeneration requires the desktop dependencies to be installed. To refresh only
the palette, run `node scripts/sync-icon-colors.mjs`; `--check` verifies that the
generated assets match the current desktop palette without rewriting files.
