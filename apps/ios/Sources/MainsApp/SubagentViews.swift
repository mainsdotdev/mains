import SwiftUI

struct SubagentSelection: Identifiable {
    let runID: String
    let agentID: Int
    let owner: Int
    var id: String { "\(owner):\(runID):\(agentID)" }
}

/// The card is an overlay: opening it never changes the transcript's insets.
struct SubagentDock: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let agents: [SessionSubagent]
    let partial: Bool
    @Binding var expanded: Bool
    let select: (SessionSubagent) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric private var rowHeight: CGFloat = 60
    private var animation: Animation { reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.3, bounce: 0.08) }

    var body: some View {
        Button { withAnimation(animation) { expanded.toggle() } } label: {
            HStack(spacing: 8) {
                SubagentGlyph()
                Text("\(agents.count) \(agents.count == 1 ? "agent" : "agents")")
            }.font(.subheadline.weight(.medium)).foregroundStyle(.primary).padding(.horizontal, 16).frame(height: 44)
                .modifier(GlassSurface(radius: 22))
        }
        .buttonStyle(ChatPressStyle()).accessibilityIdentifier("subagentDock")
        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
        .frame(maxWidth: .infinity).padding(.vertical, 2)
        .overlay(alignment: .bottom) {
            if expanded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if partial { Text("Agents in loaded messages").font(.caption).foregroundStyle(.secondary) }
                        group("Active", states: [.running, .idle])
                        group("Completed", states: [.done])
                        group("Needs attention", states: [.failed, .stopped])
                    }.padding(14)
                }
                .scrollBounceBehavior(.basedOnSize).frame(height: cardHeight)
                .modifier(GlassSurface(radius: 22))
                .overlay { RoundedRectangle(cornerRadius: 22).strokeBorder(.primary.opacity(0.08)) }
                .padding(.horizontal, 24).padding(.bottom, 56)
                .transition(reduceMotion ? .opacity : .scale(scale: 0.94, anchor: .bottom).combined(with: .opacity))
                .accessibilityIdentifier("subagentList")
            }
        }
        .animation(animation, value: expanded)
    }

    private var cardHeight: CGFloat {
        let headings = Set(agents.map { $0.state == .running || $0.state == .idle ? 0 : $0.state == .done ? 1 : 2 }).count
        return min(300, CGFloat(agents.count) * rowHeight + CGFloat(headings) * 30 + (partial ? 26 : 0) + 28)
    }

    @ViewBuilder private func group(_ title: String, states: [SubagentState]) -> some View {
        let items = agents.filter { states.contains($0.state) }
        if !items.isEmpty {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).accessibilityAddTraits(.isHeader)
            ForEach(items) { agent in
                Button { select(agent) } label: {
                    HStack(spacing: 12) {
                        Circle().fill(color(agent)).frame(width: 10, height: 10).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(agent.title).font(.subheadline.weight(.medium)).lineLimit(2)
                            Text(agent.state.label).font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                        if agent.state == .running { ProgressView().controlSize(.mini).accessibilityHidden(true) }
                        Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
                    }.foregroundStyle(.primary).padding(.vertical, 7).padding(.leading, CGFloat(min(3, agent.depth)) * 10).contentShape(Rectangle())
                }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("subagent-\(agent.id)")
            }
        }
    }
    private func color(_ agent: SessionSubagent) -> Color {
        let colors: [Color] = [.orange, .pink, .cyan, .purple, .green, .indigo]
        let hash = (agent.agentID ?? agent.title).utf8.reduce(0) { ($0 * 31 + Int($1)) % colors.count }
        return colors[hash]
    }
}

struct SubagentSummaryRow: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let text: String
    let open: () -> Void
    var body: some View {
        Button(action: open) {
            HStack(spacing: 9) {
                SubagentGlyph()
                Text(text).lineLimit(1)
                Image(systemName: "chevron.right").font(.caption2)
            }.font(.subheadline).foregroundStyle(.secondary).frame(minHeight: 30).contentShape(Rectangle())
        }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("subagentSummary")
    }
}

