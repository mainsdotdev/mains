import SwiftUI

struct ConversationTranscript: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let runID: String
    let providerID: String
    @Binding var viewport: TranscriptViewport
    let openFile: (RunTurn, TurnFileChange) -> Void
    let openSubagents: () -> Void
    let fork: () -> Void
    var searchCursor: HistoryCursor? = nil
    let readContent: (Int) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.conversationPaneVisible) private var paneVisible
    @State private var scrollPosition = ScrollPosition(idType: String.self)
    @State private var sectionFrames: [String: TranscriptFrame] = [:]
    @State private var navigationID: UUID?
    @State private var loadingDirection: String?
    @State private var landing: TranscriptLanding?
    @State private var toolFrames: [Int: CGRect] = [:]
    @State private var transcriptFrame = CGRect.zero
    @State private var searchLanded = false
    @State private var activitySelection: ConversationActivitySelection?
    private var searchRowID: String? {
        guard let cursor = searchCursor, let artifact = page?.artifacts.first(where: { $0.id == cursor.id }) else { return nil }
        return session.transcript.rowID(for: artifact)
    }
    private var page: HistoryPage? { session.viewingRunID == runID ? session.transcript.page : nil }
    private var rows: [TranscriptRow] { session.viewingRunID == runID ? session.transcript.rows(pending: pending, runID: runID) : [] }
    private var pending: PendingMessage? { session.pendingMessage?.runID == runID ? session.pendingMessage : nil }
    private var run: Conversation? { session.conversations.first { $0.id == runID } }
    private var forkRowID: String? {
        guard run?.isReplica != true else { return nil }
        return TranscriptForkAnchor.rowID(in: rows, atLatest: page?.hasNewer != true,
                                         active: run?.isActive == true,
                                         hasLocalContinuation: pending != nil && pending?.isSteering != true)
    }

    var body: some View {
        GeometryReader { container in
            transcript(minimumHeight: max(0, container.size.height - container.safeAreaInsets.top - container.safeAreaInsets.bottom))
        }
    }

    private func transcript(minimumHeight: CGFloat) -> some View {
        ScrollView {
            // The backend already caps this page at 200 rows / 1 MB. Eager
            // measurement avoids lazy height estimates shifting a live tail.
            VStack(alignment: .leading, spacing: 24) {
                let footers = run?.mode == "chat" ? [:] : TurnChangeFooters.build(sections: sections, turns: page?.turns ?? [], atLatest: page?.hasNewer != true)
                if page?.hasOlder == true {
                    Button { navigate("older") } label: {
                        HStack(spacing: 8) {
                            if loadingDirection == "older" { ProgressView().controlSize(.mini) }
                            Text(loadingDirection == "older" ? "Loading earlier messages…" : "Load earlier messages")
                        }.font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 8)
                    }.buttonStyle(.plain).disabled(session.historyLoading || viewport.paging || !session.isConnected)
                        .accessibilityIdentifier("loadEarlierMessages")
                }
                Color.clear.frame(height: 1).id("transcript-top")
                if session.historyLoading && rows.isEmpty {
                    VStack(spacing: 12) { ProgressView(); Text("Loading conversation…").font(.footnote).foregroundStyle(.secondary) }
                        .frame(maxWidth: .infinity).padding(.vertical, 48)
                } else if rows.isEmpty && pending == nil && session.historyError == nil && run?.isActive != true {
                    ContentUnavailableView(session.isConnected ? "Pick up where you left off" : "Not downloaded yet",
                                           systemImage: session.isConnected ? "bubble.left.and.bubble.right" : "wifi.slash",
                                           description: Text(session.isConnected ? "Send a message to continue with \(Provider.name(providerID))." : "Reconnect to your computer to load this conversation."))
                        .padding(.vertical, 24)
                }
                ForEach(sections) { section in
                    VStack(alignment: .leading, spacing: 12) {
                        ChatTurnView(session: session, section: section, providerID: providerID,
                                     live: run?.isActive == true && section.id == sections.last?.id && !session.transcript.isHistorical,
                                     readContent: readContent, openSubagents: openSubagents,
                                     forkRowID: forkRowID, forkRunID: runID, fork: fork, searchRowID: searchRowID)
                        ForEach(footers[section.id] ?? [], id: \.id) { turn in
                            TurnChangesCard(turn: turn) { openFile(turn, $0) }
                        }
                    }.id(section.id).background(GeometryReader { geometry in
                        Color.clear.preference(key: TranscriptFramesKey.self,
                            value: [section.id: TranscriptFrame(rect: geometry.frame(in: .named("transcript-content")), revision: landing?.id)])
                    })
                }
                if let activity = page?.activity {
                    Button {
                        activitySelection = ConversationActivitySelection(runID: runID, owner: session.ownership, range: activity)
                    } label: {
                        Label("More messages and activity", systemImage: "list.bullet.rectangle")
                            .font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 44)
                    }.buttonStyle(ChatPressStyle()).disabled(!session.isConnected)
                        .accessibilityIdentifier("moreConversationActivity")
                }
                if let error = session.historyError {
                    ChatNotice(title: "Messages couldn't load", message: error, symbol: "wifi.exclamationmark", warning: true) {
                        Button("Retry") { navigate(session.historyRetryDirection) }
                            .disabled(!session.isConnected || session.historyLoading || viewport.paging)
                    }
                }
                if loadingDirection == "newer" { ProgressView().controlSize(.small).frame(maxWidth: .infinity).accessibilityLabel("Loading messages") }
                RunDecisionCards(session: session, runID: runID, providerID: providerID)
                ZStack(alignment: .leading) {
                    Color.clear.frame(height: 24).accessibilityHidden(true)
                    activity
                }
                Color.clear.frame(height: 1).id("transcript-bottom")
            }
            .scrollTargetLayout()
            .padding(.horizontal, 16).padding(.top, 24).padding(.bottom, 12)
            // Short conversations still need a tappable blank area below the
            // messages. Keep the content top-aligned and leave controls above it.
            .frame(minHeight: minimumHeight, alignment: .top)
            .background { KeyboardDismissBackground() }
            .coordinateSpace(name: "transcript-content")
            .animation(nil, value: rows)
        }
        .scrollPosition($scrollPosition)
        .accessibilityIdentifier("conversationTranscript")
        .onPreferenceChange(TranscriptFramesKey.self) { frames in
            let previous = sectionFrames
            sectionFrames = frames
            if !searchLanded, let searchRowID, let section = sections.first(where: { $0.rows.contains { $0.id == searchRowID } }), frames[section.id] != nil {
                searchLanded = true
                scrollPosition.scrollTo(id: section.id, anchor: .top)
            } else if let landing, let frame = frames[landing.anchor.id], frame.revision == landing.id {
                // Both coordinates come from the content, independent of scroll/keyboard insets.
                scrollPosition.scrollTo(y: max(-viewport.geometry.topInset, frame.rect.minY - landing.anchor.top))
                self.landing = nil
                finishNavigation()
            } else if !viewport.chasing && !viewport.interacting && !viewport.paging,
                      let anchor = readingAnchors(in: previous).first,
                      let old = previous[anchor.id], let new = frames[anchor.id] {
                let movement = new.rect.minY - old.rect.minY
                if abs(movement) >= 1 { scrollPosition.scrollTo(y: max(-viewport.geometry.topInset, viewport.geometry.offset + movement)) }
            }
        }
        .onPreferenceChange(ActiveToolFramesKey.self) { toolFrames = $0 }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { transcriptFrame = $0 }
        .scrollDismissesKeyboard(.interactively)
        .defaultScrollAnchor(.top, for: .initialOffset)
        .defaultScrollAnchor(.top, for: .alignment)
        .defaultScrollAnchor(nil, for: .sizeChanges)
        .onScrollPhaseChange { _, phase in
            guard paneVisible else { return }
            if phase == .tracking || phase == .interacting {
                if !viewport.interacting { viewport.beginInteraction() }
            } else if phase == .idle {
                let followed = viewport.following
                let direction = viewport.endInteraction(hasNewer: page?.hasNewer == true, hasOlder: page?.hasOlder == true)
                if viewport.following != followed { session.setHistoryFollowing(viewport.following) }
                if let direction, session.historyError == nil { navigate(direction.rawValue) }
            }
        }
        .onScrollGeometryChange(for: TranscriptGeometry.self) { geometry in
            TranscriptGeometry(offset: geometry.contentOffset.y, content: geometry.contentSize.height,
                               visibleFrame: geometry.containerSize.height, topInset: geometry.contentInsets.top,
                               bottomInset: geometry.contentInsets.bottom)
        } action: { old, next in
            let followed = viewport.following
            let direction = viewport.update(next, hasNewer: page?.hasNewer == true, hasOlder: page?.hasOlder == true)
            if viewport.following != followed { session.setHistoryFollowing(viewport.following) }
            if paneVisible, let direction, session.historyError == nil { navigate(direction.rawValue) }
            if paneVisible && viewport.chasing && page?.hasNewer != true &&
                (old.content != next.content || old.frame != next.frame || old.topInset != next.topInset || old.bottomInset != next.bottomInset) {
                scrollPosition.scrollTo(edge: .bottom)
            }
        }
        .onChange(of: paneVisible) { _, visible in
            if !visible { viewport.interruptInteraction() }
            else if viewport.chasing && page?.hasNewer != true { scrollPosition.scrollTo(edge: .bottom) }
        }
        .overlay(alignment: .bottom) {
            if viewport.showsJump(hasNewer: page?.hasNewer == true) {
                Button {
                    navigate("latest")
                } label: {
                    Image(systemName: "arrow.down").font(.system(size: 22, weight: .regular))
                        .frame(width: 40, height: 40).modifier(GlassSurface(radius: 20))
                }
                .buttonStyle(ChatPressStyle())
                .accessibilityLabel("Jump to latest").accessibilityIdentifier("jumpToLatest")
                .padding(.bottom, 8).disabled(session.historyLoading || page?.hasNewer == true && !session.isConnected)
            }
        }
        .onDisappear {
            navigationID = nil; loadingDirection = nil; landing = nil
            viewport.finishPage(latestConfirmed: false)
        }
        .sheet(item: $activitySelection) { selection in
            ConversationActivitySheet(session: session, selection: selection)
        }
    }

    @ViewBuilder private var activity: some View {
        if session.stoppingRunID == runID {
            ChatActivity(title: "Stopping reply…", symbol: "stop.circle", busy: true)
        } else if session.waitingForDecision {
            EmptyView()
        } else if run?.isActive == true {
            if !session.isConnected {
                ChatActivity(title: "Reply continues on your computer", symbol: "sparkle", busy: false)
            } else if !session.transcript.isHistorical, run?.status == "queued" {
                AgentActivityView(activity: AgentActivity(thinking: "Queued"), providerID: providerID)
            } else if !session.transcript.isHistorical, session.viewingRunID == runID, let activity = session.transcript.activity,
                      !toolIsVisible(activity.toolID) {
                AgentActivityView(activity: activity, providerID: providerID)
            }
        } else if run?.status == "canceled" {
            ChatActivity(title: "Reply stopped", symbol: "stop.circle", busy: false)
        } else if run?.status == "failed", run?.archivedReplyError == nil {
            ChatNotice(title: "Reply interrupted", message: run?.lastError ?? "You can send a follow-up to continue.", symbol: "exclamationmark.circle", warning: true) { EmptyView() }
        }
    }

    private func toolIsVisible(_ id: Int?) -> Bool {
        guard let id, let frame = toolFrames[id], !frame.isEmpty, !transcriptFrame.isEmpty else { return false }
        let visibleFrame = CGRect(x: transcriptFrame.minX, y: transcriptFrame.minY + viewport.geometry.topInset,
                                  width: transcriptFrame.width,
                                  height: max(0, transcriptFrame.height - viewport.geometry.topInset - viewport.geometry.bottomInset))
        return frame.intersection(visibleFrame).height >= frame.height * 0.5
    }

    private func readingAnchors(in frames: [String: TranscriptFrame]) -> [TranscriptAnchor] {
        frames.filter { $0.value.rect.maxY > viewport.geometry.offset + viewport.geometry.topInset &&
            $0.value.rect.minY < viewport.geometry.offset + viewport.geometry.frame - viewport.geometry.bottomInset }
            .sorted { $0.value.rect.minY < $1.value.rect.minY }
            .map { TranscriptAnchor(id: $0.key, top: $0.value.rect.minY - viewport.geometry.offset) }
    }

    private func navigate(_ direction: String) {
        guard !viewport.paging, !session.historyLoading, session.viewingRunID == runID,
              session.isConnected || direction == "latest" && page?.hasNewer != true else { return }
        let id = UUID(), owner = session.ownership, toLatest = direction == "latest" || page == nil
        let anchors = readingAnchors(in: sectionFrames)
        navigationID = id; loadingDirection = direction
        viewport.beginPage(); session.setHistoryFollowing(false)
        Task {
            let loaded = session.isConnected ? await session.loadHistory(direction: direction) : true
            guard navigationID == id, session.ownership == owner, session.viewingRunID == runID else { return }
            guard loaded else { finishNavigation(); return }
            if toLatest {
                guard page?.hasNewer != true else { finishNavigation(); return }
                finishNavigation(latest: true)
                session.setHistoryFollowing(true)
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.25, extraBounce: 0)) { scrollPosition.scrollTo(edge: .bottom) }
            } else if let anchor = anchors.first(where: { candidate in sections.contains { $0.id == candidate.id } }) {
                landing = TranscriptLanding(id: id, anchor: anchor)
            } else {
                // Pages are bounded and can be disjoint: continue at their shared boundary.
                scrollPosition.scrollTo(edge: direction == "older" ? .bottom : .top)
                finishNavigation()
            }
        }
    }

    private func finishNavigation(latest: Bool = false) {
        landing = nil; navigationID = nil; loadingDirection = nil
        viewport.finishPage(latestConfirmed: latest)
    }

    private var sections: [TranscriptSection] { TranscriptSection.build(rows) }
}

