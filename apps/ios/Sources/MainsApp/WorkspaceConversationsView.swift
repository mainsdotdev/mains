import SwiftUI

struct TargetConversationsView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    enum Target {
        case workspace(String)
        case project(String)
    }
    let target: Target
    let openConversation: (String) -> Void
    var startConversation: () -> Void = {}
    var onWorkspaceChatCreated: ((String) -> Void)? = nil
    var isCurrentWorkspace: () -> Bool = { false }
    @State private var query = ""
    @State private var chatAction: ConversationActionRequest?
    @State private var composerFocused = false
    @State private var visible = false
    @State private var modelSheet = false
    @State private var optionsSheet = false
    @State private var consent: ConsentContext?
    @FocusState private var searching: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var workspace: Workspace? {
        guard case .workspace(let id) = target else { return nil }
        return session.workspaces.first { $0.id == id }
    }
    private var project: ProjectCollection? {
        guard case .project(let id) = target else { return nil }
        return session.collections.first { $0.id == id }
    }
    private var gitState: WorkspaceGitState? {
        guard let workspace else { return nil }
        return session.gitStates.first { $0.workspaceId == workspace.id }
    }
    private var isWorkspace: Bool {
        if case .workspace = target { return true }
        return false
    }
    private var title: LocalizedStringKey {
        if let name = workspace?.name ?? project?.name { return "\(name)" }
        return isWorkspace ? "Workspace" : "Project"
    }
    private var runs: [Conversation] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return session.conversations.filter {
            $0.assistantId == nil && belongsToTarget($0) && $0.providerId == session.selectedSpace?.providerId &&
            $0.mode == session.selectedSpace?.mode && (needle.isEmpty || $0.displayTitle.localizedCaseInsensitiveContains(needle))
        }
    }
    private func belongsToTarget(_ run: Conversation) -> Bool {
        switch target {
        case .workspace(let id): run.workspaceId == id
        case .project(let id): run.collectionId == id
        }
    }
    private var workspaceSpace: Space? {
        guard let workspace, workspace.isReplica != true,
              let space = session.selectedSpace, space.mode == "developer" else { return nil }
        return space
    }
    private var canStartProjectChat: Bool {
        project != nil && (session.selectedSpace?.mode == "work" || session.selectedSpace?.mode == "chat")
    }
    private var emptyMessage: LocalizedStringKey {
        if isWorkspace { return "No runs in this workspace yet." }
        return query.isEmpty ? "No chats in this project yet." : "No chats match."
    }
    var body: some View {
        Group {
            if isWorkspace {
                let space = workspaceSpace
                listScreen
                    .composerInset { editorExpanded in
                        if let workspace, let space {
                            let isCurrent = { visible && workspaceSpace?.id == space.id && isCurrentWorkspace() }
                            HomeComposerArea(session: session, space: space, targetPicker: .constant(false),
                                             modelSheet: $modelSheet, optionsSheet: $optionsSheet, consent: $consent,
                                             editorExpanded: editorExpanded, fixedWorkspace: workspace,
                                             focusChanged: { composerFocused = $0 }, isCurrent: isCurrent,
                                             onCreated: { id in
                                if isCurrent() { onWorkspaceChatCreated?(id) }
                            })
                            .id(space.id)
                            .onDisappear { composerFocused = false }
                        }
                    }
                    .composerPickers(model: $modelSheet, options: $optionsSheet, session: session,
                                     context: space.map { ComposerContext(space: $0, workspace: workspace) })
                    .task(id: "\(space?.providerId ?? ""):\(session.isConnected)") {
                        if let space { await session.loadModels(space.providerId) }
                    }
            } else {
                listScreen.safeAreaInset(edge: .bottom, spacing: 0) { projectBottomBar }
            }
        }
        #if MAINS_GPT_LIVE
        .toolbar {
            if let space = workspaceSpace, let workspace {
                ToolbarItem(placement: .topBarTrailing) {
                    VoiceStartButton(session: session, context: ComposerContext(space: space, workspace: workspace),
                                     workspaceRequired: {
                        session.homeDraft(for: space.id, workspaceID: workspace.id)
                            .showFailure("This workspace’s folder is unavailable on your computer.", title: "Workspace unavailable")
                    }, onCreated: { id in
                        if visible && isCurrentWorkspace() { onWorkspaceChatCreated?(id) }
                    })
                }
            }
        }
        #endif
        .onAppear { visible = true }
        .onDisappear { visible = false; composerFocused = false }
        .modifier(ConversationActionPrompts(session: session, request: $chatAction))
    }

    private var listScreen: some View {
        ZStack {
            if !composerFocused {
                conversationReader
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: -8)))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.easeInOut(duration: 0.2), value: composerFocused)
        .allowsHitTesting(!composerFocused)
        .accessibilityHidden(composerFocused)
        .overlay {
            if composerFocused { KeyboardDismissBackground() }
        }
        .background(Color(.systemBackground))
        .navigationHeaderFade()
        .scrollDismissesKeyboard(.interactively)
        .scrollingNavigationTitle(title, hidden: composerFocused)
        .toolbar(.visible, for: .navigationBar)
    }

    private var conversationReader: some View {
        let runs = self.runs
        return Group {
            if runs.isEmpty {
                EmptyStateLayout {
                    targetHeader.padding(.horizontal, 16).padding(.top, 8)
                } content: {
                    EmptyStateView(artwork: query.isEmpty ? (isWorkspace ? .spaces : .chats) : .search,
                                   description: Text(emptyMessage))
                }
            } else {
                conversationList(runs)
            }
        }
        .accessibilityIdentifier("targetConversationList")
        .pullToRefresh { await session.refresh() }
    }

    private var targetHeader: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                PageTitle(title).fixedSize(horizontal: false, vertical: true)
                if let branch = gitState?.branch {
                    Text(branch).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .padding(.bottom, 16)
            if workspace?.isReplica == true {
                BridgeReadOnlyNotice(text: "Read-only · this workspace runs on another computer")
                    .padding(.bottom, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func conversationList(_ runs: [Conversation]) -> some View {
        ScrollView {
            TimelineView(.periodic(from: .now, by: 60)) { clock in
                LazyVStack(alignment: .leading, spacing: 0) {
                    targetHeader
                    ForEach(runs) { run in
                        let active = run.isActive && run.isReplica != true
                        Button {
                            searching = false; openConversation(run.id)
                        } label: {
                            ConversationListRow(title: run.displayTitle,
                                                detail: active ? (run.status == "queued" ? "Queued" : "Running") : compactRelativeAge(run.updatedAt, now: clock.date),
                                                detailColor: active ? AppBrand.accent : Color(.tertiaryLabel))
                        }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("conversation-\(run.id)")
                            .contextMenu { ConversationMenuActions(session: session, run: run, request: $chatAction) }
                    }
                }.padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
            }
        }
    }
    private var projectBottomBar: some View {
        HStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 18)).foregroundStyle(.secondary)
                TextField("Search chats", text: $query)
                    .font(.body).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .submitLabel(.search).focused($searching).accessibilityIdentifier("projectSearch")
            }.padding(.horizontal, 16).frame(height: 52).modifier(GlassSurface(radius: 26))
            if searching || !query.isEmpty {
                RoundControl(symbol: "xmark", label: "Close search", size: 52) { query = ""; searching = false }
                    .accessibilityIdentifier("closeProjectSearch")
            } else {
                Button {
                    guard canStartProjectChat, let space = session.selectedSpace, let project else { return }
                    searching = false
                    var target = session.homeTargets[space.id] ?? HomeTarget()
                    target.collectionID = project.id
                    session.selectTarget(target, spaceID: space.id)
                    startConversation()
                } label: {
                    Image(systemName: "square.and.pencil").font(.system(size: 22))
                        .foregroundStyle(.white).frame(width: 52, height: 52).background(AppBrand.accent, in: .circle)
                }.buttonStyle(ChatPressStyle()).disabled(!canStartProjectChat)
                    .accessibilityLabel("New conversation").accessibilityIdentifier("newConversation")
            }
        }.padding(.horizontal, 16).padding(.vertical, 8)
    }
}

