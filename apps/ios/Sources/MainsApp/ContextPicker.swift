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
    let offersMates: Bool
    let offersWorkspaceFiles: Bool
    let pickSkill: @MainActor @Sendable (ContextSkill) -> Void
    let pickCommand: @MainActor @Sendable (ContextCommand) -> Void
    let close: @MainActor @Sendable () -> Void
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.frame == rhs.frame && lhs.scope == rhs.scope && lhs.owner == rhs.owner
            && lhs.trigger == rhs.trigger && lhs.query == rhs.query && lhs.pluginsOnly == rhs.pluginsOnly && lhs.offersMates == rhs.offersMates
            && lhs.offersWorkspaceFiles == rhs.offersWorkspaceFiles
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
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let request: ContextPickerRequest
    let maxHeight: CGFloat
    @State private var catalogue = ContextCatalogue()
    @State private var mates: [Mate] = []
    @State private var fileSearch: FileSearchResult?
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
    private struct FileSearchKey: Equatable {
        let scope: ContextScope
        let query: String
        let owner: Int
        let retry: Int
    }
    private struct FileSearchResult {
        let key: FileSearchKey
        var files: [WorkspaceFileMatch] = []
        var failed = false
    }
    private var fileSearchKey: FileSearchKey? {
        guard request.offersWorkspaceFiles, request.trigger == "@", !request.pluginsOnly,
              request.session.supportsWorkspaceFileSearch, request.session.isConnected, !request.query.isEmpty else { return nil }
        return FileSearchKey(scope: request.scope, query: request.query, owner: request.owner, retry: retry)
    }
    private var currentFileSearch: FileSearchResult? { fileSearch?.key == fileSearchKey ? fileSearch : nil }
    private var searchingFiles: Bool { fileSearchKey != nil && currentFileSearch == nil }
    private var loadKey: LoadKey {
        LoadKey(scope: request.scope, owner: request.owner, revision: request.session.contextRevisions[request.scope.providerID] ?? 0,
                connected: request.session.isConnected, retry: retry)
    }
    private var showMates: Bool { request.offersMates && request.trigger == "@" && !request.pluginsOnly && request.session.supportsMates && !request.session.isDemo }
    private var skills: [ContextSkill] {
        let choices = showMates ? mates.filter { mate in
            mate.ready && (request.query.isEmpty || mate.name.localizedCaseInsensitiveContains(request.query) || mate.description.localizedCaseInsensitiveContains(request.query))
        }.map { ContextSkill.mate(id: $0.id, name: $0.name, description: $0.description, providerID: $0.providerId, avatar: $0.avatar) } : []
        return choices + catalogue.matchingSkills(request.query, pluginsOnly: request.pluginsOnly)
            + (currentFileSearch?.files.map(ContextSkill.workspaceFile) ?? [])
    }
    private var commands: [ContextCommand] { catalogue.matchingCommands(request.query, trigger: request.trigger, pluginsOnly: request.pluginsOnly) }
    private var height: CGFloat {
        let groups = Set(skills.map(\.group)).count + (commands.isEmpty ? 0 : 1)
            + (searchingFiles || currentFileSearch?.failed == true ? 1 : 0)
        let rows = skills.count + commands.count
        return min(maxHeight, 54 + max(78, CGFloat(rows) * 76 + CGFloat(groups) * 30) + (catalogue.error == nil ? 0 : 90))
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(request.pluginsOnly ? "Plugins" : request.query.isEmpty ? "Add context" : "Matching “\(request.query)”")
                    .font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer()
                Button(action: request.close) { Image(systemName: "xmark").frame(width: 40, height: 44) }
                    .accessibilityLabel("Close context picker").accessibilityIdentifier("closeContextPicker")
            }.padding(.leading, 16).padding(.trailing, 4)
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if loading && skills.isEmpty && commands.isEmpty {
                        ContentSkeleton(label: "Loading context…", count: 1)
                    }
                    if let error = catalogue.error {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(error).font(.footnote).foregroundStyle(Color(uiColor: .secondaryLabel)).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("contextError")
                            Button("Try again") { retry += 1 }.font(.footnote.weight(.semibold))
                        }.padding(14)
                    }
                    ForEach(["Mates", "Plugins", "Mac apps", "Skills", "Files"], id: \.self) { group in
                        let items = skills.filter { $0.group == group }
                        if !items.isEmpty {
                            section(group)
                            ForEach(items) { skill in
                                Button { request.pickSkill(skill) } label: {
                                    HStack(alignment: .center, spacing: 12) {
                                        ContextSkillIcon(skill: skill).frame(width: 30, height: 30).accessibilityHidden(true)
                                        VStack(alignment: .leading, spacing: 3) {
                                            HStack(spacing: 6) {
                                                Text(skill.mentionTitle).font(.subheadline.weight(.medium)).foregroundStyle(Color(uiColor: .label)).lineLimit(1)
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
                    if searchingFiles || currentFileSearch?.failed == true {
                        section("Files")
                        VStack(alignment: .leading, spacing: 6) {
                            Text(searchingFiles ? "Searching files…" : "Couldn’t search workspace files.")
                                .font(.footnote).foregroundStyle(Color(uiColor: .secondaryLabel))
                            if currentFileSearch?.failed == true {
                                Button("Try again") { retry += 1 }.font(.footnote.weight(.semibold))
                            }
                        }.padding(.horizontal, 16).padding(.vertical, 8)
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
                    if !loading && !searchingFiles && currentFileSearch?.failed != true && skills.isEmpty && commands.isEmpty && catalogue.error == nil {
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
        .task(id: "\(showMates):\(request.owner):\(request.session.matesRevision):\(request.session.isConnected)") {
            guard showMates, request.session.isConnected else { mates = []; return }
            let result = try? await request.session.loadMates()
            guard !Task.isCancelled, request.owner == request.session.ownership else { return }
            mates = result?.mates ?? []
        }
        .task(id: fileSearchKey) {
            fileSearch = nil
            guard let key = fileSearchKey else { return }
            do {
                try await Task.sleep(for: .milliseconds(320))
                let files = try await request.session.searchWorkspaceFiles(key.query, scope: key.scope)
                try Task.checkCancellation()
                fileSearch = FileSearchResult(key: key, files: files)
            } catch {
                guard !Task.isCancelled, key.owner == request.session.ownership else { return }
                fileSearch = FileSearchResult(key: key, failed: true)
            }
        }
        .accessibilityElement(children: .contain).accessibilityLabel("Context picker")
    }
    private func section(_ title: String) -> some View {
        Text(title).font(.caption.weight(.semibold).width(.expanded)).foregroundStyle(Color(uiColor: .secondaryLabel)).padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 4)
            .accessibilityAddTraits(.isHeader).accessibilityIdentifier("contextSection-\(title)")
    }
}

private struct ContextTypeBadge: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let title: String
    var body: some View {
        Text(title).font(.caption2).foregroundStyle(Color(uiColor: .secondaryLabel))
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Color(uiColor: .tertiarySystemFill), in: .capsule)
    }
}

private struct ContextDefaultIcon: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
            if let id = skill.mateID {
                MateRobotThumbnail(preset: MateRobotAssets.catalogue?.preset(for: skill.mateAvatar, mateID: id))
            } else if skill.workspaceFile != nil {
                Image(uiImage: ContextArtwork.icon(nil, skill: skill, size: 20, tint: .secondaryLabel))
                    .renderingMode(.original)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let source = skill.iconSmall ?? skill.iconLarge, source.hasPrefix("data:image/"), source.utf8.count <= 350_000,
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
