import SwiftUI
import UniformTypeIdentifiers

private extension EnvironmentValues {
    @Entry var composerExpansion: Binding<Bool>? = nil
}

extension View {
    func composerInset<Bar: View>(@ViewBuilder _ bar: @escaping (Bool) -> Bar) -> some View {
        modifier(ComposerInset(bar: bar))
    }
}

private struct ComposerInset<Bar: View>: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let bar: (Bool) -> Bar
    @State private var expanded = false
    @State private var compactHeight: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .allowsHitTesting(!expanded)
            .accessibilityHidden(expanded)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                // Keep the reader's viewport stable while the editor covers it.
                Color.clear.frame(height: compactHeight).allowsHitTesting(false).accessibilityHidden(true)
            }
            .overlay {
                GeometryReader { viewport in
                    bar(expanded)
                        .environment(\.composerExpansion, $expanded)
                        .frame(height: expanded ? viewport.size.height : nil)
                        .background(expanded ? Color(.systemBackground) : .clear)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                            if !expanded { compactHeight = height }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                }
            }
    }
}

struct MessageComposer: View {
    static let horizontalInset: CGFloat = 12
    static let standardVerticalInset: CGFloat = 8
    static let controlHeight: CGFloat = 44
    private static let editorSizeButtonWidth: CGFloat = 44

    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let context: ComposerContext
    @Bindable var draft: ConversationDraft
    let canSend: Bool
    var active = false
    var canSendDuringRun = false
    var sendLabel: String? = nil
    var stopping = false
    var stop: (() -> Void)? = nil
    let model: () -> Void
    let options: () -> Void
    let send: () -> Void
    var onVoiceWorkspaceRequired: (() -> Void)? = nil
    var voiceCreated: ((String) -> Void)? = nil
    var focusChanged: ((Bool) -> Void)? = nil
    #if MAINS_GPT_LIVE
    @AppStorage(VoicePresentation.storageKey) private var voicePresentation = VoicePresentation.focus
    @State private var voiceConsent: VoiceConsentRequest?
    @State private var approvedVoiceConsentOwner: Int?
    @State private var voiceStartOwner: Int?

