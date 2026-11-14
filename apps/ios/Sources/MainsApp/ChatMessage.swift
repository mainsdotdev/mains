import SwiftUI

struct ChatPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label.opacity(configuration.isPressed ? 0.55 : 1) }
}

struct ChatMessage: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let row: TranscriptRow
    let providerID: String
    let readContent: (Int) -> Void
    var openSubagents: () -> Void = {}
    var copyText: String? = nil
    var copyIsPreview = false
    var forkRunID: String? = nil
    var fork: () -> Void = {}
    @Environment(\.openVoiceConversation) private var openVoiceConversation
    var body: some View {
        VStack(alignment: row.kind == .prompt ? .trailing : .leading, spacing: row.kind == .response ? 4 : 10) {
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
                if let task = row.voiceTask {
                    Button { openVoiceConversation(task.id) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "arrow.triangle.branch")
                            Text(task.title).font(.subheadline.weight(.medium)).lineLimit(2)
                            Spacer(minLength: 8)
                            Image(systemName: "arrow.up.right").font(.caption)
                        }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 18))
                    }.buttonStyle(ChatPressStyle()).accessibilityLabel("Open working chat: " + task.title)
                        .accessibilityIdentifier("voiceTask-" + task.id)
                } else {
                    ChatMessageBody(text: row.text).equatable().accessibilityIdentifier(row.live ? "liveMessage" : row.id)
                }
            case .notice:
                Label(row.text, systemImage: "info.circle").font(.callout).foregroundStyle(.secondary)
            case .media: ChatMediaGallery(session: session, media: row.media)
            case .tool: EmptyView()
            case .subagents: SubagentSummaryRow(text: row.text, open: openSubagents)
            }
            if let id = row.deferredArtifactID {
                Button("Read full message", systemImage: "text.alignleft") { readContent(id) }
                    .font(.subheadline.weight(.medium))
            }
            if row.kind == .response, !row.live, copyText != nil || forkRunID != nil {
                ConversationMessageActions(session: session, copyText: copyText, copyIsPreview: copyIsPreview, forkRunID: forkRunID, fork: fork)
            }
        }
        .frame(maxWidth: .infinity, alignment: row.kind == .prompt ? .trailing : .leading)
        .contextMenu {
            Button(row.live ? "Copy current text" : row.deferredArtifactID != nil ? "Copy message preview" : "Copy message", systemImage: "doc.on.doc") { UIPasteboard.general.string = row.text }
        }
    }
}

private struct PromptBubble: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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

/// Atlas mirrors document-content.css while chat retains its reading styles.
enum MarkdownPresentation: Equatable {
    case chat, atlas
    var isAtlas: Bool { self == .atlas }
    var bodyFont: Font { isAtlas ? .system(.subheadline) : .body }
    func headingFont(_ level: Int) -> Font {
        guard isAtlas else { return level == 1 ? .title2.bold() : level == 2 ? .title3.bold() : .headline }
        switch level {
        case 1: return .system(.title3).weight(.bold)
        case 2: return .system(.body).weight(.semibold)
        case 3: return .system(.subheadline).weight(.semibold)
        default: return .system(.footnote).weight(.semibold)
        }
    }
}

