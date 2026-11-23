import SwiftUI

enum MateConversationSource: Hashable {
    case profile(String)
    case assignment

    var mateID: String? {
        if case .profile(let id) = self { return id }
        return nil
    }
}

@MainActor
struct ConversationView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    private struct HistoryEntry: Hashable {
        let runID: String
        let cursor: HistoryCursor?
    }
    private struct MateHeaderRequest: Equatable {
        let owner: Int
        let mateID: String?
        let revision: Int
        let canLoad: Bool
        let retry: Int
    }
    private struct GoalRequest: Equatable {
        let owner: Int
        let status: String?
        let revision: Int
        let canRead: Bool
    }
    let session: BackendSession
    let runID: String
    let openComputer: () -> Void
    let onNew: () -> Void
    let onFork: (String) -> Void
    let initialCursor: HistoryCursor?
    let mateSource: MateConversationSource?
    let onMateNavigation: (AppRoute) -> Void
    @Bindable private var draft: ConversationDraft
    @Bindable private var queue: ConversationQueue
    @State private var owner: Int?
    @State private var scroll = TranscriptScrollState()
    @State private var initializedHistoryEntry: HistoryEntry?
    private var historyEntry: HistoryEntry { HistoryEntry(runID: runID, cursor: initialCursor) }
    @State private var consent: ConsentContext?
    @State private var consentQueuesMessage = false
    @State private var consentResumesQueue = false
    @State private var consentForksConversation = false
    @State private var content: ContentReference?
    @State private var acceptedCount = 0
    @State private var modelSheet = false
    @State private var optionsSheet = false
    @State private var projectSheet = false
    @State private var confirmDelete = false
    @State private var companion = ConversationCompanionState()
    @State private var outputSelection: ConversationOutputSelection?
    @State private var outputsSheet = false
    @State private var loadedMate: (owner: Int, profile: MateInfoProfile)?
    @State private var mateLoadFailure: (request: MateHeaderRequest, message: String)?
    @State private var mateLoadRetry = 0
    @State private var updatingArchivedMate = false
    @State private var restoredMateNeedsRefresh = false
    @State private var archivedMateError: String?
    @State private var goalSummary: (owner: Int, value: MobileGoalSummary)?
    @State private var editingGoal: GoalEditRequest?
    @State private var mateAvatarFrame = CGRect.zero
    @State private var presentedMateProfile: MateInfoProfile?
    @State private var presentedMateTask: MateAssignmentLink?
    @State private var mateRouteAfterDismissal: (owner: Int, route: AppRoute)?
    @Namespace private var mateInfoZoom
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.layoutDirection) private var layoutDirection
    private var expandedWorkspace: Bool { horizontalSizeClass == .regular && !dynamicTypeSize.isAccessibilitySize }
    @State private var outputPresence: (owner: Int, runID: String, available: Bool)?
    @State private var selectedFile: TurnFileSelection?
    @State private var agentsExpanded = false
    @State private var selectedAgent: SubagentSelection?
    #if MAINS_GPT_LIVE
    @AppStorage(VoicePresentation.storageKey) private var voicePresentation = VoicePresentation.focus
    private var ownsVoice: Bool { session.voice.ownsCall && session.voice.runID == runID }
    private var focusedVoice: Bool { ownsVoice && voicePresentation == .focus }
    #else
    private var focusedVoice: Bool { false }
    #endif
    private var agents: [SessionSubagent] { run?.assistantId == nil && session.viewingRunID == runID ? session.transcript.subagents : [] }
    private var run: Conversation? { session.conversations.first { $0.id == runID } }
    private var goalRequest: GoalRequest {
        GoalRequest(owner: session.ownership, status: run?.status, revision: session.goalSummaryRevision,
                    canRead: session.isConnected && session.supportsMobileGoalSummary && session.viewingRunID == runID
                        && run?.providerId == "codex" && run?.isReplica != true)
    }
    private var mateID: String? { run?.assistantId ?? mateSource?.mateID }
    private var mateHeaderRequest: MateHeaderRequest {
        MateHeaderRequest(owner: session.ownership, mateID: mateID, revision: session.matesRevision,
                          canLoad: session.isConnected && session.supportsMates, retry: mateLoadRetry)
    }
    private var mateProfile: MateInfoProfile? {
        guard let loadedMate, loadedMate.owner == session.ownership, loadedMate.profile.mate.id == mateID else { return nil }
        return loadedMate.profile
    }
    private var conversationMate: Mate? { mateProfile?.mate }
    private var composerMate: Mate? {
        #if MAINS_GPT_LIVE
        return conversationMate ?? (ownsVoice ? session.voiceMate : nil)
        #else
        return conversationMate
        #endif
    }
    private var archivedMate: Bool { conversationMate?.isArchived == true }
    private var canRestoreMateHere: Bool {
        guard let run, let conversationMate else { return false }
        return session.supportsMateInfo && run.assistantId == conversationMate.id && run.isReplica != true
    }
    private var isMateConversation: Bool { mateID != nil || mateSource != nil }
    private var hasLoadedHistory: Bool { run != nil && session.viewingRunID == runID && session.transcript.page != nil }
    private var waitsForMateConversation: Bool {
        guard isMateConversation, !focusedVoice else { return false }
        return !hasLoadedHistory || (mateID != nil && mateProfile == nil)
    }
    private var usesMateHeader: Bool { isMateConversation && !focusedVoice && !showsConnectionPill }
    private var showsMateHeader: Bool { usesMateHeader && !waitsForMateConversation }
    private var navigationTitle: String {
        if focusedVoice || showsConnectionPill || waitsForMateConversation { return "" }
        if showsMateHeader { return conversationMate?.name ?? "" }
        return run?.displayTitle ?? "Conversation"
    }
    private var pending: PendingMessage? { session.pendingMessage?.runID == runID ? session.pendingMessage : nil }
    private var composerContext: ComposerContext? {
        if let run { return ComposerContext(run: run, mateName: conversationMate?.name) }
        #if MAINS_GPT_LIVE
        if ownsVoice, let mate = composerMate { return ComposerContext(mate: mate, runID: runID) }
        if ownsVoice, let space = session.spaces.first(where: { $0.id == session.voiceSpaceID }) {
            return ComposerContext(space: space, runID: runID)
        }
        #endif
        // The command can be acknowledged before getById/history arrives. Keep
        // the same composer mounted throughout that metadata hand-off.
        if pending?.status == .accepted, let space = session.selectedSpace { return ComposerContext(space: space, runID: runID) }
        return nil
    }
    private var disablesComposer: Bool {
        if let pending = session.pendingConversationAction, pending.runID == runID, pending.action.retiresConversation { return true }
        #if MAINS_GPT_LIVE
        if ownsVoice { return false }
        #endif
        return run == nil
    }
    private var uncertain: Bool { session.pendingMessage?.status == .uncertain }
    private var showsConnectionPill: Bool { session.pairing != nil && !session.isConnected }
    private var forkTitle: String {
        guard let pending = session.pendingFork, pending.sourceRunID == runID else { return "Fork chat" }
        return pending.status == .sending ? "Forking…" : "Fork unconfirmed"
    }
    private var usesQueue: Bool {
        run?.supportsSteering == true && (run?.isActive == true || !queue.messages.isEmpty || queue.editingID != nil)
    }
    private var sendLabel: String {
        if queue.editingID != nil { return "Save queued message" }
        if usesQueue, run?.isActive == true { return "Queue message" }
        return "Send message"
    }
    private var hasOutputs: Bool {
        outputPresence?.owner == session.ownership && outputPresence?.runID == runID && outputPresence?.available == true
    }
    private struct OutputCheck: Hashable {
        let owner: Int
        let runID: String
        let connected: Bool
        let viewing: Bool
        let status: String?
        let updatedAt: Date?
        let artifacts: [Int]
    }
    private var outputCheck: OutputCheck {
        OutputCheck(owner: session.ownership, runID: runID, connected: session.isConnected, viewing: session.viewingRunID == runID,
                    status: run?.status, updatedAt: run?.updatedAt,
                    artifacts: session.transcript.page?.artifacts.filter { ["document", "file", "image", "visualization"].contains($0.kind) }.map(\.id) ?? [])
    }

    init(session: BackendSession, runID: String, openComputer: @escaping () -> Void, onNew: @escaping () -> Void,
         onFork: @escaping (String) -> Void, initialCursor: HistoryCursor? = nil, mateSource: MateConversationSource? = nil,
         onMateNavigation: @escaping (AppRoute) -> Void = { _ in }) {
        self.session = session; self.runID = runID
        self.openComputer = openComputer
        self.onNew = onNew
        self.onFork = onFork
        self.initialCursor = initialCursor
        self.mateSource = mateSource
        self.onMateNavigation = onMateNavigation
        draft = session.draft(for: runID)
        queue = session.messageQueue(for: runID)
    }

    var body: some View {
        GeometryReader { geometry in
            workspace(in: geometry)
                .overlay {
                    if showsMateHeader, !archivedMate, mateProfile != nil, presentedMateProfile == nil {
                        // The toolbar clips touches below the bar even though its avatar is visible there.
                        let container = geometry.frame(in: .global)
                        let avatar = mateAvatarFrame.intersection(container)
                        if !avatar.isEmpty {
                            Color.clear.frame(width: avatar.width, height: avatar.height)
                                .contentShape(.rect)
                                .onTapGesture(perform: presentMateInfo)
                                .position(x: avatar.midX - container.minX, y: avatar.midY - container.minY)
                                .accessibilityHidden(true)
                        }
                    }
                }
        }
        .environment(\.openMateAssignment, presentMateAssignment)
        .fullScreenCover(item: $presentedMateProfile, onDismiss: navigateAfterMatePresentation, content: mateInfoPage)
        .sheet(item: $presentedMateTask, onDismiss: navigateAfterMatePresentation) { link in
            MateRecordView(session: session, title: "Assignment", reloadOnChange: true, dismissWithCheckmark: true,
                           load: { try await session.readConversationMateTask(link) }) { record in
                MateTaskDetail(session: session, managingMateID: record.managingMateID, task: record.task) { id in
                    if id != runID {
                        let source = record.task.assignee.map { MateConversationSource.profile($0.id) } ?? .assignment
                        mateRouteAfterDismissal = (session.ownership, .conversation(id, mate: source))
                    }
                    presentedMateTask = nil
                }
            }
        }
        .onChange(of: archivedMate) { _, archived in
            if archived { presentedMateProfile = nil; modelSheet = false; optionsSheet = false }
            else { restoredMateNeedsRefresh = false; archivedMateError = nil }
        }
    }

    private func presentMateAssignment(_ link: MateAssignmentLink) {
        guard link.runID == runID, session.viewingRunID == runID, session.isConnected,
              presentedMateTask == nil, presentedMateProfile == nil else { return }
        presentedMateTask = link
    }

    private func presentMateInfo() {
        guard !archivedMate, let mateProfile, presentedMateProfile == nil, presentedMateTask == nil,
              session.viewingRunID == runID else { return }
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        presentedMateProfile = mateProfile
    }

    private func mateInfoPage(_ profile: MateInfoProfile) -> some View {
        NavigationStack {
            MateInfoView(session: session, mateID: profile.id, initialProfile: profile, openChat: { id, mateID in
                if id != runID {
                    mateRouteAfterDismissal = (session.ownership, .conversation(id, mate: mateID.map(MateConversationSource.profile) ?? .assignment))
                }
                presentedMateProfile = nil
            })
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { presentedMateProfile = nil } label: { Image(systemName: "chevron.left") }
                            .accessibilityLabel("Back").accessibilityIdentifier("closeMateChatInfo")
                    }
                }
                .accessibilityAction(.escape) { presentedMateProfile = nil }
        }
        .navigationTransition(.zoom(sourceID: profile.id, in: mateInfoZoom))
    }

    private func navigateAfterMatePresentation() {
        guard let next = mateRouteAfterDismissal else { return }
        mateRouteAfterDismissal = nil
        guard next.owner == session.ownership, session.viewingRunID == runID else { return }
        onMateNavigation(next.route)
    }

    private func workspace(in geometry: GeometryProxy) -> some View {
        let divisions: [CGRect]
        if #available(iOS 27.1, *) { divisions = geometry.reservedRegions(kind: .division).map(\.frame) }
        else { divisions = [] }
        // Use the same geometry for reader placement, automatic opening and actions.
        // A regular size class can still be too narrow for two usable readers.
        var openState = companion
        openState.open()
        let available = ConversationPanePlan.make(size: geometry.size, expanded: expandedWorkspace,
            rightToLeft: layoutDirection == .rightToLeft, state: openState, divisions: divisions)
        let twoReaders = available.showsConversation && available.showsOutput
        let plan = ConversationPanePlan.make(size: geometry.size, expanded: expandedWorkspace,
            rightToLeft: layoutDirection == .rightToLeft, state: companion, divisions: divisions)
        let action = companion.outputsAction(twoReaders: twoReaders)
        let displayedOutputID = outputSelection?.id
        return ConversationWorkspace(plan: plan, extendsConversationUnderHeader: !focusedVoice) {
            conversationContent.simultaneousGesture(TapGesture().onEnded {
                if outputSelection?.id == displayedOutputID { companion.focusConversation() }
            })
        } output: {
            if companion.isOpen {
                ConversationOutputsPane(session: session, runID: runID, owner: owner ?? session.ownership, selection: $outputSelection) {
                    companion.close(); outputSelection = nil
                }.simultaneousGesture(TapGesture().onEnded { companion.focusOutput() })
            }
        }
        .background(Color(.systemBackground))
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle(navigationTitle)
        .toolbarRole(usesMateHeader ? .navigationStack : .editor)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task(id: historyEntry) {
            owner = session.ownership
            if initialCursor != nil, initializedHistoryEntry != historyEntry {
                // Returning from a file diff must preserve the existing transcript and viewport.
                initializedHistoryEntry = historyEntry
                scroll.viewport.beginPage()
                await session.selectConversation(runID, around: initialCursor)
                scroll.viewport.finishPage(latestConfirmed: false)
            } else if session.viewingRunID != runID { await session.selectConversation(runID) }
        }
        .task(id: outputCheck) {
            let check = outputCheck
            guard check.connected, check.viewing, check.status != nil else { return }
            do {
                let available = try await session.hasOutputs(runID)
                try Task.checkCancellation()
                guard check.owner == session.ownership, session.viewingRunID == runID else { return }
                outputPresence = (check.owner, runID, available)
            } catch { /* Keep known metadata during disconnection or transient errors. */ }
        }
        .task(id: "\(run?.providerId ?? ""):\(session.isConnected)") {
            if let run { await session.loadModels(run.providerId, force: true) }
        }
        .task(id: mateHeaderRequest) { await refreshConversationMate(mateHeaderRequest) }
        .task(id: goalRequest) {
            let request = goalRequest
            guard request.canRead else { goalSummary = nil; return }
            do {
                let value = try await session.readGoalSummary(runID)
                guard !Task.isCancelled, request == goalRequest else { return }
                goalSummary = value.map { (request.owner, $0) }
            } catch { /* Keep the last provider-confirmed summary on a transient read error. */ }
        }
        .onChange(of: draft.text) { _, _ in companion.focusConversation() }
        .onChange(of: focusedVoice) { _, focused in if focused { companion.close(); outputSelection = nil } }
        .onChange(of: session.ownership) { _, _ in
            companion.close(); outputSelection = nil; outputsSheet = false; presentedMateProfile = nil
            presentedMateTask = nil; editingGoal = nil
        }
        .sheet(item: $editingGoal) { request in
            GoalObjectiveEditor(session: session, runID: runID, request: request)
        }
        .sheet(isPresented: $projectSheet) {
            ConversationProjectSheet(session: session, runID: runID, owner: owner ?? -1)
        }
        .confirmationDialog("Delete chat?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete chat", role: .destructive) { manage(.delete) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes the chat and its chat files. This can’t be undone.")
        }
        .onDisappear {
            if selectedFile == nil && presentedMateProfile == nil && presentedMateTask == nil { session.leaveConversation(runID) }
        }
        .navigationDestination(item: $selectedFile) { selection in
            TurnFileDiffView(session: session, selection: selection, close: { selectedFile = nil })
        }
        .sheet(item: $consent) { context in
            ConsentView(context: context) {
                guard owner == session.ownership else { return }
                session.grantConsent(providerID: context.providerID, backendID: context.backendID)
                if consentForksConversation { Task { await fork() } }
                else if consentResumesQueue { Task { await session.resumeMessageQueue(runID) } }
                else { Task { await send(queued: consentQueuesMessage) } }
            }
        }
        .sheet(item: $content) { reference in
            NavigationStack { FullMessageView(session: session, artifactID: reference.id) }
        }
        .sheet(isPresented: $outputsSheet) { OutputsView(session: session, runID: runID) }
        .sheet(item: $selectedAgent) { SubagentDetailSheet(session: session, selection: $0) }
        .onChange(of: agents.isEmpty) { _, empty in if empty { agentsExpanded = false } }
        .sensoryFeedback(.impact(weight: .light), trigger: acceptedCount)
        .runFileLinks(session: session, runID: runID)
        .toolbar {
            standardConversationTitle
            conversationToolbar(outputsAction: action)
        }
        .onChange(of: twoReaders, initial: true) { _, _ in adaptCompanion(twoReaders: twoReaders) }
        .onChange(of: hasOutputs) { _, _ in adaptCompanion(twoReaders: twoReaders) }
        .environment(\.openConversationOutput, OpenConversationOutputAction { requestedRun, source in
            guard twoReaders || companion.isOpen, requestedRun == runID, owner == session.ownership, session.viewingRunID == runID else { return false }
            outputSelection = ConversationOutputSelection(source: source, owner: session.ownership)
            companion.open()
            return true
        })
    }

    private func adaptCompanion(twoReaders: Bool) { if !focusedVoice { companion.adapt(expanded: twoReaders, hasOutputs: hasOutputs) } }

    private func refreshConversationMate(_ request: MateHeaderRequest) async {
        guard request.canLoad, request.mateID != nil else { return }
        do { try await loadConversationMate(request) }
        catch {
            guard !Task.isCancelled, request == mateHeaderRequest else { return }
            mateLoadFailure = (request, error.localizedDescription)
        }
    }

    private func loadConversationMate(_ request: MateHeaderRequest) async throws {
        guard request.canLoad, let id = request.mateID else { throw MainsError.disconnected }
        let directory = try await session.loadMates(mateID: id)
        try Task.checkCancellation()
        guard request == mateHeaderRequest else { throw MainsError.changedBackend }
        guard let mate = directory.mates.first(where: { $0.id == id }) else { throw MainsError.invalidReply }
        loadedMate = (request.owner, MateInfoProfile(mate: mate, teams: directory.teams))
        mateLoadFailure = nil
    }

    private func performOutputsAction(_ action: ConversationCompanionState.OutputsAction) {
        switch action {
        case .browse: outputsSheet = true
        case .open: companion.open()
        case .close: companion.close(); outputSelection = nil
        case .showConversation: companion.focusConversation()
        case .showOutput: companion.focusOutput()
        }
    }

    @ViewBuilder private var conversationContent: some View {
        if waitsForMateConversation {
            #if MAINS_GPT_LIVE
            mateConversationLoading
                .safeAreaInset(edge: .bottom, spacing: 0) { if ownsVoice { composerArea } }
                .environment(\.mateChatTint, composerMate.map { MateRobotAssets.chatTint(for: $0.avatar) })
            #else
            mateConversationLoading
            #endif
        }
        else { conversationReader }
    }

    @ViewBuilder private var mateConversationLoading: some View {
        if !session.isConnected {
            DisconnectedState(message: "Connect to your computer to open this Mate chat.").centered
        } else if session.viewingRunID == runID, !hasLoadedHistory, let error = session.historyError {
            EmptyStateView(artwork: .chats, title: "Messages couldn't load", description: Text(error)) {
                Button("Retry") { Task { await session.loadHistory(direction: session.historyRetryDirection) } }
                    .disabled(session.historyLoading)
            }.centered
        } else if mateID != nil, mateProfile == nil, !session.supportsMates {
            EmptyStateView(artwork: .mates, title: "Mate chat unavailable",
                           description: Text("Update Mains on your computer to open this Mate chat.")).centered
        } else if mateProfile == nil, let failure = mateLoadFailure, failure.request == mateHeaderRequest {
            EmptyStateView(artwork: .mates, title: "Mate chat couldn't load", description: Text(failure.message)) {
                Button("Try Again") { mateLoadRetry += 1 }
            }.centered
        } else {
            ConversationSkeleton(isMate: true)
                .padding(.horizontal, 16).padding(.top, 56)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .accessibilityIdentifier("mateConversationLoading")
        }
    }

    private var conversationReader: some View {
        ZStack {
            ConversationTranscript(session: session, runID: runID, providerID: run?.providerId ?? composerContext?.providerId ?? "", scroll: scroll, openFile: { turn, file in
                selectedFile = TurnFileSelection(runID: runID, turnID: turn.id, file: file, owner: session.ownership)
            }, openSubagents: { agentsExpanded.toggle() }, fork: prepareFork, searchCursor: initialCursor, mate: conversationMate) {
                content = ContentReference(id: $0)
            }
            .safeAreaPadding(.top, showsMateHeader ? archivedMate ? 46 : 32 : 0)
            .opacity(focusedVoice ? 0 : 1)
            .allowsHitTesting(!focusedVoice)
            .accessibilityHidden(focusedVoice)
            #if MAINS_GPT_LIVE
            if focusedVoice {
                VoiceFocusStage(voice: session.voice)
                    .background(alignment: .center) { KeyboardDismissBackground(color: Color(.systemBackground)) }
                    .transition(.opacity)
            }
            #endif
        }
        .background(Color(.systemBackground))
        .safeAreaInset(edge: .bottom, spacing: 0) { composerArea }
        .environment(\.mateChatTint, composerMate.map { MateRobotAssets.chatTint(for: $0.avatar) })
        .environment(\.solidChatNotices, true)
        .composerPickers(model: $modelSheet, options: $optionsSheet, session: session,
                         context: run.map { ComposerContext(run: $0) }, withinPane: true)
    }

    @ToolbarContentBuilder private var standardConversationTitle: some ToolbarContent {
        if !showsConnectionPill && !usesMateHeader && !session.isDemo && !focusedVoice {
            ToolbarItem(placement: .title) {
                Text(navigationTitle).font(Font.headline.width(.expanded)).lineLimit(1)
            }
        }
    }

    @ToolbarContentBuilder private func conversationToolbar(outputsAction: ConversationCompanionState.OutputsAction) -> some ToolbarContent {
            let hasOutputAction = (hasOutputs || companion.isOpen) && !focusedVoice && !waitsForMateConversation
            let outputsInMenu = showsMateHeader && horizontalSizeClass != .regular
            if showsConnectionPill {
                ToolbarItem(placement: .principal) {
                    ConnectionPill(session: session, action: openComputer)
                }
                .sharedBackgroundVisibility(.hidden)
            } else if showsMateHeader {
                ToolbarItem(placement: .principal) { mateChatHeader }
                .sharedBackgroundVisibility(.hidden)
            } else if session.isDemo && !focusedVoice {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text(navigationTitle).font(.headline.width(.expanded)).lineLimit(1)
                        Text("Demo · On this iPhone").font(.caption2).foregroundStyle(.secondary)
                    }.accessibilityIdentifier("conversationDemoStatus")
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                #if MAINS_GPT_LIVE
                if ownsVoice { VoicePresentationMenu() }
                #endif
                if hasOutputAction && !outputsInMenu {
                    outputsButton(outputsAction)
                }
                if !focusedVoice && !waitsForMateConversation {
                    if !archivedMate {
                        Button("New conversation", systemImage: "square.and.pencil", action: onNew).accessibilityIdentifier("newConversation")
                    }
                    Menu {
                        if hasOutputAction && outputsInMenu {
                            outputsButton(outputsAction)
                        }
                        if !archivedMate {
                            Button(action: prepareFork) {
                                Label { Text(forkTitle) } icon: { ConversationActionIcons.fork }
                            }.disabled(!session.canForkConversation(runID)).accessibilityIdentifier("forkConversation")
                        }
                        if run?.mode == "work" || run?.mode == "chat" {
                            Button("Move to project", systemImage: "folder") { projectSheet = true }
                                .disabled(!session.canManageConversation(runID, action: .moveToProject(nil)))
                                .accessibilityIdentifier("moveConversationToProject")
                        }
                        Divider()
                        Button("Archive", systemImage: "archivebox") { manage(.archive) }
                            .disabled(!session.canManageConversation(runID, action: .archive)).accessibilityIdentifier("archiveConversation")
                        Button(role: .destructive) { confirmDelete = true } label: {
                            Label { Text("Delete") } icon: {
                                Image(uiImage: (UIImage(systemName: "trash") ?? UIImage())
                                    .withTintColor(.systemRed, renderingMode: .alwaysOriginal))
                                    .renderingMode(.original)
                            }
                        }
                            .disabled(!session.canManageConversation(runID, action: .delete)).accessibilityIdentifier("deleteConversation")
                    } label: { Image(systemName: "ellipsis") }
                    .accessibilityLabel("Conversation options").accessibilityIdentifier("conversationOptions")
                }
            }
    }

    private var mateChatHeader: some View {
        let openInfo: (() -> Void)? = archivedMate ? nil : { presentMateInfo() }
        return MateConversationTitle(mate: conversationMate, avatarFrame: $mateAvatarFrame,
                                     zoomNamespace: archivedMate ? nil : mateInfoZoom, openInfo: openInfo)
    }

    private func outputsButton(_ action: ConversationCompanionState.OutputsAction) -> some View {
        Button(action == .showConversation ? "Show conversation" : "Outputs",
               systemImage: action == .showConversation ? "bubble.left" : "doc.on.doc") { performOutputsAction(action) }
            .accessibilityIdentifier("conversationOutputs")
    }

    @ViewBuilder private var composerArea: some View {
        if archivedMate {
            archivedMateNotice
        } else {
            composerControls
        }
    }

    private var archivedMateNotice: some View {
        let checking = session.mateCommandUncertain && !restoredMateNeedsRefresh
        let message = archivedMateError ?? (canRestoreMateHere
            ? "Restore this Mate to continue chatting."
            : "Restore this Mate on your computer to send messages.")
        let actionTitle = if updatingArchivedMate { "Updating…" }
            else if restoredMateNeedsRefresh { "Refresh Mate" }
            else if checking { "Check Mate change" }
            else { "Restore Mate" }
        let actionDisabled = updatingArchivedMate || !session.isConnected
            || (session.mateCommandPending && !checking && !restoredMateNeedsRefresh)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "archivebox")
                    .foregroundStyle(archivedMateError == nil ? .secondary : Color.orange)
                    .padding(.top, 2)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Archived Mate").font(.subheadline.weight(.semibold).width(.expanded))
                    Text(message).font(.footnote).foregroundStyle(Color(.secondaryLabel))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if canRestoreMateHere {
                Button {
                    Task { await restoreArchivedMate() }
                } label: {
                    Label(actionTitle, systemImage: checking || restoredMateNeedsRefresh ? "arrow.clockwise" : "arrow.uturn.backward")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .foregroundStyle(Color(.systemBackground))
                        .background(Color(.label), in: .capsule)
                        .opacity(actionDisabled ? 0.45 : 1)
                        .contentShape(.capsule)
                }
                .buttonStyle(ChatPressStyle())
                .disabled(actionDisabled)
                .accessibilityIdentifier("restoreMateFromConversation")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 26))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("archivedMateConversationNotice")
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func restoreArchivedMate() async {
        let currentOwner = session.ownership
        guard archivedMate, canRestoreMateHere, let mateID, owner == currentOwner,
              session.viewingRunID == runID, session.isConnected, !updatingArchivedMate else { return }
        updatingArchivedMate = true
        archivedMateError = nil
        defer { updatingArchivedMate = false }
        do {
            if !restoredMateNeedsRefresh {
                if session.mateCommandUncertain { try await session.checkMateCommand() }
                else { try await session.manageMate(mateID, change: .archive(false)) }
            }
            guard currentOwner == session.ownership, session.viewingRunID == runID, self.mateID == mateID, archivedMate else { return }
            restoredMateNeedsRefresh = true
            try await loadConversationMate(mateHeaderRequest)
            restoredMateNeedsRefresh = false
        } catch {
            guard currentOwner == session.ownership, session.viewingRunID == runID, self.mateID == mateID, archivedMate else { return }
            archivedMateError = error.localizedDescription
        }
    }

    private var composerControls: some View {
        VStack(spacing: 8) {
            #if MAINS_GPT_LIVE
            if focusedVoice && (session.waitingForDecision || session.pendingQuestions != nil) {
                Button { voicePresentation = .conversation } label: {
                    Label("Response needed", systemImage: "hand.raised")
                        .font(.footnote.weight(.medium)).padding(.horizontal, 14).frame(minHeight: 40)
                        .background(Color(.secondarySystemBackground), in: .capsule)
                }.buttonStyle(ChatPressStyle())
                    .accessibilityHint("Open the conversation to answer the pending request.")
                    .accessibilityIdentifier("voiceNeedsResponse")
            }
            #endif
            if !focusedVoice && !agents.isEmpty {
                SubagentDock(agents: agents, partial: session.transcript.page?.hasOlder == true || session.transcript.page?.hasNewer == true,
                             expanded: $agentsExpanded) { agent in
                    guard owner == session.ownership, session.viewingRunID == runID else { return }
                    agentsExpanded = false
                    selectedAgent = SubagentSelection(runID: runID, agentID: agent.id, owner: session.ownership)
                }.zIndex(1)
            }
            SettingsRecoveryNotice(session: session, runID: runID)
            if let decision = session.pendingPlanDecision, decision.uncertain {
                ChatNotice(title: "Plan decision unconfirmed", message: "Check whether the computer received the plan decision.", symbol: "exclamationmark.circle", warning: true) {
                    Button(decision.checking ? "Checking…" : "Check decision") {
                        let owner = session.ownership
                        Task {
                            do { try await session.checkPlanDecision() }
                            catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
                        }
                    }
                    .disabled(decision.checking || !session.isConnected)
                    .accessibilityIdentifier("checkPlanDecision")
                }
            }
            if !focusedVoice {
                RemoteConversationQueueView(queues: session.viewingRunID == runID ? session.remoteQueues : [])
            }
            if !focusedVoice, run?.supportsSteering == true, run?.isReplica != true {
                ConversationQueueView(session: session, queue: queue, canSteer: run?.canSteer == true && session.pendingPlanDecision?.runID != runID, resume: prepareQueueResume)
            }
            if uncertain, let pending = session.pendingMessage,
               !pending.isQueueOwned || pending.runID != runID || !queue.messages.contains(where: { $0.id == pending.queueInputID }) {
                ChatNotice(title: "Delivery unconfirmed", message: "“\(pending.text.prefix(160))”\nCheck this message before sending another." + (draft.failure.map { "\n" + $0 } ?? ""), symbol: "exclamationmark.circle", warning: true) {
                    Button(session.sending ? "Checking…" : "Check delivery") {
                        Task {
                            do {
                                if let id = pending.queueInputID { _ = try await session.checkQueuedInput(id) }
                                else { _ = try await session.checkDelivery() }
                                draft.dismissFailure()
                            }
                            catch { draft.showFailure(error.localizedDescription) }
                        }
                    }
                    .disabled(session.sending || !session.isConnected)
                    .accessibilityIdentifier("checkDelivery")
                }
            } else if let failure = draft.failure, failure != run?.archivedReplyError {
                ChatNotice(title: draft.failureTitle, message: failure, symbol: "exclamationmark.circle", warning: true) {
                    if let unsent = draft.unsentText {
                        Button("Copy unsent message", systemImage: "doc.on.doc") { UIPasteboard.general.string = unsent }
                        if !draft.unsentAttachments.isEmpty { Button("Use failed message and files") { draft.restoreUnsent() } }
                    }
                    Button("Dismiss") { draft.dismissFailure() }
                }
            }
            if run?.isReplica == true {
                BridgeReadOnlyNotice(text: "Read-only conversation from another computer")
                    .padding(.horizontal, 12)
            } else if let message = run?.archivedReplyError {
                ChatNotice(title: "Reply interrupted", message: message, symbol: "exclamationmark.circle", warning: true) { EmptyView() }
                    .accessibilityIdentifier("archivedConversationNotice")
            } else if let context = composerContext {
                if !focusedVoice, goalRequest.canRead, let goalSummary, goalSummary.owner == session.ownership {
                    ConversationGoalBar(summary: goalSummary.value, running: run?.status == "running",
                                        supportsControls: session.supportsMobileGoalControls, enabled: session.canChangeGoal(runID),
                                        edit: { revision in
                        editingGoal = GoalEditRequest(revision: revision, owner: session.ownership, summary: goalSummary.value)
                    }, change: applyGoalChange)
                }
                MessageComposer(session: session, context: context, draft: draft,
                    canSend: run != nil && session.pendingConversationAction == nil && session.pendingPlanDecision?.runID != runID && session.pendingFork == nil && session.stoppingRunID != runID && (usesQueue ||
                        session.isConnected && !uncertain && !session.sending && pending?.status != .accepted && !scroll.paging && run?.isActive != true),
                    active: run?.isActive == true, canSendDuringRun: run?.supportsSteering == true, sendLabel: sendLabel,
                    stopping: session.stoppingRunID == runID, stop: { Task { await stop() } },
                    model: { modelSheet = true }, options: { optionsSheet = true }, send: prepareSend)
                    .disabled(disablesComposer)
            }
        }
        .padding(.top, 8).padding(.bottom, 8)
    }

    private func applyGoalChange(_ change: MobileGoalChange, revision: String) {
        let owner = session.ownership
        Task {
            guard owner == session.ownership else { return }
            do { try await session.changeGoal(runID, revision: revision, change: change) }
            catch {
                if owner == session.ownership && !session.goalChangeNeedsCheck { session.actionError = error.localizedDescription }
            }
        }
    }

    private func prepareSend() {
        guard !archivedMate, let run, run.archivedReplyError == nil, owner == session.ownership,
              let backendID = session.pairing?.descriptor.backendId, !draft.isSending else { return }
        let queued = usesQueue
        if !session.hasConsent(providerID: run.providerId) {
            consentQueuesMessage = queued; consentResumesQueue = false; consentForksConversation = false
            consent = ConsentContext(backendID: backendID, providerID: run.providerId, isDemo: session.isDemo)
        } else { Task { await send(queued: queued) } }
    }

    private func manage(_ action: ConversationAction) {
        guard owner == session.ownership, session.canManageConversation(runID, action: action) else { return }
        let currentOwner = session.ownership
        Task {
            guard currentOwner == session.ownership else { return }
            do { try await session.manageConversation(runID, action: action) }
            catch {
                if currentOwner == session.ownership {
                    let message = error.localizedDescription
                    session.actionError = message.contains("not available to paired devices")
                        ? "Update Mains on your computer to manage chats from this iPhone." : message
                }
            }
        }
    }

    private func prepareQueueResume() {
        guard !archivedMate, let run, let backendID = session.pairing?.descriptor.backendId, owner == session.ownership else { return }
        if !session.hasConsent(providerID: run.providerId) {
            consentResumesQueue = true; consentForksConversation = false
            consent = ConsentContext(backendID: backendID, providerID: run.providerId, isDemo: session.isDemo)
        } else { Task { await session.resumeMessageQueue(runID) } }
    }

    private func send(queued: Bool) async {
        guard !archivedMate, owner == session.ownership else { return }
        if queued {
            do { try session.submitQueuedDraft(runID); acceptedCount += 1 }
            catch { draft.showFailure(error.localizedDescription) }
            return
        }
        guard let submission = draft.begin() else { return }
        do {
            if session.transcript.page?.hasNewer == true {
                scroll.viewport.beginPage()
                await session.loadHistory(direction: "latest")
                guard session.viewingRunID == runID, session.historyError == nil,
                      session.transcript.page?.hasNewer != true else {
                    throw MainsError.server("Couldn't open the latest messages. Your message wasn't sent.")
                }
                scroll.viewport.finishPage(latestConfirmed: true)
            } else { scroll.viewport.follow() }
            session.setHistoryFollowing(true)
            guard owner == session.ownership else { throw MainsError.changedBackend }
            _ = try await session.send(submission.text, runID: runID, attachments: submission.attachments, contextSkills: submission.contextSkills, contextScope: submission.contextScope)
            guard owner == session.ownership else { return }
            draft.accept(submission)
            acceptedCount += 1
        } catch {
            guard owner == session.ownership else { return }
            if scroll.paging { scroll.viewport.finishPage(latestConfirmed: false) }
            draft.reject(submission, message: error.localizedDescription, uncertain: uncertain)
        }
    }

    private func prepareFork() {
        guard !archivedMate, session.canForkConversation(runID), let run, owner == session.ownership,
              let backendID = session.pairing?.descriptor.backendId else { return }
        if !session.hasConsent(providerID: run.providerId) {
            consentForksConversation = true; consentResumesQueue = false
            consent = ConsentContext(backendID: backendID, providerID: run.providerId, isDemo: session.isDemo)
        } else { Task { await fork() } }
    }

    private func fork() async {
        guard !archivedMate, owner == session.ownership, session.viewingRunID == runID else { return }
        do {
            let id = try await session.forkConversation(runID)
            guard owner == session.ownership, session.viewingRunID == runID else { return }
            onFork(id)
        } catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
    }

    private func stop() async {
        guard owner == session.ownership else { return }
        do { try await session.stop(runID) }
        catch { if owner == session.ownership { draft.showFailure(error.localizedDescription, title: "Couldn't stop reply") } }
    }
}

