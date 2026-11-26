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
    private enum DrawerCoordinateSpace: Hashable { case shell }

    let session: BackendSession
    let openPairing: () -> Void
    @State private var path: [AppRoute] = []
    @State private var showingArchivedMates = false
    @State private var newMateDraft = NewMateDraft()
    @State private var homeRunID: String?
    @State private var drawerOpen = false
    @State private var drag: CGFloat = 0
    @GestureState private var closingDragActive = false
    @State private var drawerViewport = DrawerViewport()
    @State private var drawerSnapshot: UIView?
    @State private var drawerTransition = 0
    @State private var searchMounted = false
    @State private var searchExpanded = false
    @State private var searchTransitionID = 0
    @State private var collapsedCollections: Set<String> = []
    @State private var wideSidebarHidden = false
    @State private var inlineSidebarVisible = false
    @State private var sidebarControlOffset: CGPoint?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        ZStack(alignment: .topLeading) {
            GeometryReader { geometry in
                let regular = horizontalSizeClass == .regular
                let supportsInline = SidebarPanePlan.supportsInline(width: geometry.size.width, regular: regular)
                let isHome = path.isEmpty && homeRunID == nil
                let canPin = supportsInline && isHome && session.pairing != nil
                let pinned = canPin && !wideSidebarHidden
                let sidebar = SidebarPanePlan.make(width: geometry.size.width, regular: regular, pinned: pinned,
                                                   open: drawerOpen, drag: drag)
                let width = sidebar.sidebarWidth
                let sidebarLayoutWidth = sidebar.isInline ? width : geometry.size.width
                let progress = sidebar.overlayProgress
                let shellOrigin = geometry.frame(in: .global).origin
                // Keep the toolbar offset local to the pane as the window folds or resizes.
                let updateSidebarControlLayout: (CGRect) -> Void = { frame in
                    sidebarControlOffset = CGPoint(x: max(0, frame.minX - shellOrigin.x - sidebar.contentOffset),
                                                   y: max(0, frame.minY - shellOrigin.y))
                }
                let headerTopInset = sidebarControlOffset?.y ?? AppNavigationStyle.topInset
                let leadingInset = (supportsInline ? nil : sidebarControlOffset?.x) ?? SidebarView.controlInset
                let sidebarVisible = (pinned || drawerOpen) && !searchMounted
                // Keep the live pane's input state stable while the pan is undecided.
                let mainPaneCovered = sidebar.blocksContent || searchMounted
                ZStack(alignment: .topLeading) {
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
                                                SidebarControl(action: { toggleDrawer(overlay: !supportsInline) }, isOpen: drawerOpen,
                                                               onLayout: updateSidebarControlLayout)
                                            }.sharedBackgroundVisibility(.hidden)
                                        }
                                } else {
                                    HomeView(session: session, sidebarControl: SidebarControl(action: {
                                        if canPin { toggleWideSidebar(visible: pinned || drawerOpen) }
                                        else { toggleDrawer(overlay: !supportsInline) }
                                    }, onLayout: updateSidebarControlLayout),
                                             openComputer: showSettings, openPairing: openPairing,
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
                                case .settings: ComputerView(session: session)
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
                    .clipShape(MainPaneClip(safeAreaInsets: geometry.safeAreaInsets))
                    .offset(x: sidebar.contentOffset)
                }
                .overlay {
                    DrawerPanePreview(viewport: drawerViewport, snapshot: drawerSnapshot, progress: progress)
                        .ignoresSafeArea()
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                .overlay(alignment: .topLeading) {
                    ZStack(alignment: .topLeading) {
                        // Drive every visible layer from the same progress, including the first frame.
                        sidebarBackdrop
                            .opacity(progress)
                            .ignoresSafeArea()
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)

                        if sidebar.blocksContent {
                            Color.clear.contentShape(.rect)
                                .onTapGesture(perform: closeDrawer)
                                .simultaneousGesture(drawerClosingGesture(width: width, edge: width))
                                .accessibilityHidden(true)
                                .zIndex(1)
                        }
                        SidebarView(session: session, collapsed: $collapsedCollections, isVisible: sidebarVisible,
                                    showsContent: isHome || sidebar.isInline || sidebar.blocksContent || progress > 0,
                                    menuWidth: width, layoutWidth: sidebarLayoutWidth, overlayProgress: sidebar.isInline ? nil : progress,
                                    headerTopInset: headerTopInset, leadingInset: leadingInset,
                                    openConversation: { open(.conversation($0)) }, openWorkspace: { open(.workspace($0)) },
                                    openProject: { open(.project($0)) },
                                    selectSpace: { session.selectSpace($0); goHome() }, search: showSearch, settings: showSettings, openWorkInbox: { open(.workInbox) }, openAtlas: { open(.atlas) }, openMates: { open(.mates) })
                            .background(sidebar.isInline ? Color(.systemBackground) : .clear)
                            .opacity(sidebar.isInline ? 1 : progress)
                            .simultaneousGesture(drawerClosingGesture(width: width, edge: width - 24),
                                                 isEnabled: sidebar.isInline && drawerOpen && !pinned && !searchMounted)
                            .zIndex(2)
                        if sidebar.blocksContent {
                            closeSidebarControl
                                .padding(.top, headerTopInset)
                                .padding(.trailing, SidebarView.controlInset)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                                .opacity(progress)
                                .transition(.opacity)
                                .zIndex(3)
                        }
                    }
                    .allowsHitTesting(sidebarVisible)
                    .ignoresSafeArea(.keyboard, edges: .bottom)
                    .accessibilityElement(children: .contain)
                    .accessibilityHidden(!sidebarVisible)
                    .accessibilityAction(.escape) {
                        if pinned { toggleWideSidebar(visible: true) } else { closeDrawer() }
                    }
                }
                .overlay(alignment: .leading) {
                    if !drawerOpen && !pinned && !searchMounted {
                        DrawerOpeningHandle { translation in
                            if !supportsInline && drag == 0 && translation > 0 { captureDrawerPreview() }
                            drag = translation
                        } finish: { projected in
                            settleDrawer(open: projected > width / 2)
                        }
                            .frame(width: 24)
                            .padding(.top, headerTopInset + AppNavigationStyle.inlineToolbarHeight)
                            .ignoresSafeArea(.keyboard, edges: .bottom)
                            .accessibilityHidden(true)
                    }
                }
                .onChange(of: pinned, initial: true) { _, value in
                    if value {
                        drawerOpen = false
                        drag = 0
                        drawerSnapshot = nil
                    }
                }
                .onChange(of: sidebar.isInline, initial: true) { _, value in inlineSidebarVisible = value }
                .onChange(of: geometry.size.width) { _, _ in drawerSnapshot = nil }
                .onChange(of: closingDragActive) { _, active in
                    guard !active, drag != 0 else { return }
                    DispatchQueue.main.async {
                        // An ended drag settles in onEnded. Reset only an interrupted close here.
                        guard !closingDragActive, drawerOpen, drag < 0 else { return }
                        settleDrawer(open: drawerOpen)
                    }
                }
            }
            // Search has its own keyboard. When the drawer dismisses the main keyboard,
            // let the main pane follow the system animation from its current bounds.
            .ignoresSafeArea(searchMounted ? .keyboard : [], edges: .bottom)
            if searchMounted {
                SearchView(session: session, isPresented: searchExpanded, finish: finishSearch)
                    .allowsHitTesting(searchExpanded)
                    .accessibilityHidden(!searchExpanded)
                    .transition(.identity)
                    .zIndex(2)
            }
        }
        .coordinateSpace(.named(DrawerCoordinateSpace.shell))
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
        .onDisappear {
            session.setWorkInboxVisible(false)
            drawerSnapshot = nil
        }
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
            drawerSnapshot = nil
            path = []; homeRunID = nil; drawerOpen = false
        }
        .onChange(of: path) { _, _ in drawerSnapshot = nil }
        .onChange(of: homeRunID) { _, _ in drawerSnapshot = nil }
        .onChange(of: reduceMotion) { _, _ in drawerSnapshot = nil }
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
        if reduceTransparency {
            Color(.systemBackground)
        } else {
            let dark = colorScheme == .dark
            let haze = dark ? Color.white : .black
            Rectangle().fill(.regularMaterial)
                .overlay {
                    ZStack {
                        Color.black.opacity(dark ? 0.90 : 0.09)
                        EllipticalGradient(colors: [haze.opacity(dark ? 0.09 : 0.08), .clear],
                                           center: UnitPoint(x: 0, y: 0.32), endRadiusFraction: 0.88)
                        EllipticalGradient(colors: [haze.opacity(dark ? 0.06 : 0.05), .clear],
                                           center: UnitPoint(x: 0.04, y: 0.76), endRadiusFraction: 0.7)
                    }
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
        reduceMotion ? nil : .easeInOut(duration: 0.34)
    }
    private func toggleWideSidebar(visible: Bool) {
        if !visible { drawerViewport.dismissKeyboard() }
        withAnimation(drawerAnimation) {
            wideSidebarHidden = visible; drawerOpen = false
        }
    }
    private func toggleDrawer(overlay: Bool) {
        if overlay && !drawerOpen { captureDrawerPreview() }
        settleDrawer(open: !drawerOpen)
    }
    private func closeDrawer() {
        settleDrawer(open: false)
    }
    private func captureDrawerPreview() {
        // A frame captured at keyboard height would jump back to that layout
        // on close. Keep the live pane visible under the backdrop while editing.
        guard !reduceMotion, drawerSnapshot == nil, !drawerViewport.hasFocusedTextInput else { return }
        drawerSnapshot = drawerViewport.capture()
    }
    private func settleDrawer(open: Bool) {
        if open && !drawerOpen { drawerViewport.dismissKeyboard() }
        drawerTransition += 1
        let transition = drawerTransition
        withAnimation(drawerAnimation, completionCriteria: .logicallyComplete) {
            drag = 0
            drawerOpen = open
        } completion: {
            DispatchQueue.main.async {
                guard transition == drawerTransition, !drawerOpen, drag == 0 else { return }
                drawerSnapshot = nil
            }
        }
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
                drawerSnapshot = nil
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
    private func drawerClosingGesture(width: CGFloat, edge: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .named(DrawerCoordinateSpace.shell))
            .updating($closingDragActive) { _, active, _ in active = true }
            .onChanged { value in
                guard value.startLocation.x >= edge,
                      drag < 0 || abs(value.translation.width) > abs(value.translation.height) else { return }
                drag = min(0, value.translation.width)
            }
            .onEnded { value in
                guard value.startLocation.x >= edge,
                      drag < 0 || abs(value.translation.width) > abs(value.translation.height) else { return }
                let projected = width + value.predictedEndTranslation.width
                settleDrawer(open: projected > width / 2)
            }
    }
}

