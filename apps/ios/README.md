# Mains for iPhone

An independent SwiftUI client for the existing Mains backend. Requires iOS 26+
and Xcode 26+ with Swift 6. Controls and the composer use native Liquid Glass;
the system Reduce Transparency preference retains an opaque accessible surface.
The default v1 project has no WebRTC dependency, voice sources, voice resources,
or microphone/background-audio capabilities. The opt-in v2 development profile
pins WebRTC 157.0.0 and keeps its resolved revision and bundled license.
The portable MainsCore package remains dependency-free. Math messages use the bundled KaTeX
0.18.7 assets already used by the Expo app, inside an offline WebKit surface.
`apps/mobile` remains the separate Expo/React Native app for iOS and Android.

## Run

Open `Mains.xcodeproj`, select the **Mains** scheme and an iPhone simulator or
connected iPhone, and Run. The checked-in development team matches the existing
mobile configuration; choose your own team if necessary.

Debug installs as `dev.mains.ios.dev`, named **Mains Native**, alongside the
existing app. Release installs as `dev.mains.mobile`, named **Mains**, and continues
the existing Expo app's App Store Connect/TestFlight record (`6808557372`). A
Release update replaces the Expo installation. Native storage does not import
Expo credentials, cache or drafts; testers must pair with the computer again.

In Mains on the computer, create a pairing code in device settings. Scan its QR
code in this app, or paste the complete `mains://pair#…` link. The in-app scanner
accepts `mains`, `mains-dev`, `mains-preview` and `mains-native` schemes. This app
registers `mains-native` for direct URL opening in Debug; Release also registers
the existing production `mains` scheme. Never commit or log a real pairing link
or device token.

Debug permits local HTTP/WS pairing, including LAN IP addresses. Release retains
normal App Transport Security and requires HTTPS/WSS. The computer must be
reachable from the iPhone; this does not add a new mobile Bridge transport.

