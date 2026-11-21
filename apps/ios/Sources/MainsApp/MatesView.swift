import SwiftUI

struct MatesView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let openMate: (String) -> Void
    let navigateFromArchive: (AppRoute) -> Void
    let newMate: ([MateTeam]) -> Void
    @State private var showingArchive = false
    @State private var archivedMateID: String?
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
                NavigationStack {
                    MateDirectoryView(session: session, archived: true, openMate: { archivedMateID = $0 })
                        .expandedNavigationTitle("Archived Mates")
                        .toolbar { closeArchiveButton }
                        .navigationDestination(item: $archivedMateID) { id in
                            MateInfoView(session: session, mateID: id, openChat: { runID, mateID in
                                leaveArchive(for: .conversation(runID, mate: mateID.map(MateConversationSource.profile) ?? .assignment))
                            }, newTask: { leaveArchive(for: .mate(id)) })
                            .toolbar { closeArchiveButton }
                        }
                }
                .accessibilityAction(.escape) { showingArchive = false }
            }
    }

    private var closeArchiveButton: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button("Close Archived Mates", systemImage: "xmark") { showingArchive = false }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("closeArchivedMates")
        }
    }

    private func leaveArchive(for route: AppRoute) {
        routeAfterArchive = (session.ownership, route)
        showingArchive = false
    }

    private func finishArchive() {
        archivedMateID = nil
        let next = routeAfterArchive
        routeAfterArchive = nil
        if let next, next.owner == session.ownership { navigateFromArchive(next.route) }
    }
}

private struct MateDirectoryView: View {
    let session: BackendSession
    let archived: Bool
    let openMate: (String) -> Void
    var newMate: (([MateTeam]) -> Void)? = nil
    @State private var directory: MateDirectory?
    @State private var error: String?
    @State private var reload = 0

    private var canCreateMate: Bool {
        newMate != nil && directory != nil && session.isConnected && !session.mateCommandPending
    }

    var body: some View {
        Group {
            if !archived && directory?.mates.isEmpty == true {
                GeometryReader { geometry in
                    ScrollView {
                        VStack(spacing: 0) {
                            PageTitle("Mates")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 20).padding(.top, 8)
                            Spacer(minLength: 0)
                            VStack(spacing: 16) {
                                directoryStatus
                                emptyMates
                            }
                            .frame(maxWidth: .infinity)
                            .padding(24)
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: geometry.size.height)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                }
                .background(Color(.systemGroupedBackground))
            } else {
                List {
                    if !archived { Section { PageTitle("Mates").listRow } }
                    directoryStatus
                    if let directory {
                        if archived && directory.mates.isEmpty { Text("No archived Mates").foregroundStyle(.secondary) }
                        else { mateSections(directory) }
                    }
                    else if error == nil { ProgressView().accessibilityLabel("Loading Mates") }
                }
                .contentMargins(.top, 8, for: .scrollContent)
            }
        }
        .navigationHeaderFade(background: Color(.systemGroupedBackground))
        .toolbar {
            if !archived && directory?.mates.isEmpty == false {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New Mate", systemImage: "plus", action: startNewMate)
                        .disabled(!canCreateMate)
                        .accessibilityIdentifier("newMate")
                }
            }
        }
        .task(id: "\(session.ownership):\(session.isConnected):\(session.matesRevision):\(reload)") { await load() }
        .refreshable { reload += 1 }
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
        if let error { Text(error).foregroundStyle(.secondary) }
    }

    private var emptyMates: some View {
        VStack(spacing: 20) {
            EmptyMatesAvatars()

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

    @ViewBuilder private func mateSections(_ directory: MateDirectory) -> some View {
        let members = Dictionary(grouping: directory.mates, by: \.teamId)
        let teamNames = Dictionary(directory.teams.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        var seen: Set<String> = []
        let teamIDs = directory.mates.compactMap(\.teamId).filter { seen.insert($0).inserted }

        ForEach(teamIDs, id: \.self) { teamID in
            Section {
                mateRows(members[teamID] ?? [])
            } header: {
                MateSectionHeading(teamNames[teamID] ?? "Unavailable team")
            }
        }
        if let unassigned = members[nil] {
            if teamIDs.isEmpty { mateRows(unassigned) }
            else { Section { mateRows(unassigned) } header: { MateSectionHeading("No team") } }
        }
    }

    private func mateRows(_ mates: [Mate]) -> some View {
        ForEach(mates) { mate in
            Button { openMate(mate.id) } label: {
                HStack(spacing: 12) {
                    MateRobotThumbnail(preset: MateRobotAssets.catalogue?.preset(for: mate.avatar, mateID: mate.id))
                        .frame(width: 40, height: 40)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(mate.name).font(.headline.width(.expanded))
                        if mate.needsSetup {
                            HStack(spacing: 6) {
                                Text("Finish setup").font(.subheadline).foregroundStyle(.secondary)
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.caption).foregroundStyle(.orange).accessibilityHidden(true)
                            }
                        } else if !mate.description.isEmpty {
                            Text(mate.description).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary).accessibilityHidden(true)
                }
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }.accessibilityIdentifier("mate-\(mate.id)")
        }
    }

    private func load() async {
        let owner = session.ownership
        guard session.isConnected else { error = "Connect to your computer to use Mates."; return }
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

private struct EmptyMatesAvatars: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false

    var body: some View {
        let animated = visible && !reduceMotion && scenePhase == .active
        let presets = MateRobotAssets.catalogue?.styles.flatMap(\.presets) ?? []
        let terminal = presets.first { $0.id == "terminal-amber" }
        let shell = presets.first { $0.id == "clear-violet" }
        let metal = presets.first { $0.id == "metal-silver" }
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animated)) { context in
            let period = 3.6
            let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) * 2 * .pi / period
            HStack(alignment: .bottom, spacing: 10) {
                avatar(terminal, size: 64, tilt: -10, lift: animated ? sin(phase) : 0)
                avatar(shell, size: 80, tilt: 0, lift: animated ? sin(phase + 2 * .pi / 3) : 0)
                avatar(metal, size: 64, tilt: 10, lift: animated ? sin(phase + 4 * .pi / 3) : 0)
            }
        }
        .onScrollVisibilityChange(threshold: 0.1) { visible = $0 }
        .onDisappear { visible = false }
        .accessibilityHidden(true)
    }

    private func avatar(_ preset: MateRobotCatalogue.Preset?, size: CGFloat, tilt: Double, lift: Double) -> some View {
        MateRobotThumbnail(preset: preset)
            .frame(width: size, height: size)
            .rotationEffect(.degrees(tilt + lift * 3))
            .offset(y: -lift * 5)
    }
}

