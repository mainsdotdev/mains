import SwiftUI

struct ContextPickerRequest: Equatable, Sendable {
    let id: UUID
    let frame: CGRect
    let session: BackendSession
    let scope: ContextScope
    let owner: Int
    let trigger: String?
    let query: String
    let pluginsOnly: Bool
    let pickSkill: @MainActor @Sendable (ContextSkill) -> Void
    let pickCommand: @MainActor @Sendable (ContextCommand) -> Void
    let close: @MainActor @Sendable () -> Void
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.frame == rhs.frame && lhs.scope == rhs.scope && lhs.owner == rhs.owner
            && lhs.trigger == rhs.trigger && lhs.query == rhs.query && lhs.pluginsOnly == rhs.pluginsOnly
    }
}

private struct ContextPickerKey: PreferenceKey {
    static let defaultValue: ContextPickerRequest? = nil
    static func reduce(value: inout ContextPickerRequest?, nextValue: () -> ContextPickerRequest?) {
        if let next = nextValue() { value = next }
    }
}

extension View {
    func contextPicker(_ request: ContextPickerRequest?) -> some View { preference(key: ContextPickerKey.self, value: request) }
    func contextPickerOverlayHost(isEnabled: Bool) -> some View {
        modifier(ContextPickerHost(enabled: isEnabled))
    }
}

private struct ContextPickerHost: ViewModifier {
    let enabled: Bool
    @State private var presented: ContextPickerRequest?
    func body(content: Content) -> some View {
        content.onPreferenceChange(ContextPickerKey.self) { presented = $0 }
            .overlay {
            if enabled, let request = presented {
                GeometryReader { geometry in
                    let localY = request.frame.minY - geometry.frame(in: .global).minY
                    let height = min(360, max(0, localY - 16))
                    ZStack(alignment: .topLeading) {
                        if request.pluginsOnly {
                            Color.clear.contentShape(.rect).frame(height: max(0, localY))
                                .onTapGesture { request.close() }.accessibilityHidden(true)
                        }
                        if height >= 100 {
                            ContextPickerPanel(request: request, maxHeight: height)
                                .frame(width: max(1, geometry.size.width - 24), height: height, alignment: .bottom)
                                .offset(x: 12, y: max(0, localY - height - 8))
                        }
                    }
                }.ignoresSafeArea(.keyboard).id(request.id)
            }
        }
    }
}