```sh
xcodebuild -project Mains.xcodeproj -scheme Mains \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

## Chat organization

The conversation's options menu keeps **Fork chat** and adds **Move to project**
for Work/Chat, plus **Archive** and **Delete** in every mode. The project picker
uses the account's active Projects (collections), with search and **No project**
to detach a chat. Moving preserves the same conversation, provider, workspace,
transcript, draft and selected space. Archive/Delete are disabled for live work,
replicas and unresolved deliveries; Delete requires confirmation. Archive keeps
an unfinished draft, while confirmed deletion removes that chat's local history,
queued messages and persisted draft. Only the matching open chat is closed.

These commands require a computer running this version of Mains. They use the
existing desktop commands and durable receipts; general `runs:update` and
provider-session deletion stay unavailable to paired devices. A lost/malformed
reply retains its original identity and exposes **Check change** even after
leaving the chat. Current metadata is refreshed after a recovered move, and
older reads cannot reinsert a retired chat. Demo actions and receipts stay in
memory. In-chat Find remains outside this menu for now.

## Development hot reload

Run `npm run dev:hot-reload` once from `apps/ios`. It installs the pinned
[InjectionIII 5.2.1RC5](https://github.com/johnno1962/InjectionIII/releases/tag/5.2.1RC5)
Mac helper after checking the release SHA-256 and code signature. Then run the
**Mains** scheme in **Debug** on an iPhone **simulator** once from Xcode. Keep the
app running and save a Swift file: supported UI/function-body changes recompile
and appear in place. The bundle starts its own file watcher; opening the Mac
helper or restarting Xcode through it is unnecessary.

The console reports `[Mains Hot Reload] Enabled` and InjectionIII's watcher and
injection results. The shared scheme watches `Sources/MainsApp` and the build-log
directory, including edits made outside Xcode. A full Run is still necessary after
adding/removing stored properties, changing signatures, adding files, changing
build settings or updating resources. The custom UIKit model wheel may need to
be closed/reopened when editing its existing row configuration/layout code.

Hot reload is compiled only under `DEBUG && targetEnvironment(simulator)`;
Release also excludes `DeveloperHotReload.swift`. There is no shipped injection
bundle, package dependency, device permission or Release linker flag. UI tests
disable it explicitly. Set `MAINS_HOT_RELOAD=0` in the Run scheme environment to
disable it for a normal simulator run as well.

Each SwiftUI view/modifier observes `@ObserveHotReload` inside that same compiler
guard. New views should follow that pattern. Xcode's Debug opaque-type erasure
handles body changes; reload invalidates the existing views without `.id` resets
or rebuilding the session, conversation or draft. UIKit representables receive
an ordinary update; their coordinators and current view state stay mounted.

## GPT Live

GPT Live stays in the repository for v2 but is **compiled out** of the default
v1 app, including the call controller, signaling/settings methods and voice UI.
Historical voice-originated messages and delegated-chat links remain readable.
The v1 target has no WebRTC package/product, Metal voice shader, voice samples,
voice license resource, microphone purpose string or background-audio mode.

From `apps/ios`, select the project profile explicitly:

```sh
npm run project:generate                         # v1 submission profile (default)
MAINS_IOS_GPT_LIVE=1 npm run project:generate     # v2 voice development only
```

The opt-in profile defines `MAINS_GPT_LIVE`, includes the preserved voice sources,
links the pinned WebRTC package, adds the voice resources and selects
`Info.Voice.plist` / `Info.Voice.Debug.plist`. `AppFeatures.gptLiveEnabled` follows
that compile condition; changing a runtime constant cannot enable voice in v1.
Portable Swift-package tests retain the v2 core through `SWIFT_PACKAGE`.
Regenerate the default profile before archiving a v1 submission. Do not ship the
bundled voice recordings until their redistribution rights have been verified.

When enabled, an empty Codex composer offers the SF Symbols waveform voice button. Start it to speak in the current
conversation, or create an idle conversation from Home without a synthetic text
prompt. The paired computer must run the updated backend and have working native
Codex voice access through its existing account. Provider consent and the iPhone
microphone permission still apply; no API key is stored on the phone.

Calls open in **Focus** by default: a large water orb in the center, a compact
composer and mute/end controls, with the transcript hidden. The sliders button
switches to **Conversation**, which shows the same transcript and a larger orb
above (outside) the normal composer. This local display preference is remembered;
switching never reconnects audio, changes mute state or clears history. Ending
the call restores the normal chat. Hidden speech still persists normally.

**Settings → GPT Live → Voice** opens the voice picker before or during a call.
The native sheet loads Codex's supported voices from the computer and saves the
selection to that computer's existing Codex preference, shared with desktop.
Changes apply to the next voice session without ending or muting the current one.
Sample buttons play the same bundled English recordings as desktop, entirely
locally; voices without a recording say so. Sample playback is available outside
an active call so the microphone cannot feed a sample into the conversation, and
stops when the voice settings page closes or the app becomes inactive. An unconfirmed save
retains its original command identity for **Check saved voice** before another
selection or a new voice call. Demo voice preferences remain in memory only.

The water material is a bundled Metal shader with spherical refraction, moving
surface normals, highlights and caustics. It samples the existing audio-level
meters through a local attack/release envelope; it never opens another microphone.
Rendering pauses offscreen/inactive, uses 30 fps (15 in Low Power Mode), and becomes
static with Reduce Motion. Both light and dark appearances are supported.
Xcode's optional Metal Toolchain component is required to compile the shader;
install it with `xcodebuild -downloadComponent MetalToolchain` if missing.

Debug builds of the opt-in v2 profile accept `--voice-preview` for an entirely in-memory visual fixture;
`--voice-preview-conversation` and `--voice-preview-light` select its initial
layout and appearance. Preview preferences use a separate UserDefaults suite;
no pairing, drafts, microphone, files or external service is accessed.
`--voice-preview-reduced-motion` also freezes its material for accessibility QA.

Audio uses native WebRTC directly between the iPhone and OpenAI. The existing
Mains socket carries SDP, lifecycle and bounded context events. The call belongs
to the app, so opening another chat or a delegated working chat preserves it; a
compact dock provides return, mute and end controls. Ending the call leaves
separately delegated workers running. The call's composer Stop also stops its
current work independently. Final spoken messages remain in normal history;
partials stay in memory, and duplicate voice-work narration stays hidden.

Active calls can continue with the screen locked using the audio background mode.
Queued text stays paused in the background. Interruptions, lost connections,
revoked pairing or forgetting the computer release the microphone. A native close
that cannot be confirmed retains its original identity and exposes Retry; a new
call cannot replace it. The server watches socket liveness and tears down the
phone's own call after disconnection. A lost new-conversation acknowledgement
retains its receipt for Check delivery and never automatically restarts audio.

Demo Mode does not request microphone permission or contact a live voice service.
Physical-device QA is required for actual Codex audio, speaker/Bluetooth routing,
barge-in, incoming phone calls, locked-screen audio and Wi-Fi/cellular changes.
Unit/fixture tests validate signaling and lifecycle without an AI request.

## TestFlight

Run these commands from `apps/ios`. The npm package is only a command wrapper;
there are no Node dependencies and no `npm install` step.

One-time local setup:

```sh
brew install ruby@3.3
npm run beta:setup
cp fastlane/.env.example fastlane/.env
```

The wrapper uses your selected Ruby 3.3+ or Homebrew's Ruby 3.3 without changing
your global Ruby. Bundler installs the locked tooling into ignored `.bundle/`.
Commit `Gemfile.lock` when updating dependencies; `Gemfile` includes `xcodeproj`
for project regeneration as well as Fastlane.

Before the first upload:

1. Use the existing app `dev.mains.mobile` in App Store Connect (Apple ID
   `6808557372`) for Developer team `Y4MVJ7JSH6`. Do not create a new app record:
   native Release continues the previous Expo app. The Developer membership and
   required Apple agreements must be active.
2. Create an App Store Connect **Team API key** with **App Manager** access.
   Put its key ID, issuer ID and an absolute path to the downloaded `.p8` into
   `fastlane/.env`. Keep the `.p8` outside the repository. The env file and signing
   files are ignored; never commit credentials or private keys.
3. Install an **Apple Distribution** signing certificate **with its private key**
   into your unlocked login Keychain. Use Xcode's account certificate manager or
   import your existing identity. An API key authenticates Apple requests; it
   does not replace a signing identity. The lane uses the Team API key to obtain
   or create a **Mains Native App Store** provisioning profile backed by a local
   signing identity. Archive uses automatic signing; export explicitly uses
   this profile and the local Apple Distribution certificate, avoiding a
   dependency on cloud-managed signing permissions. Expo's profiles are separate.
   During export, macOS may ask for your login Keychain password so Apple's
   `codesign` can use the Distribution private key. Enter it in the local macOS
   dialog; the command waits until you grant access.
4. In TestFlight, create an internal tester group and enable automatic distribution
   of new builds for that group. This lane uploads internal betas; it does not
   submit external beta review or publish an App Store release.

Then use:

```sh
npm run beta:check
npm run beta
```

`beta:check` checks the local version settings, key file, selected Xcode 26+ and
presence of a distribution identity without contacting Apple or uploading. It
cannot verify API permissions, agreements or provisioning. `beta` runs that check,
runs `swift test`, queries the latest TestFlight build for the app version,
archives the **Release** scheme, exports the signed IPA, uploads it and waits for
processing before setting the TestFlight notes. Optional `MAINS_BETA_CHANGELOG`
in `fastlane/.env` supplies **What to Test**; otherwise notes contain the version
and build number. UI/backend fixture tests remain a separate manual QA step.

Edit `Version.xcconfig` to change `MARKETING_VERSION`. Its positive integer
`CURRENT_PROJECT_VERSION` is the local build default and minimum beta number.
The initial native continuation is version `1.0.0` with a minimum build of `10`,
following the existing TestFlight build `1.0.0 (9)`.
`Resources/PrivacyInfo.xcprivacy` ships required-reason declarations for app-local
UserDefaults and file metadata used for saved drafts/cache and user-selected
attachments. Keep it in the app's resources when regenerating the project.
Beta uses `max(local default, latest TestFlight build + 1)` through build-time
overrides, leaving the tracked project/version files untouched. Regenerating
the project preserves its reference to this file. Release artifacts and logs
are in ignored `build/beta/`; do not share raw release logs without reviewing
them. A lock prevents overlapping uploads from this checkout. Uploads from
different checkouts/machines must also be serialized to avoid number collisions.

If an upload succeeds but Apple processing or notes fail, check TestFlight before
retrying: the build may already be present. Running `beta` again creates the next
build rather than resuming a previous upload. First-time Apple processing may take
longer. Test the actual TestFlight build on a phone: Release requires HTTPS/WSS,
while local HTTP/WS pairing is supported only in Debug.

Offline release configuration/orchestration tests (no Apple access or upload):

```sh
npm run test:release
```

This first stage runs locally. A hosted release workflow and shared signing
storage are not configured yet. See the [Fastlane beta deployment guide](https://docs.fastlane.tools/getting-started/ios/beta-deployment/)
and [API key guide](https://docs.fastlane.tools/app-store-connect-api/) for the
underlying tooling.

## Current scope

- The conversation workspace adapts to local window size and iPhone Duo folds.
  With regular width, existing outputs open beside the chat; taller windows put
  the output above the chat. On iOS 27.1+, active division regions keep the
  readers on separate sides of the hinge, including the tabletop layout.
  Narrow windows and accessibility text show the last focused reader. **Outputs**
  switches readers on a narrow screen and toggles the panel on a wide screen;
  **Close outputs** releases the preview. Document/image cards and local file
  links open the same panel. Its menu selects another output, and **Reload file**
  explicitly downloads the current version. Metadata refreshes preserve the
  displayed version and reading position. Share and Save to Atlas remain available.
  A stable layout keeps the conversation, draft, transcript viewport and selected
  preview mounted across resizing; it does not select a chat or restart its socket.
  Hidden chat images release decoded thumbnails and hidden panes cannot page or
  invent follow intent. Output discovery skips empty/missing-file pages with a
  bounded metadata read and retains one page. Closing/navigating removes temporary
  downloads. Home pins a collapsible sidebar when space permits, while chat keeps
  that space for its output. All app profiles support portrait and both landscape
  directions. Demo uses its prepared PDF/Markdown outputs for the same workflow.
- Atlas rows show their saved item's tags. **Edit tags** in a row's long-press
  menu loads a fresh selection; choose existing tags, remove them or add a new
  name, then **Save**. Names reuse the desktop's normalization and duplicate
  handling, with up to 30 selected tags and 64 UTF-16 units per new name.
  **Filter → Tag…** opens a searchable, paginated tag picker; **All tags** or
  **Reset** clears that filter. `atlas:mobileTags` reads 50 catalogue entries at
  a time, `atlas:readMobileTags` reads only the saved item's tags/revision, and
  receipt-backed `atlas:setMobileTags` changes only tags. Stale selections refuse
  without losing the draft; **Discard edits and reload** reads the new selection.
  Unconfirmed changes reuse **Check change**, including after navigation or
  reconnection, without replacing newer metadata with an old receipt. User
  removals retain the desktop's exclusions against later automatic tagging.
  Unsaved projections must be saved first. Demo uses only in-memory tags.
- Saved Pages, documents, images and bookmarks support **Move to Trash** from
  the row's long-press menu or swipe actions. Atlas's **Trash** button opens a
  separate paginated list with **Restore** for each item. Restoring preserves
  content, project, favorites and the source conversation. Unsaved projections
  must be saved first; permanent deletion is unavailable. `atlas:mobileTrash`
  returns only 50 metadata entries, and receipt-backed `atlas:setMobileTrash`
  accepts only the saved identity and desired Trash state. Unknown outcomes use
  the shared **Check change** recovery; checking an older receipt reads current
  state without undoing a newer Restore. Demo supports both actions in memory.
- Saved bookmarks expose **Edit** in their detail sheet and **Edit bookmark** in
  the row's long-press menu. The editor loads fresh title/description/note data,
  validates the existing 240/2,000/10,000 UTF-16 limits, and submits only dirty
  fields through `atlas:editMobileBookmark`; empty description/note values clear
  them. The URL and other Atlas metadata are preserved. An editable-content
  revision is checked again at the commit seam, so stale edits cannot overwrite
  another device or background enrichment. Drafts remain in memory on failure;
  **Discard edits and reload** explicitly replaces them with the current values.
  Unknown acknowledgements use the shared **Check change** recovery. Returning
  to the detail/library reads fresh metadata instead of applying old receipt
  text. Older computers show update guidance. Demo supports the same edits and
  revision conflicts without contacting a website, provider or real computer.
- Saved Atlas Pages, documents, images and bookmarks support **Add to favorites** /
  **Remove from favorites** and **Move to project** from a row's long-press menu
  or swipe actions. The project sheet includes **No project**. These affect the
  permanent Atlas item, including an existing saved copy shown under Generated;
  unsaved projections must be saved first. The source conversation and file bytes
  stay unchanged. Library favorites/project filters refresh after confirmation.
  A narrow receipt-backed `atlas:updateMobileItem` command accepts only favorite
  and project fields, rejects Trash/foreign/archived targets and returns the
  requested identity plus confirmed fields. Unknown outcomes share the Atlas
  write recovery owner and expose **Check change** across navigation. Recovery
  refreshes current metadata instead of reapplying an old result over newer edits.
  Demo supplies the same in-memory updates and filters.
- **Save to Atlas** is available in conversation output/document/image previews
  and the Outputs row menu, plus previews of generated library files. The phone
  sends an existing artifact/attachment/source identity and its version; the
  computer retains the verified original, without uploading the preview or
  exposing a host path. Explicit saves work across Code/Work/Chat; replicas save
  from their source computer. Repeated saves reuse the existing immutable copy.
  Atlas's **New bookmark** button accepts an HTTP(S) link and optional project;
  normalized duplicate URLs reuse their item and preserve authored fields.
  Both narrow save commands use the standard command receipts. Unknown results
  retain the original request, block new Atlas saves and expose **Check save**
  across navigation. Pairing retirement fences late replies. Demo supports both
  saves entirely in memory, including duplicate/receipt recovery behavior.
- Sidebar **Atlas** opens the account library without changing the active provider
  or Space mode. All, Pages, Docs, Images and Bookmarks support search, project,
  source and favorites filters, with one 50-entry page retained in memory.
  Image rows show a fixed-size thumbnail; only visible rows request the bounded
  128-pixel/128 KB `readMobileImage` response, and offscreen rows release it.
  Metadata shows bookmark domains, file type/size and short Page excerpts instead
  of source labels. File metadata and 240-scalar Page previews are optional on older
  computers, which retain category icons when thumbnails are unavailable.
  Pages are read-only Markdown in version-pinned parts of up to 16,384 Unicode
  scalars; embedded Atlas files open by identity. Bookmark details expose their
  description, note and HTTP(S) link. Items can open their source conversation.
  Documents/images reuse native file previews, paged text and Share / Save to Files;
  downloads stream in 128 KB chunks up to 100 MB into protected temporary storage.
  Closing a preview removes its files. Saved items span providers/modes; automatic
  files follow desktop's Work-only discovery, including synced conversation files.
  This requires an updated computer with the narrow `atlas:*Mobile*` readers
  (`mobileLibrary`, `readMobilePage`, `describeMobileFile`, `readMobileFile`, `readMobileImage`). Broad
  Atlas mutations/path resolvers remain unavailable to paired phones. Library
  metadata and Page content stay out of the snapshot cache; stale pairing/connection
  reads cannot populate another session. Atlas changes refresh an open library,
  while a Page refresh explicitly restarts its reading version. Demo includes all
  four content kinds and a prepared generated file without a network connection.
  Page editing/creation and Page chat are outside this first native Atlas scope.
- Sidebar **Activity** shows work across all spaces/providers: pending tool
  approvals/questions, authoritative running/queued work, recent failures (seven
  days), and completed/stopped work (24 hours). Requests take priority over running
  rows; selecting one opens the existing conversation decision cards. Running work
  can be stopped from the list through the normal receipt-backed abort command.
  Reads use existing paired-device channels, retain at most 100 descriptors/200
  request identities in memory, and resolve older requested conversations without
  loading their history. The screen and sidebar refresh on events plus a 15-second
  visible-only poll. Connection/navigation retirement fences reads; resolved and
  expired requests cannot return from stale responses. Offline/error views label
  last-known work, hide decisions and disable Stop. The inbox never changes the
  selected transcript or persists decision evidence. Demo uses the same reader.
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
  The bundled `demo-report.pdf` chat attachment appears only in **Explore Mains**;
  other prepared conversations retain their original attachments.
  The Demo Mac identity, imported attachments, command receipts and new conversations
  stay in memory; explicit file previews use the normal protected temporary files.
  Only a separate demo-enabled flag survives app termination. A new
  launch restores fresh sample data. Demo does not write the real pairing, snapshot
  or provider consents. A saved real pairing always takes priority. Replay pauses
  in the background and resumes on foreground, including without network access.
  Settings offers Exit Demo Mode or pairing a real computer. Demo disclosures use
  Continue Demo and never authorize real sharing. The home suggestion **Try
  approvals and questions** starts a walkthrough of tool consent, a multiple-choice
  question, a validated form, a local sample connection link, and Codex async
  questions. Replies use the same session channels as a real backend. Demo links
  stay on-device; expiry and decline do not execute an action. Demo also supplies
  plugin, skill and command examples; sending selected context produces a prepared
  acknowledgement without invoking a plugin or external service.
- The shared home/conversation composer supports **+ → Plugins** and trailing
  **@**, **/** and **$** context triggers. The inline picker keeps the keyboard open,
  groups plugins, Mac apps, skills and commands, and filters by title/description.
  `$` searches skills only; commands insert `/name`. Selected context appears as
  atomic icon/name tokens inside the editable text and sent prompts. Backspace removes
  one mention at a time; copying/pasting uses readable plain text, and undo stays
  scoped to the provider/workspace. Selections follow text edits and send canonical
  `$name` mentions plus `contextSkills` on execute/continue. Catalogues load lazily for the current provider/workspace,
  refresh on `providers:skillsUpdated`, retain successful sources on partial failure,
  and never enter the disk snapshot. Provider/workspace changes remove stale selections.
  Computer-local icon/skill paths are metadata only; artwork accepts data or HTTPS URLs.
  Paired discovery limits optional artwork and avoids sending both icon sizes;
  skills use the desktop Sparkles icon by default; commands use Slash, and plugins
  without usable artwork use Box. The same defaults appear in inline mentions.
- In-conversation decision cards match the React Native flows: allow/deny (including
  Codex's explicit Allow for this run), option/custom/secret question answers,
  flat MCP schema forms with defaults and field validation, HTTP(S) URL elicitation,
  and step-by-step Codex async answers/dismissal. Request incarnation tokens, expiry,
  pairing ownership and viewed-run checks reject stale decisions. Unknown approval
  deliveries can only check the original receipt; unknown Codex answers use
  `checkOnly`, never a fresh answer. Authoritative resolution retires the card.
  Decisions and secret drafts are memory-only; replicas remain read-only.
  Tool approvals use desktop-style shell/directory and file-diff previews, bounded
  scrollable content, compact Cancel/Allow actions, and curated connector fields.
- Completed Code/Work turns show a read-only changed-files card outside folded
  messages, with additions/deletions, shared/binary/renamed files, and a compact
  expandable list. Selecting a file opens a native diff page with numbered,
  wrapped rows and word emphasis. Previous/Next keeps only one bounded page;
  stored patches are read through `runs:readHistoryContent` (`turn-diff`) on demand,
  never loaded into the snapshot cache. Historical cutoffs, unavailable/truncated
  changes and undone changes follow Expo. `runs:diffUpdated` refreshes the summary.
  Diff reads are fenced by computer ownership, connection and conversation;
  returning preserves the transcript position. Demo's **Try file changes** replays
  a prepared patch; **Explore Mains** also includes modified, paged added,
  renamed and binary samples. No real files are changed.
- Subagents use a centered **N agents** glass capsule above the composer. Tapping
  opens a floating Active/Completed list without changing the transcript's height;
  failed/stopped agents appear under Needs attention. Selecting an agent opens an
  expandable partial-height sheet with its task, child tools/messages and report.
  Native identity merges continuations, provider lifecycle wins over detached launch
  acknowledgements, and known children follow their parent. This is read-only and
  limited to the current bounded mobile history window, explicitly labelled when
  more messages exist. No full-history or host-file reads are introduced. Up to four
  child message previews (8,192 characters each) stay in memory; they never enter
  the cache or main transcript. **Try subagents** replays working/completed Security
  and Tests agents; **Explore Mains** includes their prepared completed reports.
- A sliding sidebar with provider/space discs, Code workspaces and branch
  information, and Work/Chat project groups and recent conversations.
- The sidebar header places the filled Mains vector logo beside Code / Work / Chat.
  Only the selected mode has a text label, with icon-only controls in narrow
  layouts and accessibility text sizes. The fixed-height footer holds the selected
  provider, Search and Settings. Tapping the selected provider reveals the other
  spaces to its right in a bounded horizontal scroller; Search becomes an icon
  below its 110-point, text-scaled label threshold, while Settings stays at the edge.
  Provider selection, Search and Settings close the strip. Controls retain 44-point
  hit targets and respect Reduce Motion and Reduce Transparency.
- Code / Work / Chat selection
  persists through `space:update` on the computer and updates the list while
  keeping the sidebar open. Unsupported experiences are hidden for code-only providers.
- Home and conversation headers share a centered capsule showing the computer
  name and connection state while disconnected or syncing. It opens Settings and
  hides once live; conversation headers then restore their title. Connection changes
  never insert a separate status row above the transcript.
- Settings opens as a native page with grouped cards for computer/connection details,
  manual sync and diagnostics, persistent System/Light/Dark appearance, phone/app
  information and legal/support links. Pairing and last successful sync timestamps
  are local metadata; existing pairings without a saved date show a dash.
  AI Data Sharing lets you revoke one provider or reset permissions for this computer.
- Search conversation titles/goals and visible message text across the computer's
  account, including conversations outside the recent 100. Results arrive in pages
  of 25 with message excerpts; opening a message loads its bounded history window
  and highlights the match. Workspace/branch search remains local. Offline or older
  computers fall back to explicitly labelled saved chats. Full search requires an
  updated computer backend exposing `search:conversations`; global `search:query`
  remains unavailable to paired phones. Pull to refresh and read-only replicas remain supported.
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
  All providers share model brand icons in the wheel and composer.
  Unknown models use their provider's logo; Copilot Auto uses Copilot
  and Cursor Auto/Composer uses Cursor. Icons stay in one consistent 16-point slot.
  OpenCode preserves desktop's provider grouping/order, model brand icons and
  display names. The composer and wheel show only the model name and brand icon;
  provider provenance remains in accessibility labels for ambiguous model names.
  Selections keep the catalogue's original model ids for settings and requests.
  Run-options lists use compact rows. Effort opens as a large floating
  control with a soft material halo confined to the component; the rest of the
  conversation stays visible and mounted. Its position follows the live keyboard
  safe area, moving back down when the keyboard closes. Opening effort preserves the
  composer's keyboard focus and positions the control just above the keyboard. It grows from the composer’s model
  button, with an opacity transition for Reduce Motion. The current model sits
  inside an inline snapping scroll wheel with faded neighbours above/below,
  larger single-line names and no selected-row background or descriptions.
  Scroll settling submits the original model id
  through the existing settings writer; scrolling/programmatic positioning does
  not submit intermediate models. Effort stays below the wheel and is disabled
  while a model save is pending. Saved selections outside the current catalogue
  remain visible, without automatically choosing another model. Nearby rows are
  reused, and accessibility exposes one adjustable control. The effort caption
  and control reserve the same scaled height for sliders, menus, toggles and
  models without effort, so changing capabilities never moves the model wheel.
  Model saves keep the wheel and effort at full opacity, with a delayed saving
  indicator and a consistent pending model/settings preview. One glass surface
  survives model changes at a constant width; shared stops and the thumb animate
  inside it to the new range without remounting the control. Menus/toggles crossfade in the
  same reserved space, and Reduce Motion removes range movement.
  OpenCode labels an unset effort as Default, separately from its native None option.
  None comes first when advertised, followed by Default and the effort levels;
  models without None keep Default first. Selection follows the original value.
  Effort uses a stepped yellow-to-violet scale for up to seven stops when the
  measured track provides 44 points between stops (scaled with text size).
  Narrow layouts, accessibility text and larger catalogues use the same ordered
  options in a menu. None/Default stay neutral; the lowest explicit effort begins the colour ramp.
  On/off models retain their Thinking switch. Claude's Ultracode is the last stop
  of the same slider/menu, without a separate row. Dragging previews locally and saves only on release;
  accessibility adjustments use the same stops.
  Selecting a Claude model without Ultracode clears that flag and uses its
  highest supported effort. Older incompatible saved values use the same display
  projection in the composer, caption and slider without an automatic write;
  switching to a Thinking-only model preserves the switch's existing intent.
  Codex permissions respect the computer’s managed profile/sandbox policy. New-chat
  choices travel in `conversationSettings`; they do not change provider defaults
  or existing conversations. Existing-chat choices are saved through
  `runs:updateConversationSettings` and included in that conversation’s next message.
  A late snapshot cannot overwrite a confirmed save. Unknown saves retain their
  original command identity for Check settings and block fresh settings/sends.
  Selection preferences survive through disposable cache.
- Code messages without an available local workspace show a Workspace required
  notice with a chooser shortcut and keep the draft intact.
- Photos, Files and device Camera attachments in both composers (up to five,
  2 MB total), including messages with attachments only. Attachment bytes stay in
  memory while composing and sending.
- The + menu grows from its composer button and preserves the editor's keyboard
  and caret. A child overlay in the current window blocks background touches
  without disabling the editor; dismissing the menu keeps typing active.
  Camera and Photos grow out of that
  menu into matching partial-height panels; Back reverses to the menu, while Close,
  backdrop taps and a completed import shrink back along the same path before
  removing the overlay. Reduce Motion uses a short fade. Camera has shutter,
  flash and front/back controls; Photos has a three-column paged recents grid,
  ordered multi-selection and an All Photos system picker. Limited or denied
  library access still allows explicit selections through All Photos.
  Photo authorization survives the permission dialog's temporary inactive phase;
  cancelled loads always retire their spinner. Loading, fallback text and controls
  share the full media panel bounds.
  Selected photos are downsampled without cropping and encoded as JPEGs within the shared
  attachment budget; file imports retain their data. The composer shows fixed
  104-point square image previews in one horizontal strip and documents separately.
- Text continuation, stop, cumulative live replies and durable stream acknowledgement.
- Completed answers expose Copy beside Fork, using the desktop's sideways fork
  glyph. Copy works offline, takes the loaded turn's raw Markdown (including folded
  assistant prose), and acknowledges with a checkmark for two seconds. Tool output
  is excluded; truncated answers are labeled as previews. Long-press message and
  code-block copy remain available.
- Fork a completed local conversation from the last settled response or the
  conversation menu. The computer branches its provider session and inherits the
  source's workspace, space, mode, model and policy; the new conversation opens
  with the same continuation message as desktop. The original draft, files,
  reading position and queued messages stay with their source. Historical pages
  do not label an old response as a fork point. Running/replica/offline conversations
  cannot fork. Provider support and session expiry are checked by the computer.
  Forks use the normal provider-sharing disclosure. An unconfirmed fork blocks
  fresh sends and exposes an app-wide **Check fork** action that reuses its
  original command identity, including after reconnection. Pending fork receipts
  stay in memory until resolved, pairing replacement or app termination. Demo
  forks inherit the sample's settings and remain entirely on-device.
- Codex and Claude queue new messages during a running turn: messages keep their
  files, context and selected settings, and send FIFO after a successful turn.
  The queue is visible only while it contains messages; there is no delivery-mode
  selector or empty Queue bar. Use Steer on one waiting row to send it immediately.
  Rows support edit/save/cancel with draft backup,
  remove, drag reorder and accessible Move up/down actions. Editing settings stays
  local until that queued message sends. Failure, Stop, backgrounding and connection
  changes pause the queue until Resume; Check delivery uses the original input
  identity and frozen payload, never a new send. Older computers fall back to the
  original command receipt. The session owns the consumer across navigation, keeps
  reading position unchanged, and limits memory to 32 pending messages/32 MiB.
  Queues, draft backups and files are memory-only and clear with pairing ownership
  or app termination. Native queues do not add optimistic transcript turns.
- Desktop-owned pending messages appear as **Queued on computer**, with their
  current order, attachment names and delivery/pause status. The desktop publishes
  a bounded, memory-only projection over `runs:publishQueue`; iOS reads it through
  `runs:getQueue` and `runs:queueChanged`, with a periodic refresh for reconnects.
  Projections expire after 60 seconds without a desktop heartbeat. The desktop
  retains delivery ownership and its original files/settings; the phone never
  imports these rows into its own queue or sends them again. This requires an
  updated desktop/backend as well as the native app.
- Running status follows the foreground tool or the provider’s current thinking preview,
  with a provider-coloured square loader and text shimmer. Streaming assistant prose
  and visible running tool rows suppress duplicate footer indicators. Live thinking
  stays bounded in memory, outside messages and the disk cache. Reduce Motion uses
  static feedback, and inactive scenes pause animations. Demo sample requests include
  thinking snapshots and running/completed tool transitions.
- Stable message identity across send acknowledgements and streaming finalization.
  The bounded transcript is measured eagerly, uses one scroll controller, and keeps
  observed execution details open after completion. Reopened history starts compact.
  Image previews reserve their layout before loading and decode only while visible.
- Per-computer/provider AI data-sharing consent before sending.
- Bounded mobile history with automatic directional edge paging and chunked full-message reading.
  Native conversation requests use desktop's last-20-prompt boundaries and overlapping
  windows of at most 60 blocks, while previews remain capped at 200 rows/about 1 MB.
  Prompts and the last visible reply in each block take priority over intermediate
  commentary and child tools. Oversized windows expose **More messages and activity**:
  a separate Earlier/Later reader for all omitted messages/tools within the frozen
  window. It keeps one bounded page, supports full-message/tool readers, and leaves
  the main conversation's reading position and following state untouched. Existing
  computers without this additive option retain their previous row-based pages.
  The top retains an earlier-message fallback; newer messages load at the bottom without
  a load-more row. Overlapping pages preserve the visible row’s offset, and the arrow
  requests the latest page before resuming live-follow. Demo uses the same overlapping
  window behavior with smaller sample pages.
- Foreground/network recovery, endpoint rotation, 30-second visible recovery budget
  and slower silent probes. No retry timers or sockets while offline/backgrounded.
- Stable command identities across reconnects. Timeout/refusal does not
  automatically start a new command. Unconfirmed delivery retains the original
  identity for **Check delivery**; this is not permission to resend after the
  backend's seven-day receipt retention.
- Up to 100 recent conversation descriptors, plus the currently viewed older
  conversation, and four bounded history pages in a disposable cache. Live text is
  memory-only. Losing the cache simply refetches.
- System typography, Dynamic Type, native navigation/sheets, selectable inline
  Markdown, headings, ordered/nested/task lists, quotes, horizontally scrollable GFM tables
  and fenced code, interactive keyboard dismissal
  and a latest-message control.
- Folded intermediate assistant/tool work, with the final answer always visible;
  active turns stay expanded and errors stay outside the fold.
- Native output listing and downloads up to 100 MB, streamed to a protected
  temporary file in version-checked 128 KB chunks. Markdown/text files open in
  64 KB UTF-8 pages; documents/images use Quick Look. ZIP and other unsupported
  formats still download and expose Share / Save to Files. Partial files are
  removed on failure/cancellation and temporary files are removed on close.
  The output list keeps one page of up to 100 descriptors.
- Local Markdown links resolve selected outputs by name in their conversation;
  duplicate names direct the user to Outputs. Work/Chat Markdown references also
  use the backend's contained `runs:readTextFile` reader, including relative links
  inside an opened document. Code repository paths never become arbitrary file
  reads. HTTP(S)/mail links keep the normal system action.
- Inline `$…$` / `\\(…\\)` and display `$$…$$` / `\\[…\\]` math use local KaTeX
  scripts, CSS and fonts, with native Markdown retained for other messages.
  Code/currency remain literal, raw HTML is escaped, and links use the same file
  routing. MathML supplies accessibility. The isolated WebKit surface has no
  network access, limits macro expansion/size, and disables trusted TeX commands.
  Unfinished/invalid TeX stays readable; messages above the 128 KB math-rendering
  budget fall back to the native Markdown reader.
- A floating material composer, expandable tool activity,
  message/code copy actions and explicit sending/stopping/error states.
- Sending clears the composer immediately. Acknowledgements preserve anything typed
  next; definite failures restore the original input or keep it available to copy.
  Unsent text survives navigation and app termination, independently per conversation
  or home space and paired computer/device. Atomic, protected Application Support
  files hold only text (up to 512 KB per draft, 128 drafts/8 MB per pairing; oldest
  abandoned drafts are pruned). Forgetting/replacing a pairing removes its drafts.
  Files, selected context, queues, editing backups and delivery receipts stay in
  memory; queued edits never overwrite the saved normal draft. Sending removes the
  submitted text from storage, definite refusal restores it, and new input typed
  during delivery remains separate. Demo never reads or writes real saved drafts.
- Touch and momentum pause following. Only an upward departure leaves live-follow
  mode; content growth and keyboard resizing do not. Reading freezes history refresh
  bounds, and Latest starts following only after its requested page is confirmed.
  Sending from a historical page first opens the latest page; subsequent send
  acknowledgements respect any new reading gesture instead of forcing another jump.

Consecutive tool calls share desktop's stable work summary (for example, “Read
files, looked for files”), rather than the first unfinished call's activity label.
Tool rows and the activity footer share a display-only status projection: later
foreground output retires stale running/queued previews, while the trailing
parallel batch stays active. Thinking, command progress and child activity do
not finish foreground tools. Explicit background MCP task lifecycle still wins;
wire statuses and cached history are unchanged.
Each row shows its command, file or
search pattern, status, error and available line/diff counts. Opening a row shows
up to 40 output lines; deferred input/output opens a separate bounded reader.
Conversation images load small previews on demand, preserve their aspect ratio
and open larger native previews. Prompt documents and selected agent outputs use
file cards; PDFs open in the native viewer with sharing. Downloads use run-scoped
attachment/output descriptors and version-checked 128 KB chunks, up to 100 MB.
Text previews are paged instead of loading a whole large document into memory.
No host path is used as a download URL. Temporary preview files
are protected and removed when the viewer closes. Older attachments without a
durable reference remain visible with an unavailable-preview label.

Other providers and queued turns require waiting or stopping before sending.
Raw HTML is shown as text rather than executed.
In Demo Mode, send “Show Markdown formatting” to explore the native formatting sample.

## Validate

Portable protocol/transcript tests run without Xcode simulators or a backend:

```sh
swift test
```

The offline math engine also has a nonvisual macOS WebKit check (no window or
screenshots):

```sh
swift scripts/check-math-webkit.swift Resources/Math
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
Keyboard tests require the software keyboard to be visible on the QA simulator.
In Device Hub, select that simulator and use **Device → Keyboard → Toggle Software
Keyboard** if only the hardware-keyboard accessory bar appears.

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
conversation-scoped settings and original-id recovery, persistent text isolation,
140-conversation paginated search and anchored historical matches, stale search/snapshot fencing,
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