struct MateConversationTitle: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let mate: Mate?
    var avatarFrame: Binding<CGRect>? = nil
    var zoomNamespace: Namespace.ID? = nil
    var openInfo: (() -> Void)? = nil
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        let compact = horizontalSizeClass != .regular
        let name = mate?.name ?? String(localized: "Mate")
        let archived = mate?.isArchived == true
        // Keep the native bar at its usual height while the avatar and name extend over the chat.
        Color.clear.frame(width: compact ? 112 : 240, height: 44)
            .overlay(alignment: .top) {
                Button { openInfo?() } label: {
                    VStack(spacing: -8) {
                        avatar
                            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { avatarFrame?.wrappedValue = $0 }
                        VStack(spacing: 2) {
                            Text(name).font(.footnote.weight(.semibold).width(.expanded)).lineLimit(1)
                            if archived { ArchivedMateBadge().accessibilityHidden(true) }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .modifier(GlassSurface(radius: 18, interactive: openInfo != nil))
                    }
                    .contentShape(.rect)
                    .frame(width: compact ? 192 : 240)
                    .dynamicTypeSize(...DynamicTypeSize.xLarge)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .buttonStyle(.plain)
                .offset(y: -11)
                .accessibilityLabel(archived ? "\(name), archived Mate" : name)
                .accessibilityHint(mate == nil || openInfo == nil ? "" : "Opens Mate Details")
                .accessibilityRemoveTraits(mate == nil || openInfo == nil ? .isButton : [])
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("mateConversationHeader")
                .allowsHitTesting(mate != nil && openInfo != nil)
            }
    }

    @ViewBuilder private var avatar: some View {
        let artwork = Group {
            if let mate, let preset = MateRobotAssets.catalogue?.preset(for: mate.avatar, mateID: mate.id) {
                if mate.isArchived == true { MateRobotThumbnail(preset: preset).saturation(0.25) }
                else { MateRobotPreview(preset: preset, acceptsDrag: false, motion: .greeting) }
            } else {
                RegistryIcon(token: "icon:assistant-steps", size: 27)
                    .frame(width: 56, height: 56)
                    .background(.quaternary, in: .circle)
            }
        }.frame(width: 84, height: 84)
        if let mate, let zoomNamespace {
            artwork.background(alignment: .center) {
                // Use the avatar's bounds as the source without enlarging a second copy of the robot.
                Color.black.opacity(0.001)
                    .matchedTransitionSource(id: mate.id, in: zoomNamespace) { $0.clipShape(RoundedRectangle(cornerRadius: 22)) }
            }
        } else {
            artwork
        }
    }
}