/// Native Markdown uses an isolated, offline KaTeX surface only when it contains math.
struct ChatMessageBody: View, Equatable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let text: String
    var presentation: MarkdownPresentation = .chat
    nonisolated static func == (lhs: Self, rhs: Self) -> Bool { lhs.text == rhs.text && lhs.presentation == rhs.presentation }
    var body: some View {
        if let document = MathMarkdown.prepare(text) { MathMarkdownView(document: document, source: text, presentation: presentation) }
        else { nativeBody }
    }
    private var nativeBody: some View {
        VStack(alignment: .leading, spacing: presentation.isAtlas ? 8 : 16) {
            ForEach(Array(MessageBlock.parse(text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let value): prose(value)
                case .heading(let level, let value): prose(value).font(presentation.headingFont(level)).padding(.top, presentation.isAtlas ? (level == 1 ? 16 : 8) : 0)
                case .list(let marker, let value, let depth):
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Text(marker).foregroundStyle(.secondary).frame(minWidth: 12, alignment: .trailing)
                        prose(value).frame(maxWidth: .infinity, alignment: .leading)
                    }.padding(.leading, 12 + CGFloat(depth) * 12)
                case .task(let checked, let value, let depth):
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Group {
                            if presentation.isAtlas {
                                RoundedRectangle(cornerRadius: 4).fill(checked ? Color.primary : Color(.tertiarySystemFill))
                                    .overlay { RoundedRectangle(cornerRadius: 4).strokeBorder(.primary.opacity(0.12)) }
                                    .overlay { if checked { Image(systemName: "checkmark").font(.caption2.bold()).foregroundStyle(Color(.systemBackground)) } }
                                    .frame(width: 16, height: 16)
                            } else {
                                Image(systemName: checked ? "checkmark.square" : "square").foregroundStyle(.secondary)
                            }
                        }.accessibilityLabel(checked ? "Completed" : "Not completed")
                        prose(value).frame(maxWidth: .infinity, alignment: .leading)
                    }.padding(.leading, 12 + CGFloat(depth) * 12)
                case .quote(let value):
                    HStack(spacing: 12) { Rectangle().fill(.secondary.opacity(0.3)).frame(width: presentation.isAtlas ? 4 : 3); AnyView(ChatMessageBody(text: value, presentation: presentation)).foregroundStyle(.secondary).italic(presentation.isAtlas) }
                        .fixedSize(horizontal: false, vertical: true)
                case .code(let language, let value): CodeBlock(language: language, code: value, presentation: presentation)
                case .table(let table): MarkdownTable(table: table, presentation: presentation)
                case .rule: Divider()
                }
            }
        }.font(presentation.bodyFont).tint(.blue).accessibilityElement(children: .contain)
    }
    private func prose(_ source: String) -> some View {
        let rendered = (try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(source)
        let styled: AttributedString
        if presentation.isAtlas {
            var result = rendered
            for run in rendered.runs where run.inlinePresentationIntent?.contains(.code) == true {
                result[run.range].backgroundColor = Color(.tertiarySystemFill)
            }
            styled = result
        } else { styled = rendered }
        return Text(styled).lineSpacing(presentation.isAtlas ? 7 : 4).textSelection(.enabled)
    }
}

private struct MarkdownTable: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let table: MessageTable
    var presentation: MarkdownPresentation = .chat
    @ScaledMetric(relativeTo: .body) private var minimumColumnWidth: CGFloat = 86
    @ScaledMetric(relativeTo: .body) private var maximumColumnWidth: CGFloat = 260
    var body: some View {
        ViewThatFits(in: .horizontal) {
            grid
            ScrollView(.horizontal) {
                grid.fixedSize(horizontal: true, vertical: true)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: presentation.isAtlas ? 8 : 12))
        .clipShape(.rect(cornerRadius: presentation.isAtlas ? 8 : 12))
        .overlay { RoundedRectangle(cornerRadius: presentation.isAtlas ? 8 : 12).strokeBorder(.primary.opacity(0.08)) }
        .font(presentation.bodyFont)
        .accessibilityElement(children: .contain).accessibilityIdentifier("markdownTable")
    }
    private var grid: some View {
        MarkdownTableGrid(columns: table.header.count, minimumWidth: minimumColumnWidth, maximumWidth: maximumColumnWidth) {
            ForEach(0...table.rows.count, id: \.self) { row in
                ForEach(table.header.indices, id: \.self) { column in
                    cell(row == 0 ? table.header[column] : table.rows[row - 1][column], row: row, column: column)
                }
            }
        }
    }
    private func cell(_ source: String, row: Int, column: Int) -> some View {
        let header = row == 0
        let alignment: Alignment = table.alignments[column] == .center ? .top : table.alignments[column] == .trailing ? .topTrailing : .topLeading
        let value = (try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(source)
        return Text(value).fontWeight(header ? .semibold : .regular).lineSpacing(4).textSelection(.enabled)
            .multilineTextAlignment(table.alignments[column] == .center ? .center : table.alignments[column] == .trailing ? .trailing : .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, presentation.isAtlas ? 16 : 12).padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 44, maxHeight: .infinity, alignment: alignment)
            .background(alignment: .center) {
                if header { Rectangle().fill(Color.primary.opacity(presentation.isAtlas ? 0.08 : 0.04)) }
            }
            .overlay(alignment: .trailing) {
                if presentation.isAtlas && column < table.header.count - 1 { Rectangle().fill(.primary.opacity(0.12)).frame(width: 0.5) }
            }
            .overlay(alignment: .bottom) {
                if row < table.rows.count { Rectangle().fill(.primary.opacity(0.12)).frame(height: 0.5) }
            }
            .accessibilityAddTraits(header ? .isHeader : [])
    }
}

