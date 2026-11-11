import SwiftUI

struct HomeView: View {
    let session: BackendSession
    let openSidebar: () -> Void
    let openComputer: () -> Void
    let openPairing: () -> Void
    let onCreated: (String) -> Void
    @State private var targetSheet = false
    @State private var modelSheet = false
    @State private var optionsSheet = false
    @State private var consent: ConsentContext?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var space: Space? { session.selectedSpace }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                SidebarControl(action: openSidebar)
                ZStack {
                    if session.isDemo || session.pairing != nil && !session.isConnected {
                        ConnectionPill(session: session, action: openComputer)
                            .transition(.opacity)
                    }
                }.frame(maxWidth: .infinity)
                Color.clear.frame(width: 46, height: 46).accessibilityHidden(true)
            }.padding(.horizontal, 16).padding(.top, 8)
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: session.connection)
            Spacer(minLength: 20)
            if session.pairing != nil && space == nil && !session.connection.isBusy {
                ContentUnavailableView("Choose a space", systemImage: "square.grid.2x2", description: Text("Open the sidebar to choose where to start."))
            }
            Spacer(minLength: 20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let space {
                HomeComposerArea(session: session, space: space, targetSheet: $targetSheet, modelSheet: $modelSheet,
                                 optionsSheet: $optionsSheet, consent: $consent, onCreated: onCreated)
                    .id(space.id)
            } else if session.pairing == nil {
                UnpairedHomeArea(session: session, pair: openPairing)
            }
        }
        .sheet(isPresented: $targetSheet) { if let space { TargetSheet(session: session, space: space) } }
        .effortOverlay(isPresented: $modelSheet, session: session, context: space.map { ComposerContext(space: $0) })
        .sheet(isPresented: $optionsSheet) { if let space { RunOptionsSheet(session: session, context: ComposerContext(space: space)) } }
        .task(id: "\(space?.providerId ?? ""):\(session.isConnected)") {
            if let space { await session.loadModels(space.providerId, force: true) }
        }
    }

}

private struct UnpairedHomeArea: View {
    let session: BackendSession
    let pair: () -> Void
    var body: some View {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 12) {
                Text("No computer paired").font(.headline)
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
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 18))
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
    let session: BackendSession
    let space: Space
    @Binding var targetSheet: Bool
    @Binding var modelSheet: Bool
    @Binding var optionsSheet: Bool
    @Binding var consent: ConsentContext?
    let onCreated: (String) -> Void
    @Bindable private var draft: ConversationDraft
    private var target: HomeTarget { session.homeTargets[space.id] ?? HomeTarget() }
    private var workspace: Workspace? { session.workspaces.first { $0.id == target.workspaceID && $0.isReplica != true } }
    private var workspaceIcon: String? { session.projects.first { $0.id == workspace?.projectId }?.icon }
    private var collection: ProjectCollection? { session.collections.first { $0.id == target.collectionID } }
    private var uncertain: Bool { session.pendingMessage?.status == .uncertain }
    private var ready: Bool { session.isConnected && !session.changingMode && !session.sending && !uncertain }
    private var targetReady: Bool { space.mode != "developer" || workspace != nil && session.gitStates.first(where: { $0.workspaceId == workspace?.id })?.pathExists != false }
    init(session: BackendSession, space: Space, targetSheet: Binding<Bool>, modelSheet: Binding<Bool>, optionsSheet: Binding<Bool>,
         consent: Binding<ConsentContext?>, onCreated: @escaping (String) -> Void) {
        self.session = session; self.space = space; _targetSheet = targetSheet; _modelSheet = modelSheet; _optionsSheet = optionsSheet
        _consent = consent; self.onCreated = onCreated; draft = session.homeDraft(for: space.id)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
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
            } else if let failure = draft.failure {
                ChatNotice(title: draft.failureTitle, message: failure, symbol: "exclamationmark.circle", warning: true) {
                    if !targetReady { Button("Choose a workspace") { targetSheet = true }.accessibilityIdentifier("chooseRequiredWorkspace") }
                    if let unsent = draft.unsentText {
                        Button("Copy unsent message") { UIPasteboard.general.string = unsent }
                        if !draft.unsentAttachments.isEmpty { Button("Use failed message and files") { draft.restoreUnsent() } }
                    }
                    Button("Dismiss") { draft.dismissFailure() }
                }
            }
            Button { targetSheet = true } label: {
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
            .disabled(!ready).padding(.horizontal, 16).accessibilityIdentifier("chooseTarget")
            MessageComposer(session: session, context: ComposerContext(space: space), draft: draft, canSend: ready,
                         model: { modelSheet = true }, options: { optionsSheet = true }, send: prepareSend)
        }.padding(.bottom, 8)
        .onChange(of: targetReady) { _, ready in
            if ready, draft.failureTitle == "Workspace required" { draft.dismissFailure() }
        }
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
        draft.showFailure(workspace == nil ? "Choose a workspace before sending a message in Code mode." : "This workspace’s folder is unavailable on your computer. Choose another workspace or restore the folder.", title: "Workspace required")
        return false
    }
}
