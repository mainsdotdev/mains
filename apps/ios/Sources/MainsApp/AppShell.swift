import SwiftUI

struct OpenVoiceConversationAction {
    var action: (String) -> Void = { _ in }
    func callAsFunction(_ id: String) { action(id) }
}
extension EnvironmentValues {
    // Read-only navigation also works for chats created by desktop voice calls.
    @Entry var openVoiceConversation = OpenVoiceConversationAction()
}


enum AppRoute: Hashable { case conversation(String), searchMessage(String, HistoryCursor), workspace(String), settings, workInbox, atlas, atlasPage(String) }

struct AppShell: View {
    let session: BackendSession
    let openPairing: () -> Void
    @State private var path: [AppRoute] = []
    @State private var homeRunID: String?
    @State private var drawerOpen = false
    @GestureState private var drag: CGFloat = 0
    @State private var searchMounted = false
    @State private var searchExpanded = false
    @State private var searchTransitionID = 0
    @State private var searchPageHeight: CGFloat = 0
    @State private var searchExitHeight: CGFloat?
    @State private var collapsedCollections: Set<String> = []
    @State private var wideSidebarHidden = false
    @State private var pinnedSidebarVisible = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        ZStack(alignment: .topLeading) {
            GeometryReader { geometry in
                let width = min(horizontalSizeClass == .regular ? 320 : 360, geometry.size.width * 0.82)
                let canPin = horizontalSizeClass == .regular && geometry.size.width >= 760 && path.isEmpty && homeRunID == nil && session.pairing != nil
                let pinned = canPin && !wideSidebarHidden && !searchMounted
                let offset = pinned ? width : min(width, max(0, (drawerOpen ? width : 0) + drag))
                let progress = width > 0 && !pinned ? offset / width : 0
                let pageOffset = searchMounted ? (searchExpanded ? 0 : width) : offset
                let pageCorner = searchMounted ? (searchExpanded ? 0.0 : 44.0) : 44 * progress
                ZStack(alignment: .leading) {
                    Color(.systemBackground).ignoresSafeArea()
                    if offset > 0 || searchMounted {
                        SidebarView(session: session, collapsed: $collapsedCollections, openConversation: { open(.conversation($0)) }, openWorkspace: { open(.workspace($0)) },
                                    selectSpace: { session.selectSpace($0); goHome() }, search: showSearch, settings: showSettings, openWorkInbox: { open(.workInbox) }, openAtlas: { open(.atlas) })
                            .frame(width: width)
                            .offset(x: searchExpanded ? -width : 0)
                            .allowsHitTesting(!searchExpanded)
                            .accessibilityHidden(!pinned && !drawerOpen || searchExpanded)
                    }
                    ZStack {
                        NavigationStack(path: $path) {
                            Group {
                                if let homeRunID {
                                    ConversationView(session: session, runID: homeRunID, openComputer: showSettings, onNew: goHome, onFork: { path.append(.conversation($0)) })
                                        .id("\(session.ownership):\(homeRunID)")
                                        .toolbar {
                                            ToolbarItem(placement: .topBarLeading) { sidebarButton }
                                        }
                                } else {
                                    HomeView(session: session, openSidebar: {
                                        if canPin { wideSidebarHidden.toggle(); drawerOpen = false }
                                        else { toggleDrawer() }
                                    }, openComputer: showSettings, openPairing: openPairing,
                                             onCreated: { id in
                                                 var transaction = Transaction(animation: nil)
                                                 transaction.disablesAnimations = true
                                                 withTransaction(transaction) { homeRunID = id }
                                             })
                                }
                            }
                            .navigationDestination(for: AppRoute.self) { route in
                                switch route {
                                case .conversation(let id): ConversationView(session: session, runID: id, openComputer: showSettings, onNew: goHome, onFork: { path.append(.conversation($0)) })
                                    .id("\(session.ownership):\(id)")
                                case .searchMessage(let id, let cursor): ConversationView(session: session, runID: id, openComputer: showSettings, onNew: goHome, onFork: { path.append(.conversation($0)) }, initialCursor: cursor)
                                    .id("\(session.ownership):\(id):\(cursor.timestamp):\(cursor.id)")
                                case .workspace(let id): WorkspaceConversationsView(session: session, workspaceID: id,
                                    openConversation: { path.append(.conversation($0)) }, startConversation: goHome)
                                case .settings: ComputerView(session: session)
                                case .workInbox: WorkInboxView(session: session, openConversation: { path.append(.conversation($0)) }, openSettings: showSettings)
                                case .atlas: AtlasView(session: session, openPage: { path.append(.atlasPage($0)) }, openConversation: { path.append(.conversation($0)) })
                                    .id(session.ownership)
                                case .atlasPage(let id): AtlasPageView(session: session, pageID: id, openPage: { path.append(.atlasPage($0)) }, openConversation: { path.append(.conversation($0)) })
                                    .id("\(session.ownership):atlas:\(id)")
                                }
                            }
                        }
                        #if MAINS_GPT_LIVE
                        .environment(\.voiceSurfaceVisible, !drawerOpen && !searchMounted)
                        #endif
                        .allowsHitTesting(!searchMounted)
                        .accessibilityHidden(drawerOpen && !pinned || searchMounted)
                    }
                    .frame(width: max(1, geometry.size.width - (pinned ? width : 0)))
                    .accessibilityHidden(drawerOpen && !pinned && !searchMounted)
                    .overlay { if progress > 0 && !searchMounted { Color.primary.opacity(0.08 * progress).allowsHitTesting(false) } }
                    .overlay(alignment: .leading) {
                        if drawerOpen && !pinned && !searchMounted {
                            Button(action: toggleDrawer) { Color.clear.contentShape(.rect) }
                                .frame(width: max(0, geometry.size.width - offset))
                                .buttonStyle(.plain).accessibilityLabel("Close sidebar").accessibilityIdentifier("closeSidebar")
                        }
                    }
                    .clipShape(MainPaneClip(cornerRadius: pageCorner, safeAreaInsets: geometry.safeAreaInsets))
                    .offset(x: pageOffset)
                    .simultaneousGesture(drawerGesture(width: width), isEnabled: drawerOpen && !pinned && !searchMounted)
                    if !drawerOpen && !pinned && !searchMounted {
                        Color.clear.frame(width: 24).contentShape(.rect).gesture(drawerGesture(width: width))
                            .accessibilityHidden(true)
                    }
                }.onChange(of: pinned, initial: true) { _, value in
                    pinnedSidebarVisible = value
                    if value { drawerOpen = false }
                }
            }
            // The inactive main pane and sidebar must not follow Search's keyboard.
            // Keep this on their geometry root so clipping and composer insets share
            // the same stable bounds, including after Search leaves the screen.
            .ignoresSafeArea(drawerOpen || searchMounted ? .keyboard : [], edges: .bottom)
            if searchMounted {
                GeometryReader { geometry in
                    SearchView(session: session, focusRequested: searchExpanded, layoutChanged: { height in
                        if searchMounted, searchExitHeight == nil, height > 0 { searchPageHeight = height }
                    }, open: openSearchResult, close: closeSearch)
                        // Freeze only the departing Search layout at its keyboard edge.
                        .frame(height: searchExitHeight, alignment: .top)
                        .ignoresSafeArea(searchExitHeight == nil ? [] : .keyboard, edges: .bottom)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .background(Color(.systemBackground))
                        .clipShape(MainPaneClip(cornerRadius: searchExpanded ? 0 : 44, safeAreaInsets: geometry.safeAreaInsets))
                        // This independent layer travels the same full-screen distance
                        // as the old shared pane, without resizing the page underneath.
                        .offset(x: searchExpanded ? 0 : geometry.size.width)
                        .allowsHitTesting(searchExpanded)
                }
                .transition(.identity)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                ForkDeliveryNotice(session: session, open: { open(.conversation($0)) })
                AtlasSaveDeliveryNotice(session: session)
#if MAINS_GPT_LIVE
                VoiceCallDock(session: session, visibleRunID: visibleVoiceRunID,
                    preparingHere: !drawerOpen && !searchMounted && path.isEmpty && homeRunID == nil && session.voiceSpaceID == session.selectedSpaceID,
                    open: { openVoiceConversation($0) })
#endif

            }
        }
        .environment(\.openVoiceConversation, OpenVoiceConversationAction { openVoiceConversation($0) })
        #if MAINS_GPT_LIVE
        .onChange(of: session.voice.error) { _, error in if let error { session.actionError = error } }
        #endif
        .attachmentOverlayHost()
        .contextPickerOverlayHost(isEnabled: !drawerOpen && !searchMounted)
        .onChange(of: !searchMounted && (drawerOpen || pinnedSidebarVisible || path.last == .workInbox), initial: true) { _, visible in
            session.setWorkInboxVisible(visible)
        }
        .onDisappear { session.setWorkInboxVisible(false) }
        .onChange(of: session.pairing?.deviceId) { _, _ in
            resetSearch()
            path = []; homeRunID = nil; drawerOpen = false
        }
    }

    private var sidebarButton: some View {
        Button(action: toggleDrawer) { SidebarIcon() }
            .accessibilityLabel("Open sidebar").accessibilityIdentifier("openSidebar")
    }