/// Measure the actual styled SwiftUI cells, including header weight, inline
/// formatting and Dynamic Type, before assigning shared column/row bounds.
private struct MarkdownTableGrid: Layout {
    let columns: Int
    let minimumWidth: CGFloat
    let maximumWidth: CGFloat
    private func widths(_ subviews: Subviews, proposedWidth: CGFloat?) -> [CGFloat] {
        guard columns > 0 else { return [] }
        var natural = Array(repeating: 0.0, count: columns)
        for index in subviews.indices.prefix(columns * 41) {
            natural[index % columns] = max(natural[index % columns], Double(subviews[index].sizeThatFits(.unspecified).width))
        }
        return MessageTableSizing.columnWidths(natural, proposedWidth: proposedWidth.map { Double($0) },
            minimum: Double(minimumWidth), maximum: Double(maximumWidth)).map { CGFloat($0) }
    }
    private func heights(_ subviews: Subviews, widths: [CGFloat]) -> [CGFloat] {
        guard !widths.isEmpty else { return [] }
        let fitted = subviews.indices.map { index in
            Double(subviews[index].sizeThatFits(ProposedViewSize(width: widths[index % columns], height: nil)).height)
        }
        return MessageTableSizing.rowHeights(fitted, columns: columns).map { CGFloat($0) }
    }
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let widths = widths(subviews, proposedWidth: proposal.width)
        return CGSize(width: widths.reduce(0, +), height: heights(subviews, widths: widths).reduce(0, +))
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let widths = widths(subviews, proposedWidth: bounds.width)
        let heights = heights(subviews, widths: widths)
        guard !widths.isEmpty else { return }
        var y = bounds.minY
        for row in heights.indices {
            var x = bounds.minX
            for column in widths.indices {
                let index = row * columns + column
                guard index < subviews.count else { break }
                subviews[index].place(at: CGPoint(x: x, y: y), anchor: .topLeading,
                    proposal: ProposedViewSize(width: widths[column], height: heights[row]))
                x += widths[column]
            }
            y += heights[row]
        }
    }
}

private struct CodeBlock: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let language: String
    let code: String
    var presentation: MarkdownPresentation = .chat
    private var title: String {
        guard !language.isEmpty else { return "Code" }
        return language.replacingOccurrences(of: "\\", with: "/").split(separator: "/").last.map(String.init) ?? language
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(title).font(.caption.monospaced()).foregroundStyle(.secondary)
                    .lineLimit(1).truncationMode(.middle)
                    .accessibilityLabel(language.isEmpty ? "Code" : language)
                Spacer()
                Button("Copy code", systemImage: "doc.on.doc") { UIPasteboard.general.string = code }
                    .labelStyle(.iconOnly).font(.caption).frame(width: 44, height: 44)
            }.padding(.leading, 14).padding(.trailing, 6)
            ScrollView(.horizontal) {
                Text(code).font(.system(presentation.isAtlas ? .footnote : .callout, design: .monospaced)).lineSpacing(4).textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: false).padding(.horizontal, 14).padding(.bottom, 14)
            }
        }
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: presentation.isAtlas ? 12 : 14))
        .overlay { RoundedRectangle(cornerRadius: presentation.isAtlas ? 12 : 14).strokeBorder(.primary.opacity(0.05)) }
    }
}

struct ChatActivity: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
