#if DEBUG
import SwiftUI

/// A launch-only visual fixture. It has no Keychain, files, microphone or network.
struct VoiceAppearancePreview: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @State private var session = BackendSession(storage: VoicePreviewStorage())
    @State private var runID: String?
    private let preferences = UserDefaults(suiteName: "dev.mains.voice-preview")!
    var body: some View {
        ZStack {
            if let runID {
                NavigationStack {
                    ConversationView(session: session, runID: runID, openComputer: {}, onNew: {}, onFork: { _ in })
                }
            } else { ConversationSkeleton(isMate: false).padding(16).frame(maxHeight: .infinity, alignment: .top) }
        }
        .defaultAppStorage(preferences)
        .environment(\.voiceReduceMotionPreview, CommandLine.arguments.contains("--voice-preview-reduced-motion"))
        .preferredColorScheme(CommandLine.arguments.contains("--voice-preview-light") ? .light : .dark)
        .task {
            preferences.set(CommandLine.arguments.contains("--voice-preview-conversation") ? "conversation" : "focus", forKey: VoicePresentation.storageKey)
            let style = CommandLine.arguments.firstIndex(of: "--voice-preview-orb").flatMap { index in
                CommandLine.arguments.dropFirst(index + 1).first.flatMap(VoiceOrbStyle.init(rawValue:))
            } ?? .water
            preferences.set(style.rawValue, forKey: VoiceOrbStyle.storageKey)
            do {
                session.setActive(true); try session.startDemo()
                let end = ContinuousClock.now + .seconds(5)
                while !session.isConnected && ContinuousClock.now < end { try await Task.sleep(for: .milliseconds(10)) }
                guard let run = session.conversations.first(where: { $0.providerId == "codex" && !$0.isActive }) else { return }
                runID = run.id
                session.voice.makeMedia = { VoicePreviewMedia() }
                session.voice.onConnectedFeedback = VoiceCallSounds.playOpening
                session.voice.onClosing = VoiceCallSounds.playClosing
                await session.voice.start(label: run.displayTitle) {
                    RealtimeVoiceSignaling(runID: run.id, start: { _, id in
                        try await Task.sleep(for: .seconds(2))
                        session.voice.receive(.object(["runId": .string(run.id), "connectionId": .string(id), "type": .string("started")]))
                    }, stop: { _ in })
                }
            } catch { session.actionError = error.localizedDescription }
        }
        .onDisappear { session.exitDemo() }
    }
}

@MainActor private final class VoicePreviewMedia: RealtimeVoiceMedia {
    var onConnected: (() -> Void)?
    var onFailure: ((String) -> Void)?
    var onChannelOpen: (() -> Void)?
    var onLevels: ((Double, Double) -> Void)?
    private var levels: Task<Void, Never>?
    func offer() async throws -> String {
        onConnected?()
        levels = Task { [weak self] in
            while !Task.isCancelled {
                let phrase = sin(Date.timeIntervalSinceReferenceDate * 1.4)
                self?.onLevels?(max(0, phrase) * 0.42, max(0, -phrase) * 0.60)
                do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
            }
        }
        return "v=0\r\nvisual-fixture"
    }
    func answer(_ sdp: String) async throws {}
    func send(_ event: JSONValue) throws -> Bool { true }
    func setMuted(_ muted: Bool) {}
    func close() { levels?.cancel(); levels = nil }
}

@MainActor private final class VoicePreviewStorage: SessionStorage {
    func loadPairing() throws -> PairedBackend? { nil }
    func savePairing(_ pairing: PairedBackend) throws {}
    func removePairing() throws {}
    func loadSnapshot(backendID: String, deviceID: String) -> CachedSnapshot? { nil }
    func saveSnapshot(_ snapshot: CachedSnapshot, deviceID: String, history: CachedHistoryChange?) {}
    func removeSnapshot() {}
    func hasConsent(backendID: String, providerID: String) -> Bool { false }
    func grantConsent(backendID: String, providerID: String) {}
    func revokeConsent(backendID: String, providerID: String) {}
    func revokeAllConsents(backendID: String) {}
}
#endif
