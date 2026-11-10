import SwiftUI

enum AppRoute: Hashable { case conversation(String), workspace(String), settings }

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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width * 0.82
            let offset = min(width, max(0, (drawerOpen ? width : 0) + drag))
            let progress = width > 0 ? offset / width : 0
            let pageOffset = searchMounted ? (searchExpanded ? 0 : width) : offset
            let pageCorner = searchMounted ? (searchExpanded ? 0.0 : 44.0) : 44 * progress
            ZStack(alignment: .leading) {
                Color(.systemBackground).ignoresSafeArea()
                if offset > 0 || searchMounted {
                    SidebarView(session: session, collapsed: $collapsedCollections, openConversation: { open(.conversation($0)) }, openWorkspace: { open(.workspace($0)) },
                                selectSpace: { session.selectSpace($0); goHome() }, search: showSearch, settings: showSettings)
                        .frame(width: width)
                        .offset(x: searchExpanded ? -width : 0)
                        .allowsHitTesting(!searchExpanded)
                        .accessibilityHidden(!drawerOpen || searchExpanded)
                }
                ZStack {
                    NavigationStack(path: $path) {
                        Group {
                            if let homeRunID {
                                ConversationView(session: session, runID: homeRunID, onNew: goHome)
                                    .toolbar {
                                        ToolbarItem(placement: .topBarLeading) { sidebarButton }
                                    }
                            } else {
                                HomeView(session: session, openSidebar: toggleDrawer, openComputer: showSettings, openPairing: openPairing,
                                         onCreated: { homeRunID = $0 })
                            }
                        }
                        .navigationDestination(for: AppRoute.self) { route in
                            switch route {
                            case .conversation(let id): ConversationView(session: session, runID: id, onNew: goHome)
                            case .workspace(let id): WorkspaceConversationsView(session: session, workspaceID: id,
                                openConversation: { path.append(.conversation($0)) }, startConversation: goHome)
                            case .settings: ComputerView(session: session)
                            }
                        }
                    }
                    .allowsHitTesting(!searchMounted)
                    .accessibilityHidden(drawerOpen || searchMounted)
                    if searchMounted {
                        SearchView(session: session, focusRequested: searchExpanded, layoutChanged: { height in
                            if searchMounted, searchExitHeight == nil, height > 0 { searchPageHeight = height }
                        }, open: openSearchResult, close: closeSearch)
                            // Keep the departing page above the keyboard's old edge.
                            // Its full-size background also covers the underlying composer.
                            .frame(height: searchExitHeight, alignment: .top)
                            .ignoresSafeArea(searchExitHeight == nil ? [] : .keyboard, edges: .bottom)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                            .background(Color(.systemBackground))
                            // The sidebar leaves a main-pane preview visible. Search
                            // exits the remaining distance before its view is removed.
                            .offset(x: searchExpanded ? 0 : geometry.size.width - width)
                            .allowsHitTesting(searchExpanded)
                            .transition(.identity)
                    }
                }
                .accessibilityHidden(drawerOpen && !searchMounted)
                .overlay { if progress > 0 && !searchMounted { Color.primary.opacity(0.08 * progress).allowsHitTesting(false) } }
                .overlay(alignment: .leading) {
                    if drawerOpen && !searchMounted {
                        Button(action: toggleDrawer) { Color.clear.contentShape(.rect) }
                            .frame(width: max(0, geometry.size.width - offset))
                            .buttonStyle(.plain).accessibilityLabel("Close sidebar").accessibilityIdentifier("closeSidebar")
                    }
                }
                .clipShape(MainPaneClip(cornerRadius: pageCorner, safeAreaInsets: geometry.safeAreaInsets))
                .offset(x: pageOffset)
                .simultaneousGesture(drawerGesture(width: width), isEnabled: drawerOpen && !searchMounted)
                if !drawerOpen && !searchMounted {
                    Color.clear.frame(width: 24).contentShape(.rect).gesture(drawerGesture(width: width))
                        .accessibilityHidden(true)
                }
            }
        }
        .attachmentOverlayHost()
        .onChange(of: session.pairing?.deviceId) { _, _ in
            resetSearch()
            path = []; homeRunID = nil; drawerOpen = false
        }
    }

    private var sidebarButton: some View {
        Button(action: toggleDrawer) { SidebarIcon() }
            .accessibilityLabel("Open sidebar").accessibilityIdentifier("openSidebar")
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
        // Mount in the existing, shifted main pane before moving either surface.
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
    private func goHome() { path = []; homeRunID = nil; closeDrawer() }
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
