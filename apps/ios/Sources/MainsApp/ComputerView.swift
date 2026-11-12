import SwiftUI

enum AppAppearance: String, CaseIterable {
    case system, light, dark
    var title: String { rawValue.capitalized }
    var colorScheme: ColorScheme? {
        switch self { case .system: nil; case .light: .light; case .dark: .dark }
    }
}

struct ComputerView: View {
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
        List {
            SettingsSection(session.isDemo ? "Demo Mode" : "Connected computer") {
                if session.isDemo {
                    SettingsRow(title: "Demo Mac", subtitle: "Runs on this iPhone. No AI service is contacted. Demo changes reset when the app restarts.", value: "Demo")
                    Button { pair = true } label: { SettingsRow(title: "Pair a computer", subtitle: "Connect to Mains with a pairing code", symbol: "chevron.right") }
                } else if let pairing = session.pairing {
                    computerSummary
                    SettingsRow(title: "Address", subtitle: fallbackAddresses, value: endpoint.map(Self.host) ?? "—")
                    SettingsRow(title: "Mains version", value: descriptor?.appVersion ?? "—")
                    timestampRow("Paired", date: pairing.pairedAt, empty: "—")
                    timestampRow("Last synced", date: session.lastSyncedAt, empty: "Not yet")
                } else {
                    SettingsRow(title: "No computer paired", subtitle: "Start Mains on your computer, then scan its pairing code.")
                    Button { pair = true } label: { SettingsRow(title: "Scan pairing code", symbol: "chevron.right") }
                }
            }
            if session.pairing != nil {
                SettingsSection {
                    Button { Task { await session.refresh() } } label: {
                        HStack {
                            SettingsRow(title: session.refreshing ? "Syncing…" : "Sync now",
                                        subtitle: session.isDemo ? "Refresh the on-device sample conversations" : session.isConnected ? "Pull the latest runs, workspaces and settings" : "Available once Mains is reachable")
                            if session.refreshing { ProgressView().controlSize(.small) }
                        }
                    }
                    .disabled(!session.isConnected || session.refreshing).accessibilityIdentifier("syncNow")
                    if canRetry {
                        Button { session.retry() } label: {
                            SettingsRow(title: "Try again", subtitle: "Reconnect to Mains on your computer now")
                        }
                    }
                    if needsPairing {
                        Button { pair = true } label: {
                            SettingsRow(title: "Pair again", subtitle: "Scan a new pairing code from your computer", symbol: "chevron.right")
                        }
                    }
                    Button {
                        UIPasteboard.general.string = diagnostics
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        copied = true
                    } label: {
                        SettingsRow(title: "Copy diagnostics", subtitle: "Versions, addresses and the connection’s state, for a bug report",
                                    value: copied ? "Copied" : nil)
                    }
                    .accessibilityIdentifier("copyDiagnostics")
                }
            }
            if AppFeatures.gptLiveEnabled && session.pairing != nil {
                SettingsSection("GPT Live") {
                    NavigationLink { VoiceSettingsView(session: session) } label: {
                        SettingsRow(title: "Voice", subtitle: "Choose a voice and listen to samples",
                                    value: session.selectedRealtimeVoice?.capitalized)
                    }
                    .accessibilityIdentifier("voiceSettings")
                }
            }
            SettingsSection("Appearance") {
                ForEach(AppAppearance.allCases, id: \.self) { option in
                    Button {
                        appearance = option
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        SettingsRow(title: option.title,
                                    subtitle: option == .system ? "Follow the phone’s Display & Brightness setting" : nil,
                                    selected: appearance == option)
                    }
                    .accessibilityIdentifier("appearance-" + option.rawValue)
                    .accessibilityAddTraits(appearance == option ? .isSelected : [])
                }
            }
            SettingsSection("This phone") {
                SettingsRow(title: "Name", value: UIDevice.current.name)
                if let pairing = session.pairing, !session.isDemo {
                    SettingsRow(title: "Device ID", subtitle: "As listed by Mains on your computer", value: String(pairing.deviceId.prefix(8)))
                }
                SettingsRow(title: "Version", value: Self.appVersion)
                SettingsRow(title: "Build", value: "\(Self.buildVariant) (\(Self.buildNumber))")
                SettingsRow(title: "Protocol", value: String(Wire.protocolVersion))
            }
            SettingsSection("Legal & Support") {
                NavigationLink { AIDataSharingSettingsView(session: session) } label: {
                    SettingsRow(title: "AI Data Sharing", subtitle: session.isDemo ? "Demo choices are separate from real provider permissions" : "Review or reset provider permissions")
                }
                .accessibilityIdentifier("aiDataSharing")
                externalRow("Privacy Policy", subtitle: "How Mains handles your data", url: "https://mains.dev/privacy")
                externalRow("Terms of Use", subtitle: "Terms for using Mains", url: "https://mains.dev/terms")
                externalRow("Support", subtitle: "Email team@mains.dev", url: "mailto:team@mains.dev?subject=Mains%20Mobile%20Support", symbol: "envelope")
                externalRow("Open Source Licenses", subtitle: "Open-source software used by the app", url: "https://mains.dev/license")
            }
            if session.pairing != nil {
                SettingsSection {
                    if session.isDemo {
                        Button(role: .destructive) { session.exitDemo(); dismiss() } label: { SettingsRow(title: "Exit Demo Mode", destructive: true) }
                            .accessibilityIdentifier("exitDemo")
                    } else {
                        Button(role: .destructive) { forget = true } label: { SettingsRow(title: "Forget this computer", destructive: true) }
                            .accessibilityIdentifier("forgetComputer")
                    }
                }
            }
        }
        .modifier(SettingsListStyle())
        .navigationTitle("Settings").navigationBarTitleDisplayMode(.large)
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
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                Text(session.pairing?.descriptor.name ?? "Computer").font(.headline).lineLimit(1)
                Spacer(minLength: 4)
                HStack(spacing: 6) {
                    if session.connection.isBusy { ProgressView().controlSize(.mini) }
                    else { Circle().fill(statusColor).frame(width: 7, height: 7).accessibilityHidden(true) }
                    Text(session.connection.label.replacingOccurrences(of: "…", with: "")).font(.subheadline.weight(.medium))
                }
                .foregroundStyle(statusColor).accessibilityIdentifier("settingsConnectionStatus")
            }
            if let endpoint {
                Text(session.isConnected ? "via \(Self.host(endpoint)) · Mains \(descriptor?.appVersion ?? "—")" : Self.host(endpoint))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let connectionHint { Text(connectionHint).font(.footnote).foregroundStyle(.secondary).padding(.top, 2) }
        }
        .padding(.vertical, 10)
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
    private func timestampRow(_ title: String, date: Date?, empty: String) -> some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            SettingsRow(title: title, subtitle: date?.formatted(date: .numeric, time: .standard),
                        value: date.map { Self.relativeTime($0, now: timeline.date) } ?? empty)
        }
    }
    private func externalRow(_ title: String, subtitle: String, url: String, symbol: String = "arrow.up.right.square") -> some View {
        Button {
            guard let destination = URL(string: url) else { return }
            openURL(destination) { accepted in
                if !accepted {
                    session.actionError = title == "Support" ? "Could not open Mail. Email team@mains.dev for support." : "Could not open \(title). Visit \(url) in your browser."
                }
            }
        } label: { SettingsRow(title: title, subtitle: subtitle, symbol: symbol) }
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
    private static func relativeTime(_ date: Date, now: Date) -> String {
        let seconds = now.timeIntervalSince(date)
        if seconds < 45 { return "just now" }
        if seconds < 3600 { return "\(max(1, Int((seconds / 60).rounded())))m ago" }
        if seconds < 86400 { return "\(Int((seconds / 3600).rounded()))h ago" }
        if seconds < 604800 { return "\(Int((seconds / 86400).rounded()))d ago" }
        return date.formatted(date: .numeric, time: .omitted)
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
    let session: BackendSession
    @State private var revokeProvider: String?
    @State private var revokeBackendID: String?
    @State private var reset = false
    private let providers = ["claude_code", "codex", "copilot_cli", "cursor", "opencode"]
    private var allowedProviders: [String] { providers.filter { session.hasConsent(providerID: $0) } }

    var body: some View {
        List {
            Section {
                Text(session.isDemo ? "Demo Mode stays on this iPhone. These demo choices never grant permission to share data with a real AI service. Mains asks separately after pairing a computer." : "Before Mains on your computer sends a request to a third-party AI service, Mains asks for permission for that computer and provider. Switching providers asks again. These choices are stored only on this phone.")
                    .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    .listRowBackground(Color.clear)
                    // Inset-grouped rows clip their corners even with a clear
                    // background. Keep the prose inside that rounded boundary.
                    .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
            }
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
        .modifier(SettingsListStyle())
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

private struct SettingsRow: View {
    let title: String
    var subtitle: String? = nil
    var value: String? = nil
    var symbol: String? = nil
    var selected = false
    var destructive = false
    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).foregroundStyle(destructive ? .red : .primary)
                if let subtitle { Text(subtitle).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let value { Text(value).foregroundStyle(.secondary).multilineTextAlignment(.trailing) }
            if selected { Image(systemName: "checkmark").foregroundStyle(.blue).font(.body.weight(.medium)).accessibilityHidden(true) }
            if let symbol { Image(systemName: symbol).font(.subheadline).foregroundStyle(.tertiary).accessibilityHidden(true) }
        }
        .font(.body).padding(.vertical, 8).frame(minHeight: 36).contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}

private struct SettingsSection<Content: View>: View {
    var title: String? = nil
    @ViewBuilder let content: Content
    init(_ title: String? = nil, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
    var body: some View {
        Section { content } header: {
            if let title { Text(title).font(.title3.weight(.semibold)).foregroundStyle(.primary).textCase(nil).padding(.bottom, 4) }
        }
        .listRowBackground(Color(.secondarySystemBackground))
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
    }
}

private struct SettingsListStyle: ViewModifier {
    func body(content: Content) -> some View {
        content.listStyle(.insetGrouped).scrollContentBackground(.hidden)
            .background(Color(.systemBackground)).listSectionSpacing(24).buttonStyle(.plain)
    }
}
