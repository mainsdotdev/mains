import SwiftUI
import UIKit

struct MatesView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    private enum ArchiveRoute: Hashable { case mate(String), details(String) }

    let session: BackendSession
    @Binding var showingArchive: Bool
    let openMate: (String) -> Void
    let navigateFromArchive: (AppRoute) -> Void
    let newMate: ([MateTeam]) -> Void
    @State private var archivePath: [ArchiveRoute] = []
    @State private var routeAfterArchive: (owner: Int, route: AppRoute)?

    var body: some View {
        MateDirectoryView(session: session, archived: false, openMate: openMate, newMate: newMate)
            .scrollingNavigationTitle("Mates")
            .toolbar {
                if session.supportsMateInfo {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Archived Mates", systemImage: "archivebox") { showingArchive = true }
                            .accessibilityIdentifier("openArchivedMates")
                    }
                }
            }
            .fullScreenCover(isPresented: $showingArchive, onDismiss: finishArchive) {
                NavigationStack(path: $archivePath) {
                    MateDirectoryView(session: session, archived: true, openMate: { archivePath.append(.mate($0)) })
                        .expandedNavigationTitle("Archived Mates")
                        .toolbar { closeArchiveButton }
                        .navigationDestination(for: ArchiveRoute.self) { route in
                            switch route {
                            case .mate(let id):
                                MateView(session: session, mateID: id, openChat: { runID in
                                    leaveArchive(for: .conversation(runID, mate: .profile(id)))
                                }, openInfo: { archivePath.append(.details(id)) }, closeArchive: { showingArchive = false })
                            case .details(let id):
                                MateInfoView(session: session, mateID: id, openChat: { runID, mateID in
                                    leaveArchive(for: .conversation(runID, mate: mateID.map(MateConversationSource.profile) ?? .assignment))
                                })
                                .toolbar { closeArchiveButton }
                            }
                        }
                }
                .accessibilityAction(.escape) { showingArchive = false }
            }
    }

    private var closeArchiveButton: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            archiveDismissButton { showingArchive = false }
        }
    }

    private func leaveArchive(for route: AppRoute) {
        routeAfterArchive = (session.ownership, route)
        showingArchive = false
    }

    private func finishArchive() {
        archivePath = []
        let next = routeAfterArchive
        routeAfterArchive = nil
        if let next, next.owner == session.ownership { navigateFromArchive(next.route) }
    }
}

@MainActor private func archiveDismissButton(action: @escaping () -> Void) -> some View {
    Button("Close Archived Mates", systemImage: "xmark", action: action)
        .labelStyle(.iconOnly)
        .accessibilityIdentifier("closeArchivedMates")
}

private struct MateDirectoryView: View {
    private static let avatarSize: CGFloat = 64
    private static let avatarSpacing: CGFloat = 12

    let session: BackendSession
    let archived: Bool
    let openMate: (String) -> Void
    var newMate: (([MateTeam]) -> Void)? = nil
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var directory: MateDirectory?
    @State private var error: String?
    @State private var reload = 0
    @State private var query = ""

    private var canCreateMate: Bool {
        newMate != nil && directory != nil && session.isConnected && !session.mateCommandPending
    }
    private var disconnectedWithoutMates: Bool { !session.isConnected && directory?.mates.isEmpty != false }
    private var canChangeMatePin: Bool { session.isConnected && session.supportsMatePinning && !session.mateCommandPending }

