import SwiftUI

struct ChatPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label.opacity(configuration.isPressed ? 0.55 : 1) }
}

struct ChatMessage: View {
    let session: BackendSession
    let row: TranscriptRow
    let providerID: String
    let readContent: (Int) -> Void
    var body: some View {
        VStack(alignment: row.kind == .prompt ? .trailing : .leading, spacing: 10) {
            switch row.kind {
            case .prompt:
                if !row.media.isEmpty { ChatMediaGallery(session: session, media: row.media, prompt: true) }
                if !row.text.isEmpty { PromptBubble(text: row.text, providerID: providerID).accessibilityIdentifier(row.id) }
            case .response:
                ChatMessageBody(text: row.text).accessibilityIdentifier(row.live ? "liveMessage" : row.id)
            case .notice:
                Label(row.text, systemImage: "info.circle").font(.callout).foregroundStyle(.secondary)
            case .media: ChatMediaGallery(session: session, media: row.media)
            case .tool: EmptyView()
            }
            if let id = row.deferredArtifactID {
                Button("Read full message", systemImage: "text.alignleft") { readContent(id) }
                    .font(.subheadline.weight(.medium))
            }
        }
        .frame(maxWidth: .infinity, alignment: row.kind == .prompt ? .trailing : .leading)
        .contextMenu {
            Button(row.live ? "Copy current text" : row.deferredArtifactID != nil ? "Copy message preview" : "Copy message", systemImage: "doc.on.doc") { UIPasteboard.general.string = row.text }
        }
    }
}

private struct PromptBubble: View {
    let text: String
    let providerID: String
    var body: some View {
        Text(text).textSelection(.enabled).font(.body).lineSpacing(3)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .foregroundStyle(.white)
            .background(Provider.accent(providerID), in: .rect(cornerRadius: 22))
            .padding(.leading, 56)
    }
}

struct PendingPrompt: View {
    let pending: PendingMessage
    let providerID: String
    var body: some View {
        VStack(alignment: .trailing, spacing: 7) {
            if !pending.attachments.isEmpty { PendingPromptAttachments(attachments: pending.attachments) }
            PromptBubble(text: pending.text, providerID: providerID)
            HStack(spacing: 6) {
                if pending.status == .sending { ProgressView().controlSize(.mini) }
                if pending.status == .uncertain { Image(systemName: "exclamationmark.circle") }
                Text(pending.status == .uncertain ? "Delivery unconfirmed" : pending.status == .accepted ? "Sent" : "Sending…")
            }.font(.caption).foregroundStyle(.secondary).padding(.trailing, 4)
        }.frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// Selectable native prose and fenced code; remote images and HTML remain outside this slice.
struct ChatMessageBody: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(MessageBlock.parse(text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let value): prose(value)
                case .heading(let level, let value): prose(value).font(level == 1 ? .title2.bold() : level == 2 ? .title3.bold() : .headline)
                case .list(let marker, let value, let depth):
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Text(marker).foregroundStyle(.secondary).frame(minWidth: 12, alignment: .trailing)
                        prose(value).frame(maxWidth: .infinity, alignment: .leading)
                    }.padding(.leading, 12 + CGFloat(depth) * 12)
                case .quote(let value):
                    HStack(spacing: 12) { Rectangle().fill(.secondary.opacity(0.3)).frame(width: 3); prose(value).foregroundStyle(.secondary) }
                        .fixedSize(horizontal: false, vertical: true)
                case .code(let language, let value): CodeBlock(language: language, code: value)
                case .rule: Divider()
                }
            }
        }.font(.body).tint(.blue)
    }
    private func prose(_ source: String) -> some View {
        let rendered = (try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(source)
        return Text(rendered).lineSpacing(4).textSelection(.enabled)
    }
}

private struct CodeBlock: View {
    let language: String
    let code: String
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "Code" : language).font(.caption.monospaced()).foregroundStyle(.secondary)
                Spacer()
                Button("Copy code", systemImage: "doc.on.doc") { UIPasteboard.general.string = code }
                    .labelStyle(.iconOnly).font(.caption).frame(width: 44, height: 44)
            }.padding(.leading, 14).padding(.trailing, 6)
            ScrollView(.horizontal) {
                Text(code).font(.system(.callout, design: .monospaced)).lineSpacing(4).textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: false).padding(.horizontal, 14).padding(.bottom, 14)
            }
        }
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 14))
        .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(.primary.opacity(0.05)) }
    }
}

struct ChatActivity: View {
    let title: String
    let symbol: String
    let busy: Bool
    var body: some View {
        HStack(spacing: 9) {
            if busy { ProgressView().controlSize(.mini) }
            else { Image(systemName: symbol) }
            Text(title)
        }.font(.footnote).foregroundStyle(.secondary).accessibilityElement(children: .combine)
    }
}

struct ChatNotice<Actions: View>: View {
    let title: String
    let message: String
    let symbol: String
    let warning: Bool
    @ViewBuilder var actions: () -> Actions
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(warning ? Color.orange : .secondary).padding(.top, 2)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(message).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 16) { actions() }.font(.footnote.weight(.semibold)).buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
        .padding(.horizontal, 16)
    }
}
