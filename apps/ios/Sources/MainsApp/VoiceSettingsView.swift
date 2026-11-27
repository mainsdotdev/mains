import SwiftUI
import Observation
@preconcurrency import AVFAudio

struct VoiceOrbSettingsView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @Binding var selection: VoiceOrbStyle
    @AppStorage(VoiceOrbColor.storageKey) private var color = VoiceOrbColor.theme
    private let previewFrame = VoiceOrbFrame(levels: SIMD2(0.42, 0.58), flow: 1.4)

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 12) {
                    Text(selection.title)
                        .font(.largeTitle.weight(.semibold).width(.expanded))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .accessibilityHidden(true)

                    VoiceOrbCarousel(selection: $selection, color: color, width: min(geometry.size.width, 520), frame: previewFrame)

                    HStack(spacing: 6) {
                        ForEach(VoiceOrbStyle.allCases, id: \.self) { style in
                            Capsule().fill(Color.primary.opacity(selection == style ? 0.85 : 0.25))
                                .frame(width: selection == style ? 18 : 6, height: 6)
                        }
                    }
                    .accessibilityHidden(true)

                    paletteOptions.padding(.top, 16)
                }
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
            .navigationHeaderFade()
        }
        .background(Color(.systemBackground))
        .expandedNavigationTitle("Orb Style")
        .toolbar(.visible, for: .navigationBar)
    }

    private var paletteOptions: some View {
        VStack(spacing: 6) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 44, maximum: 44), spacing: 6)], spacing: 6) {
                ForEach(VoiceOrbColor.allCases, id: \.self) { candidate in
                    Button { color = candidate } label: {
                        VoiceOrbArtwork(style: selection, size: 32, color: candidate, frame: previewFrame)
                            .frame(width: 44, height: 44)
                            .overlay {
                                Circle()
                                    .strokeBorder(Color.primary.opacity(color == candidate ? 0.85 : 0), lineWidth: 2)
                            }
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(candidate.title)
                    .accessibilityAddTraits(color == candidate ? .isSelected : [])
                    .accessibilityIdentifier("voiceOrbColor-" + candidate.rawValue)
                }
            }
            .frame(maxWidth: 294)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Orb color")

            Text(color.title)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 12)
        .sensoryFeedback(.selection, trigger: color)
    }
}

private struct VoiceOrbCarousel: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @Binding var selection: VoiceOrbStyle
    let color: VoiceOrbColor
    let width: CGFloat
    let frame: VoiceOrbFrame
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var index: Int
    @State private var dragOffset: CGFloat = 0

    private static let styles = VoiceOrbStyle.allCases

    init(selection: Binding<VoiceOrbStyle>, color: VoiceOrbColor, width: CGFloat, frame: VoiceOrbFrame) {
        _selection = selection
        self.color = color
        self.width = width
        self.frame = frame
        _index = State(initialValue: Self.styles.firstIndex(of: selection.wrappedValue) ?? 0)
    }

    var body: some View {
        let size = min(250, width * 0.64)
        let spacing = size * 0.86 + 8
        ZStack {
            ForEach((index - 2)...(index + 2), id: \.self) { slot in
                let x = CGFloat(slot - index) * spacing + dragOffset
                VoiceOrbArtwork(style: style(at: slot), size: size, color: color, frame: frame)
                    .modifier(PickerCarouselArc(x: x, radius: max(1, width * 0.58), reduceMotion: reduceMotion))
                    .transition(.identity)
            }
        }
        .frame(width: width, height: size + 32)
        .clipped()
        .overlay {
            PickerCarouselGestures(
                onDrag: { dragOffset = min(spacing, max(-spacing, $0)) },
                onEnd: { distance in
                    select(step: abs(distance) >= spacing / 3 ? (distance < 0 ? 1 : -1) : 0)
                },
                onTap: { x in
                    if abs(x) >= spacing / 2 { select(step: x < 0 ? -1 : 1) }
                }
            )
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Orb style")
        .accessibilityValue(selection.title)
        .accessibilityIdentifier("voiceOrbCarousel")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: select(step: 1)
            case .decrement: select(step: -1)
            @unknown default: break
            }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }

    private func style(at slot: Int) -> VoiceOrbStyle {
        let count = Self.styles.count
        return Self.styles[(slot % count + count) % count]
    }

    private func select(step: Int) {
        let next = index + step
        withAnimation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.88)) {
            index = next
            dragOffset = 0
        }
        selection = style(at: next)
    }
}