private struct DrawerOpeningHandle: UIViewRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    var update: (CGFloat) -> Void
    var finish: (CGFloat) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UIView {
        // A dedicated hit area keeps the scroll view and its interactive keyboard
        // dismissal out of the swipe, even before the pan recognizer has begun.
        let view = UIView()
        let recognizer = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pan(_:)))
        recognizer.maximumNumberOfTouches = 1
        recognizer.delegate = context.coordinator
        view.addGestureRecognizer(recognizer)
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        context.coordinator.handle = self
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var handle: DrawerOpeningHandle
        init(_ handle: DrawerOpeningHandle) { self.handle = handle }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let recognizer = gestureRecognizer as? UIPanGestureRecognizer else { return false }
            let translation = recognizer.translation(in: recognizer.view?.window)
            return translation.x > abs(translation.y)
        }

        @objc func pan(_ recognizer: UIPanGestureRecognizer) {
            let window = recognizer.view?.window
            let translation = recognizer.translation(in: window).x
            switch recognizer.state {
            case .began, .changed:
                handle.update(max(0, translation))
            case .ended:
                handle.finish(translation + recognizer.velocity(in: window).x * 0.18)
            case .cancelled, .failed:
                handle.finish(0)
            default: break
            }
        }
    }
}

@MainActor
private final class DrawerViewport {
    weak var marker: UIView?

