import SwiftUI
import Observation

enum TranscriptRowMetrics {
    static let spacing: CGFloat = 20
    static let summaryHeight: CGFloat = 32
}

struct ConversationSkeleton: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let isMate: Bool

    var body: some View {
        VStack(spacing: 24) {
            message([152, 96], alignment: .trailing, boxed: true)
            message([246, 222, 148], alignment: .leading, boxed: isMate)
            message([108], alignment: .trailing, boxed: true)
            message([230, 164], alignment: .leading, boxed: isMate)
        }
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isMate ? Text("Loading Mate chat…") : Text("Loading conversation…"))
    }

    private func message(_ widths: [CGFloat], alignment: Alignment, boxed: Bool) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(widths, id: \.self) { width in
                SkeletonLine(width: width, height: 11)
            }
        }
        .padding(.horizontal, boxed ? 16 : 0)
        .padding(.vertical, boxed ? 14 : 3)
        .background(boxed ? SkeletonLine.fill.opacity(0.5) : .clear, in: .rect(cornerRadius: 22))
        .padding(.leading, alignment == .trailing ? 56 : 0)
        .frame(maxWidth: .infinity, alignment: alignment)
    }
}

@MainActor @Observable
final class TranscriptScrollState {
    private(set) var paging = false
    private(set) var visibleToolIDs: Set<Int> = []
    private var showsJumpOnLatestPage = false

    // Publish changes that affect the transcript or its controls.
    @ObservationIgnored var viewport = TranscriptViewport() {
        didSet {
            if paging != viewport.paging { paging = viewport.paging }
            let showsJump = viewport.showsJump(hasNewer: false)
            if showsJumpOnLatestPage != showsJump { showsJumpOnLatestPage = showsJump }
            if oldValue.geometry.topInset != viewport.geometry.topInset || oldValue.geometry.bottomInset != viewport.geometry.bottomInset {
                updateVisibleTools()
            }
        }
    }
    @ObservationIgnored var toolFrames: [Int: CGRect] = [:] { didSet { updateVisibleTools() } }
    @ObservationIgnored var transcriptFrame = CGRect.zero { didSet { updateVisibleTools() } }
    @ObservationIgnored var keyboardTransition: KeyboardTransition?

    func showsJump(hasNewer: Bool) -> Bool { hasNewer ? !paging : showsJumpOnLatestPage }

    private func updateVisibleTools() {
        let geometry = viewport.geometry
        let visibleFrame = CGRect(x: transcriptFrame.minX, y: transcriptFrame.minY + geometry.topInset,
                                  width: transcriptFrame.width,
                                  height: max(0, transcriptFrame.height - geometry.topInset - geometry.bottomInset))
        let visible = Set(toolFrames.compactMap { id, frame in
            !visibleFrame.isEmpty && !frame.isEmpty && frame.intersection(visibleFrame).height >= frame.height * 0.5 ? id : nil
        })
        if visibleToolIDs != visible { visibleToolIDs = visible }
    }
}

