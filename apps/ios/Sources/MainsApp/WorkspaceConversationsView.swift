import SwiftUI

struct WorkspaceConversationsView: View {
    let session: BackendSession
    let workspaceID: String
    let openConversation: (String) -> Void
    let startConversation: () -> Void
    @State private var query = ""
    @FocusState private var searching: Bool
    @Environment(\.colorScheme) private var scheme
    private var workspace: Workspace? { session.workspaces.first { $0.id == workspaceID } }
    private var branch: String? { session.gitStates.first { $0.workspaceId == workspaceID }?.branch }
    private var accent: Color {
        scheme == .dark ? Color(red: 59 / 255, green: 130 / 255, blue: 246 / 255) : Color(red: 37 / 255, green: 99 / 255, blue: 235 / 255)
    }
    private var runs: [Conversation] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return session.conversations.filter {
            $0.workspaceId == workspaceID && $0.providerId == session.selectedSpace?.providerId && $0.mode == session.selectedSpace?.mode &&
            (needle.isEmpty || $0.displayTitle.localizedCaseInsensitiveContains(needle))
        }
    }
    private var canStart: Bool {
        workspace != nil && workspace?.isReplica != true && session.selectedSpace?.mode == "developer" &&
        session.gitStates.first(where: { $0.workspaceId == workspaceID })?.pathExists != false
    }
    var body: some View {
        ScrollView {
            TimelineView(.periodic(from: .now, by: 60)) { clock in
                LazyVStack(alignment: .leading, spacing: 0) {
                    if workspace?.isReplica == true {
                        BridgeReadOnlyNotice(text: "Read-only · this workspace runs on another computer")
                            .padding(.bottom, 12)
                    }
                    if runs.isEmpty {
                        Text(query.isEmpty ? "No runs in this workspace yet." : "No runs match.")
                            .font(.subheadline).foregroundStyle(.secondary).padding(.horizontal, 4).padding(.vertical, 16)
                    }
                    ForEach(runs) { run in
                        Button {
                            searching = false; openConversation(run.id)
                        } label: {
                            HStack(alignment: .firstTextBaseline, spacing: 16) {
                                Text(run.displayTitle).font(.body.weight(.medium)).foregroundStyle(.primary)
                                    .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                                Text(run.isActive && run.isReplica != true ? (run.status == "queued" ? "Queued" : "Running") : conversationAge(run.updatedAt, now: clock.date))
                                    .font(.caption).monospacedDigit().foregroundStyle(run.isActive && run.isReplica != true ? accent : Color(.tertiaryLabel))
                                    .fixedSize(horizontal: true, vertical: false)
                            }.padding(.horizontal, 4).padding(.vertical, 16).contentShape(.rect)
                        }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("conversation-\(run.id)")
                    }
                }.padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
            }
        }
        .background(Color(.systemBackground))
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(workspace?.name ?? "Workspace").navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(workspace?.name ?? "Workspace").font(.headline).lineLimit(1)
                    if let branch { Text(branch).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                }.accessibilityElement(children: .combine).accessibilityIdentifier("workspaceTitle")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { bottomBar }
        .refreshable { await session.refresh() }
    }
    private var bottomBar: some View {
        HStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 18)).foregroundStyle(.secondary)
                TextField("Search runs", text: $query)
                    .font(.body).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .submitLabel(.search).focused($searching).accessibilityIdentifier("workspaceSearch")
            }.padding(.horizontal, 16).frame(height: 52).modifier(GlassSurface(radius: 26))
            if searching || !query.isEmpty {
                RoundControl(symbol: "xmark", label: "Close search", size: 52) { query = ""; searching = false }
                    .accessibilityIdentifier("closeWorkspaceSearch")
            } else if workspace?.isReplica != true {
                Button {
                    guard canStart, let space = session.selectedSpace else { return }
                    searching = false
                    var target = session.homeTargets[space.id] ?? HomeTarget()
                    target.workspaceID = workspaceID; session.selectTarget(target, spaceID: space.id)
                    startConversation()
                } label: {
                    Image(systemName: "square.and.pencil").font(.system(size: 22))
                        .foregroundStyle(.white).frame(width: 52, height: 52).background(accent, in: .circle)
                }.buttonStyle(ChatPressStyle()).disabled(!canStart)
                    .accessibilityLabel("New conversation").accessibilityIdentifier("newConversation")
            }
        }.padding(.horizontal, 16).padding(.vertical, 8)
    }
}

