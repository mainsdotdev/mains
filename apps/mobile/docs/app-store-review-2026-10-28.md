# Mobile App Store submission — 2026-10-28

App Store Connect metadata was updated and saved for English (U.S.). The version page was reloaded and its saved description, promotional text, keywords and review notes were confirmed. The subtitle was saved as **Manage AI agents remotely**. The app name remains **Mains: AI Workspace**.

The canonical store copy is [app-store-metadata.en-US.json](app-store-metadata.en-US.json). A readable copy follows below. No build was uploaded, selected or submitted for review in this task; the existing submission still selects build 6. The new mobile build must include these source changes.

## Implementation and validation

- Demo Mode now includes **Review demo files** in the default Code workspace. Its completed turn has two file summaries, a stored patch, a PDF attachment and PDF/Markdown outputs. Tapping either file uses the production bounded diff reader and native viewer.
- Demo patch reads are scoped to that run and turn and reject invalid offsets. Other conversations never receive its patch.
- The review notes explain this exact demo path, document/attachment viewing, photo-library permission timing, desktop-only HTML/interactive outputs, connection recovery and scrolling changes.
- Desktop download links are pinned to **v0.21.0** for Apple silicon and Intel, using the repository's existing asset naming convention. This release is planned for today by the owner; availability of its assets has not been confirmed. Publish those assets before submitting the mobile build.
- Mobile verification passed: **173 tests**, typecheck, lint and iOS JavaScript export. The new demo tests exercise the actual DemoBackend listing/channel routing and the production file-diff reader. No simulator or mobile visual QA was performed.
- Website source `../website/content/legal/privacy.mdx` (sibling repository of mains) was updated for downloaded document/attachment caches, offline access and eviction, deletion/forgetting behavior, the Photos grid and optional Bridge sync. The Settings action now uses its current name, **Forget this computer**. The website production build passed. The owner will publish this website change to mains.dev; no website commit, push or deployment was made in this task.
- App Privacy's Data Not Collected declaration, screenshots, preview videos, the review attachment, categories, support/marketing URLs and manual release setting were not changed.

## Before submission

1. Publish the desktop v0.21.0 release and confirm both linked installers are downloadable.
2. Publish the website privacy-policy source change and confirm the live `/privacy` page.
3. Build the mobile app with the new demo fixture, select that build instead of build 6, then submit it for review.

## name

Mains: AI Workspace

## subtitle

Manage AI agents remotely

## promotionalText

Keep AI work moving from your phone. Continue conversations, respond to approvals, review file changes, and open supported documents from your own computer.

## keywords

coding,agents,assistant,developer,remote,projects,automation,productivity,workflow,git

## description

Stay connected to the AI work running on your computer.

Mains is a mobile companion for your Mains workspace. Start and continue conversations, follow agent progress, review file changes, and respond to approval requests from your phone.

With Mains, you can:
- Browse workspaces, projects, and recent conversations
- Start a new run or continue an existing conversation
- Follow messages, tool calls, and agent progress
- Approve or decline actions that require your permission
- Choose available models, reasoning levels, and conversation settings
- Attach photos and supported documents to your messages
- Tap edited files to view supported text diffs with line numbers
- Open supported documents and images, then share or save downloaded files
- Reopen downloaded documents offline while their cached copies remain available

HTML files and interactive outputs are currently available on desktop only.

Your computer runs the agents using your configured provider access. The mobile app connects to Mains on your computer over your local network or Tailscale. Your computer must be awake, running Mains, and reachable for live work. Supported features depend on your selected agent and Mains version.

The mobile app stores local copies of conversation data and downloaded files. Before your first prompt to a provider on a paired computer, Mains shows a provider-specific data-sharing disclosure. You can review or withdraw your choices in Settings.

No Mains account is required for direct pairing. AI services may require their own account or subscription.

Without a computer, explore sample conversations and simulated agent activity in the on-device Demo Mode.

Requirements:
Mains running on a compatible computer is required for live agent work. Download Mains for macOS and find setup information at https://mains.dev.

## reviewNotes

Mains is a mobile companion and remote controller for the user's own Mains installation. Agent execution takes place on the user's computer. Direct pairing requires no Mains account or sign-in.

Review without a computer:
1. Launch Mains.
2. On the "No computer paired" card, tap "Try Demo Mode on this phone".
3. Open the conversation list and choose "Review demo files". It is also searchable by that title.
4. Below the final response, tap greeting.ts or README.md under "Edited 2 files" to see the numbered text diff.
5. Tap Outputs to preview the bundled PDF and Markdown, or tap demo-report.pdf attached to the prompt to try the attachment viewer. Downloaded copies can be reopened offline while cached.
6. Return home and send the suggested demo prompt to see simulated progress and approval requests. Review Settings and the AI data-sharing disclosure. Demo agent responses are simulated locally and do not contact a backend or an AI provider.

Live paired mode:
Mains desktop v0.21.0 is required for this submission.
Apple silicon download: https://github.com/mainsdotdev/mains/releases/download/v0.21.0/Mains-0.21.0-arm64.dmg
Intel download: https://github.com/mainsdotdev/mains/releases/download/v0.21.0/Mains-0.21.0-x64.dmg
Run Mains on the computer, enable LAN or Tailscale access, show a pairing QR code, and scan it from the mobile app. The computer must remain awake and reachable. The user configures supported agent tooling and provider access on that computer.

The camera is used for pairing QR codes and user-initiated photo capture. Photo Library access is requested when the user opens the Photos attachment panel; the app displays photos permitted by the user's access choice. Only photos the user adds are attached to a message. The Files picker reads the documents the user selects.

Before the first mobile prompt to a provider on a paired computer, the app presents a provider-specific data-sharing disclosure. Provider access is managed on the user's own computer.

This build includes supported document and attachment viewing, per-file text diffs, improved conversation scrolling, and bounded connection recovery. HTML files and interactive outputs show "See on desktop".

The app has no advertising, analytics SDK, in-app purchases, or subscriptions sold by Mains.
