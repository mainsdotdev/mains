import SwiftUI
import UniformTypeIdentifiers

struct MessageComposer: View {
    let session: BackendSession
    let context: ComposerContext
    @Bindable var draft: ConversationDraft
    let canSend: Bool
    var active = false
    var stopping = false
    var stop: (() -> Void)? = nil
    let model: () -> Void
    let options: () -> Void
    let send: () -> Void
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
    @State private var attachmentError: String?
    private var settings: ComposerSettings { context.settings(session) }
    private var selectedModel: ModelChoice? { context.model(session) }
    private var effort: String? {
        guard let selectedModel else { return nil }
        switch EffortControlKind.resolve(provider: context.providerId, levels: selectedModel.supportedEffortLevels ?? []) {
        case .hidden: return nil
        case .thinking: return settings.config["thinkingMode"]?.bool == true ? "On" : nil
        case .toggle, .slider, .list:
            let value = settings.effort(provider: context.providerId)
            return value.isEmpty && context.providerId == "codex" ? "Default" : ComposerSettings.effortLabel(value)
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
        VStack(alignment: .leading, spacing: 4) {
            if !draft.attachments.isEmpty {
                ComposerAttachmentStrip(attachments: draft.attachments) { id in
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { draft.attachments.removeAll { $0.id == id } }
                }.padding(.horizontal, 8).padding(.top, 6)
            }
            ContextTextEditor(text: $draft.text, skills: $draft.contextSkills, scope: contextScope, focused: $focused,
                placeholder: context.runID == nil ? "Start a run in \(context.name)" : "Continue this run…",
                identifier: context.runID == nil ? "homeMessageInput" : "messageInput")
                .padding(.horizontal, 10).padding(.top, 7).padding(.bottom, 3)
            HStack(spacing: 6) {
                Button(action: openAttachments) {
                    Image(systemName: "plus").font(.system(size: 24, weight: .light)).frame(width: 44, height: 44)
                }
                .background(GeometryReader { geometry in
                    Color.clear.preference(key: AttachmentSourceFrameKey.self, value: geometry.frame(in: .global))
                })
                .disabled(draft.isSending).accessibilityLabel("Add attachment").accessibilityIdentifier("addAttachment")
                ScrollView(.horizontal) {
                    HStack(spacing: 12) {
                        Button(action: model) {
                            HStack(spacing: 5) {
                                ComposerModelLabel(model: selectedModel, loading: context.modelsLoading(session))
                                if let effort { Text(effort).foregroundStyle(.secondary) }
                            }.lineLimit(1).frame(minHeight: 40)
                        }
                        .background(GeometryReader { geometry in
                            Color.clear.preference(key: EffortSourceFrameKey.self, value: geometry.frame(in: .global))
                        })
                        .disabled(!session.isConnected || session.sending || context.saving(session)).accessibilityIdentifier("chooseModel")
                        if let label = optionsLabel {
                            Button(label, action: options).fontWeight(.semibold).frame(minHeight: 40)
                                .disabled(!session.isConnected || session.sending || context.saving(session)).accessibilityIdentifier("runOptions")
                        }
                    }.font(.footnote).foregroundStyle(.secondary)
                }.scrollIndicators(.hidden)
                if active || stopping, let stop {
                    Button(action: stop) {
                        Group {
                            if stopping { ProgressView().tint(.white) }
                            else { Image(systemName: "stop.fill").font(.body.weight(.semibold)) }
                        }.frame(width: 40, height: 40).foregroundStyle(.white)
                            .background(Provider.accent(context.providerId), in: .circle).padding(2)
                    }.buttonStyle(ChatPressStyle()).disabled(!session.isConnected || stopping)
                        .accessibilityLabel(stopping ? "Stopping reply" : "Stop reply").accessibilityIdentifier("stopReply")
                } else {
                    Button(action: send) {
                        Group {
                            if draft.isSending { ProgressView().tint(.white) }
                            else { Image(systemName: "arrow.up").font(.system(size: 22, weight: .medium)) }
                        }.frame(width: 40, height: 40).foregroundStyle(.white)
                            .background(Provider.accent(context.providerId), in: .circle).padding(2)
                    }
                    .buttonStyle(ChatPressStyle())
                    .disabled(!canSend || context.saving(session) || draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel(draft.isSending ? "Sending message" : "Send message").accessibilityIdentifier(context.runID == nil ? "startConversation" : "sendMessage")
                }
            }
            .buttonStyle(.plain)
        }
        .padding(8).modifier(GlassSurface(radius: 34, interactive: false)).padding(.horizontal, 12)
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