private struct ConversationGoalBar: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let summary: MobileGoalSummary
    let running: Bool
    let supportsControls: Bool
    let enabled: Bool
    let edit: (String) -> Void
    let change: (MobileGoalChange, String) -> Void
    private static let actionSize: CGFloat = 44
    @ScaledMetric(relativeTo: .footnote) private var statusLineHeight: CGFloat = 16
    @State private var clearRevision: String?

    private var title: LocalizedStringKey {
        switch summary.status {
        case "active": running ? "Pursuing goal" : "Goal active"
        case "complete": "Goal complete"
        case "paused": "Goal paused"
        case "blocked": "Goal blocked"
        case "budgetLimited": "Budget reached"
        case "usageLimited": "Usage limit reached"
        default: "Goal"
        }
    }

    private var tint: Color {
        switch summary.status {
        case "active", "complete": .green
        case "blocked", "budgetLimited", "usageLimited": .orange
        default: Color(.secondaryLabel)
        }
    }

    private var usage: String {
        var parts: [String] = []
        if let tokens = summary.tokensUsed, tokens > 0 {
            parts.append(String(localized: "\(tokens.formatted()) tokens"))
        }
        if let seconds = summary.timeUsedSeconds, seconds > 0 {
            parts.append(Duration.seconds(seconds).formatted(.units(allowed: [.hours, .minutes, .seconds], width: .narrow)))
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        let usage = usage
        Group {
            if supportsControls, let revision = summary.revision {
                ViewThatFits(in: .horizontal) {
                    // The centered status gets extra space above it from the 44-point controls.
                    goalContent(bottomInset: max(0, (Self.actionSize - statusLineHeight) / 2)) {
                        HStack(spacing: 4) {
                            status(usage).layoutPriority(1)
                            Spacer(minLength: 0)
                            controls(revision)
                        }
                    }
                    goalContent {
                        VStack(alignment: .leading, spacing: 2) {
                            status(usage)
                            controls(revision).frame(maxWidth: .infinity, alignment: .trailing)
                        }
                    }
                }
            } else {
                goalContent { status(usage) }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 22))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversationGoalBar")
        .padding(.horizontal, MessageComposer.horizontalInset)
        .alert("Clear this goal?", isPresented: Binding(
            get: { clearRevision != nil }, set: { if !$0 { clearRevision = nil } }
        ), presenting: clearRevision) { revision in
            Button("Clear goal", role: .destructive) { change(.clear, revision) }
            Button("Cancel", role: .cancel) {}
        } message: { _ in Text("The conversation and its messages will be kept.") }
    }

    private func goalContent<Header: View>(bottomInset: CGFloat = 0, @ViewBuilder header: () -> Header) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            header()
            Text(summary.objective).font(.subheadline).lineLimit(2)
                // Fit the header first and wrap the objective at the resulting width.
                .frame(idealWidth: 0, maxWidth: .infinity, alignment: .leading)
        }
        .padding(.bottom, bottomInset)
    }

    private func status(_ usage: String) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                statusLabel
                if !usage.isEmpty { usageLabel(usage) }
            }
            VStack(alignment: .leading, spacing: 3) {
                statusLabel
                if !usage.isEmpty { usageLabel(usage) }
            }
        }
        .font(.footnote)
    }

    private func controls(_ revision: String) -> some View {
        HStack(spacing: 0) {
            if summary.status != "complete" {
                action("Edit goal", icon: "pencil", id: "editGoal") { edit(revision) }
            }
            if summary.status == "active" {
                action("Pause goal", icon: "pause.fill", id: "pauseGoal") { change(.pause, revision) }
            } else if summary.status == "paused" {
                action("Resume goal", icon: "play.fill", id: "resumeGoal") { change(.resume, revision) }
            }
            action("Clear goal", icon: "trash", id: "clearGoal", tint: .red) { clearRevision = revision }
        }
        .buttonStyle(ChatPressStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
    }

    private func action(_ title: LocalizedStringKey, icon: String, id: String,
                        tint: Color = Color(.secondaryLabel), perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Image(systemName: icon)
                .font(.subheadline.weight(.medium)).foregroundStyle(tint)
                .frame(width: Self.actionSize, height: Self.actionSize).contentShape(.rect)
        }
        .accessibilityLabel(title)
        .accessibilityIdentifier(id)
    }

    private var statusLabel: some View {
        Label {
            Text(title).fontWeight(.semibold)
        } icon: {
            Image(systemName: summary.status == "complete" ? "checkmark.circle.fill" : "target")
                .foregroundStyle(tint).accessibilityHidden(true)
        }
    }

    private func usageLabel(_ usage: String) -> some View {
        Text(usage).foregroundStyle(Color(.secondaryLabel)).accessibilityIdentifier("goalSummaryUsage")
    }
}

