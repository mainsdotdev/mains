import SwiftUI

@MainActor
struct ConversationView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    private struct HistoryEntry: Hashable {
        let runID: String
        let cursor: HistoryCursor?
    }
    let session: BackendSession
    let runID: String
    let openComputer: () -> Void
    let onNew: () -> Void
    let onFork: (String) -> Void
    let initialCursor: HistoryCursor?
    @Bindable private var draft: ConversationDraft
    @Bindable private var queue: ConversationQueue
    @State private var owner: Int?
    @State private var viewport = TranscriptViewport()
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
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
    private var agents: [SessionSubagent] { session.viewingRunID == runID ? session.transcript.subagents : [] }
    private var run: Conversation? { session.conversations.first { $0.id == runID } }
    private var pending: PendingMessage? { session.pendingMessage?.runID == runID ? session.pendingMessage : nil }
    private var composerContext: ComposerContext? {
        if let run { return ComposerContext(run: run) }
        // The command can be acknowledged before getById/history arrives. Keep
        // the same composer mounted throughout that metadata hand-off.
        if pending?.status == .accepted, let space = session.selectedSpace { return ComposerContext(space: space, runID: runID) }
        return nil
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

    init(session: BackendSession, runID: String, openComputer: @escaping () -> Void, onNew: @escaping () -> Void, onFork: @escaping (String) -> Void, initialCursor: HistoryCursor? = nil) {
        self.session = session; self.runID = runID
        self.openComputer = openComputer
        self.onNew = onNew
        self.onFork = onFork
        self.initialCursor = initialCursor
        draft = session.draft(for: runID)
        queue = session.messageQueue(for: runID)
    }

    var body: some View {
        let displayedOutputID = outputSelection?.id
        ConversationWorkspace(state: companion) {
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
        .navigationTitle(focusedVoice || showsConnectionPill ? "" : run?.displayTitle ?? "Conversation")
        .toolbarRole(.editor)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            conversationToolbar
        }
        .task(id: historyEntry) {
            owner = session.ownership
            if initialCursor != nil, initializedHistoryEntry != historyEntry {
                // Returning from a file diff must preserve the existing transcript and viewport.
                initializedHistoryEntry = historyEntry
                viewport.beginPage()
                await session.selectConversation(runID, around: initialCursor)
                viewport.finishPage(latestConfirmed: false)
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
        .onChange(of: expandedWorkspace, initial: true) { _, _ in adaptCompanion() }
        .onChange(of: hasOutputs) { _, _ in adaptCompanion() }
        .onChange(of: draft.text) { _, _ in companion.focusConversation() }
        .onChange(of: focusedVoice) { _, focused in if focused { companion.close(); outputSelection = nil } }
        .onChange(of: session.ownership) { _, _ in companion.close(); outputSelection = nil }
        .sheet(isPresented: $projectSheet) {
            ConversationProjectSheet(session: session, runID: runID, owner: owner ?? -1)
        }
        .confirmationDialog("Delete chat?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete chat", role: .destructive) { manage(.delete) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes the chat and its chat files. This can’t be undone.")
        }
        .onDisappear { if selectedFile == nil { session.leaveConversation(runID) } }
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
        .effortOverlay(isPresented: $modelSheet, session: session, context: run.map { ComposerContext(run: $0) })
        .sheet(isPresented: $optionsSheet) { if let run { RunOptionsSheet(session: session, context: ComposerContext(run: run)) } }
        .sheet(item: $selectedAgent) { SubagentDetailSheet(session: session, selection: $0) }
        .onChange(of: agents.isEmpty) { _, empty in if empty { agentsExpanded = false } }
        .sensoryFeedback(.impact(weight: .light), trigger: acceptedCount)
        .runFileLinks(session: session, runID: runID)
        .environment(\.openConversationOutput, OpenConversationOutputAction { requestedRun, source in
            guard requestedRun == runID, owner == session.ownership, session.viewingRunID == runID else { return false }
            outputSelection = ConversationOutputSelection(source: source, owner: session.ownership)
            companion.open()
            return true
        })
    }

    private func adaptCompanion() { if !focusedVoice { companion.adapt(expanded: expandedWorkspace, hasOutputs: hasOutputs) } }
    private func toggleCompanion() {
        if companion.isOpen && expandedWorkspace { companion.close(); outputSelection = nil }
        else if companion.isOpen && companion.focus == .output { companion.focusConversation() }
        else { companion.open() }
    }

    private var conversationContent: some View {
        ZStack {
            ConversationTranscript(session: session, runID: runID, providerID: run?.providerId ?? composerContext?.providerId ?? "", viewport: $viewport, openFile: { turn, file in
                selectedFile = TurnFileSelection(runID: runID, turnID: turn.id, file: file, owner: session.ownership)
            }, openSubagents: { agentsExpanded.toggle() }, fork: prepareFork, searchCursor: initialCursor) {
                content = ContentReference(id: $0)
            }
            .opacity(focusedVoice ? 0 : 1)
            .allowsHitTesting(!focusedVoice)
            .accessibilityHidden(focusedVoice)
            #if MAINS_GPT_LIVE
            if focusedVoice {
                VoiceFocusStage(voice: session.voice)
                    .background { KeyboardDismissBackground(color: Color(.systemBackground)) }
                    .transition(.opacity)
            }
            #endif
        }
        .background(Color(.systemBackground))
        .safeAreaInset(edge: .bottom, spacing: 0) { composerArea }
    }

    @ToolbarContentBuilder private var conversationToolbar: some ToolbarContent {
            if showsConnectionPill {
                ToolbarItem(placement: .principal) {
                    ConnectionPill(session: session, action: openComputer)
                }
                .sharedBackgroundVisibility(.hidden)
            } else if session.isDemo && !focusedVoice {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text(run?.displayTitle ?? "Conversation").font(.headline).lineLimit(1)
                        Text("Demo · On this iPhone").font(.caption2).foregroundStyle(.secondary)
                    }.accessibilityIdentifier("conversationDemoStatus")
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                #if MAINS_GPT_LIVE
                if ownsVoice { VoicePresentationMenu() }
                #endif
                if (hasOutputs || companion.isOpen) && !focusedVoice {
                    Button(companion.isOpen && !expandedWorkspace && companion.focus == .output ? "Show conversation" : "Outputs",
                           systemImage: companion.isOpen && !expandedWorkspace && companion.focus == .output ? "bubble.left" : "doc.on.doc", action: toggleCompanion)
                        .accessibilityIdentifier("conversationOutputs")
                }
                if !focusedVoice {
                    Button("New conversation", systemImage: "square.and.pencil", action: onNew).accessibilityIdentifier("newConversation")
                    Menu {
                        Button(action: prepareFork) {
                            Label { Text(forkTitle) } icon: { ConversationActionIcons.fork }
                        }.disabled(!session.canForkConversation(runID)).accessibilityIdentifier("forkConversation")
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

    private var composerArea: some View {
        VStack(spacing: 8) {
            #if MAINS_GPT_LIVE
            if focusedVoice && (session.waitingForDecision || session.pendingQuestions != nil) {
                Button { voicePresentation = .conversation } label: {
                    Label("Response needed", systemImage: "hand.raised")
                        .font(.footnote.weight(.medium)).padding(.horizontal, 14).frame(minHeight: 40)
                }.buttonStyle(ChatPressStyle()).modifier(GlassSurface(radius: 20))
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
            if !focusedVoice {
                RemoteConversationQueueView(queues: session.viewingRunID == runID ? session.remoteQueues : [])
            }
            if !focusedVoice, run?.supportsSteering == true, run?.isReplica != true {
                ConversationQueueView(session: session, queue: queue, canSteer: run?.canSteer == true, resume: prepareQueueResume)
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
                ChatNotice(title: "Reply interrupted", message: message, symbol: "exclamationmark.circle", warning: true, horizontalInset: 12) { EmptyView() }
                    .accessibilityIdentifier("archivedConversationNotice")
            } else if let context = composerContext {
                MessageComposer(session: session, context: context, draft: draft,
                    canSend: run != nil && session.pendingConversationAction == nil && session.pendingFork == nil && session.stoppingRunID != runID && (usesQueue ||
                        session.isConnected && !uncertain && !session.sending && pending?.status != .accepted && !viewport.paging && run?.isActive != true),
                    active: run?.isActive == true, canSendDuringRun: run?.supportsSteering == true, sendLabel: sendLabel,
                    stopping: session.stoppingRunID == runID, stop: { Task { await stop() } },
                    model: { modelSheet = true }, options: { optionsSheet = true }, send: prepareSend)
                    .disabled(run == nil || session.pendingConversationAction.map { $0.runID == runID && $0.action.retiresConversation } == true)
            }
        }
        .padding(.top, 8).padding(.bottom, 8)
    }

    private func prepareSend() {
        guard let run, run.archivedReplyError == nil, owner == session.ownership,
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
        guard let run, let backendID = session.pairing?.descriptor.backendId, owner == session.ownership else { return }
        if !session.hasConsent(providerID: run.providerId) {
            consentResumesQueue = true; consentForksConversation = false
            consent = ConsentContext(backendID: backendID, providerID: run.providerId, isDemo: session.isDemo)
        } else { Task { await session.resumeMessageQueue(runID) } }
    }

    private func send(queued: Bool) async {
        guard owner == session.ownership else { return }
        if queued {
            do { try session.submitQueuedDraft(runID); acceptedCount += 1 }
            catch { draft.showFailure(error.localizedDescription) }
            return
        }
        guard let submission = draft.begin() else { return }
        do {
            if session.transcript.page?.hasNewer == true {
                viewport.beginPage()
                await session.loadHistory(direction: "latest")
                guard session.viewingRunID == runID, session.historyError == nil,
                      session.transcript.page?.hasNewer != true else {
                    throw MainsError.server("Couldn't open the latest messages. Your message wasn't sent.")
                }
                viewport.finishPage(latestConfirmed: true)
            } else { viewport.follow() }
            session.setHistoryFollowing(true)
            guard owner == session.ownership else { throw MainsError.changedBackend }
            _ = try await session.send(submission.text, runID: runID, attachments: submission.attachments, contextSkills: submission.contextSkills, contextScope: submission.contextScope)
            guard owner == session.ownership else { return }
            draft.accept(submission)
            acceptedCount += 1
        } catch {
            guard owner == session.ownership else { return }
            if viewport.paging { viewport.finishPage(latestConfirmed: false) }
            draft.reject(submission, message: error.localizedDescription, uncertain: uncertain)
        }
    }

    private func prepareFork() {
        guard session.canForkConversation(runID), let run, owner == session.ownership,
              let backendID = session.pairing?.descriptor.backendId else { return }
        if !session.hasConsent(providerID: run.providerId) {
            consentForksConversation = true; consentResumesQueue = false
            consent = ConsentContext(backendID: backendID, providerID: run.providerId, isDemo: session.isDemo)
        } else { Task { await fork() } }
    }

    private func fork() async {
        guard owner == session.ownership, session.viewingRunID == runID else { return }
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

private struct ContentReference: Identifiable { let id: Int }