struct NewMateDraft {
    var name = ""
    var avatar = MateRobotAssets.catalogue?.defaultPreset?.avatar ?? MateAvatar(shape: "terminal-amber", color: "amber")
    var rememberedStyles: [String: String] = [:]
    var teamID: String?
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
    @State private var error: String?

    var body: some View {
        ZStack {
            // Draw on the moving page, including the area behind the status bar.
            NewMateBackdrop(avatar: draft.avatar)
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
                        .disabled(!draft.hasValidName)
                        .accessibilityIdentifier("nextMateStep")
                }
            }
        }
        .task(id: "\(choosingModel):\(space?.providerId ?? ""):\(session.isConnected)") {
            if choosingModel, let space, session.isConnected { await session.loadModels(space.providerId) }
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
        let teamName = teams.first { $0.id == draft.teamID }?.name ?? "No team"
        return Menu {
            Button { draft.teamID = nil } label: {
                if draft.teamID == nil { Label("No team", systemImage: "checkmark") }
                else { Text("No team") }
            }
            ForEach(teams) { team in
                Button { draft.teamID = team.id } label: {
                    if team.id == draft.teamID { Label(team.name, systemImage: "checkmark") }
                    else { Text(team.name) }
                }
            }
        } label: {
            mateCreationChoiceLabel(teamName, icon: "icon:users")
        }
        .accessibilityLabel("Team")
        .accessibilityValue(teamName)
        .disabled(teams.isEmpty)
    }
}

private struct MatePickerAppearance: UIViewControllerRepresentable {
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

private struct NewMateBackdrop: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let avatar: MateAvatar
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        // Silver's catalogue tint follows the green iris. Use the casing color here.
        let tint = avatar.shape == "metal-silver"
            ? Color(red: 0.49, green: 0.62, blue: 0.73)
            : MateRobotAssets.chatTint(for: avatar)
        Rectangle()
            .fill(tint)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.32), value: tint)
            .mask(alignment: .center) {
                LinearGradient(stops: [
                    .init(color: .white.opacity(0.58), location: 0),
                    .init(color: .white.opacity(0.53), location: 0.24),
                    .init(color: .white.opacity(0.36), location: 0.50),
                    .init(color: .white.opacity(0.14), location: 0.75),
                    .init(color: .clear, location: 1)
                ], startPoint: .top, endPoint: .bottom)
            }
            .opacity(colorScheme == .light ? 0.55 : 1)
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
        var result = preferredSettings
        guard let space, let model else { return result }
        let provider = space.providerId
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

            if writing { ProgressView("Checking creation…").controlSize(.small) }
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
                                      effort: settings.effort(provider: space.providerId), teamID: draft.teamID, avatar: draft.avatar))
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
                        Text("Creating Mate…").font(.headline).foregroundStyle(.secondary).activityShimmer()
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

private extension View {
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
        .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
    }
}

