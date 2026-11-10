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
    @FocusState private var focused: Bool
    @State private var file = false
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
            TextField(context.runID == nil ? "Start a run in \(context.name)" : "Continue this run…", text: $draft.text, axis: .vertical)
                .font(.body).lineLimit(1...6).focused($focused)
                .padding(.horizontal, 10).padding(.top, 7).padding(.bottom, 3)
                .accessibilityIdentifier(context.runID == nil ? "homeMessageInput" : "messageInput")
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
        .attachmentOverlay(isPresented: attachmentsOpen, id: attachmentPresentationID, accent: Provider.accent(context.providerId),
                           maxCount: 5 - draft.attachments.count, maxBytes: remainingBytes, add: addFromPanel, close: closeAttachments)
        .onChange(of: session.ownership) { _, _ in attachmentsOpen = false; file = false }
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
    private var remainingBytes: Int {
        min(2 * 1024 * 1024, max(0, (2_800_000 - draft.attachments.reduce(0) { $0 + $1.data.utf8.count }) / 4 * 3))
    }
    private func openAttachments() {
        guard draft.attachments.count < 5, remainingBytes > 0 else {
            attachmentError = "Attach up to 5 files, totalling 2 MB or less."; return
        }
        focused = false; panelOwner = session.ownership; attachmentPresentationID = UUID(); attachmentsOpen = true
    }
    private func addFromPanel(_ attachments: [PromptAttachment]) throws {
        guard panelOwner == session.ownership, !draft.isSending else { throw MainsError.changedBackend }
        try add(attachments)
    }
    private func closeAttachments(_ id: UUID, showFiles: Bool) {
        guard attachmentPresentationID == id, attachmentsOpen else { return }
        attachmentsOpen = false
        if showFiles { DispatchQueue.main.async { openFilesFromPanel() } }
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