struct SearchView: View {
    nonisolated private static let layoutSpace = "globalSearchPage"
    let session: BackendSession
    let focusRequested: Bool
    let layoutChanged: (CGFloat) -> Void
    let open: (AppRoute) -> Void
    let close: () -> Void
    @State private var query = ""
    @FocusState private var searching: Bool
    private var needle: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var conversations: [Conversation] {
        guard !needle.isEmpty else { return [] }
        return Array(session.conversations.filter { run in
            run.displayTitle.localizedCaseInsensitiveContains(needle) || session.collections.first { $0.id == run.collectionId }?.name.localizedCaseInsensitiveContains(needle) == true
        }.prefix(50))
    }
    private var workspaces: [Workspace] {
        guard !needle.isEmpty else { return [] }
        return session.workspaces.filter { workspace in
            workspace.name.localizedCaseInsensitiveContains(needle) || session.gitStates.first { $0.workspaceId == workspace.id }?.branch?.localizedCaseInsensitiveContains(needle) == true
        }
    }
    var body: some View {
        Group {
            if needle.isEmpty || conversations.isEmpty && workspaces.isEmpty {
                VStack(spacing: 20) {
                    Image(systemName: "magnifyingglass").font(.system(size: 36, weight: .regular)).accessibilityHidden(true)
                    Text(needle.isEmpty ? "Search chats and workspaces" : "No results found")
                        .font(.subheadline).foregroundStyle(Color(.secondaryLabel))
                }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    TimelineView(.periodic(from: .now, by: 60)) { clock in
                        LazyVStack(alignment: .leading, spacing: 0) {
                            if !conversations.isEmpty {
                                sectionTitle("Chats")
                                ForEach(conversations) { run in
                                    Button { openResult(.conversation(run.id)) } label: {
                                        HStack(spacing: 16) {
                                            VStack(alignment: .leading, spacing: 4) {
                                                Text(run.displayTitle).font(.body).foregroundStyle(.primary).lineLimit(1)
                                                Text(place(of: run)).font(.footnote).foregroundStyle(Color(.secondaryLabel)).lineLimit(1)
                                            }.frame(maxWidth: .infinity, alignment: .leading)
                                            Text(run.isActive && run.isReplica != true ? (run.status == "queued" ? "Queued" : "Running") : conversationAge(run.updatedAt, now: clock.date))
                                                .font(.caption).monospacedDigit().foregroundStyle(Color(.secondaryLabel))
                                                .fixedSize(horizontal: true, vertical: false)
                                        }.padding(.vertical, 10).contentShape(.rect)
                                    }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("search-run-\(run.id)")
                                }
                            }
                            if !workspaces.isEmpty {
                                sectionTitle("Workspaces").padding(.top, conversations.isEmpty ? 0 : 16)
                                ForEach(workspaces) { workspace in
                                    Button { openResult(.workspace(workspace.id)) } label: {
                                        WorkspaceLabel(session: session, workspace: workspace).padding(.vertical, 10)
                                    }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("search-workspace-\(workspace.id)")
                                }
                            }
                        }.padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 24)
                    }
                }
                .scrollDismissesKeyboard(.interactively)
                .refreshable { await session.refresh() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            searchBar.onGeometryChange(for: CGFloat.self) { geometry in
                geometry.frame(in: .named(Self.layoutSpace)).maxY
            } action: { layoutChanged($0) }
        }
        .coordinateSpace(name: Self.layoutSpace)
        .task(id: focusRequested) { searching = focusRequested }
        .accessibilityAction(.escape, close)
    }
    private var searchBar: some View {
        HStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 18)).foregroundStyle(.secondary).accessibilityHidden(true)
                TextField("Search", text: $query)
                    .font(.body).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .submitLabel(.search).focused($searching).tint(.blue)
                    .onSubmit { searching = false }
                    .accessibilityIdentifier("globalSearchInput")
                if !query.isEmpty {
                    Button { query = ""; searching = true } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundStyle(.secondary)
                            .frame(width: 28, height: 44).contentShape(.rect)
                    }.buttonStyle(ChatPressStyle()).accessibilityLabel("Clear search").accessibilityIdentifier("clearGlobalSearch")
                }
            }.padding(.leading, 16).padding(.trailing, query.isEmpty ? 16 : 8)
                .frame(height: 52).modifier(GlassSurface(radius: 26))
            RoundControl(symbol: "xmark", label: "Close search", size: 52, action: close)
                .accessibilityIdentifier("closeGlobalSearch")
        }.padding(.horizontal, 16).padding(.vertical, 8)
    }
    private func sectionTitle(_ title: String) -> some View {
        Text(title).font(.subheadline.weight(.semibold)).padding(.top, 20).padding(.bottom, 8)
    }
    private func place(of run: Conversation) -> String {
        let workspace = session.workspaces.first { $0.id == run.workspaceId }?.name
        let collection = session.collections.first { $0.id == run.collectionId }?.name
        return [workspace ?? collection, Experience.label(run.mode)].compactMap { $0 }.joined(separator: " · ")
    }
    private func openResult(_ route: AppRoute) {
        searching = false; open(route)
    }
}

private func conversationAge(_ date: Date, now: Date) -> String {
    let seconds = now.timeIntervalSince(date)
    if seconds < 45 { return "just now" }
    if seconds < 3600 { return "\(max(1, Int((seconds / 60).rounded())))m ago" }
    if seconds < 86400 { return "\(Int((seconds / 3600).rounded()))h ago" }
    if seconds < 7 * 86400 { return "\(Int((seconds / 86400).rounded()))d ago" }
    return date.formatted(date: .numeric, time: .omitted)
}