@MainActor private func mateCreationChoiceLabel(_ name: String, icon: String) -> some View {
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
    private var showsSetup: Bool {
        guard let mate else { return false }
        return mate.welcome?.question?.profileSetup != nil && (!mate.ready || chats.isEmpty)
    }

    var body: some View {
        Group {
            if showsSetup, let mate, let welcome = mate.welcome, let question = welcome.question, let setup = question.profileSetup {
                setupConversation(mate, welcome, question, setup)
            } else {
                mateDetails
            }
        }
        .environment(\.mateChatTint, mate.map { MateRobotAssets.chatTint(for: $0.avatar) })
        .navigationTitle(mate?.name ?? "Mate").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if showsSetup, let mate {
                ToolbarItem(placement: .principal) { MateConversationTitle(mate: mate) }
                    .sharedBackgroundVisibility(.hidden)
            } else if let mate {
                ToolbarItem(placement: .title) {
                    Text(mate.name).font(.headline.weight(.medium).width(.expanded)).lineLimit(1)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Mate Details", systemImage: "info.circle", action: openInfo)
                        .accessibilityIdentifier("openMateInfo")
                }
            }
        }
        .task(id: "\(session.ownership):\(session.isConnected):\(session.matesRevision):\(reload)") { await load() }
        .refreshable { reload += 1 }
        .sheet(item: $consent, onDismiss: { afterConsent = nil }) { consent in
            ConsentView(context: consent) {
                guard consent.backendID == session.pairing?.descriptor.backendId else { return }
                session.grantConsent(providerID: consent.providerID, backendID: consent.backendID)
                afterConsent?()
            }
        }
    }

    private var mateDetails: some View {
        VStack(spacing: 0) {
            List {
                if let error { Text(error).foregroundStyle(.secondary) }
                if session.mateCommandUncertain { checkMateChange }
                if let mate {
                    Section { mateSummary(mate) }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    if mate.ready {
                        if let welcome = mate.welcome { welcomeSection(mate, welcome) }
                        if !composerFocused { mateChatHistory(mate) }
                    } else { Text("Loading profile setup…").foregroundStyle(.secondary) }
                } else if loading { ProgressView().accessibilityLabel("Loading Mate") }
            }
            .navigationHeaderFade(background: Color(.systemGroupedBackground))
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
    }

    private func mateSummary(_ mate: Mate) -> some View {
        VStack(spacing: 8) {
            if let preset = MateRobotAssets.catalogue?.preset(for: mate.avatar, mateID: mate.id) {
                MateRobotPreview(preset: preset).frame(width: 120, height: 120)
            }
            if !mate.description.isEmpty {
                Text(mate.description).font(.subheadline).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).frame(maxWidth: 460)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private func mateChatHistory(_ mate: Mate) -> some View {
        let history = chats.filter { mate.showsChat($0) }
        return Section {
            if history.isEmpty { Text("No chats yet").foregroundStyle(.secondary) }
            ForEach(history) { chat in
                Button { openChat(chat.id) } label: {
                    HStack {
                        Text(chat.displayTitle).lineLimit(1)
                        Spacer()
                        TimelineView(.periodic(from: .now, by: 60)) { clock in
                            Text(compactRelativeAge(chat.updatedAt, now: clock.date))
                                .font(.caption).foregroundStyle(.secondary)
                                .fixedSize(horizontal: true, vertical: false)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
                }
            }
        } header: {
            Text("Chats")
        }
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
            Text(title).foregroundStyle(.secondary).activityShimmer()
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
            Text("Profile draft").font(.headline).accessibilityAddTraits(.isHeader)
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
                HStack { draftActions(draft, profile: profile, mateID: mate.id, busy: busy) }
                VStack(alignment: .leading) { draftActions(draft, profile: profile, mateID: mate.id, busy: busy) }
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
        Button("Save profile") { Task { await saveSetupProfile(profile, mateID: mateID) } }
            .buttonStyle(.borderedProminent)
            .tint(AppBrand.accent)
            .disabled(busy || !session.isConnected || profile.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                      || profile.instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                      || profile.description.utf16.count > 1_000 || profile.instructions.utf16.count > 16_000)
            .accessibilityIdentifier("saveMateProfile")
        Button(editedProfile == nil ? "Edit" : "Discard edits") { editedProfile = editedProfile == nil ? draft : nil }
            .buttonStyle(.bordered)
            .disabled(busy)
            .accessibilityIdentifier("editMateProfile")
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
                model: {}, options: {}, send: { withConsent(mate) { Task { await send(mate) } } }, focusChanged: focusChanged)
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
            Section {
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
            consent = ConsentContext(backendID: backend, providerID: mate.providerId)
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
        let owner = session.ownership
        guard session.isConnected else { error = "Connect to your computer to use Mates."; loading = false; return }
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
            if current.ready {
                let currentChats = try await session.loadMateChats(mateID)
                guard !Task.isCancelled, owner == session.ownership else { return }
                chats = currentChats
            }
            error = nil
            loading = false
        } catch { if !Task.isCancelled, owner == session.ownership { self.error = error.localizedDescription; loading = false } }
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