private struct ConversationActivitySelection: Identifiable {
    let runID: String
    let owner: Int
    let range: HistoryActivityRange
    var id: String { "\(owner):\(runID):\(range.id)" }
}

/// Detail pages remain separate from the message window and its scroll position.
private struct ConversationActivitySheet: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let selection: ConversationActivitySelection
    @Environment(\.dismiss) private var dismiss
    @State private var page: HistoryPage?
    @State private var loading = false
    @State private var error: String?
    @State private var failedDirection = "refresh"
    @State private var fullMessage: ActivityMessageReference?
    private var valid: Bool { session.ownership == selection.owner && session.viewingRunID == selection.runID }
    private var rows: [TranscriptRow] {
        guard let page, valid else { return [] }
        var transcript = Transcript(); transcript.replace(page)
        var result = transcript.rows.filter { $0.kind != .tool && $0.kind != .subagents }
        result += page.toolCalls.map { call in
            TranscriptRow(id: "tool:\(call.id)", kind: .tool, text: "", date: call.createdAt, live: false,
                deferredArtifactID: nil, tool: call)
        }
        result += page.artifacts.compactMap { artifact in
            let metadata = artifact.metadata ?? .null
            guard !AgentActivity.foreground(metadata), !metadata["voice"].bool,
                  !AgentActivity.thinking(kind: artifact.kind, metadata: metadata),
                  ["report", "result", "command_result"].contains(artifact.kind), let text = artifact.content, !text.isEmpty else { return nil }
            return TranscriptRow(id: "child-artifact:\(artifact.id)", kind: .response, text: text, date: artifact.createdAt,
                live: false, deferredArtifactID: metadata["mobileContentDeferred"].bool || metadata["mobileContentDeferred"]["chars"].number != nil ? artifact.id : nil)
        }
        return result.sorted { $0.date == $1.date ? $0.id < $1.id : $0.date < $1.date }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ForEach(TranscriptGroup.build(rows)) { group in
                        if group.rows.first?.kind == .tool { ChatToolBlock(session: session, rows: group.rows) }
                        else if let row = group.rows.first {
                            if row.id.hasPrefix("child-artifact:") { Text("Agent message").font(.caption).foregroundStyle(.secondary) }
                            ChatMessage(session: session, row: row, providerID: "", readContent: { if valid { fullMessage = ActivityMessageReference(id: $0) } })
                        }
                    }
                    if !loading && rows.isEmpty && error == nil { Text("No messages or tool activity in this part.").font(.footnote).foregroundStyle(.secondary) }
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            }
            .id(page?.start).defaultScrollAnchor(.top)
            .overlay { if loading { ProgressView() } }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    if let error {
                        Text(error).font(.caption).foregroundStyle(.secondary)
                        Button("Retry") { Task { await load(failedDirection) } }.disabled(loading)
                    }
                    HStack {
                        Button("Earlier") { Task { await load("older") } }.disabled(loading || page?.hasOlder != true)
                        Spacer()
                        Button("Later") { Task { await load("newer") } }.disabled(loading || page?.hasNewer != true)
                    }
                }.font(.subheadline).padding().background(.bar)
            }
            .navigationTitle("Messages and activity").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load("refresh") }
            .sheet(item: $fullMessage) { item in if valid { NavigationStack { FullMessageView(session: session, artifactID: item.id) } } }
        }
        .onChange(of: valid, initial: true) { _, valid in if !valid { fullMessage = nil; dismiss() } }
    }
    private func load(_ direction: String) async {
        guard valid, !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let cursor = direction == "older" ? page?.start : direction == "newer" ? page?.end : nil
            let next = try await session.readHistoryActivity(runID: selection.runID, range: selection.range, direction: direction, cursor: cursor)
            try Task.checkCancellation()
            guard valid else { return }
            page = next
        } catch { if !Task.isCancelled, valid { failedDirection = direction; self.error = error.localizedDescription } }
    }
}