Atlas, Trash and Activity share `AppListStyle` row insets and minimum content height.
Keep list metadata compact beneath a single-line title, allowing extra lines at
accessibility text sizes. Use `compactRelativeAge` for list dates (`5m ago`, `3h ago`,
`1d ago`), with minute updates while visible; VoiceOver can read the exact Atlas date.

The Xcode project and shared scheme are committed. After adding/removing Swift
files, update them in Xcode or regenerate with `npm run project:generate`
(run `npm run beta:setup` once to install the locked Ruby tooling). Vector icons are rendered
directly from desktop's current `iconRegistry` into the asset catalogue with
`node scripts/sync-icons.mjs`. This includes new names, strokes and masks;
full-viewport SVG wrappers are flattened for native template rendering.
The filled Mains mark, Bridge status mark, Atlas navigation icons and model brand marks are included from their desktop components as well.
Current-colour alpha masks use white mask paint so native luminance rendering
does not erase outlined marks such as Mains.
Existing legacy assets remain available for previously saved tokens.
`node scripts/sync-icons.mjs --check` verifies every current icon and colour
against desktop without rewriting assets. Colour names and shade choices come directly
from desktop's `ICON_COLORS`, resolved through its installed Tailwind theme.
Regeneration requires the desktop dependencies to be installed. To refresh only
the palette, run `node scripts/sync-icon-colors.mjs`; `--check` verifies that the
generated assets match the current desktop palette without rewriting files.