#if MAINS_GPT_LIVE
    private var visibleVoiceRunID: String? {
        guard !drawerOpen, !searchMounted else { return nil }
        switch path.last {
        case .conversation(let id), .searchMessage(let id, _): return id
        case .workspace, .settings, .workInbox, .atlas, .atlasPage: return nil
        case nil: return homeRunID
        }
    }
#endif

    private func openVoiceConversation(_ id: String) {
        var spaceID = session.conversations.first(where: { $0.id == id })?.spaceId
        #if MAINS_GPT_LIVE
        spaceID = spaceID ?? (session.voice.runID == id ? session.voiceSpaceID : nil)
        #endif
        if let spaceID { session.selectSpace(spaceID) }
        open(.conversation(id))
    }
    private func showSettings() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        path.append(.settings)
        closeDrawer()
    }
    private func toggleDrawer() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        withAnimation(reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.86)) { drawerOpen.toggle() }
    }
    private func closeDrawer() {
        withAnimation(reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.86)) { drawerOpen = false }
    }
    private func open(_ route: AppRoute) {
        if case .conversation(let id) = route {
            if session.viewingRunID != id { leaveCurrentConversation() }
        } else { leaveCurrentConversation() }
        if case .workspace(let id) = route {
            if session.selectedSpace?.mode != "developer", let code = session.spaces.first(where: { $0.mode == "developer" }) { session.selectSpace(code.id) }
            if let space = session.selectedSpace, space.mode == "developer",
               session.workspaces.contains(where: { $0.id == id && $0.isReplica != true }) {
                var target = session.homeTargets[space.id] ?? HomeTarget()
                target.workspaceID = id; session.selectTarget(target, spaceID: space.id)
            }
        }
        path = [route]; closeDrawer()
    }
    private func showSearch() {
        guard !searchExpanded else { return }
        searchTransitionID += 1
        let transitionID = searchTransitionID
        searchExitHeight = nil
        // Mount Search above the retained main pane before sliding either surface.
        searchMounted = true
        DispatchQueue.main.async {
            guard searchMounted, transitionID == searchTransitionID else { return }
            withAnimation(searchAnimation) {
                searchExpanded = true
            }
        }
    }
    private var searchAnimation: Animation? {
        reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 1)
    }
    private func closeSearch() {
        guard searchMounted, searchExpanded else { return }
        searchTransitionID += 1
        let transitionID = searchTransitionID
        searchExitHeight = searchPageHeight > 0 ? searchPageHeight : nil
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        withAnimation(searchAnimation, completionCriteria: .logicallyComplete) {
            searchExpanded = false
        } completion: {
            guard !searchExpanded, transitionID == searchTransitionID else { return }
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                searchMounted = false
                searchExitHeight = nil
                searchPageHeight = 0
            }
        }
    }
    private func resetSearch() {
        searchTransitionID += 1
        searchExpanded = false; searchMounted = false
        searchExitHeight = nil; searchPageHeight = 0
    }
    private func openSearchResult(_ route: AppRoute) {
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            resetSearch()
            drawerOpen = false
            open(route)
        }
    }
    private func goHome() { leaveCurrentConversation(); path = []; homeRunID = nil; closeDrawer() }
    private func leaveCurrentConversation() {
        if let runID = session.viewingRunID { session.leaveConversation(runID) }
    }
    private func drawerGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 10)
            .updating($drag) { value, state, _ in
                if abs(value.translation.width) > abs(value.translation.height) { state = value.translation.width }
            }
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                let projected = (drawerOpen ? width : 0) + value.predictedEndTranslation.width
                withAnimation(reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.86)) {
                    drawerOpen = projected > width / 2
                }
            }
    }
}

private struct MainPaneClip: Shape {
    var cornerRadius: CGFloat
    let safeAreaInsets: EdgeInsets
    var animatableData: CGFloat {
        get { cornerRadius }
        set { cornerRadius = newValue }
    }

    func path(in rect: CGRect) -> Path {
        guard cornerRadius > 0 else {
            // Native navigation controls expand into the safe area when pressed.
            // Keep that feedback visible without changing the page's layout.
            return Path(rect.inset(by: UIEdgeInsets(top: -safeAreaInsets.top, left: -safeAreaInsets.leading,
                                                  bottom: -safeAreaInsets.bottom, right: -safeAreaInsets.trailing)))
        }
        return RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).path(in: rect)
    }
}