    var hasFocusedTextInput: Bool { marker?.window?.focusedTextInput != nil }

    func dismissKeyboard() { marker?.window?.endEditing(true) }

    func capture() -> UIView? {
        guard let marker, let window = marker.window else { return nil }
        let frame = marker.convert(marker.bounds, to: window).intersection(window.bounds)
        guard !frame.isEmpty else { return nil }
        return window.resizableSnapshotView(from: frame, afterScreenUpdates: false, withCapInsets: .zero)
    }

}

private struct DrawerPanePreview: View, Animatable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let viewport: DrawerViewport
    let snapshot: UIView?
    nonisolated var progress: CGFloat

    nonisolated var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    var body: some View {
        ZStack {
            DrawerViewportMarker(viewport: viewport)
            if let snapshot {
                ZStack {
                    Color(.systemBackground)
                    DrawerSnapshotView(snapshot: snapshot).scaleEffect(1 - 0.04 * progress)
                }
                // Blend back to the live pane near the resting position, where their sizes match.
                .opacity(min(1, max(0, progress * 6)))
                .transition(.identity)
            }
        }
    }
}

private struct DrawerViewportMarker: UIViewRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let viewport: DrawerViewport

    func makeUIView(context: Context) -> UIView {
        let marker = UIView()
        marker.isUserInteractionEnabled = false
        viewport.marker = marker
        return marker
    }

    func updateUIView(_ view: UIView, context: Context) {}
}

private struct DrawerSnapshotView: UIViewRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let snapshot: UIView

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        guard snapshot.superview !== view else { return }
        view.subviews.forEach { $0.removeFromSuperview() }
        snapshot.frame = view.bounds
        snapshot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(snapshot)
    }
}

private struct MainPaneClip: Shape {
    let safeAreaInsets: EdgeInsets

    func path(in rect: CGRect) -> Path {
        // Native navigation controls expand into the safe area when pressed.
        Path(rect.inset(by: UIEdgeInsets(top: -safeAreaInsets.top, left: -safeAreaInsets.leading,
                                        bottom: -safeAreaInsets.bottom, right: -safeAreaInsets.trailing)))
    }
}
