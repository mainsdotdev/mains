import SwiftUI

struct SidebarView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    @Binding var collapsed: Set<String>
    let isVisible: Bool
    let menuWidth: CGFloat
    let openConversation: (String) -> Void
    let openWorkspace: (String) -> Void
    let openProject: (String) -> Void
    let selectSpace: (String) -> Void
    let search: () -> Void
    let settings: () -> Void
    let openWorkInbox: () -> Void
    let openAtlas: () -> Void
    let openMates: () -> Void
    @State private var pendingMode: String?
    @State private var providersExpanded = false
    @Namespace private var modeSelection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .subheadline) private var modeLabelWidth: CGFloat = 36
    @ScaledMetric(relativeTo: .body) private var searchLabelWidth: CGFloat = 110
    @ScaledMetric(relativeTo: .title3) private var shortcutIconSize: CGFloat = 24
    static let controlInset: CGFloat = 16
    static let headerDiscSize: CGFloat = 40
    private let menuInset: CGFloat = 28
    private let menuIconWidth: CGFloat = 22
    private let menuIconSize: CGFloat = 20
    private let menuIconSpacing: CGFloat = 10
    private let folderAsset = "registry-project-folder"
    private var space: Space? { session.selectedSpace }
    private var modes: [String] { space.map { Experience.modes(for: $0.providerId) } ?? [] }
    private var otherSpaces: [Space] { session.spaces.filter { $0.id != space?.id } }
    private var controlAnimation: Animation? { reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 1) }
    private var chats: [Conversation] {
        session.conversations.filter { $0.assistantId == nil && $0.providerId == space?.providerId && $0.mode == space?.mode }
    }
    private var recents: [Conversation] {
        let collections = Set(session.collections.map(\.id))
        return Array(chats.filter { $0.collectionId == nil || !collections.contains($0.collectionId!) }.prefix(20))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(.horizontal, Self.controlInset).padding(.bottom, 21)
                .frame(width: menuWidth)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if session.pairing != nil {
                        shortcuts.padding(.bottom, 34)
                    }
                    if space?.mode == "developer" {
                        sectionTitle("Workspaces")
                        if session.workspaces.isEmpty { empty("No workspaces yet.") }
                        ForEach(session.workspaces) { workspace in
                            Button {
                                if let space, workspace.isReplica != true {
                                    var target = session.homeTargets[space.id] ?? HomeTarget()
                                    target.workspaceID = workspace.id; session.selectTarget(target, spaceID: space.id)
                                }
                                openWorkspace(workspace.id)
                            } label: {
                                WorkspaceLabel(session: session, workspace: workspace,
                                               iconColumnWidth: menuIconWidth, iconSpacing: menuIconSpacing,
                                               iconSize: menuIconSize, fallbackIconAsset: folderAsset)
                            }
                            .buttonStyle(.plain).padding(.vertical, 10)
                            .accessibilityIdentifier("workspace-\(workspace.id)")
                        }
                    } else {
                        if !session.collections.isEmpty {
                            sectionTitle("Projects")
                            ForEach(session.collections) { collection in
                                collectionSection(collection)
                            }
                        }
                        sectionTitle("Recents").padding(.top, session.collections.isEmpty ? 0 : 22)
                        if recents.isEmpty { empty("No chats yet.") }
                        ForEach(recents) { run in conversationRow(run) }
                    }
                }.padding(.horizontal, menuInset).padding(.bottom, 24)
            }
            .refreshable { await session.refresh() }
            .scrollIndicators(.hidden)
            .modifier(SidebarScrollFade())
            .frame(width: menuWidth)
            .id("\(space?.id ?? ""):\(space?.mode ?? "")")
            bottomBar.padding(.horizontal, Self.controlInset).padding(.top, 10).padding(.bottom, 16)
        }
        .onChange(of: space?.id) { _, _ in providersExpanded = false }
        .onChange(of: session.ownership) { _, _ in providersExpanded = false; pendingMode = nil }
        .onDisappear { providersExpanded = false }
    }
    private var shortcuts: some View {
        VStack(spacing: 0) {
            TimelineView(.periodic(from: .now, by: 15)) { clock in
                let live = session.workInboxIsCurrent && session.isConnected
                let groups = session.displayedWorkInbox.groups(now: clock.date, live: live)
                let waitingCount = groups.needsYou.count
                let runningCount = live ? groups.running.count : 0
                Button(action: openWorkInbox) {
                    shortcutLabel("Activity") {
                        Image(systemName: "bell").font(.system(size: shortcutIconSize, weight: .medium))
                    } trailing: {
                        HStack(spacing: 6) {
                            activityBadge(waitingCount, tint: .orange)
                            activityBadge(runningCount, tint: .blue)
                        }
                    }
                }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("openWorkInbox")
                    .accessibilityValue([
                        waitingCount > 0 ? "\(waitingCount) conversations need you" : nil,
                        runningCount > 0 ? "\(runningCount) running conversations" : nil
                    ].compactMap { $0 }.joined(separator: ", "))
            }
            Button(action: openAtlas) {
                shortcutLabel("Atlas") {
                    RegistryIcon(token: "icon:globe", size: shortcutIconSize, tint: .primary)
                }
            }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("openAtlas")
            if !session.isDemo {
                Button(action: openMates) {
                    shortcutLabel("Mates") {
                        SidebarMateIcon(sidebarVisible: isVisible, size: shortcutIconSize + 4)
                    }
                }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("openMates")
            }
        }
    }
    private func shortcutLabel<Icon: View, Trailing: View>(_ title: String, @ViewBuilder icon: () -> Icon,
                                                           @ViewBuilder trailing: () -> Trailing = { EmptyView() }) -> some View {
        HStack(spacing: menuIconSpacing) {
            icon().frame(width: shortcutIconSize + 4).accessibilityHidden(true)
            Text(title).font(.title3.weight(.medium))
            Spacer(minLength: 0)
            trailing()
        }
        .foregroundStyle(.primary)
        .padding(.vertical, 6)
        .frame(minHeight: 52)
        .contentShape(.rect)
    }
    @ViewBuilder private func activityBadge(_ count: Int, tint: Color) -> some View {
        if count > 0 {
            Text(count, format: .number).font(.caption.weight(.semibold)).monospacedDigit()
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(tint.opacity(0.15), in: .capsule).foregroundStyle(tint)
                .fixedSize().accessibilityHidden(true)
        }
    }
    private var header: some View {
        GeometryReader { geometry in
            let labeledWidth = 52 * CGFloat(modes.count + 1) + modeLabelWidth + 6
            HStack(spacing: 8) {
                Image("registry-mains-fill").renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 20, height: 20).foregroundStyle(.black)
                    .frame(width: Self.headerDiscSize, height: Self.headerDiscSize).background(Color(white: 0.92), in: .circle)
                    .frame(width: AppNavigationStyle.inlineToolbarHeight, height: AppNavigationStyle.inlineToolbarHeight).accessibilityLabel("Mains")
                    .accessibilityIdentifier("sidebarMainsLogo")
                modeSwitcher(showLabel: geometry.size.width >= labeledWidth && !dynamicTypeSize.isAccessibilitySize)
                Spacer(minLength: 0)
            }.frame(height: AppNavigationStyle.inlineToolbarHeight)
        }.frame(height: AppNavigationStyle.inlineToolbarHeight)
    }
    private var bottomBar: some View {
        GeometryReader { geometry in
            let control: CGFloat = 44
            let gap: CGFloat = 8
            let available = geometry.size.width
            let providerWidth = providersExpanded
                ? min(control + CGFloat(otherSpaces.count) * (control + gap) + (otherSpaces.isEmpty ? 0 : 16), max(control, available - 2 * control - 2 * gap))
                : control
            let searchWidth = max(control, available - providerWidth - control - 2 * gap)
            let compactSearch = searchWidth < searchLabelWidth
            HStack(spacing: gap) {
                providerSwitcher(width: providerWidth)
                Button {
                    setProvidersExpanded(false)
                    search()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").font(.system(size: 19))
                        if !compactSearch {
                            Text("Search").font(.body).foregroundStyle(.secondary).fixedSize()
                                .transition(.opacity)
                            Spacer(minLength: 0)
                        }
                    }
                    .padding(.horizontal, compactSearch ? 0 : 14)
                    .frame(width: compactSearch ? control : searchWidth, height: control)
                    .foregroundStyle(.primary)
                    .contentShape(.capsule)
                }
                .buttonStyle(ChatPressStyle()).modifier(GlassSurface(radius: 22))
                .accessibilityLabel("Search").accessibilityIdentifier("sidebarSearch")
                .frame(width: searchWidth, alignment: providersExpanded ? .trailing : .center)
                RoundControl(symbol: "gearshape", label: "Settings", size: control) {
                    setProvidersExpanded(false)
                    settings()
                }.accessibilityIdentifier("openSettings")
            }
            .frame(height: 48)
            .animation(controlAnimation, value: providersExpanded)
            .animation(controlAnimation, value: available)
        }.frame(height: 48)
    }
    private func providerSwitcher(width: CGFloat) -> some View {
        HStack(spacing: 8) {
            if let space {
                SpaceDisc(space: space, selected: true) { setProvidersExpanded(!providersExpanded) }
                    .accessibilityHint(providersExpanded ? "Hide providers" : "Show providers")
                    .accessibilityValue(providersExpanded ? "Expanded" : "Collapsed")
                    .disabled(otherSpaces.isEmpty)
            } else {
                Image(systemName: "square.stack").foregroundStyle(.secondary).frame(width: 44, height: 44)
                    .accessibilityLabel("No provider selected")
            }
            if providersExpanded && !otherSpaces.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(otherSpaces) { item in
                            SpaceDisc(space: item, selected: false) {
                                setProvidersExpanded(false)
                                selectSpace(item.id)
                            }
                        }
                    }.padding(.vertical, 2)
                }
                .scrollIndicators(.hidden)
                .contentMargins(.horizontal, 8, for: .scrollContent)
                .scrollClipDisabled()
                .frame(width: max(0, width - 52), height: 48)
                // Keep horizontal overflow bounded, with room for native press feedback.
                .mask { Rectangle().padding(.vertical, -12) }
                .modifier(SidebarScrollFade(axis: .horizontal))
                .accessibilityIdentifier("sidebarProviderStrip")
                .transition(.opacity)
            }
        }
        .frame(width: width, height: 48, alignment: .leading)
        .accessibilityElement(children: .contain).accessibilityLabel("Providers")
    }
    private func setProvidersExpanded(_ expanded: Bool) {
        withAnimation(controlAnimation) { providersExpanded = expanded }
    }
    private func modeSwitcher(showLabel: Bool) -> some View {
        HStack(spacing: 8) {
            ForEach(modes, id: \.self) { mode in
                let selected = space?.mode == mode
                Button { chooseMode(mode) } label: {
                    GlassSelectionTab(title: Experience.label(mode), selected: selected,
                                      showLabel: showLabel && selected, selection: modeSelection) {
                        ZStack {
                            RegistryIcon(token: "icon:\(mode == "developer" ? "code" : mode == "work" ? "bag" : "chat")",
                                         size: 22, tint: selected ? .primary : .primary.opacity(0.8))
                                .opacity(pendingMode == mode ? 0 : 1)
                            if pendingMode == mode { ProgressView().controlSize(.mini).transition(.opacity) }
                        }
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: pendingMode)
                    }
                }
                .buttonStyle(ChatPressStyle())
                .disabled(!session.isConnected || session.changingMode || session.sending || pendingMode != nil)
                .accessibilityLabel(Experience.label(mode)).accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("sidebarMode-\(mode)")
            }
        }
        .fixedSize(horizontal: true, vertical: false)
        .animation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.94), value: space?.mode)
        .accessibilityElement(children: .contain).accessibilityLabel("Mode")
    }
    private func chooseMode(_ mode: String) {
        guard let space, space.mode != mode, pendingMode == nil else { return }
        setProvidersExpanded(false)
        let owner = session.ownership
        pendingMode = mode
        Task {
            defer { if owner == session.ownership { pendingMode = nil } }
            do { try await session.setSpaceMode(mode, spaceID: space.id) }
            catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
        }
    }
    private func sectionTitle(_ title: String) -> some View {
        Text(title).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            .padding(.bottom, 6).accessibilityAddTraits(.isHeader)
    }
    private func empty(_ title: String) -> some View { Text(title).font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 8) }
    private func collectionSection(_ collection: ProjectCollection) -> some View {
        let open = !collapsed.contains(collection.id)
        let inside = chats.filter { $0.collectionId == collection.id }
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Button { openProject(collection.id) } label: {
                    HStack(spacing: menuIconSpacing) {
                        RegistryIcon(token: collection.icon, fallbackAsset: folderAsset, size: menuIconSize)
                            .frame(width: menuIconWidth)
                        Text(collection.name).foregroundStyle(.primary).lineLimit(1)
                    }
                    .font(.body).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(.rect)
                }
                .accessibilityIdentifier("openProject-\(collection.id)")
                Button {
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                        if open { collapsed.insert(collection.id) } else { collapsed.remove(collection.id) }
                    }
                } label: {
                    RegistryIcon(token: "tool-arrow-up", size: 16)
                        .rotationEffect(.degrees(open ? 180 : 90))
                        .frame(width: 44, height: 44, alignment: .trailing).contentShape(.rect)
                }
                .accessibilityLabel("\(collection.name), \(open ? "expanded" : "collapsed")")
                .accessibilityHint(open ? "Hide project chats" : "Show project chats")
                .accessibilityIdentifier("collection-\(collection.id)")
            }.buttonStyle(.plain)
            if open {
                if inside.isEmpty { empty("No chats yet.").padding(.leading, menuIconWidth + menuIconSpacing).padding(.bottom, 6) }
                ForEach(inside) { run in conversationRow(run).padding(.leading, menuIconWidth + menuIconSpacing) }
            }
        }
    }
    private func conversationRow(_ run: Conversation) -> some View {
        Button { openConversation(run.id) } label: {
            HStack(spacing: 8) {
                Text(run.displayTitle).foregroundStyle(.primary).lineLimit(1)
                Spacer(minLength: 4)
                if run.isActive { Circle().fill(Provider.accent(run.providerId)).frame(width: 6, height: 6) }
                if run.isReplica == true { BridgeIcon() }
            }.font(.body).frame(minHeight: 44).contentShape(.rect)
        }.buttonStyle(.plain).accessibilityIdentifier("conversation-\(run.id)")
            .accessibilityValue(run.isReplica == true ? "Read-only, synced through Bridge" : "")
    }
}

