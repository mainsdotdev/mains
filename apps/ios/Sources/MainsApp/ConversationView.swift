import SwiftUI

@MainActor
struct ConversationView: View {
    let session: BackendSession
    let runID: String
    let onNew: () -> Void
    @Bindable private var draft: ConversationDraft
    @State private var owner: Int?
    @State private var viewport = TranscriptViewport()
    @State private var consent: ConsentContext?
    @State private var content: ContentReference?
    @State private var acceptedCount = 0
    @State private var modelSheet = false
    @State private var optionsSheet = false
    @State private var outputs = false
    @State private var outputPresence: (owner: Int, runID: String, available: Bool)?
    @State private var selectedFile: TurnFileSelection?
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

    init(session: BackendSession, runID: String, onNew: @escaping () -> Void) {
        self.session = session; self.runID = runID
        self.onNew = onNew
        draft = session.draft(for: runID)
    }

    var body: some View {
        VStack(spacing: 0) {
            ConnectionNotice(session: session)
            ConversationTranscript(session: session, runID: runID, providerID: run?.providerId ?? composerContext?.providerId ?? "", viewport: $viewport, openFile: { turn, file in
                selectedFile = TurnFileSelection(runID: runID, turnID: turn.id, file: file, owner: session.ownership)
            }) {
                content = ContentReference(id: $0)
            }
        }
        .background(Color(.systemBackground))
        .safeAreaInset(edge: .bottom, spacing: 0) { composerArea }
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle(run?.displayTitle ?? "Conversation")
        .toolbarRole(.editor)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            if session.isDemo {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text(run?.displayTitle ?? "Conversation").font(.headline).lineLimit(1)
                        Text("Demo · On this iPhone").font(.caption2).foregroundStyle(.secondary)
                    }.accessibilityIdentifier("conversationDemoStatus")
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                if hasOutputs {
                    Button("Outputs", systemImage: "doc.on.doc") { outputs = true }.accessibilityIdentifier("conversationOutputs")
                }
                Button("New conversation", systemImage: "square.and.pencil", action: onNew).accessibilityIdentifier("newConversation")
                Menu {
                    Label(session.isDemo ? "Demo Mode · On this iPhone" : session.connection.label, systemImage: session.isConnected ? "checkmark.circle" : "wifi.slash")
                    Button("Sync now", systemImage: "arrow.clockwise") {
                        Task { await session.refresh(); if session.viewingRunID == runID { await session.loadHistory(direction: "refresh") } }
                    }.disabled(!session.isConnected)
                    if !session.isConnected {
                        Button("Reconnect", systemImage: "arrow.clockwise") { session.retry() }
                            .disabled(session.connection.isBusy || [.unauthorized, .incompatible].contains(session.connection))
                    }
                } label: { Image(systemName: "ellipsis") }
                .accessibilityLabel("Conversation options").accessibilityIdentifier("conversationOptions")
            }
        }
        .task(id: runID) {
            owner = session.ownership
            if session.viewingRunID != runID { await session.selectConversation(runID) }
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
        .onDisappear { if selectedFile == nil { session.leaveConversation(runID) } }
        .navigationDestination(item: $selectedFile) { selection in
            TurnFileDiffView(session: session, selection: selection, close: { selectedFile = nil })
        }
        .sheet(item: $consent) { context in
            ConsentView(context: context) {
                guard owner == session.ownership else { return }
                session.grantConsent(providerID: context.providerID, backendID: context.backendID)
                Task { await send() }
            }
        }
        .sheet(item: $content) { reference in
            NavigationStack { FullMessageView(session: session, artifactID: reference.id) }
        }
        .effortOverlay(isPresented: $modelSheet, session: session, context: run.map { ComposerContext(run: $0) })
        .sheet(isPresented: $optionsSheet) { if let run { RunOptionsSheet(session: session, context: ComposerContext(run: run)) } }
        .sheet(isPresented: $outputs) { OutputsView(session: session, runID: runID) }
        .sensoryFeedback(.impact(weight: .light), trigger: acceptedCount)
    }

    private var composerArea: some View {
        VStack(spacing: 8) {
            SettingsRecoveryNotice(session: session, runID: runID)
            if uncertain, let pending = session.pendingMessage {
                ChatNotice(title: "Delivery unconfirmed", message: "“\(pending.text.prefix(160))”\nCheck this message before sending another." + (draft.failure.map { "\n" + $0 } ?? ""), symbol: "exclamationmark.circle", warning: true) {
                    Button(session.sending ? "Checking…" : "Check delivery") {
                        Task {
                            do { _ = try await session.checkDelivery(); draft.dismissFailure() }
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
                    canSend: run != nil && session.isConnected && !uncertain && !session.sending && pending?.status != .accepted && !viewport.paging,
                    active: run?.isActive == true, stopping: session.stoppingRunID == runID, stop: { Task { await stop() } },
                    model: { modelSheet = true }, options: { optionsSheet = true }, send: prepareSend)
                    .disabled(run == nil)
            }
        }
        .padding(.top, 8).padding(.bottom, 8)
    }

    private func prepareSend() {
        guard let run, run.archivedReplyError == nil, owner == session.ownership,
              let backendID = session.pairing?.descriptor.backendId, !draft.isSending else { return }
        if !session.hasConsent(providerID: run.providerId) { consent = ConsentContext(backendID: backendID, providerID: run.providerId, isDemo: session.isDemo) }
        else { Task { await send() } }
    }

    private func send() async {
        guard owner == session.ownership, let submission = draft.begin() else { return }
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
            guard owner == session.ownership else { throw MainsError.changedBackend }
            session.setHistoryFollowing(true)
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

    private func stop() async {
        guard owner == session.ownership else { return }
        do { try await session.stop(runID) }
        catch { if owner == session.ownership { draft.showFailure(error.localizedDescription, title: "Couldn't stop reply") } }
    }
}

private struct ContentReference: Identifiable { let id: Int }
