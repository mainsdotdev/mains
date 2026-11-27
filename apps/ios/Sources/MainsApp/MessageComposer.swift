import SwiftUI
import UniformTypeIdentifiers

private extension EnvironmentValues {
    @Entry var composerExpansion: Binding<Bool>? = nil
    @Entry var compactComposerEditing: Bool? = nil
}

extension EnvironmentValues {
    @Entry var composerCoversReader = false
}

extension View {
    func composerInset<Bar: View>(preservesReaderViewport: Bool = true,
                                 composerFocused: Bool? = nil,
                                 @ViewBuilder _ bar: @escaping (Bool) -> Bar) -> some View {
        modifier(ComposerInset(preservesReaderViewport: preservesReaderViewport, composerFocused: composerFocused, bar: bar))
    }
}

private struct ComposerInset<Bar: View>: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let preservesReaderViewport: Bool
    let composerFocused: Bool?
    let bar: (Bool) -> Bar
    @State private var expanded = false
    @State private var compactHeight: CGFloat = 0
    @State private var keyboardFreeFrame: CGRect?
    @State private var hardwareEditing = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @ViewBuilder func body(content: Content) -> some View {
        let page = content
            .environment(\.composerCoversReader, expanded)
            .allowsHitTesting(!expanded)
            .accessibilityHidden(expanded)
        if preservesReaderViewport && composerFocused == nil {
            reserveReaderInset(page).overlay {
                GeometryReader { viewport in readerPanel(viewportHeight: viewport.size.height) }
            }
        } else {
            GeometryReader { viewport in
                let visibleFrame = viewport.frame(in: .global)
                let keyboardIsDocked = keyboardFreeFrame.map { fullFrame in
                    abs(fullFrame.width - visibleFrame.width) < 1 && fullFrame.maxY - visibleFrame.maxY > 1
                } ?? false
                let needsHardwareFallback = composerFocused == true && !keyboardIsDocked
                let editing = keyboardIsDocked || hardwareEditing

                // The native keyboard changes the viewport and the editor layout in the same transaction.
                Group {
                    if preservesReaderViewport {
                        reserveReaderInset(page).overlay {
                            readerPanel(viewportHeight: viewport.size.height, editing: editing)
                        }
                    } else {
                        page.safeAreaInset(edge: .bottom, spacing: 0) {
                            panel(viewportHeight: viewport.size.height)
                                .environment(\.compactComposerEditing, composerFocused == nil ? nil : editing)
                        }
                    }
                }
                .task(id: needsHardwareFallback) {
                    if needsHardwareFallback {
                        // Hardware-keyboard focus can leave the native viewport unchanged.
                        do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                        guard !Task.isCancelled else { return }
                    }
                    guard hardwareEditing != needsHardwareFallback else { return }
                    withAnimation(reduceMotion || keyboardIsDocked ? nil : .easeInOut(duration: 0.24)) {
                        hardwareEditing = needsHardwareFallback
                    }
                }
            }
            .background(alignment: .center) {
                if composerFocused != nil {
                    GeometryReader { _ in
                        Color.clear
                            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: {
                                keyboardFreeFrame = $0
                            }
                    }
                    .ignoresSafeArea(.keyboard, edges: .bottom)
                    .allowsHitTesting(false)
                }
            }
        }
    }

    private func reserveReaderInset(_ page: some View) -> some View {
        page.safeAreaInset(edge: .bottom, spacing: 0) {
            // The transcript retains its inset while the editor covers it.
            Color.clear.frame(height: compactHeight).allowsHitTesting(false).accessibilityHidden(true)
        }
    }

    private func readerPanel(viewportHeight: CGFloat, editing: Bool? = nil) -> some View {
        panel(viewportHeight: viewportHeight)
            .environment(\.compactComposerEditing, editing)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                if !expanded { compactHeight = height }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    }

    private func panel(viewportHeight: CGFloat) -> some View {
        bar(expanded)
            .environment(\.composerExpansion, $expanded)
            .frame(height: expanded ? viewportHeight : nil)
            .background(expanded ? Color(.systemBackground) : .clear)
    }
}

