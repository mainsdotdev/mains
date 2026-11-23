import SwiftUI

struct ChatToolBlock: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let rows: [TranscriptRow]
    var live = false
    var isMate = false
    @State private var disclosure = TranscriptDisclosure()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var calls: [ToolCall] { rows.compactMap(\.tool) }
    private var running: Bool { rows.contains { $0.tool != nil && $0.live } }
    private var active: Bool { running || live }
    private var expanded: Bool { disclosure.isExpanded(active: active) }
    var body: some View {
        if isMate {
            let providerID = session.conversations.first { $0.id == session.viewingRunID }?.providerId ?? ""
            VStack(alignment: .leading, spacing: 16) {
                ForEach(rows) { row in
                    if let call = row.tool {
                        if call.isMateQuestion {
                            let entries = MateQuestion.read(call)
                            if !entries.isEmpty {
                                MateQuestionBubble(entries: entries, providerID: providerID)
                                    .accessibilityIdentifier("mateQuestion-\(call.id)")
                            }
                        } else {
                            ChatToolRow(session: session, call: call, displayStatus: row.toolDisplayStatus)
                        }
                    }
                }
            }
        } else if !calls.isEmpty {
            let group = ToolGroupPresentation(calls)
            VStack(alignment: .leading, spacing: 6) {
                if calls.count > 1 {
                    Button {
                        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) { disclosure.toggle(active: active) }
                    } label: {
                        HStack(spacing: 4) {
                            if !expanded {
                                HStack(spacing: 4) {
                                    ForEach(group.icons) { RegistryIcon(token: $0.asset, size: 16) }
                                }
                            }
                            Text(group.summary).lineLimit(1)
                            toolChevron(expanded)
                        }
                        .font(.footnote).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading).contentShape(.rect)
                    }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("toolBlock-\(calls[0].id)")
                        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                }
                if calls.count == 1 || expanded {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(rows) { row in
                            if let call = row.tool { ChatToolRow(session: session, call: call, displayStatus: row.toolDisplayStatus) }
                        }
                    }
                }
            }
            .onChange(of: active, initial: true) { _, active in disclosure.observe(active: active) }
        }
    }
}

@MainActor func toolChevron(_ expanded: Bool) -> some View {
    RegistryIcon(token: "tool-arrow-up", size: 16)
        .rotationEffect(.degrees(expanded ? 180 : 90))
}

private struct ToolContentSelection: Identifiable {
    let id: String
    let source: String
}