struct ConversationListRow: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let title: String
    let detail: String
    var detailColor = Color(.tertiaryLabel)

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(title).font(.body.weight(.medium)).foregroundStyle(.primary)
                .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            Text(detail).font(.caption).monospacedDigit().foregroundStyle(detailColor)
                .fixedSize(horizontal: true, vertical: false)
        }
        .padding(.horizontal, 4).padding(.vertical, 16).contentShape(.rect)
    }
}

struct SearchView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let isPresented: Bool
    let finish: (AppRoute?, Animation) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var query = ""
    @FocusState private var searching: Bool
    @State private var keyboardInset: CGFloat = 0
    @State private var keyboardAnimation: Animation?
    @State private var dismissal: Dismissal?
    @State private var followsKeyboardOnClose = false

    private struct Dismissal { let route: AppRoute? }
    private var addsSlide: Bool { !isPresented && !reduceMotion && !followsKeyboardOnClose }
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
    @State private var hits: [ConversationSearchHit] = []
    @State private var nextCursor: ConversationSearchCursor?
    @State private var loading = false
    @State private var searchError: String?
    @State private var resultQuery = ""
    @State private var requestID = UUID()
    private struct SearchIdentity: Hashable { let query: String; let owner: Int; let connected: Bool; let active: Bool }
    private var searchIdentity: SearchIdentity { SearchIdentity(query: needle, owner: session.ownership, connected: session.isConnected, active: isPresented) }
    private var visibleHits: [ConversationSearchHit] { resultQuery == needle ? hits : [] }
    private var visibleError: String? { resultQuery == needle ? searchError : nil }
    private var savedOnly: Bool { !session.isConnected || visibleError != nil }
    private var hasNoResults: Bool {
        !loading && resultQuery == needle && visibleHits.isEmpty && workspaces.isEmpty &&
            (!savedOnly || conversations.isEmpty) && visibleError == nil
    }

    var body: some View {
        GeometryReader { viewport in
            searchSurface
                .padding(.bottom, keyboardInset)
                .animation(keyboardAnimation, value: keyboardInset)
                .background {
                    Color(.systemBackground).ignoresSafeArea().opacity(isPresented ? 1 : 0)
                }
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
                    guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
                    moveKeyboard(to: overlap(with: frame, in: viewport.frame(in: .global)), notification: notification)
                }
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { notification in
                    moveKeyboard(to: 0, notification: notification)
                }
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .toolbar(.hidden, for: .navigationBar)
        .task(id: isPresented) { searching = isPresented }
        .task(id: dismissal != nil) {
            guard dismissal != nil else { return }
            // Focus can be interrupted without a keyboard hide notification.
            do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
            finishDismissal()
        }
        .task(id: searchIdentity) { await search(debounce: true) }
        .onDisappear { requestID = UUID() }
        .accessibilityAction(.escape) { dismiss() }
    }

    private var searchSurface: some View {
        ZStack {
            if needle.isEmpty {
                VStack(spacing: 16) {
                    EmptyStateIllustration(artwork: .search)
                    Text("Search chats, messages and workspaces").font(.subheadline).foregroundStyle(Color(.secondaryLabel))
                }
                .multilineTextAlignment(.center)
                .offset(y: addsSlide ? 28 : 0)
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if hasNoResults {
                EmptyStateLayout {
                    if savedOnly {
                        Text("Showing chats and messages saved on this iPhone.")
                            .font(.footnote).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16).padding(.top, 28)
                    }
                } content: {
                    EmptyStateView(artwork: .search, title: "No results found")
                }
                .scrollDismissesKeyboard(.interactively)
                .pullToRefresh { await session.refresh(); await search() }
            } else {
                ScrollView {
                    TimelineView(.periodic(from: .now, by: 60)) { clock in
                        LazyVStack(alignment: .leading, spacing: 0) {
                            if savedOnly {
                                Text(visibleError ?? "Showing chats and messages saved on this iPhone.")
                                    .font(.footnote).foregroundStyle(.secondary).padding(.vertical, 12)
                                if visibleError != nil { Button("Try again") { Task { await search() } }.disabled(!session.isConnected || loading) }
                                if !conversations.isEmpty { sectionTitle("Saved chats") }
                                ForEach(conversations.filter { run in !visibleHits.contains { $0.runId == run.id } }) { run in
                                    Button { dismiss(to: .conversation(run.id)) } label: {
                                        resultRow(title: run.displayTitle, context: place(of: run), snippet: nil, date: run.updatedAt, now: clock.date)
                                    }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("search-run-\(run.id)")
                                }
                            }
                            if loading && visibleHits.isEmpty || resultQuery != needle {
                                ContentSkeleton(label: "Searching conversations and messages…")
                            }
                            if !visibleHits.isEmpty { sectionTitle(savedOnly ? "Saved messages" : "Chats and messages") }
                            ForEach(visibleHits) { hit in
                                Button {
                                    if let cursor = hit.messageCursor { dismiss(to: .searchMessage(hit.runId, cursor)) }
                                    else { dismiss(to: .conversation(hit.runId)) }
                                } label: {
                                    resultRow(title: hit.title, context: [hit.context, Experience.label(hit.mode)].compactMap { $0 }.joined(separator: " · "),
                                              snippet: hit.snippet, date: Date(timeIntervalSince1970: hit.updatedAt / 1000), now: clock.date)
                                }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("search-run-\(hit.runId)")
                            }
                            if !savedOnly && nextCursor != nil && resultQuery == needle {
                                Button("More results") { Task { await loadMore() } }
                                    .font(.subheadline).frame(maxWidth: .infinity, minHeight: 44).disabled(loading)
                                    .accessibilityIdentifier("loadMoreSearchResults")
                            }
                            if !workspaces.isEmpty {
                                sectionTitle("Workspaces").padding(.top, 16)
                                ForEach(workspaces) { workspace in
                                    Button { dismiss(to: .workspace(workspace.id)) } label: { WorkspaceLabel(session: session, workspace: workspace).padding(.vertical, 10) }
                                        .buttonStyle(ChatPressStyle()).accessibilityIdentifier("search-workspace-\(workspace.id)")
                                }
                            }
                        }.padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 24)
                    }
                }
                .scrollDismissesKeyboard(.interactively)
                .pullToRefresh { await session.refresh(); await search() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .opacity(isPresented ? 1 : 0)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            searchBar
                .offset(y: addsSlide ? 68 : 0)
                .opacity(isPresented ? 1 : 0)
        }
    }

    private func dismiss(to route: AppRoute? = nil) {
        guard isPresented, dismissal == nil else { return }
        dismissal = Dismissal(route: route)
        searching = false
        if keyboardInset == 0 { finishDismissal() }
    }

    private func finishDismissal(keyboardDuration: TimeInterval? = nil) {
        guard let dismissal else { return }
        self.dismissal = nil
        followsKeyboardOnClose = keyboardDuration != nil
        let duration = reduceMotion ? 0.18 : keyboardDuration ?? 0.32
        finish(dismissal.route, .easeInOut(duration: duration > 0 ? duration : 0.32))
    }

    private func overlap(with screenFrame: CGRect, in viewport: CGRect) -> CGFloat {
        let window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive && $0.keyWindow != nil }?.keyWindow
        let frame = window.map { $0.convert(screenFrame, from: $0.screen.coordinateSpace) } ?? screenFrame
        // A floating keyboard doesn't reserve the bottom of the search surface.
        guard frame.maxY >= viewport.maxY, frame.width >= viewport.width * 0.9 else { return 0 }
        return max(0, viewport.maxY - frame.minY)
    }

    private func moveKeyboard(to inset: CGFloat, notification: Notification) {
        guard isPresented, searching || inset == 0 || keyboardInset > 0 else { return }
        let transition = KeyboardTransition(notification)
        // Use one animated inset so the field and the centered illustration move through the same layout.
        keyboardAnimation = transition.animation(duration: transition.duration)
        keyboardInset = inset
        if inset == 0, dismissal != nil { finishDismissal(keyboardDuration: transition.duration) }
    }
    private func resultRow(title: String, context: String, snippet: String?, date: Date, now: Date) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.body).foregroundStyle(.primary).lineLimit(1)
                Text(context).font(.footnote).foregroundStyle(Color(.secondaryLabel)).lineLimit(1)
                if let snippet, !snippet.isEmpty { Text(snippet).font(.footnote).foregroundStyle(.secondary).lineLimit(2) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Text(compactRelativeAge(date, now: now)).font(.caption).monospacedDigit().foregroundStyle(Color(.secondaryLabel)).fixedSize(horizontal: true, vertical: false)
        }.padding(.vertical, 10).contentShape(.rect)
    }
    private func search(debounce: Bool = false) async {
        guard isPresented else { return }
        let ticket = UUID(), query = needle, owner = session.ownership
        requestID = ticket; resultQuery = query; hits = []; nextCursor = nil; searchError = nil; loading = false
        guard !query.isEmpty else { return }
        loading = true
        defer { if requestID == ticket { loading = false } }
        do {
            if debounce { try await Task.sleep(for: .milliseconds(300)) }
            let page: ConversationSearchPage
            if session.isConnected { page = try await session.searchConversations(query) }
            else { page = ConversationSearchPage(items: await session.searchSavedConversations(query), nextCursor: nil) }
            try Task.checkCancellation()
            guard requestID == ticket, needle == query, owner == session.ownership else { return }
            hits = page.items; nextCursor = page.nextCursor
        } catch {
            if !Task.isCancelled, requestID == ticket, owner == session.ownership {
                let local = await session.searchSavedConversations(query)
                guard !Task.isCancelled, requestID == ticket, needle == query, owner == session.ownership else { return }
                hits = local
                searchError = "Couldn’t search the computer. Reconnect or update Mains on your computer, then try again."
            }
        }
    }
    private func loadMore() async {
        guard !loading, resultQuery == needle, let cursor = nextCursor else { return }
        let ticket = requestID, query = needle, owner = session.ownership
        loading = true
        defer { if requestID == ticket { loading = false } }
        do {
            let page = try await session.searchConversations(query, cursor: cursor)
            try Task.checkCancellation()
            guard requestID == ticket, needle == query, owner == session.ownership else { return }
            let existing = Set(hits.map(\.runId))
            hits.append(contentsOf: page.items.filter { !existing.contains($0.runId) }); nextCursor = page.nextCursor
        } catch { if !Task.isCancelled, requestID == ticket, owner == session.ownership { searchError = "More results couldn’t load. Try the search again." } }
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
            RoundControl(symbol: "xmark", label: "Close search", size: 52) { dismiss() }
                .accessibilityIdentifier("closeGlobalSearch")
        }.padding(.horizontal, 16).padding(.vertical, 8)
    }
    private func sectionTitle(_ title: String) -> some View {
        Text(title).font(.subheadline.weight(.semibold).width(.expanded)).padding(.top, 20).padding(.bottom, 8)
    }
    private func place(of run: Conversation) -> String {
        let workspace = session.workspaces.first { $0.id == run.workspaceId }?.name
        let collection = session.collections.first { $0.id == run.collectionId }?.name
        return [workspace ?? collection, Experience.label(run.mode)].compactMap { $0 }.joined(separator: " · ")
    }
}
