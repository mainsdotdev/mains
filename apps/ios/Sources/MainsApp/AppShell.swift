import SwiftUI

struct OpenVoiceConversationAction {
    var action: (String) -> Void = { _ in }
    func callAsFunction(_ id: String) { action(id) }
}
extension EnvironmentValues {
    // Read-only navigation also works for chats created by desktop voice calls.
    @Entry var openVoiceConversation = OpenVoiceConversationAction()
    @Entry var openMateConversation = OpenVoiceConversationAction()
    @Entry var mainPaneCovered = false
}


enum AppRoute: Hashable {
    case conversation(String, mate: MateConversationSource? = nil)
    case searchMessage(String, HistoryCursor), workspace(String), project(String), settings, workInbox, atlas, atlasPage(String)
    case mates, newMate([MateTeam]), creatingMate(NewMateCreationRequest), mate(String), mateInfo(String)
}

struct AppShell: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    private enum ActivityWatch { case hidden, events, polling }

    let session: BackendSession
    let openPairing: () -> Void
    @State private var path: [AppRoute] = []
    @State private var showingArchivedMates = false
    @State private var newMateDraft = NewMateDraft()
    @State private var homeRunID: String?
    @State private var drawerOpen = false
    @State private var drag: CGFloat = 0
    @GestureState private var drawerDragActive = false
    @State private var searchMounted = false
    @State private var searchExpanded = false
    @State private var searchTransitionID = 0
    @State private var collapsedCollections: Set<String> = []
    @State private var wideSidebarHidden = false
    @State private var inlineSidebarVisible = false
    #if MAINS_GPT_LIVE
    @State private var demoVoiceOrbStyle = VoiceOrbStyle.water
    #endif
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        ZStack(alignment: .topLeading) {
            GeometryReader { geometry in
                let regular = horizontalSizeClass == .regular
                let canPin = SidebarPanePlan.supportsInline(width: geometry.size.width, regular: regular) && path.isEmpty && homeRunID == nil && session.pairing != nil
                let pinned = canPin && !wideSidebarHidden
                let sidebar = SidebarPanePlan.make(width: geometry.size.width, regular: regular, pinned: pinned, open: drawerOpen, drag: drag)
                let width = sidebar.sidebarWidth
                let sidebarLayoutWidth = sidebar.isInline ? width : geometry.size.width
                let progress = sidebar.overlayProgress
                let overlayMounted = sidebar.blocksContent || progress > 0
                let sidebarVisible = (pinned || drawerOpen) && !searchMounted
                let mainPaneCovered = sidebar.blocksContent || searchMounted
                ZStack(alignment: .leading) {
                    Color(.systemBackground).ignoresSafeArea()
                    ZStack {
                        NavigationStack(path: $path) {
                            Group {
                                if let homeRunID {
                                    ConversationView(session: session, runID: homeRunID, openComputer: showSettings, onNew: goHome,
                                                     onFork: { path.append(.conversation($0)) }, onNavigate: { path.append($0) })
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
                                                     onFork: { path.append(.conversation($0)) }, mateSource: mate, onNavigate: { path.append($0) })
                                    .id("\(session.ownership):\(id)")
                                case .searchMessage(let id, let cursor): ConversationView(session: session, runID: id, openComputer: showSettings,
                                    onNew: { newConversation(from: id) }, onFork: { path.append(.conversation($0)) }, initialCursor: cursor,
                                    onNavigate: { path.append($0) })
                                    .id("\(session.ownership):\(id):\(cursor.timestamp):\(cursor.id)")
                                case .workspace(let id): TargetConversationsView(session: session, target: .workspace(id),
                                    openConversation: { path.append(.conversation($0)) }, startConversation: goHome)
                                case .project(let id): TargetConversationsView(session: session, target: .project(id),
                                    openConversation: { path.append(.conversation($0)) }, startConversation: goHome)
                                case .settings:
                                    #if MAINS_GPT_LIVE
                                    ComputerView(session: session, demoVoiceOrbStyle: $demoVoiceOrbStyle)
                                    #else
                                    ComputerView(session: session)
                                    #endif
                                case .workInbox: WorkInboxView(session: session, openConversation: { path.append(.conversation($0)) }, openSettings: showSettings)
                                case .atlas: AtlasView(session: session, openPage: { path.append(.atlasPage($0)) }, openConversation: { path.append(.conversation($0)) })
                                    .id(session.ownership)
                                case .atlasPage(let id): AtlasPageView(session: session, pageID: id, openPage: { path.append(.atlasPage($0)) }, openConversation: { path.append(.conversation($0)) })
                                    .id("\(session.ownership):atlas:\(id)")
                                case .mates: MatesView(session: session, showingArchive: $showingArchivedMates, openMate: { path.append(.mate($0)) },
                                                      navigateFromArchive: { if path.last == route { path.append($0) } }, newMate: { teams in
                                    newMateDraft = NewMateDraft()
                                    path.append(.newMate(teams))
                                })
                                    .id(session.ownership)
                                case .newMate(let teams):
                                    NewMateView(session: session, teams: teams, draft: $newMateDraft, create: { request in
                                        guard path.last == route else { return }
                                        path.append(.creatingMate(request))
                                    }, created: { id in finishMateCreation(id, from: route) })
                                    .id(session.ownership)
                                case .creatingMate(let request):
                                    CreatingMateView(session: session, request: request) { id in
                                        finishMateCreation(id, from: .creatingMate(request))
                                    }
                                    .id(session.ownership)
                                case .mate(let id):
                                    MateView(session: session, mateID: id, openChat: { runID in
                                        if path.last == route { path.append(.conversation(runID, mate: .profile(id))) }
                                    },
                                             openInfo: { path.append(.mateInfo(id)) })
                                        .id("\(session.ownership):mate:\(id)")
                                case .mateInfo(let id):
                                    MateInfoView(session: session, mateID: id, openChat: { runID, mateID in
                                        path.append(.conversation(runID, mate: mateID.map(MateConversationSource.profile) ?? .assignment))
                                    })
                                        .id("\(session.ownership):mate-info:\(id)")
                                }
                            }
                        }
                        .safeAreaPadding(.top, AppNavigationStyle.topInset)
                        .environment(\.mainPaneCovered, mainPaneCovered)
                        #if MAINS_GPT_LIVE
                        .environment(\.voiceSurfaceVisible, !mainPaneCovered)
                        #endif
                        .accessibilityHidden(mainPaneCovered)
                    }
                    .frame(width: sidebar.contentWidth)
                    .allowsHitTesting(!mainPaneCovered)
                    .accessibilityHidden(mainPaneCovered)
                    .clipShape(MainPaneClip(cornerRadius: 0, safeAreaInsets: geometry.safeAreaInsets))
                    .offset(x: sidebar.contentOffset)
                    ZStack(alignment: .leading) {
                        if overlayMounted {
                            sidebarBackdrop
                                .opacity(progress)
                                .ignoresSafeArea()
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                                .transition(.opacity)

                            Color.clear.contentShape(.rect)
                                .onTapGesture(perform: closeDrawer)
                                .simultaneousGesture(drawerGesture(width: width, closingEdge: width))
                                .accessibilityHidden(true)
                                .zIndex(1)
                        }
                        if sidebar.isInline || overlayMounted {
                            SidebarView(session: session, collapsed: $collapsedCollections, isVisible: sidebarVisible, menuWidth: width,
                                        openConversation: { open(.conversation($0)) }, openWorkspace: { open(.workspace($0)) },
                                        openProject: { open(.project($0)) },
                                        selectSpace: { session.selectSpace($0); goHome() }, search: showSearch, settings: showSettings, openWorkInbox: { open(.workInbox) }, openAtlas: { open(.atlas) }, openMates: { open(.mates) })
                                .frame(width: sidebarLayoutWidth)
                                .background(sidebar.isInline ? Color(.systemBackground) : .clear)
                                .opacity(sidebar.isInline ? 1 : progress)
                                .offset(x: sidebar.isInline || reduceMotion ? 0 : -sidebarLayoutWidth * (1 - progress))
                                .transition(sidebar.isInline || reduceMotion ? .opacity : .offset(x: -sidebarLayoutWidth))
                                .simultaneousGesture(drawerGesture(width: width, closingEdge: width - 24),
                                                     isEnabled: sidebar.isInline && drawerOpen && !pinned && !searchMounted)
                                .zIndex(2)
                        }
                        if sidebar.blocksContent {
                            closeSidebarControl
                                .padding(.trailing, SidebarView.controlInset)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                                .opacity(progress)
                                .transition(.opacity)
                                .zIndex(3)
                        }
                    }
                    .allowsHitTesting(sidebarVisible)
                    .accessibilityElement(children: .contain)
                    .accessibilityHidden(!sidebarVisible)
                    .accessibilityAction(.escape) {
                        if pinned { toggleWideSidebar(visible: true) } else { closeDrawer() }
                    }
                    .zIndex(1)
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
                .onChange(of: drawerDragActive) { _, active in
                    guard !active, drag != 0 else { return }
                    DispatchQueue.main.async {
                        // An ended drag settles in onEnded. Reset only an interrupted drag here.
                        guard !drawerDragActive, drag != 0 else { return }
                        withAnimation(drawerAnimation) { drag = 0 }
                    }
                }
            }
            // The inactive main pane and sidebar must not follow Search's keyboard.
            // Keep this on their geometry root so clipping and composer insets share
            // the same stable bounds, including after Search leaves the screen.
            .ignoresSafeArea(drawerOpen && !inlineSidebarVisible || searchMounted ? .keyboard : [], edges: .bottom)
            if searchMounted {
                SearchView(session: session, isPresented: searchExpanded, finish: finishSearch)
                    .allowsHitTesting(searchExpanded)
                    .accessibilityHidden(!searchExpanded)
                    .transition(.identity)
                    .zIndex(2)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                ForkDeliveryNotice(session: session, open: { open(.conversation($0)) })
                AtlasSaveDeliveryNotice(session: session)
                ConversationActionDeliveryNotice(session: session)
                GoalChangeDeliveryNotice(session: session)
#if MAINS_GPT_LIVE
                VoiceCallDock(session: session, visibleRunID: visibleVoiceRunID,
                    preparingHere: preparingVoiceHere,
                    open: { openVoiceConversation($0) })
#endif

            }
        }
        .environment(\.openVoiceConversation, OpenVoiceConversationAction { openVoiceConversation($0) })
        .environment(\.openMateConversation, OpenVoiceConversationAction { id in
            guard session.viewingRunID != id else { return }
            path.append(.conversation(id, mate: .assignment))
        })
        #if MAINS_GPT_LIVE
        .onChange(of: session.voice.error) { _, error in if let error { session.actionError = error } }
        #endif
        .attachmentOverlayHost()
        .contextPickerOverlayHost(isEnabled: mainPaneInteractive)
        .onChange(of: activityWatch, initial: true) { _, watch in
            session.setWorkInboxVisible(watch != .hidden, poll: watch == .polling)
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
            showingArchivedMates = false
            path = []; homeRunID = nil; drawerOpen = false
        }
    }

    private var closeSidebarControl: some View {
        let discSize = SidebarView.headerDiscSize
        let hitSize = AppNavigationStyle.inlineToolbarHeight
        return Button(action: closeDrawer) {
            Image(systemName: "xmark").font(.system(size: 18))
                .frame(width: discSize, height: discSize)
                .modifier(GlassSurface(radius: discSize / 2))
                .frame(width: hitSize, height: hitSize)
                .contentShape(.circle)
        }
        .buttonStyle(ChatPressStyle())
        .accessibilityLabel("Close sidebar")
        .accessibilityIdentifier("closeSidebar")
    }

    @ViewBuilder private var sidebarBackdrop: some View {
        let background = Color(.systemBackground)
        if reduceTransparency {
            background
        } else {
            let dark = colorScheme == .dark
            Rectangle().fill(.regularMaterial)
                .overlay {
                    LinearGradient(colors: [.black.opacity(dark ? 0.84 : 0.13), .black.opacity(dark ? 0.98 : 0.23)],
                                   startPoint: .leading, endPoint: .trailing)
                }
        }
    }

    private var mainPaneInteractive: Bool { !searchMounted && (!drawerOpen || inlineSidebarVisible) }

    private var activityWatch: ActivityWatch {
        if searchMounted || showingArchivedMates { return .hidden }
        if drawerOpen || inlineSidebarVisible || path.last == .workInbox { return .polling }
        return path.last == .mates ? .events : .hidden
    }

    private func finishMateCreation(_ id: String, from route: AppRoute) {
        guard path.last == route else { return }
        let steps = if case .creatingMate = route { 2 } else { 1 }
        let firstStep = path.count - steps
        guard firstStep >= 0, case .newMate = path[firstStep] else { return }
        path.replaceSubrange(firstStep..., with: [.mate(id)])
    }

