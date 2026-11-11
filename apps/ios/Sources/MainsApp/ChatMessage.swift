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
                if !row.pendingAttachments.isEmpty { PendingPromptAttachments(attachments: row.pendingAttachments) }
                else if !row.media.isEmpty { ChatMediaGallery(session: session, media: row.media, prompt: true) }
                if !row.text.isEmpty { PromptBubble(text: row.text, skills: row.contextSkills, providerID: providerID).accessibilityIdentifier(row.id) }
                if let delivery = row.delivery {
                    HStack(spacing: 6) {
                        if delivery == .sending { ProgressView().controlSize(.mini) }
                        if delivery == .uncertain { Image(systemName: "exclamationmark.circle") }
                        Text(delivery == .uncertain ? "Delivery unconfirmed" : delivery == .accepted ? "Sent" : "Sending…")
                    }.font(.caption).foregroundStyle(.secondary).frame(height: 18).padding(.trailing, 4)
                }
            case .response:
                ChatMessageBody(text: row.text).equatable().accessibilityIdentifier(row.live ? "liveMessage" : row.id)
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
    let skills: [ContextSkill]
    let providerID: String
    var body: some View {
        InlineContextText(text: text, skills: skills).textSelection(.enabled).font(.body).lineSpacing(3)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .foregroundStyle(.white)
            .background(Provider.accent(providerID), in: .rect(cornerRadius: 22))
            .padding(.leading, 56)
    }
}

/// Selectable native Markdown; raw HTML and mathematical typesetting remain outside this slice.
struct ChatMessageBody: View, Equatable {
    let text: String
    nonisolated static func == (lhs: Self, rhs: Self) -> Bool { lhs.text == rhs.text }
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
                case .task(let checked, let value, let depth):
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Image(systemName: checked ? "checkmark.square" : "square").foregroundStyle(.secondary)
                            .accessibilityLabel(checked ? "Completed" : "Not completed")
                        prose(value).frame(maxWidth: .infinity, alignment: .leading)
                    }.padding(.leading, 12 + CGFloat(depth) * 12)
                case .quote(let value):
                    HStack(spacing: 12) { Rectangle().fill(.secondary.opacity(0.3)).frame(width: 3); AnyView(ChatMessageBody(text: value)).foregroundStyle(.secondary) }
                        .fixedSize(horizontal: false, vertical: true)
                case .code(let language, let value): CodeBlock(language: language, code: value)
                case .table(let table): MarkdownTable(table: table)
                case .rule: Divider()
                }
            }
        }.font(.body).tint(.blue).accessibilityElement(children: .contain)
    }
    private func prose(_ source: String) -> some View {
        let rendered = (try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(source)
        return Text(rendered).lineSpacing(4).textSelection(.enabled)
    }
}

private struct MarkdownTable: View {
    let table: MessageTable
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var widths: [CGFloat] {
        let font = UIFont.preferredFont(forTextStyle: .body)
        return table.header.indices.map { column in
            let values = [table.header[column]] + table.rows.prefix(40).map { $0[column] }
            let longest = values.map { ($0 as NSString).size(withAttributes: [.font: font]).width }.max() ?? 80
            return min(260, max(86, longest + 24))
        }
    }
    var body: some View {
        let widths = widths
        ScrollView(.horizontal) {
            VStack(spacing: 0) {
                row(table.header, widths: widths, header: true)
                    .background(Color.primary.opacity(0.04))
                ForEach(table.rows.indices, id: \.self) { index in
                    Divider()
                    row(table.rows[index], widths: widths)
                }
            }.fixedSize(horizontal: true, vertical: true)
        }
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12))
        .clipShape(.rect(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(.primary.opacity(0.08)) }
        .accessibilityElement(children: .contain).accessibilityIdentifier("markdownTable")
    }
    private func row(_ cells: [String], widths: [CGFloat], header: Bool = false) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(table.header.indices, id: \.self) { column in
                let alignment: Alignment = table.alignments[column] == .center ? .center : table.alignments[column] == .trailing ? .trailing : .leading
                let value = (try? AttributedString(markdown: cells[column], options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(cells[column])
                Text(value).fontWeight(header ? .semibold : .regular).lineSpacing(4).textSelection(.enabled)
                    .multilineTextAlignment(table.alignments[column] == .center ? .center : table.alignments[column] == .trailing ? .trailing : .leading)
                    .frame(width: max(1, widths[column] - 24), alignment: alignment)
                    .fixedSize(horizontal: false, vertical: true).padding(12)
                    .accessibilityAddTraits(header ? .isHeader : [])
            }
        }
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
    var horizontalInset: CGFloat = 16
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
        .padding(.horizontal, horizontalInset)
    }
}
