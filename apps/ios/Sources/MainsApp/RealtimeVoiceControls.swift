import SwiftUI

extension EnvironmentValues {
    @Entry var voiceSurfaceVisible = true
    @Entry var voiceReduceMotionPreview = false
}

enum VoicePresentation: String, CaseIterable {
    case focus, conversation
    static let storageKey = "voicePresentation"
    var title: String { self == .focus ? "Focus" : "Conversation" }
    var symbol: String { self == .focus ? "circle" : "text.bubble" }
}

enum VoiceOrbStyle: String, CaseIterable {
    case water, cloud, sphere, aurora
    static let storageKey = "voiceOrbStyle"

    var title: String {
        switch self {
        case .water: String(localized: "Water")
        case .cloud: String(localized: "Cloud")
        case .sphere: String(localized: "Sphere")
        case .aurora: String(localized: "Aurora")
        }
    }

    fileprivate var shaderFunction: ShaderFunction {
        switch self {
        case .water: ShaderLibrary.voiceWater
        case .cloud: ShaderLibrary.voiceCloud
        case .sphere: ShaderLibrary.voiceSphere
        case .aurora: ShaderLibrary.voiceAurora
        }
    }

    fileprivate func flowSpeed(energy: Double) -> Double {
        let desktopSpeed = 0.4 + energy * 4.2
        return switch self {
        case .water: 1.1 + energy * 8.4
        case .cloud: desktopSpeed
        case .sphere: desktopSpeed * 2.0
        case .aurora: desktopSpeed * 2.4
        }
    }
}

enum VoiceOrbColor: String, CaseIterable {
    case theme, blue, violet, rose, amber, mint
    static let storageKey = "voiceOrbColor"

    var title: String {
        switch self {
        case .theme: String(localized: "Theme")
        case .blue: String(localized: "Blue")
        case .violet: String(localized: "Violet")
        case .rose: String(localized: "Rose")
        case .amber: String(localized: "Amber")
        case .mint: String(localized: "Mint")
        }
    }

    // Keep the fixed palettes in step with desktop's voice-orb-colors.ts.
    fileprivate var palette: VoiceOrbPalette {
        switch self {
        case .theme: VoiceOrbPalette(0x2257CC, 0xB9CDF9, 0xEEF3FD, 0xBE93DC, 0xA5DEB6)
        case .blue: VoiceOrbPalette(0x245CDD, 0x9ABBFC, 0xF1F6FF, 0x79D5D2, 0xBEA4F3)
        case .violet: VoiceOrbPalette(0x7C3AED, 0xCCB8F9, 0xF9F5FF, 0x93BFF2, 0xF2A8CE)
        case .rose: VoiceOrbPalette(0xDC435C, 0xF2ACBB, 0xFFF1F4, 0xF3B878, 0xAAAFE9)
        case .amber: VoiceOrbPalette(0xD97706, 0xF5C987, 0xFFF8E7, 0xF28F91, 0xF7DC86)
        case .mint: VoiceOrbPalette(0x078569, 0x8BDCC2, 0xEFFFF7, 0xA3C9F5, 0xF5DFA0)
        }
    }
}

private struct VoiceOrbPalette {
    let deep: Shader.Argument
    let soft: Shader.Argument
    let light: Shader.Argument
    let secondary: Shader.Argument
    let tertiary: Shader.Argument

    init(_ deep: UInt32, _ soft: UInt32, _ light: UInt32, _ secondary: UInt32, _ tertiary: UInt32) {
        self.deep = Self.rgb(deep)
        self.soft = Self.rgb(soft)
        self.light = Self.rgb(light)
        self.secondary = Self.rgb(secondary)
        self.tertiary = Self.rgb(tertiary)
    }

    private static func rgb(_ hex: UInt32) -> Shader.Argument {
        .float3(Float(hex >> 16) / 255, Float((hex >> 8) & 0xff) / 255, Float(hex & 0xff) / 255)
    }
}

struct VoicePresentationMenu: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let voice: RealtimeVoiceController
    let presented: Bool

    var body: some View {
        GeometryReader { geometry in
            let size = max(80, min(geometry.size.width * 0.70, geometry.size.height * 0.72, 300))
            VoiceOrbSlot(voice: voice, size: size, presented: presented)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .allowsHitTesting(false)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("voiceFocusStage", isEnabled: presented)
        .accessibilityHidden(!presented)
    }
}

struct VoiceOrbSlot: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let voice: RealtimeVoiceController
    let size: CGFloat
    let presented: Bool
    var bottomInset: CGFloat = 0
    var orbIdentifier = "voiceOrb"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.voiceReduceMotionPreview) private var reduceMotionPreview

    var body: some View {
        let inCall = voice.phase == .connecting || voice.phase == .connected
        let motionAllowed = !reduceMotion && !reduceMotionPreview
        let disappearance: AnyTransition = motionAllowed ? .scale(scale: 0.16).combined(with: .opacity) : .opacity
        // Keep the slot alive when the controller releases a call so its removal can finish.
        VStack(spacing: 0) {
            if presented && inCall {
                VoiceOrb(voice: voice, size: size)
                    .accessibilityIdentifier(orbIdentifier)
                    .transition(.asymmetric(insertion: .identity, removal: disappearance))
                    .padding(.bottom, bottomInset)
            }
        }
        .animation(.easeInOut(duration: motionAllowed ? 0.17 : 0.10), value: inCall)
    }
}