#if MAINS_GPT_LIVE
    private var preparingVoiceHere: Bool {
        guard mainPaneInteractive else { return false }
        if let mate = session.voiceMate { return path.last == .mate(mate.id) }
        return path.isEmpty && homeRunID == nil && session.voiceSpaceID == session.selectedSpaceID
    }

    private var visibleVoiceRunID: String? {
        guard mainPaneInteractive else { return nil }
        switch path.last {
        case .conversation(let id, _), .searchMessage(let id, _): return id
        case .workspace, .project, .settings, .workInbox, .atlas, .atlasPage, .mates, .newMate, .creatingMate, .mate, .mateInfo: return nil
        case nil: return homeRunID
        }
    }
#endif

    private func openVoiceConversation(_ id: String) {
        let run = session.conversations.first(where: { $0.id == id })
        var spaceID = run?.spaceId
        var mateID = run?.assistantId
        #if MAINS_GPT_LIVE
        if session.voice.runID == id {
            spaceID = spaceID ?? session.voiceSpaceID
            mateID = mateID ?? session.voiceMate?.id
        }
        #endif
        if let mateID { open(.conversation(id, mate: .profile(mateID))); return }
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
    private var drawerAnimation: Animation? {
        reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.86)
    }
    private func toggleWideSidebar(visible: Bool) {
        withAnimation(drawerAnimation) {
            wideSidebarHidden = visible; drawerOpen = false
        }
    }
    private func toggleDrawer() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        withAnimation(drawerAnimation) { drawerOpen.toggle() }
    }
    private func closeDrawer() {
        withAnimation(drawerAnimation) { drawerOpen = false }
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
        // Mount the editor before asking it to take focus.
        searchMounted = true
        DispatchQueue.main.async {
            guard searchMounted, transitionID == searchTransitionID else { return }
            withAnimation(.easeInOut(duration: reduceMotion ? 0.18 : 0.32)) {
                searchExpanded = true
            }
        }
    }
    private func finishSearch(to route: AppRoute?, animation: Animation) {
        guard searchMounted, searchExpanded else { return }
        if let route {
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                drawerOpen = false
                open(route)
            }
        }
        searchTransitionID += 1
        let transitionID = searchTransitionID
        withAnimation(animation, completionCriteria: .logicallyComplete) {
            searchExpanded = false
        } completion: {
            guard !searchExpanded, transitionID == searchTransitionID else { return }
            searchMounted = false
        }
    }
    private func resetSearch() {
        searchTransitionID += 1
        searchExpanded = false; searchMounted = false
    }
    private func goHome() { leaveCurrentConversation(); path = []; homeRunID = nil; closeDrawerAfterNavigation() }
    private func leaveCurrentConversation() {
        if let runID = session.viewingRunID { session.leaveConversation(runID) }
    }
    private func drawerGesture(width: CGFloat, closingEdge: CGFloat? = nil) -> some Gesture {
        DragGesture(minimumDistance: 10)
            .updating($drawerDragActive) { _, active, _ in active = true }
            .onChanged { value in
                if let closingEdge, value.startLocation.x < closingEdge { return }
                if abs(value.translation.width) > abs(value.translation.height) { drag = value.translation.width }
            }
            .onEnded { value in
                if let closingEdge, value.startLocation.x < closingEdge { return }
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                let projected = (drawerOpen ? width : 0) + value.predictedEndTranslation.width
                withAnimation(drawerAnimation) {
                    drag = 0
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
        return RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .path(in: rect)
    }
}