private struct SidebarMateIcon: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let sidebarVisible: Bool
    let size: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pose = Pose()

    private struct Pose {
        var rotation: Double = 0
        var offset: CGFloat = 0
        var verticalScale: CGFloat = 1
    }

    private static let preset = MateRobotAssets.catalogue?.styles.lazy.flatMap(\.presets)
        .first { $0.id == "terminal-amber" }
    private static let reactions = [
        Pose(rotation: -11), Pose(rotation: 11), Pose(offset: -4), Pose(offset: 1, verticalScale: 0.84)
    ]

    var body: some View {
        let animate = sidebarVisible && !reduceMotion
        let currentPose = animate ? pose : Pose()
        MateRobotThumbnail(preset: Self.preset)
            .frame(width: size, height: size)
            .scaleEffect(x: 1, y: currentPose.verticalScale)
            .rotationEffect(.degrees(currentPose.rotation))
            .offset(y: currentPose.offset)
            .task(id: animate) {
                withAnimation(nil) { pose = Pose() }
                guard animate, let reaction = Self.reactions.randomElement() else { return }
                // Let the drawer uncover the icon before playing the reaction.
                try? await Task.sleep(for: .milliseconds(180))
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.16)) { pose = reaction }
                try? await Task.sleep(for: .milliseconds(160))
                guard !Task.isCancelled else { return }
                withAnimation(.spring(response: 0.28, dampingFraction: 0.72)) { pose = Pose() }
            }
    }
}

