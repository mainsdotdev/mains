# CLAUDE.md

This is the independent SwiftUI iPhone app. Do not modify `apps/mobile` to implement native iOS features.

- `Sources/MainsCore` owns the portable wire codec, DTOs, pairing client, socket ownership, bounded history projection and backend session. It compiles as a Swift package on macOS for tests and directly into the iOS app.
- `Sources/MainsApp` owns SwiftUI screens, camera scanning, Keychain and filesystem adapters. Keep network behavior out of views.
- `packages/contracts/src` remains the source of truth for channel names, payloads, date/undefined tags, command receipts and transcript behavior. Swift models cover the subset used by this client. Changes to the shared wire protocol need explicit coordination with other clients.
- The credential belongs only in this app's Keychain service. Disposable cache files never contain tokens or live stream previews.
- Retain a mutation's original command ID, payload, computer and total deadline during reconnection. Only connection loss automatically retries. Unknown receipt outcomes block fresh sends and retain the original identity for an explicit delivery check.
- Fence asynchronous writers by pairing ownership, transport generation and viewed conversation. History is one bounded `profile: mobile` page; do not append entire histories or tool outputs.
- Native iOS supports the sidebar, shared home/conversation composer, durable conversation model/permission settings, bounded file/photo attachments, grouped tool calls with bounded output/diff previews, inline conversation images, document cards and native file/PDF previews up to 25 MB. Approval replies, plugins and full Markdown/math rendering remain later work. Surface these limits accurately.

Run from `apps/ios`:

```sh
swift test
xcodebuild -project Mains.xcodeproj -scheme Mains -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

See README.md for fixture integration/UI tests. The committed Xcode project has no third-party runtime dependencies. After adding/removing Swift files, regenerate it with `ruby scripts/generate-project.rb` (requires the `xcodeproj` gem), or update its groups/build phases in Xcode.

Keep this file and CLAUDE.md byte-identical apart from the heading.
