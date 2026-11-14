import SwiftUI
import UniformTypeIdentifiers

struct MessageComposer: View {
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
    var voiceCreated: ((String) -> Void)? = nil
    #if MAINS_GPT_LIVE
    @AppStorage(VoicePresentation.storageKey) private var voicePresentation = VoicePresentation.focus
    @State private var voiceConsent: ConsentContext?
    @State private var voiceStartOwner: Int?
    #endif
    @State private var focused = false
    @State private var file = false
    @State private var pluginsOpen = false
    @State private var contextPresentationID = UUID()
    @State private var composerFrame = CGRect.zero
    @State private var panelScope: ContextScope?
    private var contextScope: ContextScope { context.contextScope(session) }
    private var trigger: ContextTriggerMatch? { focused && !attachmentsOpen ? ContextMentions.detect(draft.text) : nil }
    @State private var attachmentsOpen = false
    @State private var attachmentPresentationID = UUID()
    @State private var panelOwner = 0
    @State private var fileOwner = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var attachmentError: String?
    private var settings: ComposerSettings { context.settings(session) }
    private var selectedModel: ModelChoice? { context.model(session) }
    #if MAINS_GPT_LIVE
    private var ownsVoice: Bool {
        session.voice.ownsCall && (session.voice.runID == context.runID && context.runID != nil || context.runID == nil && voiceStartOwner == session.ownership)
    }
    private var voiceCanStart: Bool { AppFeatures.gptLiveEnabled && session.canStartVoice(runID: context.runID, spaceID: context.spaceID) }
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
            return PermissionChoice.title(for: value, provider: context.providerId) ?? "Options"
        }
        return context.mode == "work" && context.providerId == "codex" || selectedModel?.supportsFastMode == true || selectedModel?.serviceTiers?.isEmpty == false ? "Options" : nil
    }
    var body: some View {
        VStack(spacing: 8) {
            #if MAINS_GPT_LIVE
            if ownsVoice && voicePresentation == .conversation {
                VoiceOrb(voice: session.voice, size: 104)
                    .accessibilityIdentifier("voiceComposerOrb")
                    .frame(maxWidth: .infinity).padding(.bottom, 4)
            }
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
        .onChange(of: draft.text) { _, _ in draft.reconcileContext() }
        .onChange(of: contextScope, initial: true) { _, scope in draft.synchronizeContext(scope); pluginsOpen = false }
        .attachmentOverlay(isPresented: attachmentsOpen, id: attachmentPresentationID, accent: Provider.accent(context.providerId),
                           maxCount: 5 - draft.attachments.count, maxBytes: remainingBytes, add: addFromPanel, close: closeAttachments)
        .onChange(of: session.ownership) { _, _ in attachmentsOpen = false; file = false; pluginsOpen = false }
    #if MAINS_GPT_LIVE
        .onChange(of: session.voice.runID) { _, id in
            if let id, context.runID == nil, voiceStartOwner == session.ownership, session.selectedSpaceID == context.spaceID { voiceCreated?(id) }
        }
        .sheet(item: $voiceConsent) { consent in
            ConsentView(context: consent) {
                guard consent.backendID == session.pairing?.descriptor.backendId else { return }
                session.grantConsent(providerID: "codex", backendID: consent.backendID)
                beginVoice()
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
        VStack(alignment: .leading, spacing: 4) {
            if let error = draft.storageError { Text(error).font(.caption).foregroundStyle(.orange).padding(.horizontal, 12).padding(.top, 8).accessibilityIdentifier("draftStorageError") }
            if !draft.attachments.isEmpty {
                ComposerAttachmentStrip(attachments: draft.attachments) { id in
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { draft.attachments.removeAll { $0.id == id } }
                }.padding(.horizontal, 8).padding(.top, 6)
            }
            ContextTextEditor(text: $draft.text, skills: $draft.contextSkills, scope: contextScope, focused: $focused,
                placeholder: context.runID == nil ? "Start a run in \(context.name)" : "Continue this run…",
                identifier: context.runID == nil ? "homeMessageInput" : "messageInput")
                .padding(.horizontal, 10).padding(.top, 7).padding(.bottom, 3)
            HStack(alignment: .center, spacing: 6) {
                Button(action: openAttachments) {
                    Image(systemName: "plus").font(.system(size: 22, weight: .light)).frame(width: 44, height: 44)
                }
                .background(GeometryReader { geometry in
                    Color.clear.preference(key: AttachmentSourceFrameKey.self, value: geometry.frame(in: .global))
                })
                .disabled(draft.isSending).accessibilityLabel("Add attachment").accessibilityIdentifier("addAttachment")
                Group {
                    if dynamicTypeSize.isAccessibilitySize {
                        ScrollView(.horizontal) { configurationControls }.scrollIndicators(.hidden)
                    } else {
                        configurationControls
                    }
                }.fixedSize(horizontal: false, vertical: true)
                composerActions
            }
            .buttonStyle(.plain)
        }
        .padding(8).modifier(GlassSurface(radius: 34, interactive: false)).padding(.horizontal, 12)
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
            .background(GeometryReader { geometry in
                Color.clear.preference(key: EffortSourceFrameKey.self, value: geometry.frame(in: .global))
            })
            .disabled(!session.isConnected || session.sending || context.saving(session)).accessibilityIdentifier("chooseModel")
            if let label = optionsLabel {
                Button(label, action: options).fontWeight(.semibold).frame(minHeight: 44)
                    .fixedSize(horizontal: true, vertical: false).layoutPriority(1)
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
        Button(action: send) {
            Group {
                if draft.isSending { ProgressView().tint(.white) }
                else { Image(systemName: "arrow.up").font(.system(size: 18, weight: .medium)) }
            }.frame(width: 36, height: 36).foregroundStyle(.white)
                .background(Provider.accent(context.providerId), in: .circle)
                .frame(width: 44, height: 44).contentShape(.circle)
        }
        .buttonStyle(ChatPressStyle())
        .disabled(!canSend || draft.isSending || context.saving(session) || !draft.hasContent || voiceBlocksSending)
        .accessibilityLabel(draft.isSending ? "Sending message" : sendLabel ?? "Send message").accessibilityIdentifier(context.runID == nil ? "startConversation" : "sendMessage")
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
                Group {
                    if stopping { ProgressView().tint(.white) }
                    else { Image(systemName: ownsVoice && session.voice.phase == .stopFailed ? "arrow.clockwise" : "stop.fill").font(.callout.weight(.semibold)) }
                }.frame(width: 36, height: 36).foregroundStyle(.white)
                    .background(Provider.accent(context.providerId), in: .circle)
                    .frame(width: 44, height: 44).contentShape(.circle)
            }.buttonStyle(ChatPressStyle()).disabled(ownsVoice ? session.voice.phase == .ending : !session.isConnected || stopping)
                .accessibilityLabel(ownsVoice ? session.voice.phase == .stopFailed ? "Retry ending voice chat" : "End voice chat" : stopping ? "Stopping reply" : "Stop reply")
                .accessibilityIdentifier(ownsVoice ? "endVoice" : "stopReply")
        } else if !draft.hasContent && context.providerId == "codex" && !active && !session.isDemo {
            Button(action: prepareVoice) {
                Image(systemName: "waveform").font(.system(size: 18, weight: .medium))
                    .frame(width: 36, height: 36).foregroundStyle(.white)
                    .background(Provider.accent(context.providerId), in: .circle)
                    .frame(width: 44, height: 44).contentShape(.circle)
            }.buttonStyle(ChatPressStyle()).disabled(!voiceCanStart || context.saving(session))
                .accessibilityLabel("Start GPT Live").accessibilityIdentifier("startVoice")
        } else {
            sendMessageButton
        }
        #else
        if stopping || active {
            Button { stop?() } label: {
                Group {
                    if stopping { ProgressView().tint(.white) }
                    else { Image(systemName: "stop.fill").font(.callout.weight(.semibold)) }
                }.frame(width: 36, height: 36).foregroundStyle(.white)
                    .background(Provider.accent(context.providerId), in: .circle)
                    .frame(width: 44, height: 44).contentShape(.circle)
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
                    Group {
                        if session.voice.phase == .ending { ProgressView() }
                        else { Image(systemName: session.voice.phase == .stopFailed ? "arrow.clockwise" : "xmark").font(.system(size: 22, weight: .medium)) }
                    }
                    .frame(width: 52, height: 52).foregroundStyle(Color(.systemBackground)).background(.primary, in: .circle)
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
        return ContextPickerRequest(id: contextPresentationID, frame: composerFrame, session: session, scope: scope, owner: owner,
            trigger: trigger?.trigger, query: trigger?.filter ?? "", pluginsOnly: trigger == nil && pluginsOpen,
            pickSkill: { skill in
                guard owner == session.ownership, scope == contextScope, !draft.isSending else { return }
                draft.insert(skill, scope: scope); pluginsOpen = false; focused = true
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
    private func prepareVoice() {
        guard voiceCanStart, let backendID = session.pairing?.descriptor.backendId else { return }
        if session.hasConsent(providerID: "codex") { beginVoice() }
        else { voiceConsent = ConsentContext(backendID: backendID, providerID: "codex", isVoice: true) }
    }
    private func beginVoice() {
        guard voiceCanStart else { return }
        focused = false; voiceStartOwner = session.ownership
        Task { await session.startVoice(runID: context.runID, spaceID: context.spaceID) }
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