    var body: some View {
        let matches = directory.map(matchingMates)
        Group {
            if disconnectedWithoutMates || matches?.isEmpty == true {
                EmptyStateLayout {
                    if !archived {
                        PageTitle("Mates")
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 20).padding(.top, 8)
                    }
                } content: {
                    emptyDirectory
                }
                .background(Color(.systemGroupedBackground))
            } else if archived {
                directoryList(matches: matches ?? [], activity: [:])
            } else {
                TimelineView(.periodic(from: .now, by: 15)) { clock in
                    let activity = session.isConnected && session.workInboxIsCurrent
                        ? session.workInbox.mateActivity(now: clock.date) : [:]
                    directoryList(matches: matches ?? [], activity: activity)
                }
            }
        }
        .navigationHeaderFade(background: Color(.systemGroupedBackground))
        .searchable(text: $query, placement: .toolbar, prompt: archived ? "Search archived Mates" : "Search Mates")
        .toolbar {
            DefaultToolbarItem(kind: .search, placement: .bottomBar)
            if !archived && directory?.mates.isEmpty == false {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New Mate", systemImage: "plus", action: startNewMate)
                        .disabled(!canCreateMate)
                        .accessibilityIdentifier("newMate")
                }
            }
        }
        .task(id: "\(session.ownership):\(session.isConnected):\(session.matesRevision):\(reload)") { await load() }
        .pullToRefresh {
            reload += 1
            if !archived { await session.refreshWorkInbox() }
        }
    }

    private func directoryList(matches: [Mate], activity: [String: MateActivity]) -> some View {
        List {
            if !archived { Section { PageTitle("Mates").listRow } }
            directoryStatus
            if let directory {
                mateSections(directory, matches: matches, activity: activity)
            } else if error == nil {
                ContentSkeleton(label: archived ? "Loading archived Mates…" : "Loading Mates…").listRow
            }
        }
        .contentMargins(.top, 8, for: .scrollContent)
    }

    @ViewBuilder private var emptyDirectory: some View {
        if disconnectedWithoutMates {
            DisconnectedState(message: "Connect to your computer to use Mates.")
        } else {
            VStack(spacing: 16) {
                directoryStatus
                if directory?.mates.isEmpty == true {
                    if archived { EmptyStateView(artwork: .mates, title: "No archived Mates") }
                    else { emptyMates.padding(24) }
                } else {
                    EmptyStateView(artwork: .search, title: "No matching Mates")
                }
            }
        }
    }

    @ViewBuilder private var directoryStatus: some View {
        if session.mateCommandUncertain {
            Button("Check Mate change", systemImage: "arrow.clockwise") {
                Task {
                    do { try await session.checkMateCommand(); error = nil }
                    catch { self.error = error.localizedDescription }
                }
            }.disabled(!session.isConnected)
        }
        if !session.isConnected {
            Label("Connect to your computer to refresh Mates.", systemImage: "wifi.slash").foregroundStyle(.secondary)
        } else if let error { Text(error).foregroundStyle(.secondary) }
    }

    private var emptyMates: some View {
        VStack(spacing: 20) {
            EmptyStateIllustration(artwork: .mates)

            VStack(spacing: 8) {
                Text("Your mates").font(.title2.weight(.semibold).width(.expanded))
                    .accessibilityAddTraits(.isHeader)
                Text("Create a mate, then start a conversation. Your team can share memory and work together.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            .frame(maxWidth: 290)

            Button(action: startNewMate) {
                HStack(spacing: 10) {
                    Text("New Mate")
                    Image(systemName: "arrow.right")
                        .font(.subheadline.weight(.semibold))
                        .accessibilityHidden(true)
                }
            }
            .buttonStyle(.glass)
            .controlSize(.large)
            .disabled(!canCreateMate)
            .accessibilityIdentifier("emptyStateNewMate")
        }
        .multilineTextAlignment(.center)
    }

    private func startNewMate() {
        guard canCreateMate, let directory else { return }
        newMate?(directory.teams)
    }

    private func matchingMates(in directory: MateDirectory) -> [Mate] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return directory.mates }
        let teamNames = Dictionary(directory.teams.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        return directory.mates.filter { mate in
            let teamName = mate.teamId.map { teamNames[$0] ?? "Unavailable team" } ?? "No team"
            return [mate.name, mate.description, teamName].contains { $0.localizedStandardContains(term) }
        }
    }

    @ViewBuilder private func mateSections(_ directory: MateDirectory, matches: [Mate], activity: [String: MateActivity]) -> some View {
        let teamNames = Dictionary(directory.teams.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        let pinned = archived ? [] : matches.filter { $0.pinnedAt != nil }.sorted { first, second in
            let firstDate = first.pinnedAt ?? .distantPast
            let secondDate = second.pinnedAt ?? .distantPast
            return firstDate == secondDate ? first.id < second.id : firstDate > secondDate
        }
        let regular = archived ? matches : matches.filter { $0.pinnedAt == nil }
        let members = Dictionary(grouping: regular, by: \.teamId)
        var seen: Set<String> = []
        let teamIDs = directory.mates.compactMap(\.teamId).filter { seen.insert($0).inserted }

        if !pinned.isEmpty {
            Section {
                if dynamicTypeSize.isAccessibilitySize {
                    mateRows(pinned, activity: activity)
                } else {
                    pinnedMateGrid(pinned, activity: activity)
                }
            } header: {
                directorySectionHeading("Pinned")
            }
        }
        ForEach(teamIDs.filter { members[$0] != nil }, id: \.self) { teamID in
            Section {
                mateRows(members[teamID] ?? [], activity: activity)
            } header: {
                directorySectionHeading(teamNames[teamID] ?? "Unavailable team")
            }
        }
        if let unassigned = members[nil] {
            if teamIDs.isEmpty { mateRows(unassigned, activity: activity) }
            else { Section { mateRows(unassigned, activity: activity) } header: { directorySectionHeading("No team") } }
        }
    }

    private func directorySectionHeading(_ title: String) -> some View {
        MateSectionHeading(title).listRowInsets(.horizontal, 0)
    }

    private func pinnedMateGrid(_ mates: [Mate], activity: [String: MateActivity]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(minimum: 0), spacing: 12, alignment: .top), count: 3), spacing: 14) {
            ForEach(mates) { mate in
                let status = activity[mate.id]
                PinnedMateTile(mate: mate, activityText: status.map(mateActivityText),
                               canUnpin: canChangeMatePin, onOpen: { openMate(mate.id) },
                               onUnpin: session.supportsMatePinning ? { setMatePinned(mate, pinned: false) } : nil) {
                    VStack(spacing: 5) {
                        MateRobotThumbnail(preset: MateRobotAssets.catalogue?.preset(for: mate.avatar, mateID: mate.id))
                            .frame(width: Self.avatarSize, height: Self.avatarSize)
                        Text(mate.name).font(.subheadline.weight(.medium)).lineLimit(1)
                        if mate.needsSetup {
                            Text("Finish setup").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        } else if let status {
                            mateActivityLabel(status).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 12, trailing: 0))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    @ViewBuilder private func matePinAction(_ mate: Mate) -> some View {
        if !archived, session.supportsMatePinning {
            let pin = mate.pinnedAt == nil
            Button(pin ? "Pin \(mate.name)" : "Unpin \(mate.name)", systemImage: pin ? "pin" : "pin.slash") {
                setMatePinned(mate, pinned: pin)
            }
            .disabled(!canChangeMatePin)
        }
    }

    private func setMatePinned(_ mate: Mate, pinned: Bool) {
        guard canChangeMatePin else { return }
        let owner = session.ownership
        Task {
            guard owner == session.ownership else { return }
            do {
                try await session.manageMate(mate.id, change: .setPinned(pinned))
                if owner == session.ownership { error = nil }
            } catch {
                if owner == session.ownership { self.error = error.localizedDescription }
            }
        }
    }

    private func mateRows(_ mates: [Mate], activity: [String: MateActivity]) -> some View {
        ForEach(mates) { mate in
            Button { openMate(mate.id) } label: {
                HStack(spacing: 12) {
                    HStack(alignment: .top, spacing: Self.avatarSpacing) {
                        MateRobotThumbnail(preset: MateRobotAssets.catalogue?.preset(for: mate.avatar, mateID: mate.id))
                            .frame(width: Self.avatarSize, height: Self.avatarSize)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(mate.name).font(.body.weight(.medium))
                            if mate.needsSetup {
                                HStack(spacing: 6) {
                                    Text("Finish setup").font(.subheadline).foregroundStyle(.secondary)
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .font(.caption).foregroundStyle(.orange).accessibilityHidden(true)
                                }
                            } else if !mate.description.isEmpty {
                                Text(mate.description).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                            }
                            if let status = activity[mate.id] { mateActivityLabel(status) }
                        }
                        .padding(.top, 3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary).accessibilityHidden(true)
                }
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 11)
                .padding(.trailing, 6)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .contextMenu { matePinAction(mate) }
            .overlay(alignment: .bottom) {
                if mate.id != mates.last?.id {
                    Divider()
                        .padding(.leading, Self.avatarSize + Self.avatarSpacing)
                        .allowsHitTesting(false)
                }
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .accessibilityIdentifier("mate-\(mate.id)")
        }
    }

    private func mateActivityText(_ status: MateActivity) -> String { status == .needsYou ? "Needs you" : "Working" }

    private func mateActivityLabel(_ status: MateActivity) -> some View {
        HStack(spacing: 5) {
            Circle().fill(status == .needsYou ? Color.orange : .blue)
                .frame(width: 6, height: 6).accessibilityHidden(true)
            Text(mateActivityText(status))
                .font(.caption.weight(.medium))
        }
    }

    private func load() async {
        let owner = session.ownership
        guard session.isConnected else { return }
        do {
            let result = try await session.loadMates(archived: archived)
            guard !Task.isCancelled, owner == session.ownership else { return }
            directory = result
            error = nil
        } catch {
            if !Task.isCancelled, owner == session.ownership { self.error = error.localizedDescription }
        }
    }
}

// SwiftUI merges context menus inside a single List row. The native button
// owns the interaction and previews only the tile it hosts.
private struct PinnedMateTile<Label: View>: UIViewRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let mate: Mate
    let activityText: String?
    let canUnpin: Bool
    let onOpen: () -> Void
    let onUnpin: (() -> Void)?
    @ViewBuilder let label: () -> Label

    struct MenuState: Equatable {
        let title: String
        let isEnabled: Bool
    }

    @MainActor final class Coordinator {
        var hostedLabel: (UIView & UIContentView)?
        var onOpen: (() -> Void)?
        var onUnpin: (() -> Void)?
        var menuState: MenuState?
    }

    private var labelConfiguration: UIHostingConfiguration<Label, EmptyView> {
        UIHostingConfiguration(content: label).margins(.all, 0).minSize(width: 0, height: 0)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .custom)
        let hostedLabel = labelConfiguration.makeContentView()
        context.coordinator.hostedLabel = hostedLabel
        hostedLabel.isUserInteractionEnabled = false
        hostedLabel.accessibilityElementsHidden = true
        hostedLabel.translatesAutoresizingMaskIntoConstraints = false
        button.addSubview(hostedLabel)
        NSLayoutConstraint.activate([
            hostedLabel.topAnchor.constraint(equalTo: button.topAnchor),
            hostedLabel.leadingAnchor.constraint(equalTo: button.leadingAnchor),
            hostedLabel.trailingAnchor.constraint(equalTo: button.trailingAnchor),
            hostedLabel.bottomAnchor.constraint(equalTo: button.bottomAnchor),
        ])
        button.addAction(UIAction { [weak coordinator = context.coordinator] _ in coordinator?.onOpen?() }, for: .touchUpInside)
        return button
    }

    func updateUIView(_ button: UIButton, context: Context) {
        let coordinator = context.coordinator
        coordinator.hostedLabel?.configuration = labelConfiguration
        coordinator.onOpen = onOpen
        coordinator.onUnpin = onUnpin
        button.accessibilityIdentifier = "mate-\(mate.id)"
        button.accessibilityLabel = mate.name
        button.accessibilityValue = mate.needsSetup ? "Finish setup" : activityText

        let menu = onUnpin.map { _ in MenuState(title: "Unpin \(mate.name)", isEnabled: canUnpin) }
        if menu != coordinator.menuState {
            coordinator.menuState = menu
            button.menu = menu.map { state in
                UIMenu(children: [UIAction(title: state.title, image: UIImage(systemName: "pin.slash"), attributes: state.isEnabled ? [] : .disabled) { [weak coordinator] _ in
                    coordinator?.onUnpin?()
                }])
            }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIButton, context: Context) -> CGSize? {
        guard let width = proposal.width, width.isFinite, let label = context.coordinator.hostedLabel else { return nil }
        let fittingSize = CGSize(width: width, height: UIView.layoutFittingCompressedSize.height)
        return label.systemLayoutSizeFitting(fittingSize, withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
    }
}

struct NewMateDraft {
    var name = ""
    var avatar = MateRobotAssets.catalogue?.defaultPreset?.avatar ?? MateAvatar(shape: "terminal-amber", color: "amber")
    var rememberedStyles: [String: String] = [:]
    var team = MateTeamSelection()
    var spaceID: String?
    var settings: ComposerSettings?

    var hasValidName: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.utf16.count <= 100
    }
}

struct NewMateView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let teams: [MateTeam]
    @Binding var draft: NewMateDraft
    let create: (NewMateCreationRequest) -> Void
    let created: (String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Namespace private var providerSelection
    @FocusState private var editingName: Bool
    @State private var previewActive = false
    @State private var choosingModel = false
    @State private var showingTeamEditor = false
    @State private var error: String?

    var body: some View {
        ZStack {
            // Draw on the moving page, including the area behind the status bar.
            MateAvatarBackdrop(avatar: draft.avatar)
            form
        }
        .background(alignment: .center) {
            MatePickerAppearance(isVisible: $previewActive)
                .frame(width: 0, height: 0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .mateCreationChrome(choosingModel ? "Model & Effort" : "New Mate", extendsBackdrop: true)
        .navigationBarBackButtonHidden(choosingModel)
        .toolbar {
            if choosingModel && !writing {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Back", systemImage: "chevron.backward") { showModelOptions(false) }
                        .labelStyle(.iconOnly)
                        .accessibilityIdentifier("BackButton")
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                if choosingModel {
                    Button("Create", action: beginCreation)
                        .disabled(!canCreate)
                        .accessibilityIdentifier("createMate")
                } else {
                    Button("Next") { showModelOptions(true) }
                        .disabled(!draft.hasValidName || session.pendingMateTeamName != nil)
                        .accessibilityIdentifier("nextMateStep")
                }
            }
        }
        .task(id: "\(choosingModel):\(space?.providerId ?? ""):\(session.isConnected)") {
            if choosingModel, let space, session.isConnected { await session.loadModels(space.providerId) }
        }
        .sheet(isPresented: $showingTeamEditor) {
            MateTeamEditor(session: session) { draft.team.select($0) }
        }
    }

    private func showModelOptions(_ visible: Bool) {
        editingName = false
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.28)) {
            choosingModel = visible
        }
    }

    private var form: some View {
        GeometryReader { geometry in
            let avatarHeight = min(330, max(220, geometry.size.width * 0.78))
            let restingInset = max(16, (geometry.size.height - avatarHeight - 216) / 2)
            ScrollView {
                VStack(spacing: 0) {
                    nameHeading

                    if let catalogue = MateRobotAssets.catalogue {
                        MateRobotPicker(catalogue: catalogue, avatar: $draft.avatar,
                                        remembered: $draft.rememberedStyles, stageHeight: avatarHeight,
                                        previewActive: previewActive, isSelecting: !choosingModel)
                    } else {
                        MateRobotThumbnail(preset: nil).frame(height: avatarHeight)
                    }

                    if choosingModel {
                        modelOptions.transition(.opacity)
                    } else {
                        appearanceOptions.transition(.opacity)
                    }
                }
                .padding(.top, choosingModel ? max(12, restingInset - 72) : restingInset)
                .padding(.bottom, 16)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height, alignment: .top)
                .background(alignment: .center) { KeyboardDismissBackground(dismissFocus: { editingName = false }) }
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
    }

    private var nameHeading: some View {
        ZStack {
            TextField("Mate name", text: $draft.name,
                      prompt: Text("Mate name").foregroundStyle(Color.primary.opacity(0.74)))
                .textFieldStyle(.plain)
                .textInputAutocapitalization(.words)
                .submitLabel(.done)
                .focused($editingName)
                .onSubmit { editingName = false }
                .opacity(choosingModel ? 0 : 1)
                .allowsHitTesting(!choosingModel)
                .accessibilityHidden(choosingModel)
                .accessibilityIdentifier("mateName")
            if choosingModel {
                Text(draft.name)
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("newMateNamePreview")
            }
        }
        .font(.largeTitle.weight(.semibold).width(.expanded))
        .multilineTextAlignment(.center)
        .foregroundStyle(.primary)
        .padding(.horizontal, 24)
        .frame(maxWidth: 460, minHeight: 52)
    }

    private var appearanceOptions: some View {
        VStack(spacing: 20) {
            if MateRobotAssets.catalogue != nil {
                Text("Swipe to choose. Hold and drag to rotate.")
                    .font(.caption).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            teamMenu.frame(maxWidth: 230).padding(.horizontal, 24)
        }
        .padding(.top, 12)
    }

    private var teamMenu: some View {
        MateTeamPicker(session: session, teams: teams, selection: $draft.team, openEditor: {
            editingName = false
            showingTeamEditor = true
        }) { teamName in
            mateCreationChoiceLabel(teamName, icon: "icon:users")
        }
    }
}

struct MatePickerAppearance: UIViewControllerRepresentable {
    @Binding var isVisible: Bool

    func makeUIViewController(context: Context) -> Controller {
        Controller(isVisible: $isVisible)
    }

    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.isVisible = $isVisible
    }

    final class Controller: UIViewController {
        var isVisible: Binding<Bool>

        init(isVisible: Binding<Bool>) {
            self.isVisible = isVisible
            super.init(nibName: nil, bundle: nil)
        }

        required init?(coder: NSCoder) { nil }

        // Keep WebKit creation off the push and pop animations.
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            isVisible.wrappedValue = true
        }

        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            isVisible.wrappedValue = false
        }
    }
}

struct MateAvatarBackdrop: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let avatar: MateAvatar
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme

    private static let topTintOpacity = 0.43

    // Reuse one static tile so the grain stays still during scrolling and avatar changes.
    private static let grain: CGImage? = {
        let side = 256
        var seed: UInt32 = 1
        let pixels = (0..<(side * side)).map { _ -> UInt8 in
            seed = seed &* 1_664_525 &+ 1_013_904_223
            return UInt8(seed >> 24)
        }
        guard let provider = CGDataProvider(data: Data(pixels) as CFData) else { return nil }
        return CGImage(width: side, height: side, bitsPerComponent: 8, bitsPerPixel: 8,
                       bytesPerRow: side, space: CGColorSpaceCreateDeviceGray(),
                       bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                       provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }()

    private static func tint(for avatar: MateAvatar) -> Color {
        // Silver's catalogue tint follows the green iris. Use the casing color here.
        avatar.shape == "metal-silver"
            ? Color(red: 0.49, green: 0.62, blue: 0.73)
            : MateRobotAssets.chatTint(for: avatar)
    }

    private static func tintStrength(in scheme: ColorScheme) -> Double {
        scheme == .light ? 0.55 : 1
    }

    static func headerFill(for avatar: MateAvatar, in scheme: ColorScheme) -> Color {
        Color(.systemBackground).mix(with: tint(for: avatar), by: topTintOpacity * tintStrength(in: scheme), in: .device)
    }

    var body: some View {
        let tint = Self.tint(for: avatar)
        Rectangle()
            .fill(tint)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.32), value: tint)
            .overlay {
                if let grain = Self.grain {
                    Image(decorative: grain, scale: 2)
                        .resizable(resizingMode: .tile)
                        .interpolation(.none)
                        .opacity(0.16)
                        .blendMode(.softLight)
                }
            }
            .compositingGroup()
            .mask(alignment: .center) {
                LinearGradient(stops: [
                    .init(color: .white.opacity(Self.topTintOpacity), location: 0),
                    .init(color: .white.opacity(Self.topTintOpacity), location: 0.18),
                    .init(color: .white.opacity(0.37), location: 0.34),
                    .init(color: .white.opacity(0.19), location: 0.52),
                    .init(color: .white.opacity(0.06), location: 0.69),
                    .init(color: .clear, location: 0.84)
                ], startPoint: .topLeading, endPoint: UnitPoint(x: 0.74, y: 0.82))
            }
            .opacity(Self.tintStrength(in: colorScheme))
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

private extension NewMateView {
    private var spaces: [Space] { session.mateSpaces }
    private var space: Space? { spaces.first { $0.id == draft.spaceID } ?? spaces.first }
    private var providerSpaces: [Space] { spaces.filter { $0.providerId == space?.providerId } }
    private var models: [ModelChoice] { space.flatMap { session.models[$0.providerId] } ?? [] }
    private var preferredSettings: ComposerSettings { draft.settings ?? space.map { session.settings(for: $0) } ?? .init() }
    private var model: ModelChoice? {
        let preferredModel = preferredSettings.model
        return models.first { $0.id == preferredModel }
            ?? models.first { $0.id == space?.model }
            ?? models.first { $0.isDefault == true } ?? models.first
    }
    private var settings: ComposerSettings {
        guard let space, let model else { return preferredSettings }
        return mateSettings(preferredSettings, selecting: model, provider: space.providerId)
    }
    private var writing: Bool { session.mateCommandPending && !session.mateCommandUncertain }
    private var canCreate: Bool {
        draft.hasValidName && model != nil && session.isConnected && !session.mateCommandPending
    }

    var modelOptions: some View {
        VStack(spacing: 4) {
            providerTabs
            if providerSpaces.count > 1 {
                spaceMenu.padding(.horizontal, 24).padding(.top, 2)
            }
            modelSelection.frame(maxWidth: 520)
        }
    }

    private var modelSelection: some View {
        VStack(spacing: 12) {
            if let space {
                ModelEffortPicker(providerID: space.providerId, models: models, model: model, settings: settings,
                                  loading: ComposerContext(space: space).modelsLoading(session), enabled: session.isConnected && !writing,
                                  storedEffortOnly: true, compactWheel: true, error: session.modelErrors[space.providerId],
                                  canRetry: session.isConnected && !writing,
                                  retry: { Task { await session.loadModels(space.providerId, force: true) } },
                                  selectModel: { model in
                                      var next = preferredSettings
                                      next.select(model, provider: space.providerId)
                                      draft.settings = next
                                  }, updateEffort: { draft.settings = $0 })
                    .id(space.id)
            } else {
                Text("Enable a Claude or Codex Space on your computer.")
                    .foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 24)
            }

            if writing { Text("Checking creation…").font(.footnote).foregroundStyle(.secondary) }
            if let error { Text(error).foregroundStyle(.secondary).padding(.horizontal, 24) }
            if session.mateCommandUncertain {
                Button("Check creation") { Task { await checkCreation() } }.disabled(!session.isConnected)
            }
        }
    }

    private var providerTabs: some View {
        let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            ForEach(["codex", "claude_code"], id: \.self) { provider in
                let isClaude = provider == "claude_code"
                let title = isClaude ? "Claude" : "Codex"
                let selected = space?.providerId == provider
                let candidate = spaces.first { $0.providerId == provider }
                let iconTint: Color = isClaude ? Provider.accent(provider) : selected ? .primary : .primary.opacity(0.8)
                Button {
                    if let candidate, !selected { selectSpace(candidate) }
                } label: {
                    GlassSelectionTab(title: title, selected: selected, showLabel: true,
                                      selection: providerSelection) {
                        RegistryIcon(token: isClaude ? "icon:claude" : "icon:codex", size: 22, tint: iconTint, useStoredColor: false)
                    }
                }
                .buttonStyle(ChatPressStyle())
                .disabled(candidate == nil || writing)
                .accessibilityLabel(title).accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("mate-provider-\(provider)")
            }
        }
        .fixedSize(horizontal: true, vertical: false)
        .animation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.94), value: space?.providerId)
        .accessibilityElement(children: .contain).accessibilityLabel("Provider")
    }

    private var spaceMenu: some View {
        Menu {
            ForEach(providerSpaces) { candidate in
                Button { selectSpace(candidate) } label: {
                    if candidate.id == space?.id { Label(candidate.name, systemImage: "checkmark") }
                    else { Text(candidate.name) }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text("Space").foregroundStyle(.secondary)
                Text(space?.name ?? "").lineLimit(1)
                Image(systemName: "chevron.down").font(.caption2).foregroundStyle(.secondary)
            }
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 12).frame(minHeight: 44).contentShape(.rect)
        }
        .accessibilityLabel("Space")
        .accessibilityValue(space?.name ?? "")
        .disabled(writing)
    }

    private func selectSpace(_ candidate: Space) {
        guard candidate.id != space?.id else { return }
        draft.spaceID = candidate.id
        draft.settings = nil
    }

    private func beginCreation() {
        guard canCreate, let space, let model else { return }
        error = nil
        create(NewMateCreationRequest(owner: session.ownership, name: draft.name, space: space, model: model.id,
                                      effort: settings.effort(provider: space.providerId), teamID: draft.team.id, avatar: draft.avatar))
    }

    private func checkCreation() async {
        let owner = session.ownership
        do {
            let id = try await session.checkMateCommand()
            guard owner == session.ownership else { return }
            if let id { created(id) } else { showModelOptions(false) }
        } catch { if owner == session.ownership { self.error = error.localizedDescription } }
    }
}