struct ConversationTranscript: View {
    private static let transcriptInset: CGFloat = 16
    private static let noticeInset = MessageComposer.horizontalInset - transcriptInset

    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let runID: String
    let providerID: String
    let scroll: TranscriptScrollState
    let openFile: (RunTurn, TurnFileChange) -> Void
    let openSubagents: () -> Void
    let fork: () -> Void
    var searchCursor: HistoryCursor? = nil
    var mate: Mate? = nil
    let readContent: (Int) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.conversationPaneVisible) private var paneVisible
    @Environment(\.mainPaneCovered) private var mainPaneCovered
    @Environment(\.composerCoversReader) private var composerCoversReader
    @State private var scrollPosition = ScrollPosition(idType: String.self)
    @State private var sectionFrames: [String: TranscriptFrame] = [:]
    @State private var navigationID: UUID?
    @State private var loadingDirection: String?
    @State private var landing: TranscriptLanding?
    @State private var searchLanded = false
    @State private var activitySelection: ConversationActivitySelection?
    @State private var mentionArtwork: (owner: Int, avatars: [String: MateAvatar])?
    private struct MentionArtworkRequest: Equatable {
        let owner: Int
        let revision: Int
        let canLoad: Bool
    }
    private var searchRowID: String? {
        guard let cursor = searchCursor, let artifact = page?.artifacts.first(where: { $0.id == cursor.id }) else { return nil }
        return session.transcript.rowID(for: artifact)
    }
    private var page: HistoryPage? { session.viewingRunID == runID ? session.transcript.page : nil }
    private var rows: [TranscriptRow] {
        guard session.viewingRunID == runID else { return [] }
        return session.transcript.rows(pending: pending, runID: runID, forMate: isMate, providerID: providerID)
    }
    private var pending: PendingMessage? { session.pendingMessage?.runID == runID ? session.pendingMessage : nil }
    private var run: Conversation? { session.conversations.first { $0.id == runID } }
    private var isMate: Bool { run?.assistantId != nil }
    private var activityArtwork: AgentActivityView.Artwork { isMate ? .mate(mate) : .provider(providerID) }
    private var mentionArtworkRequest: MentionArtworkRequest {
        let hasMentions = page?.artifacts.contains { $0.metadata?["assistantMentions"].array.isEmpty == false } == true
        return MentionArtworkRequest(owner: session.ownership, revision: session.matesRevision,
                                     canLoad: paneVisible && hasMentions && session.isConnected && session.supportsMates)
    }

    var body: some View {
        GeometryReader { container in
            transcript(minimumHeight: max(0, container.size.height - container.safeAreaInsets.top - container.safeAreaInsets.bottom))
        }
        .environment(\.mateMentionAvatars, mentionArtwork?.owner == session.ownership ? mentionArtwork?.avatars ?? [:] : [:])
        .loadToolPluginIcons(session: session, runID: runID, providerID: providerID, calls: page?.toolCalls ?? [], enabled: paneVisible)
        .task(id: mentionArtworkRequest) {
            let request = mentionArtworkRequest
            guard request.canLoad, let directory = try? await session.loadMates(),
                  !Task.isCancelled, request == mentionArtworkRequest else { return }
            mentionArtwork = (request.owner, Dictionary(directory.mates.map { ($0.id, $0.avatar) }, uniquingKeysWith: { first, _ in first }))
        }
    }

    private func transcript(minimumHeight: CGFloat) -> some View {
        let rows = self.rows
        let page = self.page
        let run = self.run
        let pending = self.pending
        let searchRowID = self.searchRowID
        let isMate = run?.assistantId != nil
        let historyError = session.viewingRunID == runID ? session.historyError : nil
        let empty = rows.isEmpty && pending == nil && run?.isActive != true
        let needsConnection = empty && !session.isConnected
        let waitsForHistory = session.isConnected && page == nil && rows.isEmpty && pending == nil && historyError == nil
        let showsEmptyState = needsConnection || empty && !waitsForHistory && historyError == nil
        let centersEmptyState = showsEmptyState && page?.hasOlder != true && page?.hasNewer != true && page?.activity == nil
        let sections = TranscriptSection.build(rows, foldsResponses: !isMate)
        let liveSectionID = run?.isActive == true && !session.transcript.isHistorical ? sections.last?.id : nil
        let forkRowID = isMate || run?.isReplica == true ? nil : TranscriptForkAnchor.rowID(
            in: rows, atLatest: page?.hasNewer != true, active: run?.isActive == true,
            hasLocalContinuation: pending != nil && pending?.isSteering != true)
        let footers = isMate || run?.mode == "chat" ? [:] : TurnChangeFooters.build(sections: sections, turns: page?.turns ?? [], atLatest: page?.hasNewer != true)
        return ScrollView {
            // The backend already caps this page at 400 rows / 2 MB. Eager
            // measurement avoids lazy height estimates shifting a live tail.
            VStack(alignment: .leading, spacing: TranscriptRowMetrics.spacing) {
                if page?.hasOlder == true {
                    Button { navigate("older") } label: {
                        Text("Load earlier messages")
                            .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 8)
                            .opacity(loadingDirection == "older" ? 0.5 : 1)
                    }.buttonStyle(.plain).disabled(session.historyLoading || scroll.paging || !session.isConnected)
                        .accessibilityIdentifier("loadEarlierMessages")
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
                if !centersEmptyState { Color.clear.frame(height: 1).id("transcript-top") }
                if needsConnection {
                    DisconnectedState(title: "Not downloaded yet", message: "Reconnect to your computer to load this conversation.")
                } else if waitsForHistory {
                    ConversationSkeleton(isMate: isMate)
                        .accessibilityIdentifier("conversationSkeleton")
                } else if empty && historyError == nil {
                    EmptyStateView(artwork: .chats, title: "Pick up where you left off",
                                   description: Text("Send a message to continue with \(Provider.name(providerID))."))
                        .accessibilityIdentifier("conversationEmptyState")
                }
                ForEach(sections) { section in
                    VStack(alignment: .leading, spacing: 12) {
                        ChatTurnView(session: session, section: section, providerID: providerID, isMate: isMate,
                                     live: section.id == liveSectionID,
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
                if !needsConnection, let error = historyError {
                    ChatNotice(title: "Messages couldn't load", message: error, symbol: "wifi.exclamationmark", warning: true,
                               horizontalInset: Self.noticeInset) {
                        Button("Retry") { navigate(session.historyRetryDirection) }
                            .disabled(!session.isConnected || session.historyLoading || scroll.paging)
                    }
                }
                RunDecisionCards(session: session, runID: runID, providerID: providerID)
                if centersEmptyState {
                    activity
                } else {
                    ZStack(alignment: .leading) {
                        Color.clear.frame(height: TranscriptRowMetrics.summaryHeight).accessibilityHidden(true)
                        activity
                    }
                    Color.clear.frame(height: 1).id("transcript-bottom")
                }
            }
            .scrollTargetLayout()
            .padding(.horizontal, Self.transcriptInset)
            .padding(.top, centersEmptyState ? 0 : 24).padding(.bottom, centersEmptyState ? 0 : 12)
            // Keep a tappable blank area around short conversations to dismiss the keyboard.
            .frame(minHeight: centersEmptyState ? nil : minimumHeight, alignment: .top)
            .coordinateSpace(name: "transcript-content")
            .animation(nil, value: rows)
        }
        .scrollEdgeEffectStyle(.soft, for: .top)
        .scrollPosition($scrollPosition)
        .accessibilityIdentifier("conversationTranscript")
        .onPreferenceChange(TranscriptFramesKey.self) { frames in
            let previous = sectionFrames
            let viewport = scroll.viewport
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
        .onPreferenceChange(ActiveToolFramesKey.self) { scroll.toolFrames = $0 }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { scroll.transcriptFrame = $0 }
        .scrollDismissesKeyboard(.interactively)
        .defaultScrollAnchor(.top, for: .initialOffset)
        .defaultScrollAnchor(centersEmptyState ? .center : .top, for: .alignment)
        .defaultScrollAnchor(nil, for: .sizeChanges)
        .contentShape(.rect)
        .background(alignment: .center) {
            TranscriptKeyboardDismissArea(active: paneVisible && !mainPaneCovered && !composerCoversReader)
        }
        .onScrollPhaseChange { _, phase in
            guard paneVisible else { return }
            if phase == .tracking || phase == .interacting {
                if !scroll.viewport.interacting { scroll.viewport.beginInteraction() }
            } else if phase == .idle {
                let followed = scroll.viewport.following
                let direction = scroll.viewport.endInteraction(hasNewer: self.page?.hasNewer == true, hasOlder: self.page?.hasOlder == true)
                if scroll.viewport.following != followed { session.setHistoryFollowing(scroll.viewport.following) }
                if let direction, session.historyError == nil { navigate(direction.rawValue) }
            }
        }
        .onScrollGeometryChange(for: TranscriptGeometry.self) { geometry in
            TranscriptGeometry(offset: geometry.contentOffset.y, content: geometry.contentSize.height,
                               visibleFrame: geometry.containerSize.height, topInset: geometry.contentInsets.top,
                               bottomInset: geometry.contentInsets.bottom)
        } action: { old, next in
            let page = self.page
            let followed = scroll.viewport.following
            let direction = scroll.viewport.update(next, hasNewer: page?.hasNewer == true, hasOlder: page?.hasOlder == true)
            if scroll.viewport.following != followed { session.setHistoryFollowing(scroll.viewport.following) }
            if paneVisible, let direction, session.historyError == nil { navigate(direction.rawValue) }
            guard !centersEmptyState, paneVisible, scroll.viewport.chasing, page?.hasNewer != true else { return }
            let viewportChanged = old.frame != next.frame || old.topInset != next.topInset || old.bottomInset != next.bottomInset
            guard viewportChanged || old.content != next.content else { return }
            if !reduceMotion, let transition = scroll.keyboardTransition,
               let animation = transition.animation(duration: transition.remainingDuration) {
                // The keyboard can change only the scroll insets, so explicitly
                // move to the new visible end using its remaining animation time.
                withAnimation(animation) {
                    scrollPosition.scrollTo(edge: .bottom)
                }
            } else {
                scrollPosition.scrollTo(edge: .bottom)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)
            .merge(with: NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification))) { notification in
            guard paneVisible, notification.userInfo?[UIResponder.keyboardIsLocalUserInfoKey] as? Bool != false else { return }
            scroll.keyboardTransition = KeyboardTransition(notification)
        }
        .onChange(of: paneVisible) { _, visible in
            if !visible { scroll.viewport.interruptInteraction() }
            else if !centersEmptyState && scroll.viewport.chasing && self.page?.hasNewer != true { scrollPosition.scrollTo(edge: .bottom) }
        }
        .overlay(alignment: .bottom) {
            if scroll.showsJump(hasNewer: page?.hasNewer == true) {
                RoundControl(symbol: "arrow.down", label: "Jump to latest", size: 40) {
                    navigate("latest")
                }
                .accessibilityIdentifier("jumpToLatest")
                .padding(.bottom, 8).disabled(session.historyLoading || page?.hasNewer == true && !session.isConnected)
            }
        }
        .onDisappear {
            navigationID = nil; loadingDirection = nil; landing = nil
            scroll.viewport.finishPage(latestConfirmed: false)
        }
        .sheet(item: $activitySelection) { selection in
            ConversationActivitySheet(session: session, selection: selection, isMate: isMate)
                .environment(\.openMateAssignment, nil)
        }
    }

    @ViewBuilder private var activity: some View {
        if session.stoppingRunID == runID {
            if isMate {
                AgentActivityView(activity: AgentActivity(thinking: "Stopping reply…"), artwork: activityArtwork)
            } else { ChatActivity(title: "Stopping reply…", symbol: "stop.circle") }
        } else if session.waitingForDecision {
            EmptyView()
        } else if run?.isActive == true {
            if !session.isConnected {
                ChatActivity(title: "Reply continues on your computer", symbol: "sparkle")
            } else if !session.transcript.isHistorical, run?.status == "queued" {
                AgentActivityView(activity: AgentActivity(thinking: "Queued"), artwork: activityArtwork)
            } else if !session.transcript.isHistorical, session.viewingRunID == runID, let activity = session.transcript.activity,
                      !toolIsVisible(activity.toolID) {
                AgentActivityView(activity: activity, artwork: activityArtwork)
            }
        } else if run?.status == "canceled" {
            ChatActivity(title: "Reply stopped", symbol: "stop.circle")
        } else if run?.status == "failed", run?.archivedReplyError == nil {
            ChatNotice(title: "Reply interrupted", message: run?.lastError ?? "You can send a follow-up to continue.",
                       symbol: "exclamationmark.circle", warning: true, horizontalInset: Self.noticeInset) { EmptyView() }
                .accessibilityIdentifier("replyInterruptedNotice")
        }
    }

    private func toolIsVisible(_ id: Int?) -> Bool { id.map(scroll.visibleToolIDs.contains) ?? false }

    private func readingAnchors(in frames: [String: TranscriptFrame]) -> [TranscriptAnchor] {
        let geometry = scroll.viewport.geometry
        return frames.filter { $0.value.rect.maxY > geometry.offset + geometry.topInset &&
            $0.value.rect.minY < geometry.offset + geometry.frame - geometry.bottomInset }
            .sorted { $0.value.rect.minY < $1.value.rect.minY }
            .map { TranscriptAnchor(id: $0.key, top: $0.value.rect.minY - geometry.offset) }
    }

    private func navigate(_ direction: String) {
        guard !scroll.paging, !session.historyLoading, session.viewingRunID == runID,
              session.isConnected || direction == "latest" && page?.hasNewer != true else { return }
        let id = UUID(), owner = session.ownership, toLatest = direction == "latest" || page == nil
        let anchors = readingAnchors(in: sectionFrames)
        navigationID = id; loadingDirection = direction
        scroll.viewport.beginPage(); session.setHistoryFollowing(false)
        Task {
            let loaded = session.isConnected ? await session.loadHistory(direction: direction) : true
            guard navigationID == id, session.ownership == owner, session.viewingRunID == runID else { return }
            guard loaded else { finishNavigation(); return }
            if toLatest {
                guard page?.hasNewer != true else { finishNavigation(); return }
                finishNavigation(latest: true)
                session.setHistoryFollowing(true)
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.25, extraBounce: 0)) { scrollPosition.scrollTo(edge: .bottom) }
                return
            }
            let sections = TranscriptSection.build(rows, foldsResponses: !isMate)
            if let anchor = anchors.first(where: { candidate in sections.contains { $0.id == candidate.id } }) {
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
        scroll.viewport.finishPage(latestConfirmed: latest)
    }
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
    let isMate: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var page: HistoryPage?
    @State private var loading = false
    @State private var error: String?
    @State private var failedDirection = "refresh"
    @State private var fullMessage: ActivityMessageReference?
    private var valid: Bool { session.ownership == selection.owner && session.viewingRunID == selection.runID }
    private var providerID: String? { session.conversations.first { $0.id == selection.runID }?.providerId }
    private var rows: [TranscriptRow] {
        guard let page, valid else { return [] }
        var transcript = Transcript(); transcript.replace(page)
        let projected = transcript.rows(pending: nil, runID: selection.runID, forMate: isMate, providerID: providerID)
        if isMate { return projected }
        var result = projected.filter { $0.kind != .tool && $0.kind != .subagents }
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
                        if group.rows.first?.kind == .tool {
                            ChatToolBlock(session: session, rows: group.rows, browserActivityTitle: group.browserActivity?.text, isMate: isMate)
                        }
                        else if let row = group.rows.first {
                            if row.id.hasPrefix("child-artifact:") { Text("Agent message").font(.caption.width(.expanded)).foregroundStyle(.secondary) }
                            ChatMessage(session: session, row: row, providerID: "", readContent: { if valid { fullMessage = ActivityMessageReference(id: $0) } },
                                        isMate: isMate)
                        }
                    }
                    if !loading && rows.isEmpty && error == nil { Text("No messages or tool activity in this part.").font(.footnote).foregroundStyle(.secondary) }
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            }
            .id(page?.start).defaultScrollAnchor(.top)
            .overlay(alignment: .top) {
                if loading && rows.isEmpty { ConversationSkeleton(isMate: isMate).padding(20) }
            }
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
            .navigationHeaderFade()
            .expandedNavigationTitle("Messages and activity")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load("refresh") }
            .sheet(item: $fullMessage) { item in if valid { NavigationStack { FullMessageView(session: session, artifactID: item.id) } } }
        }
        .loadToolPluginIcons(session: session, runID: selection.runID, providerID: providerID ?? "",
                             calls: page?.toolCalls ?? [], enabled: valid)
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
    let isMate: Bool
    let live: Bool
    let readContent: (Int) -> Void
    let openSubagents: () -> Void
    let forkRowID: String?
    let forkRunID: String
    let fork: () -> Void
    let searchRowID: String?
    @State private var disclosure = TranscriptDisclosure()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var expanded: Bool { disclosure.isExpanded(active: live) }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if section.folded {
                Button { disclosure.toggle(active: live) } label: {
                    HStack(spacing: 9) {
                        Text(section.label).font(.footnote)
                        toolChevron(expanded)
                            .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: expanded)
                    }.foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                        .padding(.bottom, 8).contentShape(Rectangle().inset(by: -6))
                }.buttonStyle(.plain).accessibilityIdentifier("executionDetails-" + section.id)
                    .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            }
            // A response always stays in this same ForEach when another response
            // arrives; folding changes membership, never its parent view tree.
            messages(section.displayedRows(expanded: expanded))
        }
        .onChange(of: live, initial: true) { _, active in disclosure.observe(active: active) }
        .onChange(of: searchRowID, initial: true) { _, id in if let id, section.rows.contains(where: { $0.id == id }) { disclosure.expand() } }
    }
    private func messages(_ rows: [TranscriptRow]) -> some View {
        VStack(alignment: .leading, spacing: TranscriptRowMetrics.spacing) {
            let lastResponse = section.rows.last(where: { $0.kind == .response && $0.mateTask == nil })
            let copyRowID = live || lastResponse?.live == true ? nil : lastResponse?.id
            ForEach(TranscriptGroup.build(rows)) { group in
                if let plan = group.rows.first?.plan, !isMate { ChatPlanCard(session: session, runID: forkRunID, plan: plan, providerID: providerID) }
                else if group.rows.first?.kind == .tool {
                    ChatToolBlock(session: session, rows: group.rows, browserActivityTitle: group.browserActivity?.text, isMate: isMate)
                        .background(group.browserActivity.map { $0.id == searchRowID } == true ? Color.accentColor.opacity(0.08) : .clear,
                                    in: .rect(cornerRadius: 8))
                }
                else if group.rows.first?.kind == .media { ChatMediaGallery(session: session, media: group.rows.flatMap(\.media)) }
                else if let row = group.rows.first {
                    ChatMessage(session: session, row: row, providerID: providerID, readContent: readContent, isMate: isMate, openSubagents: openSubagents,
                                copyText: row.id == copyRowID ? section.responseText : nil, copyIsPreview: section.responseIsPreview,
                                forkRunID: row.id == forkRowID ? forkRunID : nil, fork: fork)
                        .background(row.id == searchRowID ? Color.accentColor.opacity(0.08) : .clear, in: .rect(cornerRadius: 8))
                }
            }
        }
    }
}