    private struct VoiceConsentRequest: Identifiable {
        let context: ConsentContext
        let owner: Int
        var id: String { context.id }
    }
    #endif
    @State private var focused = false
    @State private var textOverflows = false
    @State private var file = false
    @State private var pluginsOpen = false
    @State private var contextPresentationID = UUID()
    @State private var composerFrame = CGRect.zero
    @State private var panelScope: ContextScope?
    @State private var mateConsent: ConsentContext?
    @State private var mateSelectionAfterConsent: (() -> Void)?
    private var contextScope: ContextScope { context.contextScope(session) }
    private var trigger: ContextTriggerMatch? { focused && !attachmentsOpen ? ContextMentions.detect(draft.text) : nil }
    @State private var attachmentsOpen = false
    @State private var attachmentPresentationID = UUID()
    @State private var panelOwner = 0
    @State private var fileOwner = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.composerExpansion) private var expansion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.conversationPaneVisible) private var paneVisible
    @Environment(\.mainPaneCovered) private var mainPaneCovered
    @Environment(\.mateChatTint) private var mateTint
    @State private var attachmentError: String?
    private var settings: ComposerSettings { context.settings(session) }
    private var editorExpanded: Bool { expansion?.wrappedValue == true }
    private var selectedModel: ModelChoice? { context.model(session) }
    private var speed: ComposerSpeed? { ComposerSpeed(model: selectedModel, providerID: context.providerId) }
    #if MAINS_GPT_LIVE
    private var ownsVoice: Bool {
        guard session.voice.ownsCall else { return false }
        if let id = context.runID { return session.voice.runID == id }
        if let mate = context.mate { return session.voiceMate?.id == mate.id && session.voice.runID == nil }
        return voiceStartOwner == session.ownership && session.voiceMate == nil && session.voiceSpaceID == context.spaceID
    }
    private var voiceStartAvailability: BackendSession.VoiceStartAvailability {
        guard AppFeatures.gptLiveEnabled, !context.saving(session) else { return .unavailable }
        return session.voiceStartAvailability(runID: context.runID, spaceID: context.spaceID, mate: context.mate,
                                              workspaceID: context.workspaceID)
    }
    #endif
    private var effort: String? {
        guard let selectedModel else { return nil }
        switch EffortControlKind.resolve(provider: context.providerId, levels: selectedModel.supportedEffortLevels ?? []) {
        case .hidden: return nil
        case .thinking: return settings.config["thinkingMode"]?.bool == true ? "On" : nil
        case .toggle, .slider, .list:
            let value = settings.effort(provider: context.providerId, model: selectedModel)
            return ComposerSettings.effortLabel(value, provider: context.providerId)
        }
    }
    private var optionsLabel: String? {
        if context.mode == "developer" {
            let value = settings.permission(provider: context.providerId)
            return PermissionChoice.shortTitle(for: value, provider: context.providerId) ?? "Options"
        }
        return context.mode == "work" && context.supportsGoalMode || speed != nil
            ? "Options" : nil
    }

    private var optionsTint: Color {
        if context.supportsGoalMode {
            let planEnabled = context.mode == "developer" && settings.config["planMode"]?.bool == true
            if planEnabled || settings.config["goalMode"]?.bool == true { return AppBrand.accent }
        }
        return speed?.isFast(in: settings) == true ? ComposerSpeed.activeTint(in: colorScheme) : .secondary
    }
    var body: some View {
        VStack(spacing: 0) {
            #if MAINS_GPT_LIVE
            VoiceOrbSlot(voice: session.voice, size: 104, presented: ownsVoice && voicePresentation == .conversation,
                         bottomInset: 12, orbIdentifier: "voiceComposerOrb")
                .frame(maxWidth: .infinity)
            if ownsVoice && voicePresentation == .focus { focusComposer }
            else { standardComposer }
            #else
            standardComposer
            #endif
        }
        .background(GeometryReader { geometry in
            Color.clear.onAppear { composerFrame = geometry.frame(in: .global) }
                .onChange(of: geometry.frame(in: .global)) { _, frame in composerFrame = frame }
        })
        .contextPicker(pickerRequest)
        .sheet(item: $mateConsent, onDismiss: { mateSelectionAfterConsent = nil }) { consent in
            ConsentView(context: consent) {
                guard consent.backendID == session.pairing?.descriptor.backendId else { return }
                session.grantConsent(providerID: consent.providerID, backendID: consent.backendID)
                mateSelectionAfterConsent?()
            }
        }
        .onChange(of: draft.text) { _, _ in draft.reconcileContext() }
        .onChange(of: focused) { _, focused in focusChanged?(focused) }
        .onChange(of: mainPaneCovered) { _, covered in
            if covered { focused = false; expansion?.wrappedValue = false }
        }
        .onChange(of: contextScope, initial: true) { _, scope in draft.synchronizeContext(scope); pluginsOpen = false }
        .attachmentOverlay(isPresented: attachmentsOpen, id: attachmentPresentationID, accent: Provider.accent(context.providerId),
                           maxCount: 5 - draft.attachments.count, maxBytes: remainingBytes, add: addFromPanel, close: closeAttachments)
        .onChange(of: session.ownership) { _, _ in
            attachmentsOpen = false; file = false; pluginsOpen = false; expansion?.wrappedValue = false
        }
        .onChange(of: paneVisible) { _, visible in
            if !visible { focused = false; attachmentsOpen = false; pluginsOpen = false; expansion?.wrappedValue = false }
        }
        .onDisappear { expansion?.wrappedValue = false }
    #if MAINS_GPT_LIVE
        .onChange(of: session.voice.runID) { _, id in
            guard let id, context.runID == nil, voiceStartOwner == session.ownership else { return }
            if let mate = context.mate {
                guard session.voiceMate?.id == mate.id else { return }
            } else {
                guard session.voiceMate == nil, session.selectedSpaceID == context.spaceID else { return }
            }
            voiceStartOwner = nil
            voiceCreated?(id)
        }
        .onChange(of: session.ownership) { _, _ in
            approvedVoiceConsentOwner = nil; voiceConsent = nil
        }
        .onChange(of: ownsVoice && voicePresentation == .focus) { _, voiceFocused in
            if voiceFocused { expansion?.wrappedValue = false; textOverflows = false }
        }
        .onDisappear {
            if context.mate != nil { voiceStartOwner = nil }
        }
        .sheet(item: $voiceConsent, onDismiss: resumeVoiceAfterConsent) { request in
            ConsentView(context: request.context) {
                guard request.owner == session.ownership else { return }
                session.grantConsent(providerID: "codex", backendID: request.context.backendID)
                approvedVoiceConsentOwner = request.owner
            }
        }
    #endif
        .fileImporter(isPresented: $file, allowedContentTypes: [.data]) { result in
            do {
                let url = try result.get()
                guard fileOwner == session.ownership, !draft.isSending else { throw MainsError.changedBackend }
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey, .isRegularFileKey])
                guard values.isRegularFile == true, (values.fileSize ?? Int.max) <= 2 * 1024 * 1024 else {
                    throw MainsError.server("Choose a file smaller than 2 MB.")
                }
                try add(Data(contentsOf: url), name: url.lastPathComponent, type: values.contentType ?? .data)
            } catch { if (error as NSError).code != NSUserCancelledError { attachmentError = error.localizedDescription } }
        }
        .alert("Couldn’t attach file", isPresented: Binding(get: { attachmentError != nil }, set: { if !$0 { attachmentError = nil } })) {
            Button("OK", role: .cancel) { attachmentError = nil }
        } message: { Text(attachmentError ?? "") }
    }
    private var standardComposer: some View {
        let stackedMate = context.lockedProfile && (focused || !draft.text.isEmpty || editorExpanded)
        let compactMate = context.lockedProfile && !stackedMate
        return VStack(alignment: .leading, spacing: 4) {
            if showsCollapseButtonAboveEditor {
                HStack {
                    Spacer()
                    editorSizeButton
                }
            }
            if let error = draft.storageError {
                Text(error).font(.caption).foregroundStyle(.orange)
                    .padding(.horizontal, 12).padding(.top, 8).padding(.trailing, expandButtonSpace)
                    .accessibilityIdentifier("draftStorageError")
            }
            if !draft.attachments.isEmpty {
                ComposerAttachmentStrip(attachments: draft.attachments) { id in
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { draft.attachments.removeAll { $0.id == id } }
                }.padding(.horizontal, 8).padding(.top, 6).padding(.trailing, expandButtonSpace)
            }
            if context.lockedProfile {
                MateComposerLayout(expanded: stackedMate, fillsHeight: editorExpanded) {
                    textEditor
                    attachmentButton
                    HStack(spacing: 6) {
                        if showsCollapseButtonInControls { editorSizeButton }
                        composerActions
                    }
                }
                .buttonStyle(.plain)
            } else {
                textEditor.padding(.horizontal, 10).padding(.top, 7).padding(.bottom, 3)
                HStack(spacing: 6) {
                    attachmentButton
                    Group {
                        if dynamicTypeSize.isAccessibilitySize {
                            ScrollView(.horizontal) { configurationControls }.scrollIndicators(.hidden)
                        } else {
                            configurationControls
                        }
                    }.fixedSize(horizontal: false, vertical: true)
                    if showsCollapseButtonInControls { editorSizeButton }
                    composerActions
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 8).padding(.vertical, compactMate ? 4 : Self.standardVerticalInset)
        .modifier(GlassSurface(radius: editorExpanded ? 24 : 34, interactive: false))
        .overlay(alignment: .topTrailing) {
            if showsExpandButton { editorSizeButton.padding([.top, .trailing], 8) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("messageComposer")
        .padding(.horizontal, Self.horizontalInset)
        .animation(reduceMotion ? nil : MateComposerLayout.transition, value: stackedMate)
    }

    private var textEditor: some View {
        ContextTextEditor(text: $draft.text, skills: $draft.contextSkills, scope: contextScope, focused: $focused,
            placeholder: context.placeholder,
            identifier: context.runID == nil ? "homeMessageInput" : "messageInput",
            fillsHeight: editorExpanded, reservedTrailingWidth: expandButtonSpace, onOverflowChange: { textOverflows = $0 })
    }

    private var showsExpandButton: Bool { expansion != nil && !editorExpanded && textOverflows && !draft.text.isEmpty }
    private var expandButtonSpace: CGFloat { showsExpandButton ? Self.editorSizeButtonWidth : 0 }
    private var showsCollapseButtonAboveEditor: Bool { editorExpanded && verticalSizeClass != .compact }
    private var showsCollapseButtonInControls: Bool { editorExpanded && !showsCollapseButtonAboveEditor }

    private var editorSizeButton: some View {
        Button {
            let expanding = !editorExpanded
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22)) {
                expansion?.wrappedValue = expanding
            }
            if expanding { focused = true }
        } label: {
            Image(systemName: editorExpanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: Self.editorSizeButtonWidth, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(editorExpanded ? "Collapse message editor" : "Expand message editor")
        .accessibilityIdentifier(editorExpanded ? "collapseMessageEditor" : "expandMessageEditor")
    }

    private var attachmentButton: some View {
        Button(action: openAttachments) {
            Image(systemName: "plus").font(.system(size: 22, weight: .light))
                .frame(width: Self.controlHeight, height: Self.controlHeight)
        }
        .background(GeometryReader { geometry in
            Color.clear.preference(key: AttachmentSourceFrameKey.self, value: geometry.frame(in: .global))
        })
        .disabled(draft.isSending).accessibilityLabel("Add attachment").accessibilityIdentifier("addAttachment")
    }

    private var configurationControls: some View {
        HStack(spacing: 12) {
            Button(action: model) {
                HStack(spacing: 5) {
                    ComposerModelLabel(model: selectedModel, loading: context.modelsLoading(session), providerID: context.providerId)
                        .layoutPriority(-1)
                    if let effort { Text(effort).foregroundStyle(.secondary).fixedSize(horizontal: true, vertical: false) }
                }.lineLimit(1).frame(minHeight: 44)
            }
            .composerPickerSource(.model)
            .disabled(!session.isConnected || session.sending || context.saving(session)).accessibilityIdentifier("chooseModel")
            if let label = optionsLabel {
                Button(label, action: options).fontWeight(.semibold).foregroundStyle(optionsTint).frame(minHeight: 44)
                    .fixedSize(horizontal: true, vertical: false).layoutPriority(1)
                    .composerPickerSource(.runOptions)
                    .disabled(!session.isConnected || session.sending || context.saving(session)).accessibilityIdentifier("runOptions")
            }
            Spacer(minLength: 0)
        }.font(.footnote).foregroundStyle(.secondary)
    }

    private var voiceBlocksSending: Bool {
        #if MAINS_GPT_LIVE
        session.pendingVoiceConversation != nil || ownsVoice && !active
        #else
        false
        #endif
    }

    private var sendMessageButton: some View {
        ComposerSendButton(providerID: context.providerId, sending: draft.isSending) {
            expansion?.wrappedValue = false
            send()
        }
            .disabled(!canSend || draft.isSending || context.saving(session) || !draft.hasContent || voiceBlocksSending)
            .accessibilityLabel(draft.isSending ? "Sending message" : sendLabel ?? "Send message")
            .accessibilityIdentifier(context.runID == nil ? "startConversation" : "sendMessage")
    }

    private var composerAccent: Color { mateTint ?? Provider.accent(context.providerId) }

    private func stopActionIcon(symbol: String = "stop.fill") -> some View {
        Image(systemName: symbol).font(.callout.weight(.semibold))
        .opacity(stopping ? 0.5 : 1)
        .frame(width: 36, height: 36).foregroundStyle(.white)
        .background(composerAccent, in: .circle)
        .frame(width: 44, height: 44).contentShape(.circle)
    }

    @ViewBuilder private var composerActions: some View {
        #if MAINS_GPT_LIVE
        if ownsVoice, session.voice.phase == .connected {
            Button { session.voice.toggleMute() } label: {
                Image(systemName: session.voice.muted ? "mic.slash.fill" : "mic.fill").frame(width: 40, height: 44)
            }.accessibilityLabel(session.voice.muted ? "Unmute microphone" : "Mute microphone").accessibilityIdentifier("muteVoice")
        }
        if ownsVoice && (session.voice.phase != .connected || !(active && canSendDuringRun && draft.hasContent)) || stopping || active && (!canSendDuringRun || !draft.hasContent) {
            Button {
                if ownsVoice { Task { await session.voice.stop() } }
                if active { stop?() }
            } label: {
                stopActionIcon(symbol: ownsVoice && session.voice.phase == .stopFailed ? "arrow.clockwise" : "stop.fill")
            }.buttonStyle(ChatPressStyle()).disabled(ownsVoice ? session.voice.phase == .ending : !session.isConnected || stopping)
                .accessibilityLabel(ownsVoice ? session.voice.phase == .stopFailed ? "Retry ending voice chat" : "End voice chat" : stopping ? "Stopping reply" : "Stop reply")
                .accessibilityIdentifier(ownsVoice ? "endVoice" : "stopReply")
        } else if !draft.hasContent && context.providerId == "codex" && !active && !session.isDemo {
            Button(action: prepareVoice) {
                Image(systemName: "waveform").font(.system(size: 18, weight: .medium))
                    .frame(width: 36, height: 36).foregroundStyle(.white)
                    .background(composerAccent, in: .circle)
                    .frame(width: 44, height: 44).contentShape(.circle)
            }.buttonStyle(ChatPressStyle()).disabled(voiceStartAvailability == .unavailable)
                .accessibilityLabel("Start GPT Live").accessibilityIdentifier("startVoice")
        } else {
            sendMessageButton
        }
        #else
        if stopping || active {
            Button { stop?() } label: {
                stopActionIcon()
            }
            .buttonStyle(ChatPressStyle()).disabled(!session.isConnected || stopping)
            .accessibilityLabel(stopping ? "Stopping reply" : "Stop reply").accessibilityIdentifier("stopReply")
        }
        if !stopping && (!active || canSendDuringRun && draft.hasContent) { sendMessageButton }
        #endif
    }

    #if MAINS_GPT_LIVE
    private var focusComposer: some View {
        VStack(spacing: 8) {
            if let error = draft.storageError {
                Text(error).font(.caption).foregroundStyle(.orange).accessibilityIdentifier("draftStorageError")
            }
            if !draft.attachments.isEmpty {
                ComposerAttachmentStrip(attachments: draft.attachments) { id in draft.attachments.removeAll { $0.id == id } }
            }
            HStack(alignment: .bottom, spacing: 10) {
                HStack(spacing: 0) {
                    Button(action: openAttachments) {
                        Image(systemName: "plus").font(.system(size: 21, weight: .light)).frame(width: 44, height: 52)
                    }
                    .background(GeometryReader { geometry in
                        Color.clear.preference(key: AttachmentSourceFrameKey.self, value: geometry.frame(in: .global))
                    })
                    .disabled(draft.isSending).accessibilityLabel("Add attachment").accessibilityIdentifier("addAttachment")
                    ContextTextEditor(text: $draft.text, skills: $draft.contextSkills, scope: contextScope, focused: $focused,
                        placeholder: "Ask Codex", identifier: context.runID == nil ? "homeMessageInput" : "messageInput")
                        .padding(.vertical, 13).padding(.trailing, 12)
                    if draft.hasContent {
                        Button(action: send) {
                            Image(systemName: "arrow.up").font(.callout.weight(.semibold)).frame(width: 40, height: 44)
                        }.disabled(!canSend || !active || session.voice.phase != .connected || draft.isSending || context.saving(session))
                            .accessibilityLabel(sendLabel ?? "Send message").accessibilityIdentifier(context.runID == nil ? "startConversation" : "sendMessage")
                    }
                }
                .padding(.horizontal, 4).modifier(GlassSurface(radius: 28, interactive: false))
                Button { session.voice.toggleMute() } label: {
                    Image(systemName: session.voice.muted ? "mic.slash.fill" : "mic.fill")
                        .font(.system(size: 20)).frame(width: 52, height: 52)
                }
                .modifier(GlassSurface(radius: 26)).disabled(session.voice.phase != .connected)
                .accessibilityLabel(session.voice.muted ? "Unmute microphone" : "Mute microphone").accessibilityIdentifier("muteVoice")
                Button {
                    Task { await session.voice.stop() }
                    if active { stop?() }
                } label: {
                    Image(systemName: session.voice.phase == .stopFailed ? "arrow.clockwise" : "xmark")
                    .font(.system(size: 22, weight: .medium)).opacity(session.voice.phase == .ending ? 0.5 : 1)
                    .frame(width: 52, height: 52)
                    .foregroundStyle(mateTint == nil ? Color(.systemBackground) : .white)
                    .background(mateTint ?? .primary, in: .circle)
                }
                .disabled(session.voice.phase == .ending)
                .accessibilityLabel(session.voice.phase == .stopFailed ? "Retry ending voice chat" : "End voice chat").accessibilityIdentifier("endVoice")
            }
            .buttonStyle(ChatPressStyle())
        }
        .padding(.horizontal, 16).padding(.bottom, 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("voiceFocusComposer")
    }

    #endif
    private var pickerRequest: ContextPickerRequest? {
        guard session.isConnected, !draft.isSending, !attachmentsOpen, trigger != nil || pluginsOpen else { return nil }
        let scope = contextScope, owner = session.ownership
        let hasLocalWorkspace = session.workspaces.contains { $0.id == scope.workspaceID && $0.isReplica != true }
        let match = trigger
        var pickerAnchor = composerFrame
        if editorExpanded { pickerAnchor.origin.y = composerFrame.maxY - 52 }
        return ContextPickerRequest(id: contextPresentationID, frame: pickerAnchor, session: session, scope: scope, owner: owner,
            trigger: match?.trigger, query: match?.filter ?? "", pluginsOnly: match == nil && pluginsOpen,
            offersMates: Experience.allowsMateMentions(context.mode, isMateConversation: context.lockedProfile, hasLocalWorkspace: hasLocalWorkspace),
            offersWorkspaceFiles: context.mode == "developer" && hasLocalWorkspace,
            pickSkill: { skill in
                guard owner == session.ownership, scope == contextScope, !draft.isSending else { return }
                if skill.workspaceFile != nil {
                    guard trigger?.trigger == "@", trigger?.filter == match?.filter else { return }
                }
                let select = {
                    guard owner == session.ownership, scope == contextScope, !draft.isSending else { return }
                    draft.insert(skill, scope: scope); pluginsOpen = false; focused = true
                }
                if let provider = skill.mateProviderID, !session.hasConsent(providerID: provider), let backend = session.pairing?.descriptor.backendId {
                    mateSelectionAfterConsent = select
                    mateConsent = ConsentContext(backendID: backend, providerID: provider)
                } else { select() }
            }, pickCommand: { command in
                guard owner == session.ownership, scope == contextScope, !draft.isSending else { return }
                draft.text = ContextMentions.replacingTrigger(in: draft.text, with: "/" + command.name)
                pluginsOpen = false; focused = true
            }, close: {
                guard owner == session.ownership, scope == contextScope else { return }
                if ContextMentions.detect(draft.text) != nil { draft.text = ContextMentions.replacingTrigger(in: draft.text, with: "") }
                pluginsOpen = false
            })
    }
    #if MAINS_GPT_LIVE
    private func validateVoiceStart() -> Bool {
        let availability = voiceStartAvailability
        if availability == .workspaceRequired { onVoiceWorkspaceRequired?() }
        if availability == .mateHostUpdateRequired {
            session.actionError = "Update Mains on your computer to start a new Mate voice chat. You can also start voice from an existing chat."
        }
        return availability == .ready
    }
    private func prepareVoice() {
        guard validateVoiceStart(), let backendID = session.pairing?.descriptor.backendId else { return }
        if session.hasConsent(providerID: "codex") { beginVoice() }
        else {
            voiceConsent = VoiceConsentRequest(context: ConsentContext(backendID: backendID, providerID: "codex", isVoice: true),
                                               owner: session.ownership)
        }
    }
    private func resumeVoiceAfterConsent() {
        let owner = approvedVoiceConsentOwner
        approvedVoiceConsentOwner = nil
        guard owner == session.ownership else { return }
        beginVoice()
    }
    private func beginVoice() {
        let owner = session.ownership
        Task {
            guard owner == session.ownership, validateVoiceStart() else { return }
            focused = false; voiceStartOwner = owner
            await session.startVoice(runID: context.runID, spaceID: context.spaceID, mate: context.mate, workspaceID: context.workspaceID)
        }
    }
    #endif
    private var remainingBytes: Int {
        min(2 * 1024 * 1024, max(0, (2_800_000 - draft.attachments.reduce(0) { $0 + $1.data.utf8.count }) / 4 * 3))
    }
    private func openAttachments() {
        pluginsOpen = false; panelScope = contextScope
        // The menu is an overlay, so the editor keeps its first responder and caret.
        panelOwner = session.ownership; attachmentPresentationID = UUID(); attachmentsOpen = true
    }
    private func addFromPanel(_ attachments: [PromptAttachment]) throws {
        guard panelOwner == session.ownership, !draft.isSending else { throw MainsError.changedBackend }
        try add(attachments)
    }
    private func closeAttachments(_ id: UUID, destination: AttachmentDestination) {
        guard attachmentPresentationID == id, attachmentsOpen else { return }
        attachmentsOpen = false
        guard panelOwner == session.ownership, panelScope == contextScope else { return }
        switch destination {
        case .none: break
        case .files: DispatchQueue.main.async { openFilesFromPanel() }
        case .plugins:
            DispatchQueue.main.async {
                guard panelOwner == session.ownership, panelScope == contextScope else { return }
                pluginsOpen = true; focused = true
            }
        }
    }
    private func openFilesFromPanel() {
        guard panelOwner == session.ownership else { return }
        focused = false; fileOwner = session.ownership; file = true
    }
    private func add(_ data: Data, name: String, type: UTType) throws {
        try add([PromptAttachment(name: name, type: type.conforms(to: .image) ? "image" : "document",
                                  mimeType: type.preferredMIMEType ?? "application/octet-stream", bytes: data)])
    }
    private func add(_ attachments: [PromptAttachment]) throws {
        let combined = draft.attachments + attachments
        guard combined.count <= 5, combined.reduce(0, { $0 + $1.data.utf8.count }) <= 2_800_000 else {
            throw MainsError.server("Attach up to 5 files, totalling 2 MB or less.")
        }
        draft.attachments.append(contentsOf: attachments)
    }
}

struct ComposerSendButton: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let providerID: String
    var sending = false
    let action: () -> Void
    @Environment(\.mateChatTint) private var mateTint

    var body: some View {
        let ink = Color.white
        Button(action: action) {
            Image(systemName: "arrow.up").font(.system(size: 18, weight: .medium))
            .opacity(sending ? 0.5 : 1)
            .frame(width: 36, height: 36).foregroundStyle(ink)
            .background(mateTint ?? Provider.accent(providerID), in: .circle)
            .frame(width: 44, height: 44).contentShape(.circle)
        }
        .buttonStyle(ChatPressStyle())
    }
}

/// Repositions the same text input and controls so the keyboard and caret stay active throughout the transition.
struct MateComposerLayout: Layout {
    static let transition = Animation.easeInOut(duration: 0.24)
    private let editorInset: CGFloat = 10
    private let fillsHeight: Bool
    private var progress: CGFloat

    init(expanded: Bool, fillsHeight: Bool = false) {
        progress = expanded ? 1 : 0
        self.fillsHeight = fillsHeight
    }

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? subviews.reduce(2 * editorInset) { $0 + $1.sizeThatFits(.unspecified).width }
        return CGSize(width: width, height: metrics(width: width, height: proposal.height, subviews: subviews).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let layout = metrics(width: bounds.width, height: bounds.height, subviews: subviews)
        subviews[0].place(at: CGPoint(x: bounds.minX + layout.editorX, y: bounds.minY + layout.editorY),
                          anchor: .topLeading, proposal: ProposedViewSize(width: layout.editorWidth, height: fillsHeight ? layout.editorHeight : nil))
        let controlsY = bounds.minY + layout.controlsY
        if subviews.count == 3 {
            subviews[1].place(at: CGPoint(x: bounds.minX, y: controlsY), anchor: .leading, proposal: .unspecified)
        }
        subviews[subviews.count - 1].place(at: CGPoint(x: bounds.maxX, y: controlsY), anchor: .trailing, proposal: .unspecified)
    }

    private func metrics(width: CGFloat, height: CGFloat?, subviews: Subviews) -> (editorX: CGFloat, editorY: CGFloat, editorWidth: CGFloat, editorHeight: CGFloat, controlsY: CGFloat, height: CGFloat) {
        let leading = subviews.count == 3 ? subviews[1].sizeThatFits(.unspecified) : .zero
        let trailing = subviews[subviews.count - 1].sizeThatFits(.unspecified)
        let editorX = editorInset + leading.width * (1 - progress)
        let editorWidth = max(0, width - editorX - editorInset - trailing.width * (1 - progress))
        let controlHeight = max(44, leading.height, trailing.height)
        let proposedEditorHeight = fillsHeight ? height.map { max(0, $0 - 14 - controlHeight) } : nil
        let editorHeight = subviews[0].sizeThatFits(ProposedViewSize(width: editorWidth, height: proposedEditorHeight)).height
        let compactHeight = max(controlHeight, editorHeight)
        let expandedHeight = 14 + editorHeight + controlHeight
        let layoutHeight = compactHeight + (expandedHeight - compactHeight) * progress
        let editorY = (compactHeight - editorHeight) / 2 * (1 - progress) + 7 * progress
        let controlsY = compactHeight / 2 * (1 - progress) + (expandedHeight - controlHeight / 2) * progress
        return (editorX, editorY, editorWidth, editorHeight, controlsY, layoutHeight)
    }
}