private struct ContextPickerPanel: View {
    let request: ContextPickerRequest
    let maxHeight: CGFloat
    @State private var catalogue = ContextCatalogue()
    @State private var loading = true
    @State private var retry = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    private struct LoadKey: Hashable {
        let scope: ContextScope
        let owner: Int
        let revision: Int
        let connected: Bool
        let retry: Int
    }
    private var loadKey: LoadKey {
        LoadKey(scope: request.scope, owner: request.owner, revision: request.session.contextRevisions[request.scope.providerID] ?? 0,
                connected: request.session.isConnected, retry: retry)
    }
    private var skills: [ContextSkill] { catalogue.matchingSkills(request.query, pluginsOnly: request.pluginsOnly) }
    private var commands: [ContextCommand] { catalogue.matchingCommands(request.query, trigger: request.trigger, pluginsOnly: request.pluginsOnly) }
    private var height: CGFloat {
        let groups = Set(skills.map(\.group)).count + (commands.isEmpty ? 0 : 1)
        let rows = skills.count + commands.count
        return min(maxHeight, 54 + max(78, CGFloat(rows) * 76 + CGFloat(groups) * 30) + (catalogue.error == nil ? 0 : 90))
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(request.pluginsOnly ? "Plugins" : request.query.isEmpty ? "Add context" : "Matching “\(request.query)”")
                    .font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer()
                if loading { ProgressView().controlSize(.small).accessibilityLabel("Loading context") }
                Button(action: request.close) { Image(systemName: "xmark").frame(width: 40, height: 44) }
                    .accessibilityLabel("Close context picker").accessibilityIdentifier("closeContextPicker")
            }.padding(.leading, 16).padding(.trailing, 4)
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if let error = catalogue.error {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(error).font(.footnote).foregroundStyle(Color(uiColor: .secondaryLabel)).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("contextError")
                            Button("Try again") { retry += 1 }.font(.footnote.weight(.semibold))
                        }.padding(14)
                    }
                    ForEach(["Plugins", "Mac apps", "Skills"], id: \.self) { group in
                        let items = skills.filter { $0.group == group }
                        if !items.isEmpty {
                            section(group)
                            ForEach(items) { skill in
                                Button { request.pickSkill(skill) } label: {
                                    HStack(alignment: .center, spacing: 12) {
                                        ContextSkillIcon(skill: skill).frame(width: 30, height: 30).accessibilityHidden(true)
                                        VStack(alignment: .leading, spacing: 3) {
                                            HStack(spacing: 6) {
                                                Text(skill.title).font(.subheadline.weight(.medium)).foregroundStyle(Color(uiColor: .label)).lineLimit(1)
                                                Spacer(minLength: 6)
                                                ContextTypeBadge(title: skill.badge).accessibilityIdentifier("contextSkillBadge-\(skill.name)")
                                            }
                                            if let detail = skill.detail { Text(detail).font(.caption).foregroundStyle(Color(uiColor: .secondaryLabel)).lineLimit(2).accessibilityIdentifier("contextSkillDescription-\(skill.name)") }
                                            if let hint = skill.argumentHint { Text(hint).font(.caption.monospaced()).foregroundStyle(Color(uiColor: .secondaryLabel)).lineLimit(1) }
                                        }.frame(maxWidth: .infinity, alignment: .leading)
                                    }.padding(.horizontal, 16).padding(.vertical, 10).frame(minHeight: 52).contentShape(.rect)
                                }.accessibilityIdentifier("context-skill-\(skill.name)")
                            }
                        }
                    }
                    if !commands.isEmpty {
                        section("Commands")
                        ForEach(commands) { command in
                            Button { request.pickCommand(command) } label: {
                                HStack(spacing: 12) {
                                    ContextDefaultIcon(command: true).frame(width: 30, height: 30).accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 3) {
                                        HStack(spacing: 6) {
                                            Text("/" + command.name).font(.subheadline.weight(.medium)).foregroundStyle(Color(uiColor: .label)).lineLimit(1)
                                            Spacer(minLength: 6)
                                            ContextTypeBadge(title: "Command").accessibilityIdentifier("contextCommandBadge-\(command.name)")
                                        }
                                        if let detail = command.description, !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(Color(uiColor: .secondaryLabel)).lineLimit(2).accessibilityIdentifier("contextCommandDescription-\(command.name)") }
                                        if let hint = command.argumentHint { Text(hint).font(.caption.monospaced()).foregroundStyle(Color(uiColor: .secondaryLabel)) }
                                    }.frame(maxWidth: .infinity, alignment: .leading)
                                }.padding(.horizontal, 16).padding(.vertical, 10).frame(minHeight: 52).contentShape(.rect)
                            }.accessibilityIdentifier("context-command-\(command.name)")
                        }
                    }
                    if !loading && skills.isEmpty && commands.isEmpty && catalogue.error == nil {
                        Text(request.query.isEmpty ? (request.pluginsOnly ? "No plugins available for this provider and workspace." : "No skills or commands available for this provider and workspace.") : "No matches found.")
                            .font(.subheadline).foregroundStyle(Color(uiColor: .secondaryLabel)).padding(20)
                    }
                }.padding(.bottom, 8)
            }.scrollDismissesKeyboard(.never).scrollIndicators(.hidden).accessibilityIdentifier("contextResults")
        }
        .buttonStyle(ChatPressStyle())
        .foregroundStyle(Color(uiColor: .label))
        .frame(height: height)
        .background(.regularMaterial, in: .rect(cornerRadius: 24))
        .overlay { RoundedRectangle(cornerRadius: 24).strokeBorder(.primary.opacity(0.08)) }
        .shadow(color: .black.opacity(0.2), radius: 16, y: 5)
        .opacity(appeared ? 1 : 0).scaleEffect(appeared ? 1 : 0.96, anchor: .bottomLeading)
        .onAppear { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { appeared = true } }
        .task(id: loadKey) {
            let key = loadKey
            catalogue = request.session.cachedContext(key.scope) ?? ContextCatalogue(); loading = true
            do {
                let result = try await request.session.loadContext(key.scope)
                try Task.checkCancellation()
                guard key == loadKey, request.owner == request.session.ownership else { return }
                catalogue = result; loading = false
            } catch {
                guard !Task.isCancelled, key == loadKey, request.owner == request.session.ownership else { return }
                catalogue.error = error.localizedDescription; loading = false
            }
        }
        .accessibilityElement(children: .contain).accessibilityLabel("Context picker")
    }
    private func section(_ title: String) -> some View {
        Text(title).font(.caption.weight(.semibold)).foregroundStyle(Color(uiColor: .secondaryLabel)).padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 4)
            .accessibilityAddTraits(.isHeader).accessibilityIdentifier("contextSection-\(title)")
    }
}

private struct ContextTypeBadge: View {
    let title: String
    var body: some View {
        Text(title).font(.caption2).foregroundStyle(Color(uiColor: .secondaryLabel))
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Color(uiColor: .tertiarySystemFill), in: .capsule)
    }
}

private struct ContextDefaultIcon: View {
    var tint = Color(uiColor: .secondaryLabel)
    var command = false
    var skill = false
    var body: some View {
        RegistryIcon(token: command ? "icon:slash" : skill ? "icon:sparkles" : "icon:box", fallback: command ? "line.diagonal" : skill ? "sparkles" : "cube", size: 18, tint: tint)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(tint.opacity(0.1), in: .rect(cornerRadius: 6))
    }
}

struct ContextSkillIcon: View {
    let skill: ContextSkill
    private var tint: Color {
        guard let hex = skill.brandColor?.trimmingCharacters(in: CharacterSet(charactersIn: "#")), hex.count == 6,
              let value = UInt32(hex, radix: 16) else { return Color(uiColor: .secondaryLabel) }
        return Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
    private var remote: URL? {
        guard let source = skill.iconSmall ?? skill.iconLarge, let url = URL(string: source),
              url.scheme?.lowercased() == "https", url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }
    var body: some View {
        Group {
            // Absolute paths belong to the computer; never treat them as phone files or URLs.
            if let source = skill.iconSmall ?? skill.iconLarge, source.hasPrefix("data:image/"), source.utf8.count <= 350_000,
               let comma = source.firstIndex(of: ","), let bytes = Data(base64Encoded: String(source[source.index(after: comma)...])),
               let image = UIImage(data: bytes) {
                Image(uiImage: image).resizable().scaledToFit()
            } else if let remote {
                AsyncImage(url: remote) { phase in
                    if let image = phase.image { image.resizable().scaledToFit() }
                    else { fallback }
                }
            } else {
                fallback
            }
        }
    }
    private var fallback: some View {
        ContextDefaultIcon(tint: tint, skill: skill.group == "Skills")
    }
}