struct MessageComposer: View {
    static let horizontalInset: CGFloat = 12
    static let standardVerticalInset: CGFloat = 8
    static let controlHeight: CGFloat = 44
    private static let compactControlHeight: CGFloat = 50
    private static let compactCornerRadius: CGFloat = compactControlHeight / 2
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
    var collapsesWhenUnfocused = false
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
    @Environment(\.compactComposerEditing) private var compactComposerEditing
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.conversationPaneVisible) private var paneVisible
    @Environment(\.mainPaneCovered) private var mainPaneCovered
    @Environment(\.mateChatTint) private var mateTint
    @State private var attachmentError: String?
    private var settings: ComposerSettings { context.settings(session) }
    private var editorExpanded: Bool { expansion?.wrappedValue == true }
    private var compactComposer: Bool {
        #if MAINS_GPT_LIVE
        if ownsVoice { return false }
        #endif
        return collapsesWhenUnfocused && !(compactComposerEditing ?? focused) && !editorExpanded
    }
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
        .background(alignment: .center) {
            if session.isConnected, !draft.isSending, !attachmentsOpen, trigger != nil || pluginsOpen {
                GeometryReader { geometry in
                    Color.clear.contextPicker(pickerRequest(in: geometry.frame(in: .global)))
                }
            }
        }
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
        let usesLegacyMateLayout = context.lockedProfile && !collapsesWhenUnfocused
        let stackedMate = usesLegacyMateLayout && (focused || !draft.text.isEmpty || editorExpanded)
        let compactMate = usesLegacyMateLayout && !stackedMate
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
            if context.lockedProfile || collapsesWhenUnfocused {
                MateComposerLayout(expanded: usesLegacyMateLayout ? stackedMate : !compactComposer, fillsHeight: editorExpanded,
                                   compactRowHeight: collapsesWhenUnfocused ? Self.compactControlHeight : nil) {
                    textEditor
                    attachmentButton()
                    if collapsesWhenUnfocused && !context.lockedProfile {
                        HStack(spacing: 0) {
                            if !compactComposer { configurationRow }
                        }
                    }
                    HStack(spacing: 6) {
                        if showsCollapseButtonInControls { editorSizeButton }
                        composerActions(compact: compactComposer)
                    }
                    .frame(minWidth: collapsesWhenUnfocused ? Self.controlHeight : nil, alignment: .trailing)
                }
                .buttonStyle(.plain)
            } else {
                textEditor.padding(.horizontal, 10).padding(.top, 7).padding(.bottom, 3)
                HStack(spacing: 6) {
                    attachmentButton()
                    configurationRow
                    if showsCollapseButtonInControls { editorSizeButton }
                    composerActions()
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, compactComposer ? 0 : compactMate ? 4 : Self.standardVerticalInset)
        .modifier(GlassSurface(radius: compactComposer ? Self.compactCornerRadius : editorExpanded ? 24 : 34,
                               interactive: false))
        .overlay(alignment: .topTrailing) {
            if showsExpandButton { editorSizeButton.padding([.top, .trailing], 8) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("messageComposer")
        .padding(.horizontal, Self.horizontalInset)
        .animation(reduceMotion ? nil : MateComposerLayout.transition, value: stackedMate)
    }

    private var configurationRow: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                ScrollView(.horizontal) { configurationControls }.scrollIndicators(.hidden)
            } else {
                configurationControls
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var textEditor: some View {
        ContextTextEditor(text: $draft.text, skills: $draft.contextSkills, scope: contextScope, focused: $focused,
            placeholder: context.placeholder,
            identifier: context.runID == nil ? "homeMessageInput" : "messageInput",
            fillsHeight: editorExpanded, reservedTrailingWidth: expandButtonSpace,
            compactRowHeight: collapsesWhenUnfocused ? Self.compactControlHeight : nil,
            showsSingleLine: compactComposer, onOverflowChange: { textOverflows = $0 })
    }

    private var showsExpandButton: Bool { expansion != nil && !editorExpanded && !compactComposer && textOverflows && !draft.text.isEmpty }
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

    private func attachmentButton() -> some View {
        Button(action: openAttachments) {
            Image(systemName: "plus").font(.system(size: 22, weight: .light))
                .frame(width: Self.controlHeight, height: Self.controlHeight)
                .contentShape(.rect)
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

    @ViewBuilder private func composerActions(compact: Bool = false) -> some View {
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
                    .frame(width: 36, height: 36).foregroundStyle(compact ? Color.secondary : .white)
                    .background(compact ? Color.clear : composerAccent, in: .circle)
                    .frame(width: 44, height: 44).contentShape(.circle)
            }.buttonStyle(ChatPressStyle()).disabled(voiceStartAvailability == .unavailable)
                .accessibilityLabel("Start GPT Live").accessibilityIdentifier("startVoice")
        } else if !compact || draft.hasContent || draft.isSending {
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
        if !stopping && (!active || canSendDuringRun && draft.hasContent) && (!compact || draft.hasContent || draft.isSending) {
            sendMessageButton
        }
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
    private func pickerRequest(in composerFrame: CGRect) -> ContextPickerRequest {
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
    private let compactRowHeight: CGFloat?
    private var progress: CGFloat

    init(expanded: Bool, fillsHeight: Bool = false, compactRowHeight: CGFloat? = nil) {
        progress = expanded ? 1 : 0
        self.fillsHeight = fillsHeight
        self.compactRowHeight = compactRowHeight
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
                          anchor: .topLeading, proposal: ProposedViewSize(width: layout.editorWidth,
                              height: fillsHeight || compactRowHeight != nil ? layout.editorHeight : nil))
        let controlsY = bounds.minY + layout.controlsY
        if subviews.count >= 3 {
            subviews[1].place(at: CGPoint(x: bounds.minX, y: controlsY), anchor: .leading, proposal: .unspecified)
        }
        if subviews.count == 4 {
            subviews[2].place(at: CGPoint(x: bounds.minX + layout.configurationX, y: controlsY),
                              anchor: .leading, proposal: ProposedViewSize(width: layout.configurationWidth, height: nil))
        }
        subviews[subviews.count - 1].place(at: CGPoint(x: bounds.maxX, y: controlsY), anchor: .trailing, proposal: .unspecified)
    }

    private func metrics(width: CGFloat, height: CGFloat?, subviews: Subviews) -> (
        editorX: CGFloat, editorY: CGFloat, editorWidth: CGFloat, editorHeight: CGFloat,
        configurationX: CGFloat, configurationWidth: CGFloat, controlsY: CGFloat, height: CGFloat
    ) {
        let leading = subviews.count >= 3 ? subviews[1].sizeThatFits(.unspecified) : .zero
        let trailing = subviews[subviews.count - 1].sizeThatFits(.unspecified)
        let editorX = editorInset + leading.width * (1 - progress)
        let editorWidth = max(0, width - editorX - editorInset - trailing.width * (1 - progress))
        let configurationX = leading.width + 6
        let configurationWidth = max(0, width - configurationX - trailing.width - 6)
        let configurationHeight = subviews.count == 4
            ? subviews[2].sizeThatFits(ProposedViewSize(width: configurationWidth, height: nil)).height : 0
        let compactControlHeight = max(44, leading.height, trailing.height)
        let controlHeight = max(compactControlHeight, configurationHeight)
        let proposedEditorHeight = fillsHeight ? height.map { max(0, $0 - 14 - controlHeight) } : nil
        // Reserve the final multiline width while the visible field changes width.
        let measurementWidth = compactRowHeight == nil ? editorWidth : max(0, width - 2 * editorInset)
        let expandedEditorHeight = subviews[0].sizeThatFits(
            ProposedViewSize(width: measurementWidth, height: proposedEditorHeight)).height
        let compactEditorHeight = compactRowHeight.map {
            max($0, ceil(UIFont.preferredFont(forTextStyle: .body).lineHeight) + 10)
        } ?? expandedEditorHeight
        let compactHeight = max(compactControlHeight, compactEditorHeight)
        let expandedHeight = 14 + expandedEditorHeight + controlHeight
        let layoutHeight = compactHeight + (expandedHeight - compactHeight) * progress
        let editorHeight = compactEditorHeight + (expandedEditorHeight - compactEditorHeight) * progress
        let editorY = (compactHeight - compactEditorHeight) / 2 * (1 - progress) + 7 * progress
        let controlsY = compactHeight / 2 * (1 - progress) + (expandedHeight - controlHeight / 2) * progress
        return (editorX, editorY, editorWidth, editorHeight, configurationX, configurationWidth, controlsY, layoutHeight)
    }
}
