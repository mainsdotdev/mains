import SwiftUI

enum AppAppearance: String, CaseIterable {
    case system, light, dark
    var title: String { rawValue.capitalized }
    var colorScheme: ColorScheme? {
        switch self { case .system: nil; case .light: .light; case .dark: .dark }
    }
    fileprivate var symbol: String {
        switch self {
        case .system: "circle.lefthalf.filled"
        case .light: "sun.max"
        case .dark: "moon"
        }
    }
}

struct ComputerView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    @AppStorage("appearancePreference") private var appearance = AppAppearance.system
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var forget = false
    @State private var pair = false
    @State private var copied = false

    private var descriptor: BackendDescriptor? { session.connectedDescriptor ?? session.pairing?.descriptor }
    private var endpoint: URL? { session.activeEndpoint ?? session.pairing?.endpoints.first }
    private var canRetry: Bool { [.unreachable, .offline, .reconnecting].contains(session.connection) }
    private var needsPairing: Bool { [.unauthorized, .incompatible].contains(session.connection) }

    var body: some View {
        SettingsScrollView {
            PageTitle("Settings")
            SettingsSection(session.isDemo ? "Demo Mode" : "Connected computer") {
                if session.isDemo {
                    SettingsRow(title: "Demo Mac",
                                subtitle: "Runs on this iPhone. No AI service is contacted. Demo changes reset when the app restarts.", value: "Demo")
                    Button { pair = true } label: {
                        SettingsRow(title: "Pair a computer", symbol: "chevron.right",
                                    subtitle: "Connect to Mains with a pairing code")
                    }
                } else if session.pairing != nil {
                    computerSummary
                } else {
                    SettingsRow(title: "No computer paired", symbol: "desktopcomputer",
                                subtitle: "Start Mains on your computer, then scan its pairing code.")
                    Button { pair = true } label: {
                        SettingsRow(title: "Scan pairing code", symbol: "chevron.right")
                    }
                }
                if session.pairing != nil {
                    syncRow
                    if canRetry {
                        Button { session.retry() } label: {
                            SettingsRow(title: "Try again", symbol: "wifi", subtitle: "Reconnect to Mains on your computer now")
                        }
                    }
                    if needsPairing {
                        Button { pair = true } label: {
                            SettingsRow(title: "Pair again", symbol: "chevron.right",
                                        subtitle: "Scan a new pairing code from your computer")
                        }
                    }
                    if session.isDemo {
                        Button(role: .destructive) { session.exitDemo(); dismiss() } label: {
                            SettingsRow(title: "Exit Demo Mode", symbol: "rectangle.portrait.and.arrow.right", destructive: true)
                        }
                        .accessibilityIdentifier("exitDemo")
                    }
                }
            }
            if let pairing = session.pairing, !session.isDemo {
                SettingsSection("Connection details") {
                    SettingsRow(title: "Address", subtitle: fallbackAddresses, value: endpoint.map(Self.host) ?? "—")
                    SettingsRow(title: "Mains version", value: descriptor?.appVersion ?? "—")
                    TimelineView(.periodic(from: .now, by: 60)) { timeline in
                        SettingsRow(title: "Paired", subtitle: pairing.pairedAt?.formatted(date: .numeric, time: .standard),
                                    value: pairing.pairedAt.map { compactRelativeAge($0, now: timeline.date) } ?? "—")
                    }
                    Button(role: .destructive) { forget = true } label: {
                        SettingsRow(title: "Forget this computer", symbol: "xmark.circle", destructive: true)
                    }
                    .accessibilityIdentifier("forgetComputer")
                }
            }
            #if MAINS_GPT_LIVE
            if AppFeatures.gptLiveEnabled && session.pairing != nil {
                SettingsSection("GPT Live") {
                    NavigationLink { VoiceSettingsView(session: session) } label: {
                        SettingsRow(title: "Voice", symbol: "chevron.right", subtitle: "Choose a voice and listen to samples",
                                    value: session.selectedRealtimeVoice?.capitalized)
                    }
                    .accessibilityIdentifier("voiceSettings")
                }
            }
            #endif
            SettingsSection("Appearance") {
                ForEach(AppAppearance.allCases, id: \.self) { option in
                    Button {
                        appearance = option
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        SettingsRow(title: option.title, symbol: option.symbol,
                                    subtitle: option == .system ? "Follow the phone’s Display & Brightness setting" : nil,
                                    selected: appearance == option)
                    }
                    .accessibilityIdentifier("appearance-" + option.rawValue)
                    .accessibilityAddTraits(appearance == option ? .isSelected : [])
                }
            }
            AppIconSettings()
            SettingsSection("This phone") {
                SettingsRow(title: "Name", value: UIDevice.current.name)
                if let pairing = session.pairing, !session.isDemo {
                    SettingsRow(title: "Device ID",
                                subtitle: "As listed by Mains on your computer", value: String(pairing.deviceId.prefix(8)))
                }
                SettingsRow(title: "Build", value: "\(Self.buildVariant) (\(Self.buildNumber))")
                SettingsRow(title: "Protocol", value: String(Wire.protocolVersion))
            }
            SettingsSection("Legal & Support") {
                NavigationLink { AIDataSharingSettingsView(session: session) } label: {
                    SettingsRow(title: "AI Data Sharing", symbol: "chevron.right",
                                subtitle: session.isDemo ? "Demo choices are separate from real provider permissions" : "Review or reset provider permissions")
                }
                .accessibilityIdentifier("aiDataSharing")
                externalRow("Privacy Policy", subtitle: "How Mains handles your data", url: "https://mains.dev/privacy")
                externalRow("Terms of Use", subtitle: "Terms for using Mains", url: "https://mains.dev/terms")
                externalRow("Support", symbol: "envelope", subtitle: "Email team@mains.dev",
                            url: "mailto:team@mains.dev?subject=Mains%20Mobile%20Support")
                if session.pairing != nil {
                    Button {
                        UIPasteboard.general.string = diagnostics
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        copied = true
                    } label: {
                        SettingsRow(title: "Copy diagnostics", symbol: "doc.on.doc",
                                    subtitle: "Versions, addresses and the connection’s state, for a bug report",
                                    value: copied ? "Copied" : nil)
                    }
                    .accessibilityIdentifier("copyDiagnostics")
                }
                externalRow("Open Source Licenses",
                            subtitle: "Open-source software used by the app", url: "https://mains.dev/license")
            }
            SettingsFooter(version: Self.appVersion, build: Self.buildNumber)
        }
        .scrollingNavigationTitle("Settings")
        .toolbar(.visible, for: .navigationBar)
        .accessibilityIdentifier("settingsList")
        .alert("Forget this computer?", isPresented: $forget) {
            Button("Cancel", role: .cancel) {}
            Button("Forget", role: .destructive) {
                do { try session.forget(); dismiss() } catch { session.actionError = error.localizedDescription }
            }
        } message: {
            Text("The pairing and everything cached from this computer will be removed from this phone. If the phone is lost, revoke it in Mains on the computer too.")
        }
        .sheet(isPresented: $pair) { NavigationStack { PairingView(session: session) } }
        .task(id: copied) {
            guard copied else { return }
            do { try await Task.sleep(for: .seconds(2)); copied = false } catch {}
        }
    }

    private var computerSummary: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(session.pairing?.descriptor.name ?? "Computer").font(.headline)
                if let connectionHint { Text(connectionHint).font(.footnote).foregroundStyle(.secondary) }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(session.connection.label)
                .font(.subheadline.weight(.medium)).multilineTextAlignment(.trailing)
                .foregroundStyle(statusColor).accessibilityIdentifier("settingsConnectionStatus")
        }
        .settingsRowLayout()
    }
    private var statusColor: Color {
        if session.isConnected { return .blue }
        if [.unauthorized, .incompatible, .unreachable].contains(session.connection) { return .orange }
        return .secondary
    }
    private var connectionHint: String? {
        switch session.connection {
        case .unreachable: "Make sure your computer is awake and Mains is running. Use the same Wi-Fi, or Tailscale on both devices."
        case .unauthorized: "Mains on your computer no longer accepts this phone. Create a new pairing link there."
        case .incompatible: "One side is on an older Mains. Update Mains on your phone or computer, then try again."
        case .offline: "Chats from the last sync are still here; they update once you’re back online."
        default: nil
        }
    }
    private var fallbackAddresses: String? {
        let alternatives = (session.pairing?.endpoints ?? []).filter { $0 != endpoint }.map(Self.host)
        return alternatives.isEmpty ? nil : "Also " + alternatives.joined(separator: ", ")
    }
    private var syncRow: some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            let lastSynced = session.lastSyncedAt.map { "Last synced \(compactRelativeAge($0, now: timeline.date))" } ?? "Not synced yet"
            Button { Task { await session.refresh() } } label: {
                SettingsRow(title: session.refreshing ? "Syncing…" : "Sync now", symbol: "arrow.clockwise",
                            subtitle: session.isDemo ? "Refresh the on-device sample conversations" : lastSynced,
                            loading: session.refreshing)
            }
            .disabled(!session.isConnected || session.refreshing)
            .accessibilityIdentifier("syncNow")
        }
    }
    private func externalRow(_ title: String, symbol: String = "arrow.up.right.square", subtitle: String, url: String) -> some View {
        Button {
            guard let destination = URL(string: url) else { return }
            openURL(destination) { accepted in
                if !accepted {
                    session.actionError = title == "Support" ? "Could not open Mail. Email team@mains.dev for support." : "Could not open \(title). Visit \(url) in your browser."
                }
            }
        } label: { SettingsRow(title: title, symbol: symbol, subtitle: subtitle) }
    }
    private static var appVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—" }
    private static var buildNumber: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—" }
    private static var buildVariant: String {
        #if DEBUG
        "development"
        #else
        "production"
        #endif
    }
    private static func host(_ endpoint: URL) -> String {
        guard let parts = URLComponents(url: endpoint, resolvingAgainstBaseURL: false), let host = parts.host else { return "—" }
        return host + (parts.port.map { ":\($0)" } ?? "")
    }
    private var diagnostics: String {
        var lines = [
            "Mains iOS \(Self.appVersion) (\(Self.buildVariant), build \(Self.buildNumber)) · protocol \(Wire.protocolVersion)",
            "Phone: \(UIDevice.current.name) · device \(session.pairing?.deviceId ?? "—")",
            "Computer: \(descriptor?.name ?? "not paired") · Mains \(descriptor?.appVersion ?? "—") · protocol \(descriptor.map { String($0.protocolVersion) } ?? "—")",
            "Connection: \(session.connection.label)",
            "Endpoints: \((session.pairing?.endpoints ?? []).map(\.absoluteString).joined(separator: ", "))",
        ]
        if let endpoint { lines.append("Active endpoint: \(endpoint.absoluteString)") }
        lines.append("Paired: \(session.pairing?.pairedAt?.ISO8601Format() ?? "unknown")")
        lines.append("Last synced: \(session.lastSyncedAt?.ISO8601Format() ?? "never")")
        lines.append("At: \(Date().ISO8601Format())")
        return lines.joined(separator: "\n")
    }
}

