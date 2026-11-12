import SwiftUI

struct OpenVoiceConversationAction {
    var action: (String) -> Void = { _ in }
    func callAsFunction(_ id: String) { action(id) }
}
extension EnvironmentValues {
    @Entry var openVoiceConversation = OpenVoiceConversationAction()
    @Entry var voiceSurfaceVisible = true
    @Entry var voiceReduceMotionPreview = false
}

enum VoicePresentation: String, CaseIterable {
    case focus, conversation
    static let storageKey = "voicePresentation"
    var title: String { self == .focus ? "Focus" : "Conversation" }
    var symbol: String { self == .focus ? "circle" : "text.bubble" }
}

struct VoicePresentationMenu: View {
    @AppStorage(VoicePresentation.storageKey) private var presentation = VoicePresentation.focus
    var body: some View {
        Menu {
            Section("Voice display") {
                ForEach(VoicePresentation.allCases, id: \.self) { mode in
                    Button { presentation = mode } label: {
                        Label(mode.title, systemImage: presentation == mode ? "checkmark" : mode.symbol)
                    }.accessibilityIdentifier("voiceDisplay-" + mode.rawValue)
                }
            }
        } label: { Image(systemName: "slider.horizontal.3") }
        .accessibilityLabel("Voice display").accessibilityValue(presentation.title)
        .accessibilityHint("Change the display without ending voice chat.")
        .accessibilityIdentifier("voiceDisplayOptions")
    }
}

struct VoiceFocusStage: View {
    let voice: RealtimeVoiceController
    var body: some View {
        GeometryReader { geometry in
            VoiceOrb(voice: voice, size: max(80, min(geometry.size.width * 0.70, geometry.size.height * 0.72, 300)))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("voiceFocusStage")
    }
}

struct VoiceOrb: View {
    let voice: RealtimeVoiceController
    var size: CGFloat = 104
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.voiceSurfaceVisible) private var surfaceVisible
    @Environment(\.voiceReduceMotionPreview) private var reduceMotionPreview
    @State private var visible = false
    @State private var envelope = VoiceOrbEnvelope()
    var body: some View {
        TimelineView(.animation(minimumInterval: ProcessInfo.processInfo.isLowPowerModeEnabled ? 1.0 / 15 : 1.0 / 30,
                                paused: !visible || !surfaceVisible || reduceMotion || reduceMotionPreview || scenePhase != .active)) { timeline in
            let moving = visible && surfaceVisible && !reduceMotion && !reduceMotionPreview && scenePhase == .active
            let frame = moving ? envelope.sample(input: voice.muted ? 0 : voice.inputLevel, output: voice.outputLevel,
                                                time: timeline.date.timeIntervalSinceReferenceDate) : VoiceOrbFrame()
            Rectangle().fill(.white)
                .colorEffect(ShaderLibrary.voiceWater(
                    .float2(Float(size), Float(size)), .float(frame.flow),
                    .float(frame.levels.x), .float(frame.levels.y),
                    .float(colorScheme == .dark ? 1 : 0)))
                .frame(width: size, height: size)
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(voice.muted ? "Voice chat, microphone muted" : voice.phase == .connected ? "Voice chat connected" : "Connecting voice chat")
        .accessibilityIdentifier("voiceOrb")
        .onAppear { visible = true }.onDisappear { visible = false }
    }
}

private struct VoiceOrbFrame {
    var levels = SIMD2<Float>.zero
    var flow: Float = 0
}

@MainActor private final class VoiceOrbEnvelope {
    private var previous: TimeInterval?
    private var input = 0.0
    private var output = 0.0
    private var flow = 0.0
    func sample(input targetInput: Double, output targetOutput: Double, time: TimeInterval) -> VoiceOrbFrame {
        let elapsed = min(0.1, max(0, time - (previous ?? time - 1.0 / 30)))
        previous = time
        // Match the React orb's fast speech attack and softer release.
        input += (targetInput - input) * (1 - exp(-elapsed / (targetInput > input ? 0.05 : 0.22)))
        output += (targetOutput - output) * (1 - exp(-elapsed / (targetOutput > output ? 0.05 : 0.22)))
        // Integrate velocity rather than multiplying wall time by volume: both
        // speakers accelerate the water without jumping its position on syllables.
        flow += elapsed * (1.1 + max(input, output) * 8.4)
        return VoiceOrbFrame(levels: SIMD2(Float(input), Float(output)), flow: Float(flow))
    }
}

struct VoiceCallDock: View {
    let session: BackendSession
    let visibleRunID: String?
    var preparingHere = false
    let open: (String) -> Void
    private var voice: RealtimeVoiceController { session.voice }
    var body: some View {
        if voice.ownsCall, voice.runID == nil && !preparingHere || voice.runID != nil && voice.runID != visibleRunID || voice.phase == .stopFailed {
            HStack(spacing: 8) {
                Button { if let id = voice.runID { open(id) } } label: {
                    HStack(spacing: 8) {
                        VoiceOrb(voice: voice, size: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(voice.phase == .stopFailed ? "End call to reconnect" : "GPT Live").font(.footnote.weight(.semibold))
                            Text(voice.label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.disabled(voice.runID == nil).accessibilityIdentifier("openVoiceConversation")
                if voice.phase == .connected {
                    Button { voice.toggleMute() } label: {
                        Image(systemName: voice.muted ? "mic.slash.fill" : "mic.fill").frame(width: 44, height: 44)
                    }.accessibilityLabel(voice.muted ? "Unmute microphone" : "Mute microphone").accessibilityIdentifier("dockMuteVoice")
                }
                Button { Task { await voice.stop() } } label: {
                    Image(systemName: voice.phase == .stopFailed ? "arrow.clockwise" : "phone.down.fill")
                        .frame(width: 44, height: 44).foregroundStyle(.red)
                }.disabled(voice.phase == .ending).accessibilityLabel(voice.phase == .stopFailed ? "Retry ending voice chat" : "End voice chat")
                    .accessibilityIdentifier("dockEndVoice")
            }
            .buttonStyle(.plain).padding(.horizontal, 8).padding(.vertical, 4)
            .modifier(GlassSurface(radius: 26)).padding(.horizontal, 12).padding(.vertical, 4)
        }
        if let pending = session.pendingVoiceConversation, pending.uncertain {
            ChatNotice(title: "Voice conversation unconfirmed", message: "Check delivery before starting another conversation.", symbol: "exclamationmark.circle", warning: true) {
                Button(session.checkingVoiceConversation ? "Checking…" : "Check delivery") {
                    let owner = session.ownership
                    Task {
                        do { let id = try await session.checkVoiceConversation(); if owner == session.ownership { open(id) } }
                        catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
                    }
                }.disabled(!session.isConnected || session.checkingVoiceConversation).accessibilityIdentifier("checkVoiceConversation")
            }
        }
    }
}