private struct SidebarScrollFade: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    var axis: Axis = .vertical
    private struct Edges: Equatable {
        var start = false
        var end = false
    }
    @State private var edges = Edges()
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: Edges.self) { geometry in
                let start = axis == .vertical ? -geometry.contentInsets.top : -geometry.contentInsets.leading
                let end = max(start, axis == .vertical
                    ? geometry.contentSize.height - geometry.containerSize.height + geometry.contentInsets.bottom
                    : geometry.contentSize.width - geometry.containerSize.width + geometry.contentInsets.trailing)
                let offset = axis == .vertical ? geometry.contentOffset.y : geometry.contentOffset.x
                let overflows = end > start + 1
                return Edges(start: overflows && offset > start + 1, end: overflows && offset < end - 1)
            } action: { _, next in edges = next }
            .overlay(alignment: axis == .vertical ? .top : layoutDirection == .leftToRight ? .leading : .trailing) {
                fade(start: true).opacity(edges.start ? 1 : 0)
            }
            .overlay(alignment: axis == .vertical ? .bottom : layoutDirection == .leftToRight ? .trailing : .leading) {
                fade(start: false).opacity(edges.end ? 1 : 0)
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: edges)
    }
    private func fade(start: Bool) -> some View {
        let background = Color(.systemBackground)
        let leading = start == (layoutDirection == .leftToRight)
        let from: UnitPoint = axis == .vertical ? (start ? .top : .bottom) : (leading ? .leading : .trailing)
        let to: UnitPoint = axis == .vertical ? (start ? .bottom : .top) : (leading ? .trailing : .leading)
        return LinearGradient(colors: [background, background.opacity(0)], startPoint: from, endPoint: to)
            .frame(width: axis == .horizontal ? 16 : nil, height: axis == .vertical ? 24 : nil)
            .allowsHitTesting(false).accessibilityHidden(true)
    }
}

struct WorkspaceLabel: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let workspace: Workspace
    var iconColumnWidth: CGFloat? = nil
    var iconSpacing: CGFloat = 9
    var iconSize: CGFloat = 17
    var fallbackIconAsset: String? = nil
    var body: some View {
        let project = session.projects.first { $0.id == workspace.projectId }
        let git = session.gitStates.first { $0.workspaceId == workspace.id }
        HStack(alignment: .top, spacing: iconSpacing) {
            RegistryIcon(token: project?.icon, fallbackAsset: fallbackIconAsset, size: iconSize)
                .frame(width: iconColumnWidth).padding(.top, 3)
            VStack(alignment: .leading, spacing: 4) {
                Text(workspace.name).font(.body).foregroundStyle(.primary).lineLimit(1)
                Text(git?.branch ?? (workspace.isReplica == true ? "Read only" : "No branch"))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
            if workspace.isReplica == true { BridgeIcon() }
        }.contentShape(.rect)
    }
}