struct VoiceOrb: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let voice: RealtimeVoiceController
    var size: CGFloat = 104
    @AppStorage(VoiceOrbStyle.storageKey) private var style = VoiceOrbStyle.water
    @AppStorage(VoiceOrbColor.storageKey) private var color = VoiceOrbColor.theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.voiceSurfaceVisible) private var surfaceVisible
    @Environment(\.voiceReduceMotionPreview) private var reduceMotionPreview
    @State private var visible = false
    @State private var envelope = VoiceOrbEnvelope()

    private var statusLabel: LocalizedStringKey {
        switch voice.phase {
        case .connecting: "Connecting voice chat"
        case .connected: voice.muted ? "Voice chat, microphone muted" : "Voice chat connected"
        case .ending: "Ending voice chat"
        case .stopFailed: "Ending voice chat could not be confirmed"
        case .idle, .error: "Voice chat"
        }
    }

    var body: some View {
        let connecting = voice.phase == .connecting
        let connected = voice.phase == .connected
        let waitingDiameter = min(size, 24)
        let motionAllowed = !reduceMotion && !reduceMotionPreview
        let moving = visible && surfaceVisible && motionAllowed && scenePhase == .active
        let artwork = TimelineView(.animation(minimumInterval: ProcessInfo.processInfo.isLowPowerModeEnabled ? 1.0 / 15 : 1.0 / 30,
                                              paused: !moving)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            let frame = moving ? envelope.sample(input: voice.muted ? 0 : voice.inputLevel, output: voice.outputLevel,
                                                time: time, style: style) : VoiceOrbFrame()
            VoiceOrbArtwork(style: style, size: size, color: color, frame: frame)
                .opacity(connecting && moving ? 0.84 + 0.16 * cos(time * .pi / 0.8) : 1)
        }
        .frame(width: size, height: size)

        Group {
            if motionAllowed, size > waitingDiameter {
                let growth = size - waitingDiameter
                artwork.keyframeAnimator(initialValue: connected ? CGFloat(1) : 0, trigger: connected) { content, progress in
                    let diameter = waitingDiameter + progress * growth
                    content.scaleEffect(diameter / size)
                        .frame(width: min(diameter, size), height: min(diameter, size))
                } keyframes: { current in
                    if connected {
                        CubicKeyframe(1 + 0.05 * size / growth, duration: 0.16, startVelocity: 0, endVelocity: 0)
                        CubicKeyframe(1, duration: 0.09, startVelocity: 0, endVelocity: 0)
                    } else {
                        MoveKeyframe(current)
                    }
                }
            } else {
                let diameter = connected ? size : waitingDiameter
                artwork.scaleEffect(diameter / size).frame(width: diameter, height: diameter)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(statusLabel)
        .accessibilityValue(style.title)
        .accessibilityIdentifier("voiceOrb")
        .onAppear { visible = true }.onDisappear { visible = false }
    }
}

struct VoiceOrbArtwork: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let style: VoiceOrbStyle
    let size: CGFloat
    let color: VoiceOrbColor
    var frame = VoiceOrbFrame()
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let palette = color.palette
        let shading: [Shader.Argument] = style == .water
            ? [.float(colorScheme == .dark ? 1 : 0), .float(color == .theme ? 0 : 1)]
            : [palette.secondary, palette.tertiary]
        Rectangle().fill(.white)
            .colorEffect(Shader(function: style.shaderFunction, arguments: [
                .float2(Float(size), Float(size)), .float(frame.flow),
                .float(frame.levels.x), .float(frame.levels.y), palette.deep, palette.soft, palette.light
            ] + shading))
            .frame(width: size, height: size)
    }
}

struct VoiceOrbFrame {
    var levels = SIMD2<Float>.zero
    var flow: Float = 0
}

@MainActor private final class VoiceOrbEnvelope {
    private var previous: TimeInterval?
    private var input = 0.0
    private var output = 0.0
    private var flow = 0.0
    func sample(input targetInput: Double, output targetOutput: Double, time: TimeInterval, style: VoiceOrbStyle) -> VoiceOrbFrame {
        let elapsed = min(0.1, max(0, time - (previous ?? time - 1.0 / 30)))
        previous = time
        // Match the React orb's fast speech attack and softer release.
        input += (targetInput - input) * (1 - exp(-elapsed / (targetInput > input ? 0.05 : 0.22)))
        output += (targetOutput - output) * (1 - exp(-elapsed / (targetOutput > output ? 0.05 : 0.22)))
        // Integrate velocity so both speakers accelerate the shader without
        // jumping its position on syllables.
        flow += elapsed * style.flowSpeed(energy: max(input, output))
        return VoiceOrbFrame(levels: SIMD2(Float(input), Float(output)), flow: Float(flow))
    }
}

struct VoiceCallDock: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
