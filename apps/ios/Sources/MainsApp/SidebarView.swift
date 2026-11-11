import SwiftUI

struct SidebarView: View {
    let session: BackendSession
    @Binding var collapsed: Set<String>
    let openConversation: (String) -> Void
    let openWorkspace: (String) -> Void
    let selectSpace: (String) -> Void
    let search: () -> Void
    let settings: () -> Void
    @State private var pendingMode: String?
    @Namespace private var modeSelection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var space: Space? { session.selectedSpace }
    private var chats: [Conversation] {
        session.conversations.filter { $0.providerId == space?.providerId && $0.mode == space?.mode }
    }
    private var recents: [Conversation] {
        let collections = Set(session.collections.map(\.id))
        return Array(chats.filter { $0.collectionId == nil || !collections.contains($0.collectionId!) }.prefix(20))
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Mains").font(.title2.bold())
                Spacer()
                RoundControl(symbol: "gearshape", label: "Settings", action: settings).accessibilityIdentifier("openSettings")
                RoundControl(symbol: "magnifyingglass", label: "Search", action: search)
            }.padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 12)
            modeSwitcher.padding(.horizontal, 16).padding(.bottom, 22)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
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
                            } label: { WorkspaceLabel(session: session, workspace: workspace) }
                            .buttonStyle(.plain).padding(.vertical, 12)
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
                }.padding(.horizontal, 16).padding(.bottom, 24)
            }
            .refreshable { await session.refresh() }
            .scrollIndicators(.hidden)
            .modifier(SidebarScrollFade())
            .id("\(space?.id ?? ""):\(space?.mode ?? "")")
            ScrollView(.horizontal) {
                HStack(spacing: 10) {
                    ForEach(session.spaces) { item in
                        SpaceDisc(space: item, selected: item.id == space?.id) { selectSpace(item.id) }
                    }
                }.padding(2)
            }
            .scrollClipDisabled()
            .scrollIndicators(.hidden)
            .frame(height: 48)
            .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 16)
        }
        .background(Color(.systemBackground))
    }
    private var modeSwitcher: some View {
        HStack(spacing: 8) {
            ForEach(space.map { Experience.modes(for: $0.providerId) } ?? [], id: \.self) { mode in
                let selected = space?.mode == mode
                Button { chooseMode(mode) } label: {
                    HStack(spacing: 8) {
                        ZStack {
                            RegistryIcon(token: "icon:\(mode == "developer" ? "code" : mode == "work" ? "bag" : "chat")",
                                         size: 22, tint: selected ? .primary : .primary.opacity(0.8))
                                .opacity(pendingMode == mode ? 0 : 1)
                            if pendingMode == mode { ProgressView().controlSize(.mini).transition(.opacity) }
                        }
                        .frame(width: 22, height: 22)
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: pendingMode)
                        if selected {
                            Text(Experience.label(mode)).fixedSize().lineLimit(1)
                                .transition(.opacity.combined(with: .scale(scale: 0.92, anchor: .leading)))
                        }
                    }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, selected ? 14 : 11)
                    .frame(minWidth: 44, minHeight: 40).clipped()
                    .background {
                        if selected {
                            Color.clear.modifier(GlassSurface(radius: 20))
                                .matchedGeometryEffect(id: "mode", in: modeSelection)
                        }
                    }
                    .padding(.vertical, 2).contentShape(.rect)
                }
                .buttonStyle(ChatPressStyle())
                .disabled(!session.isConnected || session.changingMode || session.sending || pendingMode != nil)
                .accessibilityLabel(Experience.label(mode)).accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("sidebarMode-\(mode)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.94), value: space?.mode)
        .accessibilityElement(children: .contain).accessibilityLabel("Mode")
    }
    private func chooseMode(_ mode: String) {
        guard let space, space.mode != mode, pendingMode == nil else { return }
        let owner = session.ownership
        pendingMode = mode
        Task {
            defer { if owner == session.ownership { pendingMode = nil } }
            do { try await session.setSpaceMode(mode, spaceID: space.id) }
            catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
        }
    }
    private func sectionTitle(_ title: String) -> some View { Text(title).font(.subheadline.weight(.semibold)).padding(.bottom, 10) }
    private func empty(_ title: String) -> some View { Text(title).font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 8) }
    private func collectionSection(_ collection: ProjectCollection) -> some View {
        let open = !collapsed.contains(collection.id)
        let inside = chats.filter { $0.collectionId == collection.id }
        let iconSize: CGFloat = 20
        let iconSpacing: CGFloat = 9
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                if open { collapsed.insert(collection.id) } else { collapsed.remove(collection.id) }
            } label: {
                HStack(spacing: iconSpacing) {
                    RegistryIcon(token: collection.icon, size: iconSize)
                    Text(collection.name).foregroundStyle(.primary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: open ? "chevron.down" : "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }.font(.body).frame(minHeight: 44).contentShape(.rect)
            }.buttonStyle(.plain).accessibilityLabel("\(collection.name), \(open ? "expanded" : "collapsed")")
                .accessibilityIdentifier("collection-\(collection.id)")
            if open {
                if inside.isEmpty { empty("No chats yet.").padding(.leading, iconSize + iconSpacing).padding(.bottom, 6) }
                ForEach(inside) { run in conversationRow(run).padding(.leading, iconSize + iconSpacing) }
            }
        }
    }
    private func conversationRow(_ run: Conversation) -> some View {
        Button { openConversation(run.id) } label: {
            HStack(spacing: 8) {
                Text(run.displayTitle).lineLimit(1)
                Spacer(minLength: 4)
                if run.isActive { Circle().fill(Provider.accent(run.providerId)).frame(width: 6, height: 6) }
                if run.isReplica == true { BridgeIcon() }
            }.font(.subheadline).frame(minHeight: 44).contentShape(.rect)
        }.buttonStyle(.plain).accessibilityIdentifier("conversation-\(run.id)")
            .accessibilityValue(run.isReplica == true ? "Read-only, synced through Bridge" : "")
    }
}

private struct SidebarScrollFade: ViewModifier {
    private struct Edges: Equatable {
        var top = false
        var bottom = false
    }
    @State private var edges = Edges()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: Edges.self) { geometry in
                let start = -geometry.contentInsets.top
                let end = max(start, geometry.contentSize.height - geometry.containerSize.height + geometry.contentInsets.bottom)
                let overflows = end > start + 1
                return Edges(top: overflows && geometry.contentOffset.y > start + 1,
                             bottom: overflows && geometry.contentOffset.y < end - 1)
            } action: { _, next in edges = next }
            .overlay(alignment: .top) { fade(top: true).opacity(edges.top ? 1 : 0) }
            .overlay(alignment: .bottom) { fade(top: false).opacity(edges.bottom ? 1 : 0) }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: edges)
    }
    private func fade(top: Bool) -> some View {
        let background = Color(.systemBackground)
        return LinearGradient(colors: top ? [background, background.opacity(0)] : [background.opacity(0), background],
                              startPoint: .top, endPoint: .bottom)
            .frame(height: 24)
            .allowsHitTesting(false).accessibilityHidden(true)
    }
}

struct WorkspaceLabel: View {
    let session: BackendSession
    let workspace: Workspace
    var body: some View {
        let project = session.projects.first { $0.id == workspace.projectId }
        let git = session.gitStates.first { $0.workspaceId == workspace.id }
        HStack(alignment: .top, spacing: 9) {
            RegistryIcon(token: project?.icon, size: 17).padding(.top, 3)
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