private struct GoalEditRequest: Identifiable {
    let id = UUID()
    let revision: String
    let owner: Int
    let summary: MobileGoalSummary
}

private struct GoalObjectiveEditor: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let runID: String
    let request: GoalEditRequest
    @Environment(\.dismiss) private var dismiss
    @State private var objective: String
    @State private var saving = false
    @State private var error: String?
    @FocusState private var focused: Bool

    init(session: BackendSession, runID: String, request: GoalEditRequest) {
        self.session = session; self.runID = runID; self.request = request
        _objective = State(initialValue: request.summary.objectiveTruncated == true ? "" : request.summary.objective)
    }

    private var trimmed: String { objective.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var allowed: Bool {
        !saving && !trimmed.isEmpty && trimmed.unicodeScalars.count <= 2048 && session.canChangeGoal(runID)
            && (request.summary.objectiveTruncated == true || trimmed != request.summary.objective)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $objective)
                        .frame(minHeight: 120).focused($focused)
                        .accessibilityLabel("Goal objective").accessibilityIdentifier("goalObjectiveInput")
                } footer: {
                    if trimmed.unicodeScalars.count > 2048 {
                        Text("Use up to 2,048 characters.")
                    } else if request.summary.objectiveTruncated == true {
                        Text("Enter a replacement for the full goal objective.")
                    }
                }
                if let error { Text(error).foregroundStyle(.secondary) }
            }
            .expandedNavigationTitle("Edit goal")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save", action: save).disabled(!allowed).accessibilityIdentifier("saveGoalObjective")
                }
            }
        }
        .task { focused = true }
        .interactiveDismissDisabled(saving)
    }

    private func save() {
        guard allowed, request.owner == session.ownership else { return }
        let text = trimmed
        saving = true; error = nil
        Task {
            defer { saving = false }
            do {
                try await session.changeGoal(runID, revision: request.revision, change: .edit(text))
                dismiss()
            } catch {
                self.error = session.goalChangeNeedsCheck ? "Close this editor to check whether Codex saved the goal." : error.localizedDescription
            }
        }
    }
}

struct GoalChangeDeliveryNotice: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession

    var body: some View {
        if session.goalChangeNeedsCheck {
            ChatNotice(title: "Goal change unconfirmed", message: "Check whether Codex applied the change.",
                       symbol: "exclamationmark.circle", warning: true) {
                Button("Check goal change") {
                    let owner = session.ownership
                    Task {
                        guard owner == session.ownership else { return }
                        do { try await session.checkGoalChange() }
                        catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
                    }
                }
                .disabled(!session.isConnected || !session.supportsMobileGoalControls)
                .accessibilityIdentifier("checkGoalChange")
            }
            .padding(.vertical, 8).background(Color(.systemBackground))
        }
    }
}

private struct ContentReference: Identifiable { let id: Int }