private struct AIDataSharingSettingsView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    @State private var revokeProvider: String?
    @State private var revokeBackendID: String?
    @State private var reset = false
    private let providers = ["claude_code", "codex", "copilot_cli", "cursor", "opencode"]
    private var allowedProviders: [String] { providers.filter { session.hasConsent(providerID: $0) } }

    var body: some View {
        SettingsScrollView {
            Text(session.isDemo ? "Demo Mode stays on this iPhone. These demo choices never grant permission to share data with a real AI service. Mains asks separately after pairing a computer." : "Before Mains on your computer sends a request to a third-party AI service, Mains asks for permission for that computer and provider. Switching providers asks again. These choices are stored only on this phone.")
                .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
            SettingsSection(session.isDemo ? "Demo providers" : "This computer") {
                ForEach(providers, id: \.self) { id in
                    let allowed = session.hasConsent(providerID: id)
                    if allowed {
                        Button {
                            revokeBackendID = session.pairing?.descriptor.backendId
                            revokeProvider = id
                        } label: {
                            SettingsRow(title: Provider.name(id), subtitle: session.isDemo ? "Demo only · Tap to reset" : Provider.recipient(id) + " · Tap to revoke", value: session.isDemo ? "Demo" : "Allowed")
                        }
                        .accessibilityIdentifier("consent-" + id)
                    } else {
                        SettingsRow(title: Provider.name(id), subtitle: session.isDemo ? "On-device sample data" : Provider.recipient(id), value: session.isDemo ? "Not tried yet" : "Ask before sending")
                            .accessibilityIdentifier("consent-" + id)
                    }
                }
            }
            if !allowedProviders.isEmpty {
                SettingsSection {
                    Button(role: .destructive) {
                        revokeBackendID = session.pairing?.descriptor.backendId
                        reset = true
                    } label: { SettingsRow(title: "Reset all permissions", destructive: true) }
                        .accessibilityIdentifier("resetAIDataPermissions")
                }
            }
        }
        .navigationTitle("AI Data Sharing").navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .confirmationDialog(session.isDemo ? "Reset the \(revokeProvider.map(Provider.name) ?? "AI") demo disclosure?" : "Revoke \(revokeProvider.map(Provider.name) ?? "AI") permission?", isPresented: Binding(
            get: { revokeProvider != nil }, set: { if !$0 { revokeProvider = nil } }), titleVisibility: .visible, presenting: revokeProvider) { provider in
                let backend = revokeBackendID
                Button(session.isDemo ? "Reset" : "Revoke", role: .destructive) {
                    if let backend { session.revokeConsent(providerID: provider, backendID: backend) }
                    revokeProvider = nil
                }
                Button("Cancel", role: .cancel) { revokeProvider = nil }
            } message: { provider in Text(session.isDemo ? "The demo disclosure will appear again. Real provider permissions stay separate." : "Mains will ask again before this computer sends data to \(Provider.name(provider)).") }
        .confirmationDialog(session.isDemo ? "Reset all demo choices?" : "Reset all AI permissions?", isPresented: $reset, titleVisibility: .visible) {
            Button("Reset", role: .destructive) {
                if let backend = revokeBackendID { session.revokeAllConsents(backendID: backend) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { Text(session.isDemo ? "Show the demo disclosures again. Real provider permissions stay separate." : "Mains will ask again before this computer sends data to any AI provider.") }
    }
}

private struct AppIconSettings: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedName = UIApplication.shared.alternateIconName
    @State private var changing = false
    @State private var changeError: String?

    private enum Choice: String, CaseIterable {
        case `default`, atlas, bridge, mate

        var title: String { rawValue.capitalized }
        var alternateName: String? { self == .default ? nil : rawValue }
    }

    var body: some View {
        SettingsSection("App Icon") {
            HStack(alignment: .top, spacing: 4) {
                ForEach(Choice.allCases, id: \.self) { choice in
                    let selected = choice.alternateName == selectedName
                    Button { changeIcon(to: choice) } label: {
                        VStack(spacing: 6) {
                            Image("app-icon-preview-\(choice.rawValue)")
                                .resizable().scaledToFit()
                                .frame(maxWidth: 54)
                                .padding(3)
                                .overlay {
                                    RoundedRectangle(cornerRadius: 16)
                                        .strokeBorder(.blue, lineWidth: 2)
                                        .opacity(selected ? 1 : 0)
                                }
                                .accessibilityHidden(true)
                            Text(choice.title)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(selected ? Color.blue : .primary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                        }
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                    }
                    .accessibilityAddTraits(selected ? .isSelected : [])
                    .accessibilityIdentifier("appIcon-\(choice.rawValue)")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 14)
            .disabled(!UIApplication.shared.supportsAlternateIcons)
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active { selectedName = UIApplication.shared.alternateIconName }
        }
        .alert("Couldn’t change the app icon", isPresented: Binding(
            get: { changeError != nil }, set: { if !$0 { changeError = nil } }
        )) {} message: {
            Text(changeError ?? "")
        }
    }

    private func changeIcon(to choice: Choice) {
        let application = UIApplication.shared
        guard application.supportsAlternateIcons, !changing, choice.alternateName != application.alternateIconName else { return }
        changing = true
        Task { @MainActor in
            do {
                try await application.setAlternateIconName(choice.alternateName)
            } catch {
                changeError = error.localizedDescription
            }
            selectedName = application.alternateIconName
            changing = false
        }
    }
}

private struct SettingsRow: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let title: String
    var symbol: String? = nil
    var subtitle: String? = nil
    var value: String? = nil
    var selected = false
    var destructive = false
    var loading = false
    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).foregroundStyle(destructive ? .red : .primary)
                if let subtitle { Text(subtitle).font(.footnote).foregroundStyle(.secondary) }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            if let value {
                Text(value).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
            } else if loading {
                ProgressView().controlSize(.small).frame(width: 20).accessibilityHidden(true)
            } else if selected {
                SettingsRowIcon(symbol: "checkmark").foregroundStyle(.blue)
            } else if let symbol {
                SettingsRowIcon(symbol: symbol).foregroundStyle(destructive ? .red : .primary)
            }
        }
        .font(.body).settingsRowLayout()
        .accessibilityElement(children: .combine)
    }
}

