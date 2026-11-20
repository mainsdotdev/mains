import SwiftUI
import Network

enum AppFeatures {
    // The v1 target never compiles or links the live voice module.
    #if MAINS_GPT_LIVE
    static let gptLiveEnabled = true
    #else
    static let gptLiveEnabled = false
    #endif
}

@main
struct MainsApp: App {
    @State private var session = BackendSession(storage: NativeStorage())
    @State private var showsLaunchIntro = true
    @Environment(\.scenePhase) private var scenePhase
    private let monitor = NWPathMonitor()

    var body: some Scene {
        WindowGroup {
            #if DEBUG && MAINS_GPT_LIVE
            if CommandLine.arguments.contains("--voice-preview") { VoiceAppearancePreview() }
            else { application }
            #else
            application
            #endif
        }
    }

    private var application: some View {
        RootView(session: session, showsLaunchIntro: $showsLaunchIntro)
            .tint(.primary)
            .task {
#if MAINS_GPT_LIVE
                if AppFeatures.gptLiveEnabled {
                    session.voice.makeMedia = { NativeRealtimeVoiceMedia() }
                }
#endif

                session.restore()
                session.setActive(scenePhase == .active)
                monitor.pathUpdateHandler = { path in
                    Task { @MainActor in session.setOnline(path.status == .satisfied) }
                }
                monitor.start(queue: DispatchQueue(label: "dev.mains.ios.network"))
            }
            .onChange(of: scenePhase) { _, phase in
                // System alerts, including the app-icon confirmation, briefly make the scene inactive.
                switch phase {
                case .active: session.setActive(true)
                case .inactive: break
                case .background: session.setActive(false)
                @unknown default: session.setActive(false)
                }
            }
    }
}

struct RootView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @Bindable var session: BackendSession
    @Binding var showsLaunchIntro: Bool
    @AppStorage("appearancePreference") private var appearance = AppAppearance.system
    @State private var incomingLink = ""
    @State private var showPairing = false

    var body: some View {
        AppShell(session: session, openPairing: {
            incomingLink = ""
            showPairing = true
        }).id(session.pairing?.deviceId)
        .allowsHitTesting(!showsLaunchIntro)
        .accessibilityHidden(showsLaunchIntro)
        .overlay {
            if showsLaunchIntro {
                LaunchIntro(preferredScheme: appearance.colorScheme, finish: finishLaunchIntro)
                    .transition(.opacity)
            }
        }
        .onOpenURL { url in
            finishLaunchIntro(false)
            incomingLink = url.absoluteString
            showPairing = true
        }
        .sheet(isPresented: $showPairing) {
            NavigationStack { PairingView(session: session, initialLink: incomingLink) }
        }
        .alert("Mains", isPresented: Binding(get: { session.actionError != nil }, set: { if !$0 { session.actionError = nil } })) {
            Button("OK", role: .cancel) { session.actionError = nil }
        } message: { Text(session.actionError ?? "") }
        .preferredColorScheme(appearance.colorScheme)
    }

    private func finishLaunchIntro(_ animated: Bool) {
        guard showsLaunchIntro else { return }
        withAnimation(animated ? .easeOut(duration: 0.14) : nil) {
            showsLaunchIntro = false
        }
    }
}

struct ConnectionPill: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let action: () -> Void
    private var name: String { session.pairing?.descriptor.name ?? "Computer" }
    private var status: String { session.isDemo ? "Demo" : session.connection.label.replacingOccurrences(of: "…", with: "") }
    private var tone: Color {
        [.unauthorized, .incompatible, .unreachable].contains(session.connection) ? .orange : Color(.secondaryLabel)
    }
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(name).truncationMode(.middle)
                Circle().fill(tone).frame(width: 6, height: 6).accessibilityHidden(true)
                Text(status).fontWeight(.semibold).contentTransition(.opacity).layoutPriority(1)
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).accessibilityHidden(true)
            }
            .font(.caption).foregroundStyle(Color(.secondaryLabel)).lineLimit(1)
            .padding(.horizontal, 12).frame(minHeight: 36)
            .modifier(GlassSurface(radius: 18))
            .padding(.vertical, 4).contentShape(.rect)
        }
        .buttonStyle(ChatPressStyle())
        .accessibilityLabel("\(name): \(status)").accessibilityHint("Opens Settings")
        .accessibilityIdentifier("connectionPill")
    }
}
