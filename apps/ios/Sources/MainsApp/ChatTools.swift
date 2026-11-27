import SwiftUI

private struct ToolPluginIconRequest: Equatable {
    let runID: String
    let owner: Int
    let revision: Int?
    let vendors: [String]
}

extension View {
    func loadToolPluginIcons(session: BackendSession, runID: String, providerID: String, calls: [ToolCall],
                             enabled: Bool) -> some View {
        let request = enabled && providerID == "codex" && session.isConnected && session.supportsPluginIcons
            ? ToolPluginIconRequest(runID: runID, owner: session.ownership, revision: session.contextRevisions["codex"],
                                    vendors: ToolPresentation.pluginVendorIDs(in: calls).prefix(64).sorted())
            : nil
        return task(id: request) {
            guard let request, !request.vendors.isEmpty, request.owner == session.ownership else { return }
            await session.loadToolPluginIcons(request.vendors, runID: request.runID)
        }
    }
}

struct ChatPlanCard: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let runID: String
    let plan: PlanProposal
    let providerID: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded: Bool?
    @State private var fullPlan = false
    @State private var consent: ConsentContext?
    @State private var consentOwner: Int?
    @State private var error: String?
    private var status: PlanProposal.Status { session.planStatus(plan, runID: runID) }
    private var open: Bool { expanded ?? (status == .pending) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) { expanded = !open }
            } label: {
                HStack(spacing: 8) {
                    RegistryIcon(token: "tool-enter-plan", size: 16)
                    Text("Plan").fontWeight(.medium)
                    if status != .pending {
                        Text(status.rawValue.capitalized).font(.caption)
                            .foregroundStyle(status == .failed ? Color.red : Color.secondary)
                            .accessibilityIdentifier("planStatus-\(plan.id)")
                    }
                    Spacer()
                    toolChevron(open).accessibilityHidden(true)
                }.font(.subheadline).foregroundStyle(.secondary)
                    .padding(.horizontal, 16).frame(minHeight: 44).contentShape(.rect)
            }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("planDisclosure-\(plan.id)")
                .accessibilityValue(open ? "Expanded" : "Collapsed")
            if open {
                if !plan.text.isEmpty {
                    ViewThatFits(in: .vertical) {
                        ChatMessageBody(text: plan.text).fixedSize(horizontal: false, vertical: true)
                        ScrollView { ChatMessageBody(text: plan.text) }
                    }.frame(maxWidth: .infinity, maxHeight: 360, alignment: .leading)
                        .padding(.horizontal, 16).padding(.bottom, 14)
                }
                if plan.fullContentSource != nil {
                    Button("Read full plan", systemImage: "text.alignleft") { fullPlan = true }
                        .font(.footnote.weight(.medium)).padding(.horizontal, 16).padding(.bottom, 12)
                        .disabled(!session.isConnected).accessibilityIdentifier("readFullPlan-\(plan.id)")
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red).padding(.horizontal, 16).padding(.bottom, 10)
                }
                if session.offersPlanDecision(plan, runID: runID) {
                    Divider()
                    HStack(spacing: 8) {
                        Spacer(minLength: 0)
                        Button("Apply Plan") { beginApply() }.buttonStyle(.borderedProminent)
                            .tint(Provider.accent(providerID)).accessibilityIdentifier("applyPlan-\(plan.id)")
                        Button("Dismiss") { decide(.dismiss) }.buttonStyle(.bordered)
                            .accessibilityIdentifier("dismissPlan-\(plan.id)")
                    }.controlSize(.regular).padding(.horizontal, 12).padding(.vertical, 8)
                        .disabled(!session.canDecidePlan(plan, runID: runID))
                }
            }
        }
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
        .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(.primary.opacity(0.09)) }
        .accessibilityElement(children: .contain).accessibilityIdentifier("planCard-\(plan.id)")
        .onChange(of: status) { _, status in if status != .pending { expanded = false; error = nil } }
        .sheet(isPresented: $fullPlan) {
            if let source = plan.fullContentSource {
                NavigationStack { FullMessageView(session: session, artifactID: plan.id, source: source, expectedRunID: runID) }
            }
        }
        .sheet(item: $consent) { context in
            ConsentView(context: context) {
                guard consentOwner == session.ownership, session.viewingRunID == runID,
                      session.pairing?.descriptor.backendId == context.backendID else { return }
                session.grantConsent(providerID: context.providerID, backendID: context.backendID)
                decide(.apply)
            }
        }
    }

    private func beginApply() {
        if session.hasConsent(providerID: providerID) { decide(.apply) }
        else if let backendID = session.pairing?.descriptor.backendId {
            consentOwner = session.ownership
            consent = ConsentContext(backendID: backendID, providerID: providerID, isDemo: session.isDemo)
        }
    }

    private func decide(_ decision: PlanProposal.Decision) {
        let owner = session.ownership
        error = nil
        Task {
            guard session.ownership == owner, session.viewingRunID == runID else { return }
            do { try await session.decidePlan(plan, runID: runID, decision: decision) }
            catch {
                if session.ownership == owner, session.viewingRunID == runID, session.pendingPlanDecision?.uncertain != true {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

struct ChatToolBlock: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let rows: [TranscriptRow]
    var browserActivityTitle: String? = nil
    var isMate = false
    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var calls: [ToolCall] { rows.compactMap(\.tool) }
    var body: some View {
        let providerID = session.conversations.first { $0.id == session.viewingRunID }?.providerId ?? ""
        if isMate {
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
                            ChatToolRow(session: session, providerID: providerID, call: call, displayStatus: row.toolDisplayStatus)
                        }
                    }
                }
            }
        } else if !calls.isEmpty {
            let group = ToolGroupPresentation(calls)
            VStack(alignment: .leading, spacing: 6) {
                if calls.count > 1 {
                    Button {
                        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) { expanded.toggle() }
                    } label: {
                        HStack(spacing: 4) {
                            if !expanded {
                                if browserActivityTitle != nil { ChatToolIcon(asset: "tool-cursor", plugin: nil) }
                                else {
                                    HStack(spacing: 4) {
                                        ForEach(group.icons) { icon in
                                            ChatToolIcon(asset: icon.asset, plugin: providerID == "codex" ? session.toolPluginIcon(icon.vendorID) : nil)
                                        }
                                    }
                                }
                            }
                            Text(browserActivityTitle ?? group.summary).lineLimit(1)
                            toolChevron(expanded)
                        }
                        .font(.footnote).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: TranscriptRowMetrics.summaryHeight, alignment: .leading).contentShape(.rect)
                    }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("toolBlock-\(calls[0].id)")
                        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                }
                if calls.count == 1 || expanded {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(rows) { row in
                            if let call = row.tool {
                                ChatToolRow(session: session, providerID: providerID, call: call, displayStatus: row.toolDisplayStatus,
                                            browserActivityTitle: calls.count == 1 ? browserActivityTitle : nil)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct ChatToolIcon: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let asset: String
    let plugin: ToolPluginIcon?
    var tint: Color = .secondary

    var body: some View {
        Group {
            if let data = plugin?.image, data.count <= 32 * 1024, let image = UIImage(data: data) {
                Image(uiImage: image).renderingMode(.original).resizable().scaledToFit()
                    .clipShape(.rect(cornerRadius: 3))
            } else if let plugin, let hex = plugin.brandColor?.trimmingCharacters(in: CharacterSet(charactersIn: "#")),
                      hex.count == 6, let value = UInt32(hex, radix: 16) {
                Text(plugin.label.prefix(1).uppercased()).font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(red: Double((value >> 16) & 255) / 255,
                                      green: Double((value >> 8) & 255) / 255,
                                      blue: Double(value & 255) / 255), in: .rect(cornerRadius: 3))
            } else {
                RegistryIcon(token: asset, size: 16, tint: tint)
            }
        }.frame(width: 16, height: 16).accessibilityHidden(true)
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
    let providerID: String
    let call: ToolCall
    var displayStatus: String? = nil
    var browserActivityTitle: String? = nil
    @State private var expanded = false
    @State private var fullContent: ToolContentSelection?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        let view = ToolPresentation(call, status: displayStatus)
        let detail = browserActivityTitle ?? view.detail
        let showsOriginalDetail = browserActivityTitle != nil && !view.detail.isEmpty
        let hasDetails = view.hasDetails || showsOriginalDetail
        let statFirst = view.kind == .glob || view.kind == .view
        let tint: Color = view.running ? .primary : .secondary
        VStack(alignment: .leading, spacing: 7) {
            Button {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Group {
                        if view.running {
                            let run = session.conversations.first { $0.id == session.viewingRunID }
                            AsciiSpinner(tint: Provider.accent(providerID), animated: session.isConnected && run?.isActive == true)
                        } else {
                            ChatToolIcon(asset: view.icon, plugin: providerID == "codex" ? session.toolPluginIcon(view.vendorID) : nil, tint: tint)
                        }
                    }.frame(width: 16)
                    Text(view.verb).fontWeight(.medium).foregroundStyle(tint).lineLimit(1).layoutPriority(1)
                    if statFirst { stat(view.stat) }
                    if !detail.isEmpty {
                        HStack(spacing: 4) {
                            if view.showsFile { fileIcon(view.detail) }
                            Text(detail)
                                .font(view.kind == .glob ? .system(.caption, design: .monospaced) : .footnote)
                                .lineLimit(1)
                        }.foregroundStyle(.secondary)
                    }
                    if !statFirst { stat(view.stat) }
                    if hasDetails { toolChevron(expanded) }
                    if view.diff && (view.added > 0 || view.removed > 0) {
                        HStack(spacing: 5) {
                            if view.added > 0 { Text("+\(view.added)").foregroundStyle(.green) }
                            if view.removed > 0 { Text("-\(view.removed)").foregroundStyle(.red) }
                        }.font(.caption).monospacedDigit().fixedSize()
                    }
                }
                .font(.footnote).frame(maxWidth: .infinity, minHeight: 30, alignment: .leading).contentShape(.rect)
            }.buttonStyle(ChatPressStyle()).disabled(!hasDetails)
                .accessibilityIdentifier("toolCall-\(call.id)").accessibilityValue(hasDetails ? (expanded ? "Expanded" : "Collapsed") : "")
                .background(GeometryReader { geometry in
                    Color.clear.preference(key: ActiveToolFramesKey.self, value: view.running ? [call.id: geometry.frame(in: .global)] : [:])
                })
            if expanded {
                VStack(alignment: .leading, spacing: 10) {
                    if showsOriginalDetail { Text(view.detail).foregroundStyle(.secondary) }
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
        if let asset = WorkspaceFileArtwork.fileTypeAssetName(for: detail) {
            Image(decorative: asset)
                .resizable().scaledToFit().frame(width: 14, height: 14)
                .accessibilityHidden(true)
        } else {
            RegistryIcon(token: "tool-file", size: 14)
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
                Text("Input").font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                preview(input)
            }
            if !text.isEmpty {
                if input != nil { Text(error ? "Error" : "Output").font(.caption2.weight(.medium)).foregroundStyle(.secondary) }
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