struct SubagentDetailSheet: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let selection: SubagentSelection
    @Environment(\.dismiss) private var dismiss
    @State private var fullMessage: AgentContentReference?
    private var valid: Bool { session.ownership == selection.owner && session.viewingRunID == selection.runID }
    private var agent: SessionSubagent? { valid ? session.transcript.subagents.first { $0.id == selection.agentID } : nil }
    private var subtitle: String {
        guard valid else { return "" }
        let run = session.conversations.first { $0.id == selection.runID }
        let workspace = run?.workspaceId.flatMap { id in session.workspaces.first { $0.id == id }?.name }
        return [session.pairing?.descriptor.name, workspace].compactMap { $0 }.joined(separator: " · ")
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                if let agent, let flow = session.transcript.subagentFlow(for: agent) {
                    VStack(alignment: .leading, spacing: 20) {
                        if !agent.detail.isEmpty { Text(agent.detail).font(.footnote).foregroundStyle(.secondary) }
                        if let prompt = flow.prompt, !prompt.isEmpty {
                            DisclosureGroup("Task") { ChatMessageBody(text: prompt).padding(.top, 8) }.font(.subheadline)
                        }
                        ForEach(TranscriptGroup.build(flow.rows)) { group in
                            if group.rows.first?.kind == .tool { ChatToolBlock(session: session, rows: group.rows, live: agent.state == .running) }
                            else if let row = group.rows.first {
                                ChatMessage(session: session, row: row, providerID: "", readContent: { fullMessage = AgentContentReference(id: $0) })
                            }
                        }
                        if let report = flow.report, !report.isEmpty {
                            Text("Result").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            ChatMessageBody(text: report)
                        }
                        if let error = flow.error, !error.isEmpty { Text(error).font(.footnote).foregroundStyle(.red).textSelection(.enabled) }
                        if flow.rows.isEmpty && flow.report == nil && flow.error == nil {
                            Text(agent.state == .running ? "Waiting for agent activity…" : "No activity in the loaded messages.").font(.footnote).foregroundStyle(.secondary)
                        }
                        if session.transcript.page?.hasOlder == true || session.transcript.page?.hasNewer == true {
                            Text("Showing activity from loaded messages.").font(.caption).foregroundStyle(.secondary)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
                        .animation(nil, value: flow.rows)
                } else {
                    ContentUnavailableView("Activity unavailable", systemImage: "person.crop.rectangle.stack",
                        description: Text("Return to the conversation to load this agent’s messages."))
                }
            }
            // Details open at the start of the flow and never pull the reader
            // away from a tool or report while further child activity arrives.
            .defaultScrollAnchor(.top).background(Color(.systemBackground))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly).accessibilityIdentifier("closeSubagent")
                }
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 2) {
                        Text(agent?.title ?? "Subagent").font(.headline).lineLimit(1)
                        Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    }.multilineTextAlignment(.center).accessibilityElement(children: .combine)
                }
            }
            .sheet(item: $fullMessage) { reference in
                NavigationStack { FullMessageView(session: session, artifactID: reference.id) }
            }
        }
        .presentationDetents([.fraction(0.55), .large]).presentationDragIndicator(.visible)
        .onChange(of: valid, initial: true) { _, valid in if !valid { fullMessage = nil; dismiss() } }
        .accessibilityIdentifier("subagentDetail")
    }
}

private struct AgentContentReference: Identifiable { let id: Int }

private struct SubagentGlyph: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4).stroke(lineWidth: 1.6).frame(width: 18, height: 13).offset(y: 3)
            Path { path in
                path.move(to: CGPoint(x: 11, y: 8)); path.addLine(to: CGPoint(x: 11, y: 4))
                path.move(to: CGPoint(x: 2, y: 12)); path.addLine(to: CGPoint(x: 2, y: 17))
                path.move(to: CGPoint(x: 20, y: 12)); path.addLine(to: CGPoint(x: 20, y: 17))
            }.stroke(style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
            Circle().stroke(lineWidth: 1.4).frame(width: 3, height: 3).offset(y: -8)
            HStack(spacing: 4) { Capsule().frame(width: 2, height: 4); Capsule().frame(width: 2, height: 4) }.offset(y: 3)
        }.frame(width: 22, height: 22).accessibilityHidden(true)
    }
}
