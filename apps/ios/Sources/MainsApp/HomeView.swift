import SwiftUI

struct HomeView: View {
    static let composerBottomInset: CGFloat = 8
    static let pairingButtonID = "homePairingButton"

    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let sidebarControl: SidebarControl
    let openComputer: () -> Void
    let openPairing: () -> Void
    let pairingTransition: Namespace.ID
    let onCreated: (String) -> Void
    @State private var targetPicker = false
    @State private var modelSheet = false
    @State private var optionsSheet = false
    @State private var consent: ConsentContext?
    #if MAINS_GPT_LIVE
    @AppStorage(VoicePresentation.storageKey) private var voicePresentation = VoicePresentation.focus
    private var preparingVoice: Bool {
        session.voice.ownsCall && session.voice.runID == nil && session.voiceSpaceID == space?.id
    }
    #endif
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var space: Space? { session.selectedSpace }

    var body: some View {
        VStack(spacing: 0) {
            #if MAINS_GPT_LIVE
            if !preparingVoice || voicePresentation != .focus { homeContent }
            #else
            homeContent
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        #if MAINS_GPT_LIVE
        .overlay { VoiceFocusStage(voice: session.voice, presented: preparingVoice && voicePresentation == .focus) }
        #endif
        .background(alignment: .center) { KeyboardDismissBackground(color: Color(.systemBackground)) }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { sidebarControl }
                .sharedBackgroundVisibility(.hidden)
            if session.isDemo || session.pairing != nil && !session.isConnected {
                ToolbarItem(placement: .principal) {
                    ConnectionPill(session: session, action: openComputer)
                        .transition(.opacity)
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: session.connection)
                }.sharedBackgroundVisibility(.hidden)
            }
            #if MAINS_GPT_LIVE
            if preparingVoice {
                ToolbarItem(placement: .topBarTrailing) { VoicePresentationMenu() }
            }
            #endif
        }
        .composerInset { editorExpanded in
            if let space {
                HomeComposerArea(session: session, space: space, targetPicker: $targetPicker, modelSheet: $modelSheet,
                                 optionsSheet: $optionsSheet, consent: $consent, editorExpanded: editorExpanded, onCreated: onCreated)
                    .id(space.id)
                    .transition(reduceMotion ? .identity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.24), value: space != nil)
        .composerPickers(model: $modelSheet, options: $optionsSheet, target: $targetPicker, session: session,
                         context: space.map { ComposerContext(space: $0) })
        .onChange(of: session.ownership) { _, _ in targetPicker = false }
        .onChange(of: space?.id) { _, _ in targetPicker = false }
        .onChange(of: space?.mode) { _, _ in targetPicker = false }
        .task(id: "\(space?.providerId ?? ""):\(session.isConnected)") {
            if let space { await session.loadModels(space.providerId, force: true) }
        }
    }

    @ViewBuilder private var homeContent: some View {
        if session.pairing == nil {
            UnpairedHomeArea(session: session, pair: openPairing, pairingTransition: pairingTransition)
        } else {
            Spacer(minLength: 20)
            pairedHomeContent
            Spacer(minLength: 20)
        }
    }

    @ViewBuilder private var pairedHomeContent: some View {
        if space == nil && !session.connection.isBusy {
            EmptyStateView(artwork: .spaces, title: "Choose a space",
                           description: Text("Open the sidebar to choose where to start."))
        } else if let space, session.isConnected, !session.homeDraft(for: space.id).hasContent {
            ViewThatFits(in: .vertical) {
                VStack(spacing: 8) {
                    TimelineView(.everyMinute) { clock in
                        Text(welcomeGreeting(at: clock.date))
                            .font(.title3.weight(.medium).width(.expanded))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .accessibilityIdentifier("homeGreeting")
                    }
                    welcomeHeading(for: space.mode)
                }
                welcomeHeading(for: space.mode)
                Color.clear.frame(height: 0).accessibilityHidden(true)
            }
            .padding(.horizontal, 24)
        }
    }