private struct SettingsRowIcon: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @ScaledMetric(relativeTo: .subheadline) private var width: CGFloat = 20
    let symbol: String

    var body: some View {
        Image(systemName: symbol)
            .font(.subheadline.weight(.medium))
            .symbolRenderingMode(.monochrome)
            .frame(width: width)
            .accessibilityHidden(true)
    }
}

private struct SettingsSection<Content: View>: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    var title: String? = nil
    @ViewBuilder let content: Content
    init(_ title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title; self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                Text(title).font(.title3.weight(.medium).width(.expanded)).padding(.horizontal, 4)
                    .accessibilityAddTraits(.isHeader)
            }
            VStack(spacing: 0) {
                Group(subviews: content) { rows in
                    ForEach(rows) { row in
                        row.overlay(alignment: .bottom) {
                            if row.id != rows.last?.id {
                                Divider().allowsHitTesting(false).accessibilityHidden(true)
                            }
                        }
                    }
                }
            }
            .background(Color(.secondarySystemBackground))
            .clipShape(.rect(cornerRadius: 14))
        }
    }
}

private struct SettingsScrollView<Content: View>: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) { content }
                .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
        }
        .background(Color(.systemBackground))
        .navigationHeaderFade()
        .buttonStyle(.plain)
    }
}

