import SwiftUI

struct SidebarView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    @Binding var collapsed: Set<String>
    let isVisible: Bool
    let showsContent: Bool
    let menuWidth: CGFloat
    let layoutWidth: CGFloat
    let overlayProgress: CGFloat?
    let headerTopInset: CGFloat
    let leadingInset: CGFloat
    let openConversation: (String) -> Void
    let openWorkspace: (String) -> Void
    let openProject: (String) -> Void
    let startConversation: (String) -> Void
    let search: () -> Void
    let settings: () -> Void
    let openHome: () -> Void
    let openWorkInbox: () -> Void
    let openAtlas: () -> Void
    let openMates: () -> Void
    @State private var pendingMode: String?
    @State private var chatAction: ConversationActionRequest?
    @State private var branchEdit: BranchEdit?
    @State private var workspaceToDelete: WorkspaceDeletion?
    @State private var providersExpanded = false
    @State private var providerScrollPosition = ScrollPosition(edge: .leading)
    @AppStorage("hasSeenSidebarOnboarding") private var hasSeenSidebarOnboarding = false
    @State private var showsProviderTip = false
    @State private var previewsProviderStrip = false
    @Namespace private var modeSelection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .subheadline) private var modeLabelWidth: CGFloat = 36
    @ScaledMetric(relativeTo: .title3) private var shortcutIconSize: CGFloat = 24
    static let controlInset: CGFloat = 16
    static let headerDiscSize: CGFloat = 40
    static let openingDuration: TimeInterval = 0.28
    private static let bottomBarHeight: CGFloat = 48
    private static let utilityControlWidth: CGFloat = 48
    private let menuInset: CGFloat = 12
    private let menuIconWidth: CGFloat = 22
    private let menuIconSize: CGFloat = 20
    private let menuIconSpacing: CGFloat = 10
    private let bottomBarTravel: CGFloat = 96
    private let folderAsset = "registry-project-folder"
    private var space: Space? { session.selectedSpace }
    private var modes: [String] { space.map { Experience.modes(for: $0.providerId) } ?? [] }
    private var otherSpaces: [Space] { session.spaces.filter { $0.id != space?.id } }
    private var controlAnimation: Animation? { reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 1) }
    private var tipAnimation: Animation? { reduceMotion ? nil : .easeInOut(duration: 0.24) }
    private var chats: [Conversation] {
        session.conversations.filter { $0.assistantId == nil && $0.providerId == space?.providerId && $0.mode == space?.mode }
    }
    private var unpinnedChats: [Conversation] { chats.filter { $0.pinnedAt == nil } }
    private var pinnedChats: [Conversation] {
        chats.filter { $0.pinnedAt != nil }.sorted {
            ($0.pinnedAt ?? .distantPast, $0.updatedAt) > ($1.pinnedAt ?? .distantPast, $1.updatedAt)
        }
    }
    private var recents: [Conversation] {
        let collections = Set(session.collections.map(\.id))
        return Array(unpinnedChats.filter { $0.collectionId.map(collections.contains) != true }.prefix(20))
    }
    private struct BranchEdit: Identifiable {
        let id: String
        let branch: String
        let owner: Int
    }
    private struct WorkspaceDeletion {
        let workspace: Workspace
        let owner: Int
    }
    var body: some View {
        let slides = overlayProgress != nil && !reduceMotion
        let hiddenFraction = slides ? 1 - (overlayProgress ?? 1) : 0
        // Center the footer on Home's composer controls in the side-by-side layout.
        let footerInset = HomeView.composerBottomInset + MessageComposer.standardVerticalInset
            + (MessageComposer.controlHeight - Self.bottomBarHeight) / 2
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                if showsContent {
                    menu
                        .offset(x: -layoutWidth * hiddenFraction)
                        .transition(slides ? .offset(x: -layoutWidth) : .opacity)
                }
            }
            .frame(maxHeight: .infinity, alignment: .topLeading)
            if showsContent {
                bottomBar.padding(.leading, leadingInset).padding(.trailing, Self.controlInset)
                    .padding(.top, 10).padding(.bottom, footerInset)
                    .offset(y: bottomBarTravel * hiddenFraction)
                    .transition(slides ? .offset(y: bottomBarTravel) : .opacity)
            }
        }
        .frame(width: layoutWidth)
        .background(alignment: .center) {
            if showsProviderTip {
                Rectangle().fill(.clear).contentShape(.rect)
                    .accessibilityHidden(true)
            }
        }
        .simultaneousGesture(TapGesture().onEnded { dismissProviderTip() }, isEnabled: showsProviderTip)
        .task(id: showsProviderTip) {
            guard showsProviderTip, !reduceMotion else { return }
            try? await Task.sleep(for: .milliseconds(750))
            guard !Task.isCancelled, showsProviderTip, !reduceMotion else { return }
            providerScrollPosition.scrollTo(edge: .leading)
            previewsProviderStrip = true
            try? await Task.sleep(for: .milliseconds(1_050))
            if !Task.isCancelled { previewsProviderStrip = false }
        }
        .onChange(of: space?.id) { _, _ in providersExpanded = false }
        .onChange(of: session.ownership) { _, _ in
            providersExpanded = false; pendingMode = nil; branchEdit = nil; workspaceToDelete = nil
        }
        .onChange(of: isVisible) { _, visible in
            if !visible {
                providersExpanded = false
                dismissProviderTip()
            }
        }
        .modifier(ConversationActionPrompts(session: session, request: $chatAction))
        .sheet(item: $branchEdit) { edit in
            RenameItemSheet(title: "Rename branch", field: "Branch name", initialValue: edit.branch) { name in
                guard edit.owner == session.ownership else { throw MainsError.changedBackend }
                guard name != edit.branch else { return }
                try await session.manageWorkspace(edit.id, action: .renameBranch(expected: edit.branch, name: name))
            }
        }
        .confirmationDialog("Delete workspace?", isPresented: Binding(get: { workspaceToDelete != nil },
            set: { if !$0 { workspaceToDelete = nil } }), titleVisibility: .visible, presenting: workspaceToDelete) { target in
            Button("Delete workspace", role: .destructive) { manageWorkspace(target.workspace, .delete, owner: target.owner) }
        } message: { target in
            Text("This removes “\(target.workspace.name)” from Mains and keeps its checkout on your computer.")
        }
    }
    private var menu: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(.leading, leadingInset).padding(.trailing, Self.controlInset)
                .padding(.top, headerTopInset).padding(.bottom, 21)
                .frame(width: menuWidth)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if session.pairing != nil {
                        shortcuts.padding(.bottom, 34)
                    }
                    if space?.mode == "developer" {
                        let pinned = session.workspaces.filter { $0.pinnedAt != nil }
                        let regular = session.workspaces.filter { $0.pinnedAt == nil }
                        if !pinned.isEmpty {
                            sectionTitle("Pinned")
                            ForEach(pinned) { workspaceRow($0) }
                        }
                        if !regular.isEmpty || pinned.isEmpty {
                            sectionTitle("Workspaces").padding(.top, pinned.isEmpty ? 0 : 22)
                            if regular.isEmpty { empty("No workspaces yet.") }
                            ForEach(regular) { workspaceRow($0) }
                        }
                    } else {
                        let pinned = pinnedChats
                        if !pinned.isEmpty {
                            sectionTitle("Pinned")
                            ForEach(pinned) { conversationRow($0) }
                        }
                        if !session.collections.isEmpty {
                            sectionTitle("Projects").padding(.top, pinned.isEmpty ? 0 : 22)
                            ForEach(session.collections) { collection in
                                collectionSection(collection)
                            }
                        }
                        let recent = recents
                        if !recent.isEmpty || pinned.isEmpty {
                            sectionTitle("Recents").padding(.top, session.collections.isEmpty && pinned.isEmpty ? 0 : 22)
                            if recent.isEmpty { empty("No chats yet.") }
                            ForEach(recent) { conversationRow($0) }
                        }
                    }
                }.padding(.leading, leadingInset + menuInset)
                    .padding(.trailing, Self.controlInset + menuInset).padding(.bottom, 24)
            }
            .pullToRefresh { await session.refresh() }
            .scrollIndicators(.hidden)
            .modifier(SidebarScrollFade())
            .frame(width: menuWidth)
            .id("\(space?.id ?? ""):\(space?.mode ?? "")")
        }
    }
    private var shortcuts: some View {
        VStack(spacing: 0) {
            Button(action: openHome) {
                shortcutLabel("Home") {
                    RegistryIcon(token: "icon:home", size: shortcutIconSize, tint: .primary)
                }
            }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("openHome")
            TimelineView(.periodic(from: .now, by: 15)) { clock in
                let live = session.workInboxIsCurrent && session.isConnected
                let groups = session.displayedWorkInbox.groups(now: clock.date, live: live)
                let waitingCount = groups.needsYou.count
                let runningCount = live ? groups.running.count : 0
                Button(action: openWorkInbox) {
                    shortcutLabel("Activity") {
                        Image(systemName: "tray").font(.system(size: shortcutIconSize * 0.8, weight: .medium))
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
            Button(action: openMates) {
                shortcutLabel("Mates") {
                    SidebarMateIcon(sidebarVisible: isVisible, size: shortcutIconSize + 4)
                }
            }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("openMates")
        }
    }
    private func shortcutLabel<Icon: View, Trailing: View>(_ title: String, @ViewBuilder icon: () -> Icon,
                                                           @ViewBuilder trailing: () -> Trailing = { EmptyView() }) -> some View {
        HStack(spacing: menuIconSpacing) {
            icon().frame(width: shortcutIconSize + 4).accessibilityHidden(true)
            Text(title).font(.title3.weight(.medium).width(.expanded))
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
            let gap: CGFloat = 8
            let stripAvailable = geometry.size.width - 2 * Self.utilityControlWidth - SpaceDisc.size - 2 * gap
            let stripContentWidth = CGFloat(otherSpaces.count) * (SpaceDisc.size + gap) - gap
            let stripWidth = max(0, min(stripAvailable, stripContentWidth))
            let canShowProviderTip = isVisible && session.pairing != nil && !session.isDemo && space != nil && stripWidth > 0
            HStack(spacing: 0) {
                providerSwitcher(stripWidth: stripWidth, gap: gap)
                Spacer(minLength: gap)
                HStack(spacing: 0) {
                    utilityButton("Search", symbol: "magnifyingglass", identifier: "sidebarSearch", action: search)
                    utilityButton("Settings", symbol: "gearshape", identifier: "openSettings", action: settings)
                }
                .background(alignment: .center) {
                    Color.clear.modifier(GlassSurface(radius: SpaceDisc.size / 2, interactive: false))
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .frame(height: Self.bottomBarHeight)
            .overlay(alignment: .bottomLeading) {
                if canShowProviderTip && showsProviderTip {
                    SidebarTipBubble(title: "Switch providers", message: "Tap this icon to see your providers.",
                                     pointer: SpaceDisc.size / 2)
                        .accessibilityIdentifier("providerTip")
                        .offset(y: -Self.bottomBarHeight - 4)
                        .transition(.opacity)
                }
            }
            .onChange(of: canShowProviderTip, initial: true) { _, available in
                if !available { dismissProviderTip() }
            }
            .task(id: canShowProviderTip) {
                guard canShowProviderTip, !hasSeenSidebarOnboarding else { return }
                // Visibility changes when the drawer starts opening.
                let openingTime: Duration = reduceMotion ? .zero : .seconds(Self.openingDuration)
                try? await Task.sleep(for: openingTime + .seconds(1))
                guard !Task.isCancelled, !hasSeenSidebarOnboarding else { return }
                hasSeenSidebarOnboarding = true
                withAnimation(tipAnimation) { showsProviderTip = true }
            }
        }.frame(height: Self.bottomBarHeight)
    }
    private func utilityButton(_ title: LocalizedStringKey, symbol: String, identifier: String, action: @escaping () -> Void) -> some View {
        Button {
            setProvidersExpanded(false)
            action()
        } label: {
            Image(systemName: symbol).font(.system(size: 18))
                .frame(width: Self.utilityControlWidth, height: SpaceDisc.size)
                .contentShape(.rect)
        }
        .buttonStyle(ChatPressStyle())
        .accessibilityLabel(title).accessibilityIdentifier(identifier)
    }
    @ViewBuilder private func providerSwitcher(stripWidth: CGFloat, gap: CGFloat) -> some View {
        if let space {
            let fill = Provider.accent(space.providerId)
            let stripExpanded = providersExpanded || (previewsProviderStrip && !reduceMotion)
            ZStack(alignment: .leading) {
                if stripWidth > 0 {
                    ScrollView(.horizontal) {
                        HStack(spacing: gap) {
                            ForEach(otherSpaces) { item in
                                SpaceDisc(space: item, selected: false) {
                                    setProvidersExpanded(false)
                                    startConversation(item.id)
                                }
                                // Keep the glass within the scroll mask during a press.
                                .modifier(GlassSurface(radius: SpaceDisc.size / 2, interactive: false))
                            }
                        }.padding(.vertical, 2)
                    }
                    .scrollIndicators(.hidden)
                    .scrollClipDisabled()
                    .scrollPosition($providerScrollPosition)
                    .frame(width: stripWidth, height: Self.bottomBarHeight)
                    .modifier(SidebarScrollFade(axis: .horizontal))
                    .mask(alignment: .leading) {
                        let maskWidth = stripWidth + 16
                        LinearGradient(stops: [
                            .init(color: .white, location: 0),
                            .init(color: .white, location: stripWidth / maskWidth),
                            .init(color: .clear, location: 1)
                        ], startPoint: .leading, endPoint: .trailing)
                        .frame(width: maskWidth)
                        .offset(x: stripExpanded ? 0 : -maskWidth)
                    }
                    .opacity(stripExpanded ? 1 : 0)
                    .animation(controlAnimation?.delay(stripExpanded ? 0.06 : 0), value: stripExpanded)
                    .accessibilityIdentifier("sidebarProviderStrip")
                    .padding(.leading, SpaceDisc.size + gap)
                    .allowsHitTesting(providersExpanded)
                    .accessibilityHidden(!providersExpanded)
                }
                HStack(spacing: 0) {
                    SpaceDisc(space: space, selected: true) { setProvidersExpanded(!providersExpanded) }
                        .accessibilityHint(providersExpanded ? "Hide providers" : "Show providers")
                        .accessibilityValue(providersExpanded ? "Expanded" : "Collapsed")
                        .disabled(otherSpaces.isEmpty)
                    if !stripExpanded {
                        Button { startConversation(space.id) } label: {
                            Text("New Chat").font(.subheadline.weight(.semibold))
                                .lineLimit(1).minimumScaleFactor(0.75)
                                .padding(.leading, 2).padding(.trailing, 14)
                                .frame(minWidth: SpaceDisc.size, minHeight: SpaceDisc.size)
                                .foregroundStyle(.white)
                                .contentShape(.rect)
                        }
                        .buttonStyle(ChatPressStyle())
                        .accessibilityIdentifier("sidebarNewChat")
                        .transition(.opacity)
                    }
                }
                .background(fill, in: .capsule)
                .clipShape(.capsule)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.14).delay(stripExpanded ? 0 : 0.16),
                           value: stripExpanded)
            }
            .accessibilityElement(children: .contain).accessibilityLabel("Providers")
        } else {
            Image(systemName: "square.stack").foregroundStyle(.secondary)
                .frame(width: SpaceDisc.size, height: SpaceDisc.size)
                .accessibilityLabel("No provider selected")
        }
    }
    private func setProvidersExpanded(_ expanded: Bool) {
        if expanded {
            providerScrollPosition.scrollTo(edge: .leading)
            if session.pairing != nil && !session.isDemo { hasSeenSidebarOnboarding = true }
        }
        providersExpanded = expanded
        dismissProviderTip()
    }
    private func dismissProviderTip() {
        guard showsProviderTip else { return }
        previewsProviderStrip = false
        withAnimation(tipAnimation) { showsProviderTip = false }
    }
    private func modeSwitcher(showLabel: Bool) -> some View {
        HStack(spacing: 8) {
            ForEach(modes, id: \.self) { mode in
                let selected = space?.mode == mode
                Button { chooseMode(mode) } label: {
                    GlassSelectionTab(title: Experience.label(mode), selected: selected,
                                      showLabel: showLabel && selected, selection: modeSelection) {
                        RegistryIcon(token: "icon:\(mode == "developer" ? "code" : mode == "work" ? "bag" : "chat")",
                                     size: 22, tint: selected ? .primary : .primary.opacity(0.8))
                        .opacity(pendingMode == mode ? 0.5 : 1)
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: pendingMode)
                    }
                }
                .buttonStyle(ChatPressStyle())
                .disabled(!session.isConnected || session.changingMode || session.sending || pendingMode != nil)
                .accessibilityLabel(Experience.label(mode)).accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityValue(pendingMode == mode ? "Switching mode" : "")
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
        Text(title).font(.footnote.weight(.semibold).width(.expanded)).foregroundStyle(.secondary)
            .padding(.bottom, 6).accessibilityAddTraits(.isHeader)
    }
    private func empty(_ title: String) -> some View { Text(title).font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 8) }
    private func collectionSection(_ collection: ProjectCollection) -> some View {
        let open = !collapsed.contains(collection.id)
        let inside = unpinnedChats.filter { $0.collectionId == collection.id }
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Button { openProject(collection.id) } label: {
                    HStack(spacing: menuIconSpacing) {
                        RegistryIcon(token: collection.icon, fallbackAsset: folderAsset, size: menuIconSize)
                            .frame(width: menuIconWidth)
                        Text(collection.name).fontWidth(.expanded).foregroundStyle(.primary).lineLimit(1)
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
            .accessibilityValue(run.isReplica == true ? "Read-only, synced through Bridge" : run.pinnedAt != nil ? "Pinned" : "")
            .contextMenu { ConversationMenuActions(session: session, run: run, request: $chatAction) }
    }

    private func workspaceRow(_ workspace: Workspace) -> some View {
        Button { openWorkspace(workspace.id) } label: {
            HStack(spacing: 8) {
                WorkspaceLabel(session: session, workspace: workspace,
                               iconColumnWidth: menuIconWidth, iconSpacing: menuIconSpacing,
                               iconSize: menuIconSize, fallbackIconAsset: folderAsset,
                               nameFont: .body.width(.expanded))
                if session.pendingWorkspaceAction?.workspaceID == workspace.id, session.pendingWorkspaceAction?.status == .sending {
                    ProgressView().controlSize(.small).accessibilityLabel("Updating workspace")
                }
            }.padding(.vertical, 10).frame(minHeight: 44).contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("workspace-\(workspace.id)")
        .accessibilityValue(workspace.pinnedAt != nil ? "Pinned" : "")
        .contextMenu {
            if workspace.isReplica != true && session.supportsWorkspaceManagement {
                workspaceMenu(workspace)
            }
        }
    }

    @ViewBuilder private func workspaceMenu(_ workspace: Workspace) -> some View {
        let pinned = workspace.pinnedAt != nil
        Button(pinned ? "Unpin" : "Pin", systemImage: pinned ? "pin.slash" : "pin") {
            manageWorkspace(workspace, .setPinned(!pinned))
        }.disabled(!session.canManageWorkspace(workspace.id, action: .setPinned(!pinned)))
            .accessibilityIdentifier("pinWorkspace")
        if let branch = session.gitStates.first(where: { $0.workspaceId == workspace.id })?.branch, branch != "HEAD" {
            Button("Rename branch", systemImage: "pencil") {
                branchEdit = BranchEdit(id: workspace.id, branch: branch, owner: session.ownership)
            }.disabled(!session.canManageWorkspace(workspace.id, action: .renameBranch(expected: branch, name: branch)))
                .accessibilityIdentifier("renameWorkspaceBranch")
        }
        Button("New worktree", systemImage: "plus") { manageWorkspace(workspace, .newWorktree) }
            .disabled(!session.canManageWorkspace(workspace.id, action: .newWorktree))
            .accessibilityIdentifier("newWorkspaceWorktree")
        Divider()
        Button("Archive", systemImage: "archivebox") { manageWorkspace(workspace, .archive) }
            .disabled(!session.canManageWorkspace(workspace.id, action: .archive))
            .accessibilityIdentifier("archiveWorkspace")
        Button(role: .destructive) {
            workspaceToDelete = WorkspaceDeletion(workspace: workspace, owner: session.ownership)
        } label: {
            Label { Text("Delete") } icon: {
                Image(uiImage: (UIImage(systemName: "trash") ?? UIImage())
                    .withTintColor(.systemRed, renderingMode: .alwaysOriginal))
                    .renderingMode(.original)
            }
        }
        .disabled(!session.canManageWorkspace(workspace.id, action: .delete))
        .accessibilityIdentifier("deleteWorkspace")
    }

    private func manageWorkspace(_ workspace: Workspace, _ action: WorkspaceAction, owner: Int? = nil) {
        let owner = owner ?? session.ownership
        Task {
            guard owner == session.ownership else { return }
            do { try await session.manageWorkspace(workspace.id, action: action) }
            catch {
                if owner == session.ownership && session.pendingWorkspaceAction?.status != .uncertain {
                    session.actionError = error.localizedDescription
                }
            }
        }
    }
}

private struct SidebarTipBubble: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let title: LocalizedStringKey
    let message: LocalizedStringKey
    let pointer: CGFloat

    var body: some View {
        let shape = SidebarTipShape(pointer: pointer, pointsFromRight: layoutDirection == .rightToLeft)
        let label = VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
            Text(message).font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .padding(.bottom, SidebarTipShape.pointerHeight)
        Group {
            if reduceTransparency {
                label.background(Color(.secondarySystemBackground), in: shape)
            } else {
                label.glassEffect(.regular, in: shape)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
        .allowsHitTesting(false)
    }
}

private struct SidebarTipShape: Shape {
    static let pointerHeight: CGFloat = 9
    let pointer: CGFloat
    let pointsFromRight: Bool

    func path(in rect: CGRect) -> Path {
        let base = rect.maxY - Self.pointerHeight
        let radius = min(15, rect.width / 4, (base - rect.minY) / 2)
        let halfPointer: CGFloat = 8
        let inset = min(max(pointer, radius + halfPointer), rect.width / 2)
        let x = pointsFromRight ? rect.maxX - inset : rect.minX + inset
        return Path { path in
            path.move(to: CGPoint(x: rect.minX + radius, y: rect.minY))
            path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY),
                        tangent2End: CGPoint(x: rect.maxX, y: base), radius: radius)
            path.addArc(tangent1End: CGPoint(x: rect.maxX, y: base),
                        tangent2End: CGPoint(x: rect.minX, y: base), radius: radius)
            path.addLine(to: CGPoint(x: x + halfPointer, y: base))
            path.addLine(to: CGPoint(x: x, y: rect.maxY))
            path.addLine(to: CGPoint(x: x - halfPointer, y: base))
            path.addArc(tangent1End: CGPoint(x: rect.minX, y: base),
                        tangent2End: CGPoint(x: rect.minX, y: rect.minY), radius: radius)
            path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY),
                        tangent2End: CGPoint(x: rect.maxX, y: rect.minY), radius: radius)
            path.closeSubpath()
        }
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
            .mask {
                GeometryReader { geometry in
                    let horizontal = axis == .horizontal
                    let length = horizontal ? geometry.size.width : geometry.size.height
                    let fade = min((horizontal ? 16 : 24) / max(length, 1), 0.5)
                    LinearGradient(stops: [
                        .init(color: edges.start ? .clear : .white, location: 0),
                        .init(color: .white, location: fade),
                        .init(color: .white, location: 1 - fade),
                        .init(color: edges.end ? .clear : .white, location: 1)
                    ], startPoint: horizontal ? .leading : .top, endPoint: horizontal ? .trailing : .bottom)
                    // Keep horizontal overflow bounded, with room for native press feedback.
                    .padding(.vertical, horizontal ? -12 : 0)
                }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: edges)
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
    var nameFont: Font = .body
    var body: some View {
        let project = session.projects.first { $0.id == workspace.projectId }
        let git = session.gitStates.first { $0.workspaceId == workspace.id }
        HStack(alignment: .top, spacing: iconSpacing) {
            RegistryIcon(token: project?.icon, fallbackAsset: fallbackIconAsset, size: iconSize)
                .frame(width: iconColumnWidth).padding(.top, 3)
            VStack(alignment: .leading, spacing: 4) {
                Text(workspace.name).font(nameFont).foregroundStyle(.primary).lineLimit(1)
                Text(git?.branch ?? (workspace.isReplica == true ? "Read only" : "No branch"))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
            if workspace.isReplica == true { BridgeIcon() }
        }.contentShape(.rect)
    }
}