    private func welcomeHeading(for mode: String) -> some View {
        Text(welcomeTitle(for: mode))
            .font(.title.weight(.medium).width(.expanded))
            .multilineTextAlignment(.center)
            .frame(maxWidth: 420)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("homeWelcomeTitle")
    }

    private func welcomeGreeting(at date: Date) -> LocalizedStringKey {
        switch Calendar.autoupdatingCurrent.component(.hour, from: date) {
        case 6..<12: "Morning"
        case 12..<18: "Afternoon"
        case 18..<22: "Evening"
        default: "Night"
        }
    }

    private func welcomeTitle(for mode: String) -> LocalizedStringKey {
        switch mode {
        case "developer": "What are we building?"
        case "work": "What are we working on?"
        default: "What’s on your mind?"
        }
    }
}

private struct UnpairedHomeArea: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let pair: () -> Void
    let pairingTransition: Namespace.ID
    @State private var showsPairingHelp = false

    var body: some View {
        GeometryReader { viewport in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 24)
                    EmptyStateView(artwork: .pairing, title: "Connect your computer",
                                   description: Text("Open Mains on your computer and scan its pairing code.")) {
                        VStack(spacing: 4) {
                            Button("Scan pairing code", action: pair)
                                .buttonStyle(PairingActionStyle())
                                .matchedTransitionSource(id: HomeView.pairingButtonID, in: pairingTransition) {
                                    $0.clipShape(RoundedRectangle(cornerRadius: 12))
                                }
                                .accessibilityIdentifier("scanPairingCode")
                            Button("Where’s the code?") { showsPairingHelp = true }
                                .font(.subheadline).foregroundStyle(.secondary)
                                .padding(.horizontal, 12).frame(minHeight: 44).contentShape(.rect)
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("pairingHelp")
                        }
                    }
                    Spacer(minLength: 24)
                    Button {
                        do { try session.startDemo() } catch { session.actionError = error.localizedDescription }
                    } label: {
                        Text("Try Demo Mode")
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 16).frame(minHeight: 44).contentShape(.rect)
                    }
                    .buttonStyle(.plain).foregroundStyle(.secondary)
                    .accessibilityIdentifier("startDemo")
                }
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24).padding(.bottom, HomeView.composerBottomInset)
                .frame(maxWidth: .infinity, minHeight: viewport.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .alert("Find your pairing code", isPresented: $showsPairingHelp) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("In Mains on your computer, open Settings → Connect. Turn on Allow remote access, then enable Network access (LAN) or Tailscale HTTPS. Under Devices, select Show pairing code.")
        }
    }
}

