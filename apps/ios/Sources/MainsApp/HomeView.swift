import SwiftUI

struct HomeView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let openSidebar: () -> Void
    let openComputer: () -> Void
    let openPairing: () -> Void
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
            ToolbarItem(placement: .topBarLeading) { SidebarControl(action: openSidebar) }
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
            } else if session.pairing == nil {
                UnpairedHomeArea(session: session, pair: openPairing)
            }
        }
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
        Spacer(minLength: 20)
        if session.pairing != nil && space == nil && !session.connection.isBusy {
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
        Spacer(minLength: 20)
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
        case 0..<12: "Morning"
        case 12..<18: "Afternoon"
        default: "Evening"
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
    var body: some View {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 12) {
                Text("No computer paired").font(.headline.width(.expanded))
                Text("Start Mains on your computer with LAN or Tailscale access, then scan its pairing code.")
                    .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Button("Scan pairing code", action: pair)
                    .buttonStyle(PairingActionStyle()).accessibilityIdentifier("scanPairingCode")
                Button("Try Demo Mode on this phone") {
                    do { try session.startDemo() } catch { session.actionError = error.localizedDescription }
                }
                .buttonStyle(PairingActionStyle(prominent: false)).accessibilityIdentifier("startDemo")
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .modifier(GlassSurface(radius: 18, interactive: false))
            .padding(.horizontal, 12)

            VStack(alignment: .leading, spacing: 4) {
                Button(action: pair) {
                    Text("Start a run").font(.body).foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10).padding(.top, 7).padding(.bottom, 3)
                }.accessibilityLabel("Pair a computer to start a run")
                HStack {
                    Button(action: pair) {
                        Image(systemName: "plus").font(.system(size: 24, weight: .light)).frame(width: 44, height: 44)
                    }.accessibilityLabel("Pair a computer to add attachments")
                    Spacer()
                    Button(action: pair) {
                        Image(systemName: "arrow.up").font(.system(size: 22, weight: .medium))
                            .frame(width: 40, height: 40).foregroundStyle(.white)
                            .background(AppBrand.accent, in: .circle).padding(2)
                    }.accessibilityLabel("Pair a computer to send a message")
                }
            }
            .buttonStyle(.plain).padding(8).modifier(GlassSurface(radius: 34, interactive: false)).padding(.horizontal, 12)
        }.padding(.bottom, 8)
    }
}

private struct HomeComposerArea: View {
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
    let onCreated: (String) -> Void
    @Bindable private var draft: ConversationDraft
    @State private var workspaceRequired = false
    private var target: HomeTarget { session.homeTargets[space.id] ?? HomeTarget() }
    private var workspace: Workspace? { session.workspaces.first { $0.id == target.workspaceID && $0.isReplica != true } }
    private var workspaceIcon: String? { session.projects.first { $0.id == workspace?.projectId }?.icon }
    private var collection: ProjectCollection? { session.collections.first { $0.id == target.collectionID } }
    private var uncertain: Bool { session.pendingMessage?.status == .uncertain }
    private var ready: Bool { session.isConnected && !session.changingMode && !session.sending && !uncertain && session.pendingFork == nil && session.pendingConversationAction == nil }
    private var targetReady: Bool { space.mode != "developer" || workspace != nil && session.gitStates.first(where: { $0.workspaceId == workspace?.id })?.pathExists != false }
    init(session: BackendSession, space: Space, targetPicker: Binding<Bool>, modelSheet: Binding<Bool>, optionsSheet: Binding<Bool>,
         consent: Binding<ConsentContext?>, editorExpanded: Bool, onCreated: @escaping (String) -> Void) {
        self.session = session; self.space = space; _targetPicker = targetPicker; _modelSheet = modelSheet; _optionsSheet = optionsSheet
        _consent = consent; self.editorExpanded = editorExpanded; self.onCreated = onCreated; draft = session.homeDraft(for: space.id)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !editorExpanded {
                if session.isDemo, draft.text.isEmpty {
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
                            Task {
                                let owner = session.pairing?.deviceId
                                do {
                                    let id = try await session.checkDelivery()
                                    guard owner == session.pairing?.deviceId else { return }
                                    draft.dismissFailure(); onCreated(id)
                                } catch { draft.showFailure(error.localizedDescription) }
                            }
                        }.disabled(!session.isConnected || session.sending).accessibilityIdentifier("checkDelivery")
                    }
                } else if workspaceRequired && !targetReady {
                    ChatNotice(title: "Workspace required", message: workspaceRequiredMessage, symbol: "exclamationmark.circle", warning: true) {
                        Button("Choose a workspace") { targetPicker = true }.accessibilityIdentifier("chooseRequiredWorkspace")
                        Button("Dismiss") { workspaceRequired = false }
                    }
                } else if let failure = draft.failure {
                    ChatNotice(title: draft.failureTitle, message: failure, symbol: "exclamationmark.circle", warning: true) {
                        if !targetReady { Button("Choose a workspace") { targetPicker = true }.accessibilityIdentifier("chooseRequiredWorkspace") }
                        if let unsent = draft.unsentText {
                            Button("Copy unsent message") { UIPasteboard.general.string = unsent }
                            if !draft.unsentAttachments.isEmpty { Button("Use failed message and files") { draft.restoreUnsent() } }
                        }
                        Button("Dismiss") { draft.dismissFailure() }
                    }
                }
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
            MessageComposer(session: session, context: ComposerContext(space: space), draft: draft, canSend: ready,
                         model: { modelSheet = true }, options: { optionsSheet = true }, send: prepareSend,
                         onVoiceWorkspaceRequired: showWorkspaceRequired, voiceCreated: onCreated)
        }.padding(.bottom, 8)
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
        guard ready, let backendID = session.pairing?.descriptor.backendId else { return }
        guard validateTarget() else { return }
        if !session.hasConsent(providerID: space.providerId) { consent = ConsentContext(backendID: backendID, providerID: space.providerId, isDemo: session.isDemo) }
        else { Task { await send() } }
    }
    private func send() async {
        guard ready, session.selectedSpaceID == space.id, validateTarget(), let submission = draft.begin() else { return }
        let owner = session.pairing?.deviceId
        let target = target
        let settings = session.settings(for: space)
        do {
            let id = try await session.send(submission.text, spaceID: space.id, workspaceID: target.workspaceID,
                collectionID: collection?.id, settings: settings, attachments: submission.attachments, contextSkills: submission.contextSkills, contextScope: submission.contextScope)
            guard owner == session.pairing?.deviceId else { return }
            draft.accept(submission)
            if session.selectedSpaceID == space.id {
                draft.transfer(to: session.draft(for: id))
                onCreated(id)
            }
        } catch {
            guard owner == session.pairing?.deviceId else { return }
            draft.reject(submission, message: error.localizedDescription, uncertain: uncertain)
        }
    }
    private func validateTarget() -> Bool {
        guard !targetReady else { return true }
        showWorkspaceRequired()
        return false
    }
    private func showWorkspaceRequired() {
        workspaceRequired = true
    }
    private var workspaceRequiredMessage: String {
        workspace == nil ? "Choose a workspace before starting a conversation in Code mode." : "This workspace’s folder is unavailable on your computer. Choose another workspace or restore the folder."
    }
}