private struct SettingsFooter: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let version: String
    let build: String
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var showsJapanese = false

    private struct SignLight {
        var level = 1.0
        var sweep: CGFloat = 0
    }

    private var animates: Bool { visible && scenePhase == .active && !reduceMotion }
    private var red: Color {
        colorScheme == .dark
            ? Color(red: 1, green: 0.33, blue: 0.38)
            : Color(red: 0.73, green: 0.08, blue: 0.16)
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("App Version \(version) (\(build))")
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("settingsAppVersion")

            Button {
                showsJapanese.toggle()
            } label: {
                neonSign.frame(minWidth: 44, minHeight: 44).contentShape(.rect)
            }
            .accessibilityLabel(showsJapanese ? "東京から生中継" : "Live from Tokyo")
            .accessibilityHint("Switches the language")
            .accessibilityIdentifier("settingsTokyoSign")
            .onScrollVisibilityChange(threshold: 0.6) { visible = $0 }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .task(id: animates ? Optional(showsJapanese) : nil) { try? await waitForNextLanguage() }
    }

    @ViewBuilder private var neonSign: some View {
        let japanese = showsJapanese
        let glow = Self.sign(japanese: japanese, animated: !reduceMotion)
            .foregroundStyle(red)
            .shadow(color: red.opacity(0.5), radius: 4)
            .shadow(color: red.opacity(0.26), radius: 14)
        if reduceMotion {
            glow
        } else {
            glow.keyframeAnimator(initialValue: SignLight(), trigger: showsJapanese) { content, light in
                content
                    .overlay {
                        GeometryReader { geometry in
                            let beamWidth = geometry.size.width * 0.55
                            LinearGradient(colors: [.clear, .cyan.opacity(0.75), .white.opacity(0.85), .clear],
                                           startPoint: .leading, endPoint: .trailing)
                                .frame(width: beamWidth)
                                .offset(x: (geometry.size.width + beamWidth) * light.sweep - beamWidth)
                        }
                        .mask(alignment: .center) { Self.sign(japanese: japanese, animated: true) }
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                    }
                    .opacity(light.level)
            } keyframes: { _ in
                KeyframeTrack(\.level) {
                    LinearKeyframe(0.62, duration: 0.14)
                    CubicKeyframe(1, duration: 0.46)
                }
                KeyframeTrack(\.sweep) {
                    MoveKeyframe(0)
                    LinearKeyframe(1, duration: 0.6)
                }
            }
        }
    }

    nonisolated private static func sign(japanese: Bool, animated: Bool) -> some View {
        ZStack {
            lettering("LIVE FROM", "TOKYO").opacity(japanese ? 0 : 1)
            lettering("東京から", "生中継").opacity(japanese ? 1 : 0)
        }
        .animation(animated ? .easeInOut(duration: 0.6) : nil, value: japanese)
    }

    nonisolated private static func lettering(_ line: String, _ headline: String) -> some View {
        VStack(spacing: 3) {
            Text(verbatim: line).font(.caption.weight(.medium).monospaced()).tracking(2.5)
            Text(verbatim: headline).font(.title2.weight(.medium).width(.expanded)).tracking(1.6)
        }
    }

    private func waitForNextLanguage() async throws {
        guard animates else { return }
        // Start a fresh countdown after either a tap or an automatic change.
        try await Task.sleep(for: .seconds(showsJapanese ? 2.5 : 4))
        try Task.checkCancellation()
        showsJapanese.toggle()
    }
}

private extension View {
    func settingsRowLayout() -> some View {
        padding(.horizontal, 16).padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 52).contentShape(.rect)
    }
}
