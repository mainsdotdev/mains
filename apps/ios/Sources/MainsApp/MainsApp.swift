import SwiftUI
import Network

@main
struct MainsApp: App {
    @State private var session = BackendSession(storage: NativeStorage())
    @AppStorage("appearancePreference") private var appearance = AppAppearance.system
    @Environment(\.scenePhase) private var scenePhase
    private let monitor = NWPathMonitor()

    var body: some Scene {
        WindowGroup {
            RootView(session: session)
                .preferredColorScheme(appearance.colorScheme)
                .tint(.primary)
                .task {
                    session.restore()
                    session.setActive(scenePhase == .active)
                    monitor.pathUpdateHandler = { path in
                        Task { @MainActor in session.setOnline(path.status == .satisfied) }
                    }
                    monitor.start(queue: DispatchQueue(label: "dev.mains.ios.network"))
                }
                .onChange(of: scenePhase) { _, phase in session.setActive(phase == .active) }
        }
    }
}

struct RootView: View {
    @Bindable var session: BackendSession
    @State private var incomingLink = ""
    @State private var showPairing = false

    var body: some View {
        AppShell(session: session, openPairing: {
            incomingLink = ""
            showPairing = true
        }).id(session.pairing?.deviceId)
        .onOpenURL { url in
            incomingLink = url.absoluteString
            showPairing = true
        }
        .sheet(isPresented: $showPairing) {
            NavigationStack { PairingView(session: session, initialLink: incomingLink) }
        }
        .alert("Mains", isPresented: Binding(get: { session.actionError != nil }, set: { if !$0 { session.actionError = nil } })) {
            Button("OK", role: .cancel) { session.actionError = nil }
        } message: { Text(session.actionError ?? "") }
    }
}

struct ConnectionPill: View {
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