private struct ChatToolRow: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let call: ToolCall
    var displayStatus: String? = nil
    @State private var expanded = false
    @State private var fullContent: ToolContentSelection?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        let view = ToolPresentation(call, status: displayStatus)
        let statFirst = view.kind == .glob || view.kind == .view
        let tint: Color = view.running ? .primary : .secondary
        VStack(alignment: .leading, spacing: 7) {
            Button {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    RegistryIcon(token: view.icon, size: 16, tint: tint).frame(width: 16)
                    Text(view.verb).fontWeight(.medium).foregroundStyle(tint).lineLimit(1).layoutPriority(1)
                    if statFirst { stat(view.stat) }
                    if !view.detail.isEmpty {
                        HStack(spacing: 4) {
                            if view.showsFile { fileIcon(view.detail) }
                            Text(view.detail)
                                .font(view.kind == .glob ? .system(.caption, design: .monospaced) : .footnote)
                                .lineLimit(1)
                        }.foregroundStyle(.secondary)
                    }
                    if !statFirst { stat(view.stat) }
                    if view.hasDetails { toolChevron(expanded) }
                    if view.diff && (view.added > 0 || view.removed > 0) {
                        HStack(spacing: 5) {
                            if view.added > 0 { Text("+\(view.added)").foregroundStyle(.green) }
                            if view.removed > 0 { Text("-\(view.removed)").foregroundStyle(.red) }
                        }.font(.caption).monospacedDigit().fixedSize()
                    }
                }
                .font(.footnote).frame(maxWidth: .infinity, minHeight: 30, alignment: .leading).contentShape(.rect)
            }.buttonStyle(ChatPressStyle()).disabled(!view.hasDetails)
                .accessibilityIdentifier("toolCall-\(call.id)").accessibilityValue(view.hasDetails ? (expanded ? "Expanded" : "Collapsed") : "")
                .background(GeometryReader { geometry in
                    Color.clear.preference(key: ActiveToolFramesKey.self, value: view.running ? [call.id: geometry.frame(in: .global)] : [:])
                })
            if expanded {
                VStack(alignment: .leading, spacing: 10) {
                    if !view.body.isEmpty || (view.showsInput && !view.input.isEmpty) {
                        ToolBody(text: view.body, diff: view.diff, command: view.kind == .command,
                                 input: view.showsInput ? view.input : nil, error: view.failed && view.showsInput)
                    }
                    if view.deferredOutput {
                        Button("Read full output", systemImage: "text.alignleft") { fullContent = .init(id: "output", source: "tool-output") }
                            .accessibilityIdentifier("toolFullOutput-\(call.id)")
                    }
                    if view.showsInput && view.deferredInput {
                        Button("Read full input", systemImage: "text.alignleft") { fullContent = .init(id: "input", source: "tool-input") }
                    }
                }.font(.footnote)
            }
        }
        .sheet(item: $fullContent) { selection in
            NavigationStack { FullMessageView(session: session, artifactID: call.id, source: selection.source) }
        }
    }

    @ViewBuilder private func stat(_ text: String) -> some View {
        if !text.isEmpty {
            Text(text).foregroundStyle(.secondary).lineLimit(1).fixedSize(horizontal: true, vertical: false)
        }
    }

    @ViewBuilder private func fileIcon(_ detail: String) -> some View {
        let file = TranscriptMedia.fileName(detail)
        let name = switch (file as NSString).pathExtension.lowercased() {
        case "swift": "swift"
        case "ts", "mts", "cts": "typescript"
        case "js", "mjs", "cjs": "javascript"
        case "tsx", "jsx": "react"
        case "json", "json5", "jsonc": "json"
        case "py", "pyi", "pyw": "python"
        default: ""
        }
        if name.isEmpty { RegistryIcon(token: "tool-file", size: 14) }
        else {
            Image(decorative: "registry-tool-file-" + name)
                .resizable().scaledToFit().frame(width: 14, height: 14)
                .accessibilityHidden(true)
        }
    }
}

private struct ToolBody: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let text: String
    let diff: Bool
    let command: Bool
    let input: String?
    var error = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let input, !input.isEmpty {
                Text("Input").font(.caption2.weight(.medium).width(.expanded)).foregroundStyle(.secondary)
                preview(input)
            }
            if !text.isEmpty {
                if input != nil { Text(error ? "Error" : "Output").font(.caption2.weight(.medium).width(.expanded)).foregroundStyle(.secondary) }
                preview(text, diff: diff, command: command, error: error)
            }
        }
        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
        .background(.primary.opacity(0.05), in: .rect(cornerRadius: 6))
        .overlay {
            if diff { RoundedRectangle(cornerRadius: 6).strokeBorder(.primary.opacity(0.1)) }
        }
    }

    private func preview(_ text: String, diff: Bool = false, command: Bool = false, error: Bool = false) -> some View {
        let lines = text.components(separatedBy: "\n")
        let visible = lines.prefix(40).map { String($0.prefix(2000)) }
        return VStack(alignment: .leading, spacing: 6) {
            if diff {
                ScrollView(.horizontal) {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(visible.enumerated()), id: \.offset) { _, line in
                            Text(verbatim: line.isEmpty ? " " : line)
                                .foregroundStyle(line.hasPrefix("+") ? Color.green : line.hasPrefix("-") ? .red : .primary)
                        }
                    }.fixedSize(horizontal: true, vertical: false)
                }
            } else {
                Text(verbatim: visible.joined(separator: "\n")).lineLimit(40)
                    .foregroundStyle(error ? Color.red : .primary).fixedSize(horizontal: false, vertical: true)
            }
            if lines.count > 40 { Text("+\(lines.count - 40) more lines").font(.caption2).foregroundStyle(.secondary) }
        }.font(command ? .footnote : .system(.caption, design: .monospaced)).textSelection(.enabled)
    }
}