struct HomeComposerArea: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let space: Space
    @Binding var targetPicker: Bool
    @Binding var modelSheet: Bool
    @Binding var optionsSheet: Bool
    @Binding var consent: ConsentContext?
    let editorExpanded: Bool
    let fixedWorkspace: Workspace?
    let focusChanged: ((Bool) -> Void)?
    let isCurrent: () -> Bool
    let onCreated: (String) -> Void
    @Bindable private var draft: ConversationDraft
    @State private var workspaceRequired = false
    private var target: HomeTarget { session.homeTargets[space.id] ?? HomeTarget() }
    private var workspaceID: String? { fixedWorkspace?.id ?? target.workspaceID }
    private var workspace: Workspace? { session.workspaces.first { $0.id == workspaceID && $0.isReplica != true } }
    private var workspaceIcon: String? { session.projects.first { $0.id == workspace?.projectId }?.icon }
    private var collection: ProjectCollection? { session.collections.first { $0.id == target.collectionID } }
    private var uncertain: Bool { session.pendingMessage?.status == .uncertain }
    private var ready: Bool { session.isConnected && !session.changingMode && !session.sending && !uncertain && session.pendingFork == nil && session.pendingConversationAction == nil }
    private var targetReady: Bool { space.mode != "developer" || workspace != nil && session.gitStates.first(where: { $0.workspaceId == workspace?.id })?.pathExists != false }
    init(session: BackendSession, space: Space, targetPicker: Binding<Bool>, modelSheet: Binding<Bool>, optionsSheet: Binding<Bool>,
         consent: Binding<ConsentContext?>, editorExpanded: Bool, fixedWorkspace: Workspace? = nil,
         focusChanged: ((Bool) -> Void)? = nil, isCurrent: @escaping () -> Bool = { true },
         onCreated: @escaping (String) -> Void) {
        self.session = session; self.space = space; _targetPicker = targetPicker; _modelSheet = modelSheet; _optionsSheet = optionsSheet
        _consent = consent; self.editorExpanded = editorExpanded
        self.fixedWorkspace = fixedWorkspace; self.focusChanged = focusChanged; self.isCurrent = isCurrent; self.onCreated = onCreated
        draft = session.homeDraft(for: space.id, workspaceID: fixedWorkspace?.id)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !editorExpanded {
                if fixedWorkspace == nil, session.isDemo, draft.text.isEmpty {
                    Button {
                        draft.text = "Review this workspace and suggest the next steps"
                    } label: {
                        Label("Try a sample request", systemImage: "sparkles").font(.footnote.weight(.medium))
                            .frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(.plain).foregroundStyle(.secondary).padding(.horizontal, 16)
                    .accessibilityIdentifier("demoSuggestedPrompt")
                    Button {
                        draft.text = DemoBackend.decisionPrompt
                    } label: {
                        Label("Try approvals and questions", systemImage: "hand.raised").font(.footnote.weight(.medium))
                            .frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(.plain).foregroundStyle(.secondary).padding(.horizontal, 16)
                    .accessibilityIdentifier("demoDecisionsPrompt")
                    Button { draft.text = DemoBackend.subagentsPrompt } label: {
                        Label("Try subagents", systemImage: "person.crop.rectangle.stack").font(.footnote.weight(.medium))
                            .frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(.plain).foregroundStyle(.secondary).padding(.horizontal, 16)
                    .accessibilityIdentifier("demoSubagentsPrompt")
                    if space.mode != "chat" {
                        Button {
                            draft.text = DemoBackend.changesPrompt
                        } label: {
                            Label("Try file changes", systemImage: "doc.badge.plus").font(.footnote.weight(.medium))
                                .frame(maxWidth: .infinity, minHeight: 32)
                        }
                        .buttonStyle(.plain).foregroundStyle(.secondary).padding(.horizontal, 16)
                        .accessibilityIdentifier("demoChangesPrompt")
                    }
                }
                if uncertain, let pending = session.pendingMessage {
                    ChatNotice(title: "Delivery unconfirmed", message: "“\(pending.text.prefix(160))”\nCheck this message before starting another conversation.", symbol: "exclamationmark.circle", warning: true) {
                        Button(session.sending ? "Checking…" : "Check delivery") {
                            Task { await checkDelivery(pending) }
                        }.disabled(!session.isConnected || session.sending).accessibilityIdentifier("checkDelivery")
                    }
                } else if workspaceRequired && !targetReady {
                    ChatNotice(title: "Workspace required", message: workspaceRequiredMessage, symbol: "exclamationmark.circle", warning: true) {
                        Button("Choose a workspace") { targetPicker = true }.accessibilityIdentifier("chooseRequiredWorkspace")
                        Button("Dismiss") { workspaceRequired = false }
                    }
                } else if let failure = draft.failure {
                    ChatNotice(title: draft.failureTitle, message: failure, symbol: "exclamationmark.circle", warning: true) {
                        if fixedWorkspace == nil, !targetReady {
                            Button("Choose a workspace") { targetPicker = true }.accessibilityIdentifier("chooseRequiredWorkspace")
                        }
                        if let unsent = draft.unsentText {
                            Button("Copy unsent message") { UIPasteboard.general.string = unsent }
                            if !draft.unsentAttachments.isEmpty { Button("Use failed message and files") { draft.restoreUnsent() } }
                        }
                        Button("Dismiss") { draft.dismissFailure() }
                    }
                }
                if fixedWorkspace == nil {
                    Button { targetPicker = true } label: {
                        HStack(spacing: 8) {
                            if space.mode == "developer" {
                                RegistryIcon(token: workspaceIcon, size: 15)
                            }
                            else { RegistryIcon(token: collection?.icon, fallback: "tray", size: 15) }
                            Text(space.mode == "developer" ? workspace?.name ?? "Choose a workspace" : collection?.name ?? "No project")
                                .font(.footnote.weight(.semibold)).lineLimit(1)
                            Image(systemName: "chevron.down").font(.caption).foregroundStyle(.secondary)
                        }
                        .foregroundStyle(.primary).padding(.horizontal, 14).frame(minHeight: 36)
                    }
                    .buttonStyle(ChatPressStyle()).modifier(GlassSurface(radius: 20))
                    .composerPickerSource(.target)
                    .disabled(!ready).padding(.horizontal, 16).accessibilityIdentifier("chooseTarget")
                }
            }
            MessageComposer(session: session, context: ComposerContext(space: space, workspace: fixedWorkspace), draft: draft, canSend: ready,
                         model: { modelSheet = true }, options: { optionsSheet = true }, send: prepareSend,
                         onVoiceWorkspaceRequired: showWorkspaceRequired, voiceCreated: onCreated, focusChanged: focusChanged)
        }.padding(.bottom, HomeView.composerBottomInset)
        .onChange(of: targetReady) { _, ready in
            if ready { workspaceRequired = false }
        }
        .onChange(of: session.ownership) { _, _ in workspaceRequired = false }
        .sheet(item: $consent) { context in
            ConsentView(context: context) {
                guard context.backendID == session.pairing?.descriptor.backendId, context.providerID == space.providerId else { return }
                session.grantConsent(providerID: context.providerID, backendID: context.backendID)
                Task { await send() }
            }
        }
    }
    private func prepareSend() {
        guard ready, isCurrent(), let backendID = session.pairing?.descriptor.backendId else { return }
        guard validateTarget() else { return }
        if !session.hasConsent(providerID: space.providerId) { consent = ConsentContext(backendID: backendID, providerID: space.providerId, isDemo: session.isDemo) }
        else { Task { await send() } }
    }
    private func send() async {
        guard ready, isCurrent(), session.selectedSpaceID == space.id, validateTarget(), let submission = draft.begin() else { return }
        let owner = session.ownership
        let settings = session.settings(for: space)
        do {
            let id = try await session.send(submission.text, spaceID: space.id, workspaceID: workspaceID,
                collectionID: collection?.id, settings: settings, attachments: submission.attachments, contextSkills: submission.contextSkills, contextScope: submission.contextScope)
            guard owner == session.ownership else { return }
            draft.accept(submission)
            if isCurrent(), session.selectedSpaceID == space.id {
                draft.transfer(to: session.draft(for: id))
                onCreated(id)
            }
        } catch {
            guard owner == session.ownership else { return }
            draft.reject(submission, message: error.localizedDescription, uncertain: uncertain)
        }
    }
    private func checkDelivery(_ pending: PendingMessage) async {
        guard isCurrent(), session.pendingMessage?.id == pending.id else { return }
        let owner = session.ownership
        do {
            if let inputID = pending.queueInputID, fixedWorkspace != nil {
                _ = try await session.checkQueuedInput(inputID)
                return
            }
            let id = try await session.checkDelivery()
            guard owner == session.ownership else { return }
            draft.dismissFailure()
            guard isCurrent() else { return }
            if let fixedWorkspace {
                guard session.selectedSpaceID == space.id,
                      pending.startsConversation(spaceID: space.id, workspaceID: fixedWorkspace.id) else { return }
            }
            onCreated(id)
        } catch {
            if owner == session.ownership { draft.showFailure(error.localizedDescription) }
        }
    }
    private func validateTarget() -> Bool {
        guard !targetReady else { return true }
        showWorkspaceRequired()
        return false
    }
    private func showWorkspaceRequired() {
        if fixedWorkspace != nil {
            draft.showFailure("This workspace’s folder is unavailable on your computer.", title: "Workspace unavailable")
        } else { workspaceRequired = true }
    }
    private var workspaceRequiredMessage: String {
        workspace == nil ? "Choose a workspace before starting a conversation in Code mode." : "This workspace’s folder is unavailable on your computer. Choose another workspace or restore the folder."
    }
}