private struct ActivityMessageReference: Identifiable { let id: Int }

private struct TranscriptAnchor { let id: String; let top: CGFloat }
private struct TranscriptLanding { let id: UUID; let anchor: TranscriptAnchor }
private struct TranscriptFrame: Equatable { let rect: CGRect; let revision: UUID? }
private struct TranscriptFramesKey: PreferenceKey {
    static let defaultValue: [String: TranscriptFrame] = [:]
    static func reduce(value: inout [String: TranscriptFrame], nextValue: () -> [String: TranscriptFrame]) { value.merge(nextValue()) { _, new in new } }
}

private struct ChatTurnView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let section: TranscriptSection
    let providerID: String
    let live: Bool
    let readContent: (Int) -> Void
    let openSubagents: () -> Void
    let forkRowID: String?
    let forkRunID: String
    let fork: () -> Void
    let searchRowID: String?
    @State private var disclosure = TranscriptDisclosure()
    private var expanded: Bool { disclosure.isExpanded(active: live) }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if section.folded {
                Button { disclosure.toggle(active: live) } label: {
                    HStack(spacing: 9) {
                        Text(section.label).font(.footnote)
                        Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.caption2)
                    }.foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                        .padding(.bottom, 8).contentShape(Rectangle().inset(by: -6))
                        .overlay(alignment: .bottom) { Color(.separator).frame(height: 0.5) }
                }.buttonStyle(.plain).accessibilityIdentifier("executionDetails-" + section.id)
            }
            // A response always stays in this same ForEach when another response
            // arrives; folding changes membership, never its parent view tree.
            messages(section.displayedRows(expanded: expanded))
        }
        .onChange(of: live, initial: true) { _, active in disclosure.observe(active: active) }
        .onChange(of: searchRowID, initial: true) { _, id in if let id, section.rows.contains(where: { $0.id == id }) { disclosure.expand() } }
    }
    private func messages(_ rows: [TranscriptRow]) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            let lastResponse = section.rows.last(where: { $0.kind == .response })
            let copyRowID = live || lastResponse?.live == true ? nil : lastResponse?.id
            ForEach(TranscriptGroup.build(rows)) { group in
                if group.rows.first?.kind == .tool { ChatToolBlock(session: session, rows: group.rows, live: live) }
                else if group.rows.first?.kind == .media { ChatMediaGallery(session: session, media: group.rows.flatMap(\.media)) }
                else if let row = group.rows.first {
                    ChatMessage(session: session, row: row, providerID: providerID, readContent: readContent, openSubagents: openSubagents,
                                copyText: row.id == copyRowID ? section.responseText : nil, copyIsPreview: section.responseIsPreview,
                                forkRunID: row.id == forkRowID ? forkRunID : nil, fork: fork)
                        .background(row.id == searchRowID ? Color.accentColor.opacity(0.08) : .clear, in: .rect(cornerRadius: 8))
                }
            }
        }
    }
}