struct VoiceSettingsView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var preview = VoiceSamplePlayer()
    private var choices: [String] {
        Array(Set(session.realtimeVoices?.voices ?? [])).sorted {
            let left = VoiceSamplePlayer.sampleURL($0) != nil, right = VoiceSamplePlayer.sampleURL($1) != nil
            return left != right ? left : $0.localizedStandardCompare($1) == .orderedAscending
        }
    }

    var body: some View {
        List {
            Section {
                if session.loadingVoiceSettings && choices.isEmpty {
                    ContentSkeleton(label: "Loading voices…").listRow
                }
                if !session.isConnected {
                    Label("Connect to your computer to change voices.", systemImage: "wifi.slash")
                        .foregroundStyle(.secondary)
                }
                if let error = session.voiceSettingsError {
                    Text(error).font(.subheadline).foregroundStyle(.secondary)
                    if session.uncertainVoiceSelection {
                        Button("Check saved voice") { Task { await session.checkVoiceSelection() } }
                            .disabled(!session.isConnected || session.savingVoiceSettings)
                            .accessibilityIdentifier("checkVoiceSelection")
                    } else {
                        Button("Try again") { Task { await session.loadVoiceSettings() } }
                            .disabled(!session.isConnected || session.loadingVoiceSettings || session.savingVoiceSettings)
                    }
                }
                if session.savingVoiceSettings {
                    Text("Saving voice…").foregroundStyle(.secondary)
                }
                if let selected = session.selectedRealtimeVoice, !choices.contains(selected) {
                    Text("\(name(selected)) is no longer available. Choose another voice.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(choices, id: \.self) { voice in
                    voiceRow(voice)
                }
            } header: {
                Text("Voice").fontWidth(.expanded)
            } footer: {
                Text("Saved with Codex on your computer. Changes apply to your next voice conversation.")
            }
            if session.voice.ownsCall {
                Section {
                    Label("End voice chat to listen to voice samples.", systemImage: "speaker.wave.2")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
            if let error = preview.error {
                Section { Text(error).font(.subheadline).foregroundStyle(.secondary) }
            }
        }
        .navigationHeaderFade(background: Color(.systemGroupedBackground))
        .expandedNavigationTitle("Voices")
        .toolbar(.visible, for: .navigationBar)
        .task(id: session.isConnected) { if session.isConnected { await session.loadVoiceSettings() } }
        .onChange(of: session.ownership) { _, _ in preview.stop(); dismiss() }
        .onChange(of: session.voice.ownsCall) { _, ownsCall in if ownsCall { preview.stop(releaseSession: false) } }
        .onChange(of: scenePhase) { _, phase in if phase != .active { preview.stop(releaseSession: !session.voice.ownsCall) } }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { _ in
            preview.stop(releaseSession: !session.voice.ownsCall)
        }
        .onDisappear { preview.stop(releaseSession: !session.voice.ownsCall) }
    }

    private func voiceRow(_ voice: String) -> some View {
        let selected = session.selectedRealtimeVoice == voice
        let available = VoiceSamplePlayer.sampleURL(voice) != nil
        let playing = preview.playingVoice == voice
        return HStack(spacing: 12) {
            Button {
                preview.stop(releaseSession: !session.voice.ownsCall)
                let owner = session.ownership
                Task { if owner == session.ownership { await session.selectRealtimeVoice(voice) } }
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(name(voice)).foregroundStyle(.primary)
                        if !available { Text("No sample available").font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer(minLength: 0)
                    if selected { Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(AppBrand.accent) }
                }.frame(minHeight: 44).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(!session.isConnected || session.loadingVoiceSettings || session.savingVoiceSettings || session.uncertainVoiceSelection)
            .accessibilityLabel(name(voice)).accessibilityValue(selected ? "Selected" : "")
            .accessibilityIdentifier("voiceChoice-" + voice)
            Button {
                if playing { preview.stop() }
                else if !session.voice.ownsCall { preview.play(voice) }
            } label: {
                Image(systemName: playing ? "stop.fill" : "play.fill")
                    .font(.system(size: 14, weight: .semibold)).frame(width: 44, height: 44)
            }
            .buttonStyle(.borderless)
            .disabled(!available || session.voice.ownsCall)
            .accessibilityLabel(playing ? "Stop voice sample" : "Preview \(name(voice)) voice")
            .accessibilityIdentifier("voicePreview-" + voice)
        }
    }

    private func name(_ voice: String) -> String { voice.prefix(1).uppercased() + voice.dropFirst() }
}

/// Local recordings only: previewing never opens a microphone or a voice call.
@MainActor @Observable private final class VoiceSamplePlayer {
    private(set) var playingVoice: String?
    private(set) var error: String?
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var completion: Task<Void, Never>?
    @ObservationIgnored private var ownsSession = false
    private static let samples: Set<String> = ["arbor", "breeze", "cove", "ember", "juniper", "maple", "sol", "spruce", "vale"]

    static func sampleURL(_ voice: String) -> URL? {
        guard samples.contains(voice) else { return nil }
        return Bundle.main.url(forResource: voice + ".en", withExtension: "wav", subdirectory: "VoicePreviews")
    }

    func play(_ voice: String) {
        stop(); error = nil
        guard let url = Self.sampleURL(voice) else { error = "No sample is available for this voice."; return }
        do {
            let player = try AVAudioPlayer(contentsOf: url)
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .default)
            try audio.setActive(true); ownsSession = true
            guard player.play() else { throw MainsError.server("The voice sample could not be played.") }
            self.player = player; playingVoice = voice
            completion = Task { [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
                    guard let self else { return }
                    if self.player?.isPlaying != true { self.stop(); return }
                }
            }
        } catch {
            stop(); self.error = "The voice sample could not be played. Try again."
        }
    }

    func stop(releaseSession: Bool = true) {
        completion?.cancel(); completion = nil
        player?.stop(); player = nil; playingVoice = nil
        if ownsSession {
            ownsSession = false
            if releaseSession { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        }
    }
}
