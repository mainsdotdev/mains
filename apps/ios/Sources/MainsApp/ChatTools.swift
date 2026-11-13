import SwiftUI

struct ChatToolBlock: View {
    let session: BackendSession
    let rows: [TranscriptRow]
    var live = false
    @State private var disclosure = TranscriptDisclosure()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var calls: [ToolCall] { rows.compactMap(\.tool) }
    private var running: Bool { rows.contains { $0.tool != nil && $0.live } }
    private var active: Bool { running || live }
    private var expanded: Bool { disclosure.isExpanded(active: active) }
    var body: some View {
        if !calls.isEmpty {
            let group = ToolGroupPresentation(calls)
            VStack(alignment: .leading, spacing: 6) {
                if calls.count > 1 {
                    Button {
                        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) { disclosure.toggle(active: active) }
                    } label: {
                        HStack(spacing: 9) {
                            if !expanded {
                                HStack(spacing: 4) {
                                    ForEach(group.symbols, id: \.self) { Image(systemName: $0).frame(width: 17) }
                                }
                            }
                            Text(group.summary).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.caption2)
                        }.font(.footnote).foregroundStyle(.secondary).frame(minHeight: 32).contentShape(.rect)
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

private struct ToolContentSelection: Identifiable {
    let id: String
    let source: String
}

private struct ChatToolRow: View {
    let session: BackendSession
    let call: ToolCall
    var displayStatus: String? = nil
    @State private var expanded = false
    @State private var fullContent: ToolContentSelection?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var view: ToolPresentation { ToolPresentation(call, status: displayStatus) }
    private var hasDetails: Bool { view.hasDetails }
    private var tint: Color { view.running ? .primary : .secondary }
    private var providerID: String { session.conversations.first { $0.id == session.viewingRunID }?.providerId ?? "" }
    private var animate: Bool { session.isConnected && session.conversations.first { $0.id == session.viewingRunID }?.isActive == true }
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Button {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) { expanded.toggle() }
            } label: {
                HStack(spacing: 9) {
                    Group {
                        if view.running { AgentAsciiSpinner(providerID: providerID, animated: animate) }
                        else { Image(systemName: view.symbol) }
                    }.frame(width: 17).foregroundStyle(tint)
                    Text(view.verb).fontWeight(.semibold).foregroundStyle(tint).lineLimit(1).layoutPriority(1).activityShimmer(view.running && animate)
                    Text(view.detail).foregroundStyle(.tertiary).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading).activityShimmer(view.running && animate)
                    if view.added > 0 || view.removed > 0 {
                        HStack(spacing: 5) {
                            if view.added > 0 { Text("+\(view.added)").foregroundStyle(.green) }
                            if view.removed > 0 { Text("−\(view.removed)").foregroundStyle(.red) }
                        }.font(.caption).fixedSize()
                    } else if !view.stat.isEmpty { Text(view.stat).font(.caption).foregroundStyle(.tertiary).lineLimit(1).fixedSize() }
                    if hasDetails { Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.caption2).foregroundStyle(.tertiary) }
                }.font(.footnote).frame(minHeight: 30).contentShape(.rect)
            }.buttonStyle(ChatPressStyle()).disabled(!hasDetails)
                .accessibilityIdentifier("toolCall-\(call.id)").accessibilityValue(expanded ? "Expanded" : "Collapsed")
                .background(GeometryReader { geometry in
                    Color.clear.preference(key: ActiveToolFramesKey.self, value: view.running ? [call.id: geometry.frame(in: .global)] : [:])
                })
            if expanded {
                VStack(alignment: .leading, spacing: 10) {
                    if !view.body.isEmpty {
                        // Match desktop: no extra lifecycle-error banner. Its
                        // generic fallback colours only the expanded error output.
                        ToolBody(text: view.body, diff: view.diff, error: view.failed && view.showsInput)
                    }
                    if view.deferredOutput {
                        Button("Read full output", systemImage: "text.alignleft") { fullContent = .init(id: "output", source: "tool-output") }
                            .accessibilityIdentifier("toolFullOutput-\(call.id)")
                    }
                    if view.showsInput {
                        if view.body.isEmpty && !view.input.isEmpty { ToolBody(text: view.input, diff: false) }
                        if view.deferredInput {
                            Button("Read full input", systemImage: "text.alignleft") { fullContent = .init(id: "input", source: "tool-input") }
                        } else if !view.input.isEmpty && !view.body.isEmpty {
                            DisclosureGroup("Input") { ToolBody(text: view.input, diff: false).padding(.top, 6) }.tint(.secondary)
                        }
                    }
                }.font(.footnote)
            }
        }
        .sheet(item: $fullContent) { selection in
            NavigationStack { FullMessageView(session: session, artifactID: call.id, source: selection.source) }
        }
    }
}

private struct ToolBody: View {
    let text: String
    let diff: Bool
    var error = false
    private var lines: [String] { text.components(separatedBy: "\n") }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ScrollView(.horizontal) {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(Array(lines.prefix(40).enumerated()), id: \.offset) { _, line in
                        Text(line.isEmpty ? " " : String(line.prefix(2000)))
                            .foregroundStyle(diff && line.hasPrefix("+") ? Color.green : diff && line.hasPrefix("-") || error ? .red : .primary)
                    }
                }.font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: false).padding(12)
            }
            if lines.count > 40 { Text("+\(lines.count - 40) more lines").font(.caption2).foregroundStyle(.secondary).padding(.horizontal, 12).padding(.bottom, 10) }
        }.background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12))
    }
}
