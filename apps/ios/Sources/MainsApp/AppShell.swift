import SwiftUI

struct OpenVoiceConversationAction {
    var action: (String) -> Void = { _ in }
    func callAsFunction(_ id: String) { action(id) }
}
extension EnvironmentValues {
    // Read-only navigation also works for chats created by desktop voice calls.
    @Entry var openVoiceConversation = OpenVoiceConversationAction()
    @Entry var openMateConversation = OpenVoiceConversationAction()
}


enum AppRoute: Hashable {
    case conversation(String, mate: MateConversationSource? = nil)
    case searchMessage(String, HistoryCursor), workspace(String), settings, workInbox, atlas, atlasPage(String)
    case mates, newMate([MateTeam]), newMateModel, creatingMate(NewMateCreationRequest), mate(String), mateInfo(String)
}

struct AppShell: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let openPairing: () -> Void
    @AppStorage("appearancePreference") private var appearance = AppAppearance.system
    @State private var path: [AppRoute] = []
    @State private var newMateDraft = NewMateDraft()
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
    @State private var inlineSidebarVisible = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        ZStack(alignment: .topLeading) {
            GeometryReader { geometry in
                let regular = horizontalSizeClass == .regular
                let canPin = SidebarPanePlan.supportsInline(width: geometry.size.width, regular: regular) && path.isEmpty && homeRunID == nil && session.pairing != nil
                let pinned = canPin && !wideSidebarHidden && !searchMounted
                let sidebar = SidebarPanePlan.make(width: geometry.size.width, regular: regular, pinned: pinned, open: drawerOpen, drag: drag)
                let width = sidebar.sidebarWidth
                let offset = sidebar.contentOffset
                let progress = sidebar.overlayProgress
                let pageOffset = searchMounted ? (searchExpanded ? 0 : width) : offset
                let pageCorner = searchMounted ? (searchExpanded ? 0.0 : 44.0) : 44 * progress
                let pageExpansion = searchMounted ? 0 : 12 * progress
                ZStack(alignment: .leading) {
                    Color(.systemBackground).ignoresSafeArea()
                    if offset > 0 || searchMounted {
                        SidebarView(session: session, collapsed: $collapsedCollections, openConversation: { open(.conversation($0)) }, openWorkspace: { open(.workspace($0)) },
                                    selectSpace: { session.selectSpace($0); goHome() }, search: showSearch, settings: showSettings, openWorkInbox: { open(.workInbox) }, openAtlas: { open(.atlas) }, openMates: { open(.mates) })
                            .frame(width: width)
                            .offset(x: searchExpanded ? -width : 0)
                            .allowsHitTesting(!searchExpanded)
                            .accessibilityHidden(!pinned && !drawerOpen || searchExpanded)
                            .simultaneousGesture(drawerGesture(width: width, closingEdge: width - 24),
                                                 isEnabled: sidebar.isInline && drawerOpen && !pinned && !searchMounted)
                            .accessibilityAction(.escape) {
                                if pinned { toggleWideSidebar(visible: true) } else { closeDrawer() }
                            }
                    }
                    ZStack {
                        NavigationStack(path: $path) {
                            Group {
                                if let homeRunID {
                                    ConversationView(session: session, runID: homeRunID, openComputer: showSettings, onNew: goHome, onFork: { path.append(.conversation($0)) })
                                        .id("\(session.ownership):\(homeRunID)")
                                        .toolbar {
                                            ToolbarItem(placement: .topBarLeading) {
                                                SidebarControl(action: toggleDrawer, isOpen: drawerOpen)
                                            }
                                        }
                                } else {
                                    HomeView(session: session, openSidebar: {
                                        if canPin { toggleWideSidebar(visible: pinned || drawerOpen) }
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
                                case .conversation(let id, let mate):
                                    ConversationView(session: session, runID: id, openComputer: showSettings, onNew: { newConversation(from: id) },
                                                     onFork: { path.append(.conversation($0)) }, mateSource: mate)
                                    .id("\(session.ownership):\(id)")
                                case .searchMessage(let id, let cursor): ConversationView(session: session, runID: id, openComputer: showSettings, onNew: { newConversation(from: id) }, onFork: { path.append(.conversation($0)) }, initialCursor: cursor)
                                    .id("\(session.ownership):\(id):\(cursor.timestamp):\(cursor.id)")
                                case .workspace(let id): WorkspaceConversationsView(session: session, workspaceID: id,
                                    openConversation: { path.append(.conversation($0)) }, startConversation: goHome)
                                case .settings: ComputerView(session: session)
                                case .workInbox: WorkInboxView(session: session, openConversation: { path.append(.conversation($0)) }, openSettings: showSettings)
                                case .atlas: AtlasView(session: session, openPage: { path.append(.atlasPage($0)) }, openConversation: { path.append(.conversation($0)) })
                                    .id(session.ownership)
                                case .atlasPage(let id): AtlasPageView(session: session, pageID: id, openPage: { path.append(.atlasPage($0)) }, openConversation: { path.append(.conversation($0)) })
                                    .id("\(session.ownership):atlas:\(id)")
                                case .mates: MatesView(session: session, openMate: { path.append(.mate($0)) }, newMate: { teams in
                                    newMateDraft = NewMateDraft()
                                    path.append(.newMate(teams))
                                })
                                    .id(session.ownership)
                                case .newMate(let teams):
                                    NewMateView(teams: teams, draft: $newMateDraft) { path.append(.newMateModel) }
                                        .id(session.ownership)
                                case .newMateModel:
                                    NewMateModelView(session: session, draft: $newMateDraft, create: { request in
                                        guard path.last == .newMateModel else { return }
                                        path.append(.creatingMate(request))
                                    }, created: { id in finishMateCreation(id, from: .newMateModel) })
                                    .id(session.ownership)
                                case .creatingMate(let request):
                                    CreatingMateView(session: session, request: request) { id in
                                        finishMateCreation(id, from: .creatingMate(request))
                                    }
                                    .id(session.ownership)
                                case .mate(let id):
                                    MateView(session: session, mateID: id, openChat: { path.append(.conversation($0, mate: .profile(id))) },
                                             openInfo: { path.append(.mateInfo(id)) })
                                        .id("\(session.ownership):mate:\(id)")
                                case .mateInfo(let id):
                                    MateInfoView(session: session, mateID: id)
                                        .id("\(session.ownership):mate-info:\(id)")
                                }
                            }
                        }
                        .safeAreaPadding(.top, AppNavigationStyle.topInset)
                        #if MAINS_GPT_LIVE
                        .environment(\.voiceSurfaceVisible, !sidebar.blocksContent && !searchMounted)
                        #endif
                        .allowsHitTesting(!searchMounted)
                        .accessibilityHidden(sidebar.blocksContent || searchMounted)
                    }
                    .frame(width: sidebar.contentWidth)
                    .accessibilityHidden(sidebar.blocksContent && !searchMounted)
                    .overlay {
                        // Follow the sliding state so mounting/retiring Search cannot
                        // abruptly remove or restore the drawer's dimming layer.
                        Color.primary.opacity(searchExpanded ? 0 : 0.08 * progress)
                            .ignoresSafeArea(edges: .vertical)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                    .overlay(alignment: .leading) {
                        if sidebar.blocksContent && !searchMounted {
                            Button(action: toggleDrawer) { Color.clear.contentShape(.rect) }
                                .frame(width: max(0, geometry.size.width - offset))
                                .buttonStyle(.plain).accessibilityLabel("Close sidebar").accessibilityIdentifier("closeSidebar")
                        }
                    }
                    .clipShape(MainPaneClip(cornerRadius: pageCorner, safeAreaInsets: geometry.safeAreaInsets, verticalExpansion: pageExpansion))
                    .offset(x: pageOffset)
                    .simultaneousGesture(drawerGesture(width: width), isEnabled: sidebar.blocksContent && !searchMounted)
                    if !drawerOpen && !pinned && !searchMounted {
                        Color.clear.frame(width: 24).contentShape(.rect).gesture(drawerGesture(width: width))
                            .accessibilityHidden(true)
                    }
                }.onChange(of: pinned, initial: true) { _, value in
                    if value { drawerOpen = false }
                }
                .onChange(of: sidebar.isInline, initial: true) { _, value in inlineSidebarVisible = value }
                .onChange(of: sidebar.blocksContent) { _, covered in
                    if covered { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
                }
            }
            // The inactive main pane and sidebar must not follow Search's keyboard.
            // Keep this on their geometry root so clipping and composer insets share
            // the same stable bounds, including after Search leaves the screen.
            .ignoresSafeArea(drawerOpen && !inlineSidebarVisible || searchMounted ? .keyboard : [], edges: .bottom)
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
                ConversationActionDeliveryNotice(session: session)
#if MAINS_GPT_LIVE
                VoiceCallDock(session: session, visibleRunID: visibleVoiceRunID,
                    preparingHere: mainPaneInteractive && path.isEmpty && homeRunID == nil && session.voiceSpaceID == session.selectedSpaceID,
                    open: { openVoiceConversation($0) })
#endif

            }
        }
        .environment(\.openVoiceConversation, OpenVoiceConversationAction { openVoiceConversation($0) })
        .environment(\.openMateConversation, OpenVoiceConversationAction { id in
            guard session.viewingRunID != id else { return }
            path.append(.conversation(id, mate: .assignment))
        })
        .preferredColorScheme(appearance.colorScheme)
        #if MAINS_GPT_LIVE
        .onChange(of: session.voice.error) { _, error in if let error { session.actionError = error } }
        #endif
        .attachmentOverlayHost()
        .contextPickerOverlayHost(isEnabled: mainPaneInteractive)
        .onChange(of: !searchMounted && (drawerOpen || inlineSidebarVisible || path.last == .workInbox), initial: true) { _, visible in
            session.setWorkInboxVisible(visible)
        }
        .onDisappear { session.setWorkInboxVisible(false) }
        .onChange(of: session.retiredConversation) { _, retired in
            guard let retired else { return }
            if homeRunID == retired.runID { homeRunID = nil }
            path.removeAll { route in
                switch route {
                case .conversation(let id, _), .searchMessage(let id, _): id == retired.runID
                default: false
                }
            }
        }
        .onChange(of: session.pairing?.deviceId) { _, _ in
            resetSearch()
            path = []; homeRunID = nil; drawerOpen = false
        }
    }

    private var mainPaneInteractive: Bool { !searchMounted && (!drawerOpen || inlineSidebarVisible) }

    private func finishMateCreation(_ id: String, from route: AppRoute) {
        guard path.last == route else { return }
        let firstStep = path.count - (route == .newMateModel ? 2 : 3)
        guard firstStep >= 0, case .newMate = path[firstStep] else { return }
        path.replaceSubrange(firstStep..., with: [.mate(id)])
    }

#if MAINS_GPT_LIVE
    private var visibleVoiceRunID: String? {
        guard mainPaneInteractive else { return nil }
        switch path.last {
        case .conversation(let id, _), .searchMessage(let id, _): return id
        case .workspace, .settings, .workInbox, .atlas, .atlasPage, .mates, .newMate, .newMateModel, .creatingMate, .mate, .mateInfo: return nil
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
    private func newConversation(from runID: String) {
        if let mateID = session.conversations.first(where: { $0.id == runID })?.assistantId {
            if path.dropLast().last == .mate(mateID) { path.removeLast() }
            else { open(.mate(mateID)) }
        } else { goHome() }
    }
    private func showSettings() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        path.append(.settings)
        closeDrawerAfterNavigation()
    }
    private func toggleWideSidebar(visible: Bool) {
        withAnimation(reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.86)) {
            wideSidebarHidden = visible; drawerOpen = false
        }
    }
    private func toggleDrawer() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        withAnimation(reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.86)) { drawerOpen.toggle() }
    }
    private func closeDrawer() {
        withAnimation(reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.86)) { drawerOpen = false }
    }
    private func closeDrawerAfterNavigation() { if !inlineSidebarVisible { closeDrawer() } }
    private func open(_ route: AppRoute) {
        if case .conversation(let id, _) = route {
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
        path = [route]; closeDrawerAfterNavigation()
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
    private func goHome() { leaveCurrentConversation(); path = []; homeRunID = nil; closeDrawerAfterNavigation() }
    private func leaveCurrentConversation() {
        if let runID = session.viewingRunID { session.leaveConversation(runID) }
    }
    private func drawerGesture(width: CGFloat, closingEdge: CGFloat? = nil) -> some Gesture {
        DragGesture(minimumDistance: 10)
            .updating($drag) { value, state, _ in
                if let closingEdge, value.startLocation.x < closingEdge { return }
                if abs(value.translation.width) > abs(value.translation.height) { state = value.translation.width }
            }
            .onEnded { value in
                if let closingEdge, value.startLocation.x < closingEdge { return }
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
    var verticalExpansion: CGFloat = 0
    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(cornerRadius, verticalExpansion) }
        set { cornerRadius = newValue.first; verticalExpansion = newValue.second }
    }

    func path(in rect: CGRect) -> Path {
        guard cornerRadius > 0 else {
            // Native navigation controls expand into the safe area when pressed.
            // Keep that feedback visible without changing the page's layout.
            return Path(rect.inset(by: UIEdgeInsets(top: -safeAreaInsets.top, left: -safeAreaInsets.leading,
                                                  bottom: -safeAreaInsets.bottom, right: -safeAreaInsets.trailing)))
        }
        return RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .path(in: rect.insetBy(dx: 0, dy: -verticalExpansion))
    }
}