func mateSettings(_ current: ComposerSettings, selecting model: ModelChoice, provider: String) -> ComposerSettings {
    var result = current
    let levels = EffortControlKind.ordered(model.supportedEffortLevels ?? [])
    result.select(model, provider: provider)
    let effort = result.effort(provider: provider)
    if !levels.contains(effort) {
        let compatible = if provider == "codex", levels.count > 1 {
            levels.contains("medium") ? "medium" : levels[0]
        } else if effort == "ultracode", levels.contains("xhigh") { "xhigh" }
        else { "" }
        result.setEffort(compatible, provider: provider)
    }
    return result
}

struct NewMateCreationRequest: Hashable {
    let id = UUID()
    let owner: Int
    let name: String
    let space: Space
    let model: String
    let effort: String
    let teamID: String?
    let avatar: MateAvatar

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct CreatingMateView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let request: NewMateCreationRequest
    let created: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var started = false
    @State private var error: String?

    private var working: Bool { error == nil }

    var body: some View {
        GeometryReader { geometry in
            let size = min(280, geometry.size.width * 0.68, geometry.size.height * 0.54)
            ScrollView {
                VStack(spacing: 14) {
                    ZStack {
                        RadialGradient(colors: [MateRobotAssets.chatTint(for: request.avatar).opacity(0.16), .clear],
                                       center: .center, startRadius: 8, endRadius: size * 0.56)
                        if let preset = MateRobotAssets.catalogue?.preset(for: request.avatar, mateID: request.name) {
                            MateRobotPreview(preset: preset, acceptsDrag: false, animates: false, motion: working ? .creating : .idle)
                        } else {
                            MateRobotThumbnail(preset: nil)
                        }
                    }
                    .frame(width: size, height: size)
                    .accessibilityHidden(true)

                    if let error {
                        Text(error).font(.subheadline).foregroundStyle(.secondary)
                        if session.mateCommandUncertain {
                            Button("Check creation") { Task { await submit(checking: true) } }
                                .disabled(!session.isConnected)
                        }
                    } else {
                        Text("Creating Mate…").font(.headline.width(.expanded)).foregroundStyle(.secondary)
                            .accessibilityIdentifier("creatingMateStatus")
                    }
                }
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .mateCreationChrome("Creating Mate")
        .toolbarVisibility(working ? .hidden : .visible, for: .navigationBar)
        .navigationBarBackButtonHidden(working)
        .onAppear {
            guard !started else { return }
            started = true
            Task { await submit() }
        }
    }

    private func submit(checking: Bool = false) async {
        guard request.owner == session.ownership,
              !checking || (error != nil && session.mateCommandUncertain && session.isConnected) else { return }
        let visibleUntil = ContinuousClock.now + .milliseconds(850)
        error = nil
        do {
            let id = if checking { try await session.checkMateCommand() }
            else {
                try await session.createMate(name: request.name, space: request.space, model: request.model,
                                             effort: request.effort, teamID: request.teamID, avatar: request.avatar)
            }
            // Give the pushed screen time to appear when the host acknowledges immediately.
            if id != nil { try? await Task.sleep(until: visibleUntil, clock: .continuous) }
            guard request.owner == session.ownership else { return }
            if let id { created(id) } else { dismiss() }
        } catch { if request.owner == session.ownership { self.error = error.localizedDescription } }
    }
}

extension View {
    func mateCreationChrome(_ title: String, extendsBackdrop: Bool = false) -> some View {
        // The page carries its own fill through the push and pop transitions.
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            if extendsBackdrop {
                self.scrollEdgeEffectHidden(for: .top).toolbarBackground(.hidden, for: .navigationBar)
            } else {
                self.navigationHeaderFade()
            }
        }
        .tint(.primary)
        .expandedNavigationTitle(title)
    }
}

@MainActor func mateCreationChoiceLabel(_ name: String, icon: String) -> some View {
    HStack(spacing: 7) {
        RegistryIcon(token: icon, fallback: "person.2", size: 15, tint: .primary, useStoredColor: false)
        Text(name).lineLimit(1)
        Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundStyle(.secondary)
    }
    .font(.subheadline.weight(.medium))
    .foregroundStyle(.primary)
    .padding(.horizontal, 12)
    .frame(maxWidth: .infinity, minHeight: 44)
    .modifier(GlassSurface(radius: 22))
}

struct MateView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let mateID: String
    let openChat: (String) -> Void
    let openInfo: () -> Void
    var closeArchive: (() -> Void)? = nil
    private struct SetupReply {
        let step: Int
        let turn: MateWelcome.Turn
    }
    private enum ProfileField: Hashable { case description, instructions }
    @State private var mate: Mate?
    @State private var chats: [MateChat] = []
    @State private var answer = ""
    @State private var submittedSetup: SetupReply?
    @State private var editedProfile: MateProfile?
    @FocusState private var focusedProfileField: ProfileField?
    @FocusState private var setupAnswerFocused: Bool
    @State private var savingProfile = false
    @State private var draft = ConversationDraft()
    @State private var error: String?
    @State private var loading = true
    @State private var reload = 0
    @State private var consent: ConsentContext?
    @State private var afterConsent: (() -> Void)?
    @State private var composerFocused = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.calendar) private var calendar
    @Environment(\.colorScheme) private var colorScheme
    private var showsSetup: Bool {
        guard let mate else { return false }
        return mate.welcome?.question?.profileSetup != nil && (!mate.ready || chats.isEmpty)
    }

    var body: some View {
        let title = showsSetup ? Text(mate?.name ?? "Mate") : Text("Chats")
        Group {
            if !session.isConnected {
                DisconnectedState(message: "Connect to your computer to view this Mate’s chats.")
                    .centered.background(Color(.systemGroupedBackground))
            } else if showsSetup, let mate, let welcome = mate.welcome, let question = welcome.question, let setup = question.profileSetup {
                setupConversation(mate, welcome, question, setup)
            } else {
                mateDetails
            }
        }
        .environment(\.mateChatTint, mate.map { MateRobotAssets.chatTint(for: $0.avatar) })
        .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if session.isConnected, showsSetup, let mate {
                ToolbarItem(placement: .principal) { MateConversationTitle(mate: mate) }
                    .sharedBackgroundVisibility(.hidden)
            } else {
                ToolbarItem(placement: .title) {
                    title.font(.headline.weight(.medium).width(.expanded)).lineLimit(1)
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                if session.isConnected, !showsSetup, mate != nil {
                    Button("Mate Details", systemImage: "info.circle", action: openInfo)
                        .accessibilityIdentifier("openMateInfo")
                }
                if let closeArchive { archiveDismissButton(action: closeArchive) }
            }
        }
        .task(id: "\(session.ownership):\(session.isConnected):\(session.matesRevision):\(reload)") { await load() }
        .pullToRefresh { reload += 1 }
        .sheet(item: $consent, onDismiss: { afterConsent = nil }) { consent in
            ConsentView(context: consent) {
                guard consent.backendID == session.pairing?.descriptor.backendId else { return }
                session.grantConsent(providerID: consent.providerID, backendID: consent.backendID)
                afterConsent?()
            }
        }
    }

    private var mateDetails: some View {
        let headerFill = mate.map { MateAvatarBackdrop.headerFill(for: $0.avatar, in: colorScheme) } ?? Color(.systemBackground)
        return VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let error { Text(error).foregroundStyle(.secondary) }
                    if session.mateCommandUncertain { checkMateChange }
                    if let mate {
                        mateSummary(mate)
                        if mate.ready, let welcome = mate.welcome { welcomeSection(mate, welcome) }
                        if mate.ready || mate.isArchived == true {
                            VStack(alignment: .leading, spacing: 0) {
                                if !composerFocused {
                                    mateChatHistory(mate)
                                        .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: -8)))
                                }
                            }
                            .animation(.easeInOut(duration: 0.2), value: composerFocused)
                            .allowsHitTesting(!composerFocused)
                            .accessibilityHidden(composerFocused)
                        } else {
                            ContentSkeleton(label: "Loading profile setup…", layout: .text)
                        }
                    } else if loading {
                        ContentSkeleton(label: "Loading Mate…")
                    }
                }
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
            }
            .navigationHeaderFade(background: headerFill, coversSafeAreaAtRest: false)
            .scrollDismissesKeyboard(.interactively)
            .contentShape(.rect)
            .simultaneousGesture(TapGesture().onEnded {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }, isEnabled: composerFocused)
            if let mate, mate.ready {
                firstTaskComposer(mate) { composerFocused = $0 }
                    .onDisappear { composerFocused = false }
            }
        }
        .background(alignment: .center) {
            Color(.systemBackground).ignoresSafeArea()
            if let mate { MateAvatarBackdrop(avatar: mate.avatar) }
        }
    }

    private func mateSummary(_ mate: Mate) -> some View {
        VStack(spacing: 8) {
            if let preset = MateRobotAssets.catalogue?.preset(for: mate.avatar, mateID: mate.id) {
                MateRobotPreview(preset: preset).frame(width: 120, height: 120)
            }
            Text(mate.name)
                .font(.title2.weight(.semibold).width(.expanded))
                .frame(maxWidth: 460)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("mateChatsName")
            if !mate.description.isEmpty {
                Text(mate.description).font(.subheadline).foregroundStyle(.secondary)
                    .frame(maxWidth: 460)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private func mateChatHistory(_ mate: Mate) -> some View {
        let history = chats.filter { mate.showsChat($0) }.sorted { $0.updatedAt > $1.updatedAt }
        let days = Dictionary(grouping: history) { calendar.startOfDay(for: $0.updatedAt) }
        return TimelineView(.periodic(from: .now, by: 60)) { clock in
            VStack(alignment: .leading, spacing: 16) {
                if history.isEmpty {
                    Text("No chats yet").font(.subheadline).foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                }
                ForEach(days.keys.sorted(by: >), id: \.self) { day in
                    VStack(alignment: .leading, spacing: 0) {
                        chatDayTitle(day, now: clock.date)
                            .font(.footnote.weight(.semibold).width(.expanded))
                            .foregroundStyle(.secondary).padding(.horizontal, 4)
                            .accessibilityAddTraits(.isHeader)
                        ForEach(days[day] ?? []) { chat in
                            Button { openChat(chat.id) } label: {
                                ConversationListRow(title: chat.displayTitle, detail: compactRelativeAge(chat.updatedAt, now: clock.date))
                            }
                            .buttonStyle(ChatPressStyle())
                        }
                    }
                }
            }
            .padding(.vertical, 8)
        }
    }

    private func chatDayTitle(_ day: Date, now: Date) -> Text {
        if calendar.isDate(day, inSameDayAs: now) { return Text("Today") }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(day, inSameDayAs: yesterday) { return Text("Yesterday") }
        if calendar.isDate(day, equalTo: now, toGranularity: .year) {
            return Text(day, format: .dateTime.day().month(.wide))
        }
        return Text(day, format: .dateTime.day().month(.wide).year())
    }

    private func setupConversation(_ mate: Mate, _ welcome: MateWelcome, _ question: MateWelcome.Question, _ setup: MateWelcome.Setup) -> some View {
        let tint = MateRobotAssets.chatTint(for: mate.avatar)
        let pending = submittedSetup.flatMap { $0.step == setup.turns.count ? $0.turn : nil }
        let canAnswer = welcome.state == "ready" && setup.saved != true && setup.draft == nil && pending == nil
        return GeometryReader { container in
            let visibleHeight = max(0, container.size.height - container.safeAreaInsets.top - container.safeAreaInsets.bottom)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    MateSetupHistory(turns: setup.turns + (pending.map { [$0] } ?? []), tint: tint)
                    if setup.saved == true {
                        MateSetupBubble(text: question.idleMessage)
                    } else if welcome.state == "failed" {
                        welcomeStatus(mate, welcome)
                    } else if welcome.state != "ready" || pending != nil {
                        preparingProfile(mate)
                    } else if let draft = setup.draft {
                        setupDraftCard(draft, mate: mate)
                    } else {
                        MateSetupBubble(text: question.question)
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                    if session.mateCommandUncertain { checkMateChange }
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(16)
                .frame(maxWidth: .infinity, minHeight: visibleHeight, alignment: .top)
                .background(alignment: .center) {
                    KeyboardDismissBackground(color: Color(.systemBackground)) { focusedProfileField = nil }
                }
            }
            .navigationHeaderFade()
            .scrollDismissesKeyboard(.interactively)
            .contentShape(.rect)
            .simultaneousGesture(TapGesture().onEnded {
                setupAnswerFocused = false
            }, isEnabled: setupAnswerFocused)
            .defaultScrollAnchor(.bottom, for: .sizeChanges)
            .accessibilityIdentifier("mateSetupConversation")
        }
        .safeAreaPadding(.top, 44)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if setup.saved == true, mate.ready { firstTaskComposer(mate) }
            else if canAnswer { setupComposer(mate, question: question.question, step: setup.turns.count) }
        }
    }

    private func preparingProfile(_ mate: Mate, title: LocalizedStringKey = "Preparing the profile…") -> some View {
        HStack(spacing: 10) {
            MateActivityAvatar(mate: mate)
            Text(title).foregroundStyle(.secondary)
        }
    }

    private func setupComposer(_ mate: Mate, question: String, step: Int) -> some View {
        let text = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        let expanded = setupAnswerFocused || !answer.isEmpty
        return MateComposerLayout(expanded: expanded) {
            TextField("What would you like help with?", text: $answer, axis: .vertical)
                .lineLimit(1...5).frame(maxWidth: .infinity)
                .focused($setupAnswerFocused)
                .accessibilityIdentifier("mateSetupAnswer")
            ComposerSendButton(providerID: mate.providerId) {
                let reply = SetupReply(step: step, turn: .init(question: question, answer: text))
                withConsent(mate) { Task { await submitSetupReply(reply) } }
            }
            .disabled(text.isEmpty || text.utf16.count > 24_000 || !session.isConnected || session.mateCommandPending || consent != nil)
            .accessibilityLabel("Send answer").accessibilityIdentifier("sendMateSetupAnswer")
        }
        .padding(.horizontal, 8).padding(.vertical, expanded ? 6 : 4)
        .modifier(GlassSurface(radius: 28, interactive: false))
        .animation(reduceMotion ? nil : MateComposerLayout.transition, value: expanded)
        .padding(.horizontal, 12).padding(.bottom, 8)
    }

    private func setupDraftCard(_ draft: MateProfile, mate: Mate) -> some View {
        let profile = editedProfile ?? draft
        let busy = savingProfile || session.mateCommandPending
        return VStack(alignment: .leading, spacing: 14) {
            Text("Profile draft").font(.headline.width(.expanded)).accessibilityAddTraits(.isHeader)
            if editedProfile != nil {
                VStack(alignment: .leading, spacing: 12) {
                    draftField(.description, text: Binding(get: { editedProfile?.description ?? draft.description },
                        set: { editedProfile?.description = $0 }), lines: 1...5, identifier: "mateProfileDescription")
                    draftField(.instructions, text: Binding(get: { editedProfile?.instructions ?? draft.instructions },
                        set: { editedProfile?.instructions = $0 }), lines: 3...10, identifier: "mateProfileInstructions")
                }
                .disabled(busy)
            } else {
                Text(draft.description)
                Text("Instructions").font(.footnote).foregroundStyle(.secondary)
                Text(draft.instructions)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { draftActions(draft, profile: profile, mateID: mate.id, busy: busy) }
                VStack(spacing: 8) { draftActions(draft, profile: profile, mateID: mate.id, busy: busy) }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .center) {
            KeyboardDismissBackground(color: Color(.secondarySystemBackground)) { focusedProfileField = nil }
                .clipShape(.rect(cornerRadius: 22))
        }
    }

    private func draftField(_ field: ProfileField, text: Binding<String>, lines: ClosedRange<Int>, identifier: String) -> some View {
        let title: LocalizedStringKey = field == .description ? "Description" : "Instructions"
        return VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.footnote).foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(title, text: text, axis: .vertical)
                .lineLimit(lines)
                .focused($focusedProfileField, equals: field)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 12))
                .overlay {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(focusedProfileField == field ? AppBrand.accent : Color(.separator))
                        .allowsHitTesting(false)
                }
                .accessibilityLabel(Text(title)).accessibilityIdentifier(identifier)
        }
    }

    @ViewBuilder private func draftActions(_ draft: MateProfile, profile: MateProfile, mateID: String, busy: Bool) -> some View {
        Button(editedProfile == nil ? "Edit" : "Discard edits") { editedProfile = editedProfile == nil ? draft : nil }
            .buttonStyle(DecisionActionStyle(accent: AppBrand.accent))
            .disabled(busy)
            .accessibilityIdentifier("editMateProfile")
        Button("Save profile") { Task { await saveSetupProfile(profile, mateID: mateID) } }
            .buttonStyle(DecisionActionStyle(accent: AppBrand.accent, prominent: true))
            .disabled(busy || !session.isConnected || profile.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                      || profile.instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                      || profile.description.utf16.count > 1_000 || profile.instructions.utf16.count > 16_000)
            .accessibilityIdentifier("saveMateProfile")
    }

    private var checkMateChange: some View {
        Button("Check Mate change", systemImage: "arrow.clockwise") {
            Task {
                await attempt { _ = try await session.checkMateCommand() }
                if error != nil, !session.mateCommandPending {
                    submittedSetup = nil
                    savingProfile = false
                }
            }
        }.disabled(!session.isConnected)
    }

    private func firstTaskComposer(_ mate: Mate, focusChanged: ((Bool) -> Void)? = nil) -> some View {
        VStack(spacing: 8) {
            if session.pendingMessage?.status == .uncertain {
                Button("Check message delivery", systemImage: "arrow.clockwise") {
                    Task {
                        let owner = session.ownership
                        do {
                            let runID = try await session.checkDelivery()
                            if owner == session.ownership { openChat(runID) }
                        } catch { if owner == session.ownership { self.error = error.localizedDescription } }
                    }
                }.disabled(!session.isConnected)
            }
            MessageComposer(session: session, context: ComposerContext(mate: mate), draft: draft,
                canSend: session.isConnected && !session.sending && session.pendingMessage?.status != .uncertain && !draft.isSending,
                model: {}, options: {}, send: { withConsent(mate) { Task { await send(mate) } } },
                voiceCreated: openChat, focusChanged: focusChanged)
        }.padding(.bottom, 8)
    }

    private func submitSetupReply(_ reply: SetupReply) async {
        guard submittedSetup == nil, session.isConnected, !session.mateCommandPending, mate?.welcome?.state == "ready",
              let question = mate?.welcome?.question, let setup = question.profileSetup,
              setup.saved != true, setup.draft == nil, setup.turns.count == reply.step, question.question == reply.turn.question else { return }
        submittedSetup = reply
        await attempt { try await session.answerMateSetup(mateID, step: reply.step, answer: reply.turn.answer) }
        if error != nil, !session.mateCommandUncertain { submittedSetup = nil }
    }

    private func saveSetupProfile(_ profile: MateProfile, mateID: String) async {
        guard !savingProfile, session.isConnected, !session.mateCommandPending,
              mate?.welcome?.state == "ready", let setup = mate?.welcome?.question?.profileSetup,
              setup.saved != true, setup.draft != nil else { return }
        savingProfile = true
        await attempt { try await session.saveMateSetup(mateID, profile: profile) }
        if error != nil { savingProfile = false }
    }
    @ViewBuilder private func welcomeSection(_ mate: Mate, _ welcome: MateWelcome) -> some View {
        if welcome.question?.profileSetup == nil {
            Group(subviews: Group {
                if welcome.state == "ready", let question = welcome.question {
                    Text(question.question)
                    ForEach(question.options, id: \.label) { option in
                        Button(option.label) { draft.text = option.label; withConsent(mate) { Task { await send(mate) } } }
                            .disabled(!session.isConnected || draft.isSending || session.sending)
                    }
                    Button("Skip") { Task { await attempt { try await session.skipMateWelcome(mate.id) } } }
                        .disabled(session.mateCommandPending || !session.isConnected)
                } else if welcome.state == "skipped", let message = welcome.question?.idleMessage { Text(message) }
                else { welcomeStatus(mate, welcome) }
            }) { rows in
                if !rows.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(rows) { $0 }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 22))
                }
            }
        }
    }
    @ViewBuilder private func welcomeStatus(_ mate: Mate, _ welcome: MateWelcome) -> some View {
        if welcome.state == "failed" {
            Text(welcome.error ?? "Couldn't prepare this Mate.").foregroundStyle(.secondary)
            Button("Retry") { withConsent(mate) { Task { await attempt { try await session.retryMateWelcome(mate.id) } } } }
                .disabled(session.mateCommandPending || !session.isConnected)
        } else if ["pending", "generating"].contains(welcome.state) { preparingProfile(mate, title: "Preparing…") }
    }

    private func withConsent(_ mate: Mate, action: @escaping () -> Void) {
        if session.hasConsent(providerID: mate.providerId) { action() }
        else if let backend = session.pairing?.descriptor.backendId {
            afterConsent = action
            consent = ConsentContext(backendID: backend, providerID: mate.providerId, isDemo: session.isDemo)
        }
    }
    private func send(_ mate: Mate) async {
        let owner = session.ownership
        guard let submission = draft.begin(retainingContent: true) else { return }
        do {
            let id = try await session.send(submission.text, attachments: submission.attachments, contextSkills: submission.contextSkills,
                                            contextScope: submission.contextScope, mate: mate, useMateWelcome: true)
            guard owner == session.ownership else { return }
            draft.accept(submission)
            openChat(id)
        } catch {
            guard owner == session.ownership else { return }
            draft.reject(submission, message: error.localizedDescription, uncertain: session.pendingMessage?.status == .uncertain)
            self.error = error.localizedDescription
        }
    }
    private func attempt(_ action: () async throws -> Void) async {
        let owner = session.ownership
        do { try await action(); if owner == session.ownership { error = nil } }
        catch { if owner == session.ownership { self.error = error.localizedDescription } }
    }
    private func load() async {
        guard session.isConnected else { return }
        let owner = session.ownership
        do {
            let directory = try await session.loadMates(mateID: mateID)
            guard !Task.isCancelled, owner == session.ownership else { return }
            guard let current = directory.mates.first(where: { $0.id == mateID }) else {
                mate = nil; error = "This Mate is unavailable."; loading = false; return
            }
            mate = current
            let setup = current.welcome?.question?.profileSetup
            if let submitted = submittedSetup, let setup, setup.turns.indices.contains(submitted.step) {
                if setup.turns[submitted.step] == submitted.turn { answer = "" }
                submittedSetup = nil
            }
            if setup?.saved == true || setup == nil {
                savingProfile = false
                editedProfile = nil
            }
            if current.ready || current.isArchived == true {
                let currentChats = try await session.loadMateChats(mateID)
                guard !Task.isCancelled, owner == session.ownership else { return }
                chats = currentChats
            }
            error = nil
            loading = false
        } catch {
            guard !Task.isCancelled, owner == session.ownership, session.isConnected else { return }
            self.error = error.localizedDescription
            loading = false
        }
    }
}

struct MateSetupHistory: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let turns: [MateWelcome.Turn]
    let tint: Color

    var body: some View {
        if !turns.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(Array(turns.enumerated()), id: \.offset) { _, turn in
                    MateSetupBubble(text: turn.question)
                    PromptBubble(text: turn.answer, skills: [], fill: tint)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
        }
    }
}

private struct MateSetupBubble: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let text: String

    var body: some View {
        Text(text)
            .textSelection(.enabled)
            .padding(14)
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 22))
    }
}
