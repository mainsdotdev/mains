import SwiftUI

struct RemoteConversationQueueView: View {
    let queues: [RemoteRunQueue]
    var body: some View {
        let current = queues.filter(\.isCurrent)
        if !current.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Label("Queued on computer", systemImage: "desktopcomputer").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(current) { queue in
                            ForEach(queue.messages) { message in
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: message.attachmentNames.isEmpty ? "text.line.first.and.arrowtriangle.forward" : "paperclip").foregroundStyle(.secondary)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(message.preview).font(.subheadline).lineLimit(2)
                                        if !message.attachmentNames.isEmpty, !message.text.isEmpty {
                                            Text(message.attachmentNames.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                        }
                                        if let error = message.error { Text(error).font(.caption).foregroundStyle(.orange).lineLimit(2) }
                                        else if message.status != "queued" { Text(status(message.status)).font(.caption).foregroundStyle(.secondary) }
                                    }
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }
                            if let reason = queue.pauseReason { Text(reason).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }.frame(maxHeight: 180).fixedSize(horizontal: false, vertical: true)
            }.padding(14).modifier(GlassSurface(radius: 22, interactive: false)).padding(.horizontal, 12)
                .accessibilityIdentifier("computerMessageQueue")
        }
    }
    private func status(_ value: String) -> String {
        switch value {
        case "sending": "Sending on computer…"
        case "editing": "Editing on computer"
        case "unknown": "Delivery unconfirmed"
        default: "Message needs attention"
        }
    }
}

struct ConversationQueueView: View {
    let session: BackendSession
    @Bindable var queue: ConversationQueue
    let canSteer: Bool
    let resume: () -> Void
    var body: some View {
        if !queue.messages.isEmpty {
            VStack(spacing: 0) {
                if !queue.messages.isEmpty {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(queue.messages) { message in
                                row(message)
                                if message.id != queue.messages.last?.id { Divider().padding(.leading, 16) }
                            }
                        }
                    }.frame(maxHeight: 192).fixedSize(horizontal: false, vertical: true)
                }
                if queue.editingID != nil {
                    HStack(spacing: 12) {
                        Text("Editing queued message").font(.caption).foregroundStyle(.secondary)
                        Spacer(minLength: 4)
                        Button("Cancel edit") { session.cancelQueuedEdit(queue.runID) }.font(.caption.weight(.semibold))
                    }.padding(.horizontal, 14).padding(.vertical, 10)
                }
                if let reason = queue.pauseReason, !queue.messages.isEmpty {
                    Divider()
                    HStack(spacing: 10) {
                        Text(reason).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                        Button(queue.hasUnknown ? "Check delivery" : "Resume queue", action: resume)
                            .font(.caption.weight(.semibold)).disabled(queue.busy || !session.isConnected)
                            .accessibilityIdentifier("resumeMessageQueue")
                    }.padding(14)
                }
            }
            .modifier(GlassSurface(radius: 22, interactive: false)).padding(.horizontal, 12)
            .accessibilityIdentifier("conversationMessageQueue")
        }
    }
    private func row(_ message: QueuedRunMessage) -> some View {
        HStack(spacing: 10) {
            Image(systemName: message.input.attachments.isEmpty ? "text.line.first.and.arrowtriangle.forward" : message.input.attachments[0].type == "image" ? "photo" : "doc.text")
                .foregroundStyle(.secondary).font(.footnote)
            VStack(alignment: .leading, spacing: 3) {
                Text(message.preview).font(.subheadline).lineLimit(1)
                if let status = status(message) { Text(status).font(.caption).foregroundStyle(.secondary) }
                if let error = message.error { Text(error).font(.caption).foregroundStyle(.orange).lineLimit(2) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if message.status != .editing {
                Button("Steer") { Task { await session.steerQueuedMessage(queue.runID, id: message.id) } }
                    .font(.caption.weight(.semibold)).disabled(!canSteer || queue.busy || queue.hasUnknown || message.status != .queued || !session.isConnected || session.pendingMessage != nil)
            }
            Button("Remove message", systemImage: "trash") { session.removeQueuedMessage(queue.runID, id: message.id) }
                .labelStyle(.iconOnly).font(.footnote).disabled([.sending, .editing].contains(message.status))
            Menu {
                Button("Edit message", systemImage: "pencil") { session.editQueuedMessage(queue.runID, id: message.id) }
                    .disabled(queue.editingID != nil || ![.queued, .error].contains(message.status))
                Button("Move up") { move(message.id, by: -1) }.disabled(!queue.canReorder || queue.messages.first?.id == message.id)
                Button("Move down") { move(message.id, by: 1) }.disabled(!queue.canReorder || queue.messages.last?.id == message.id)
            } label: { Image(systemName: "ellipsis").frame(width: 28, height: 32) }.accessibilityLabel("Queued message options")
        }
        .padding(.horizontal, 14).padding(.vertical, 10).contentShape(.rect)
        .draggable(queue.canReorder ? message.id : "")
        .dropDestination(for: String.self) { ids, _ in
            guard queue.canReorder, let source = ids.first, let from = queue.messages.firstIndex(where: { $0.id == source }),
                  let to = queue.messages.firstIndex(where: { $0.id == message.id }) else { return false }
            var ordered = queue.messages.map(\.id); let moved = ordered.remove(at: from); ordered.insert(moved, at: to); queue.reorder(ordered)
            return true
        }
    }
    private func move(_ id: String, by distance: Int) {
        guard let from = queue.messages.firstIndex(where: { $0.id == id }), queue.messages.indices.contains(from + distance) else { return }
        var ids = queue.messages.map(\.id); ids.swapAt(from, from + distance); queue.reorder(ids)
    }
    private func status(_ message: QueuedRunMessage) -> String? {
        switch message.status {
        case .queued: nil
        case .editing: "Editing queued message"
        case .sending: "Sending message…"
        case .unknown: "Delivery unconfirmed"
        case .error: "Message needs attention"
        }
    }
}
