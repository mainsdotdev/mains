import SwiftUI

struct ConversationTranscript: View {
    let session: BackendSession
    let runID: String
    let providerID: String
    @Binding var viewport: TranscriptViewport
    let readContent: (Int) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var visible: Set<String> = []
    private var page: HistoryPage? { session.viewingRunID == runID ? session.transcript.page : nil }
    private var rows: [TranscriptRow] { session.viewingRunID == runID ? session.transcript.rows : [] }
    private var pending: PendingMessage? { session.pendingMessage?.runID == runID ? session.pendingMessage : nil }
    private var run: Conversation? { session.conversations.first { $0.id == runID } }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    if page?.hasOlder == true {
                        pageButton("Load earlier messages", direction: "older", proxy: proxy)
                    }
                    if session.historyLoading && rows.isEmpty {
                        VStack(spacing: 12) { ProgressView(); Text("Loading conversation…").font(.footnote).foregroundStyle(.secondary) }
                            .frame(maxWidth: .infinity).padding(.vertical, 48)
                    } else if rows.isEmpty && pending == nil && session.historyError == nil {
                        ContentUnavailableView(session.isConnected ? "Pick up where you left off" : "Not downloaded yet",
                                               systemImage: session.isConnected ? "bubble.left.and.bubble.right" : "wifi.slash",
                                               description: Text(session.isConnected ? "Send a message to continue with \(Provider.name(providerID))." : "Reconnect to your computer to load this conversation."))
                            .padding(.vertical, 24)
                    }
                    ForEach(sections) { section in
                        ChatTurnView(session: session, section: section, providerID: providerID,
                                     live: run?.isActive == true && section.id == sections.last?.id && page?.hasNewer != true,
                                     readContent: readContent).id(section.id)
                    }
                    if let pending { PendingPrompt(pending: pending, providerID: providerID).id("pending:" + pending.id) }
                    if let error = session.historyError {
                        ChatNotice(title: "Messages couldn't load", message: error, symbol: "wifi.exclamationmark", warning: true) {
                            Button("Retry") { Task { await session.loadHistory(direction: "refresh") } }
                                .disabled(!session.isConnected || session.historyLoading)
                        }
                    }
                    if page?.hasNewer == true { pageButton("Load newer messages", direction: "newer", proxy: proxy) }
                    activity
                    Color.clear.frame(height: 1).id("transcript-bottom")
                }
                .scrollTargetLayout()
                .padding(.horizontal, 16).padding(.top, 24).padding(.bottom, 12)
            }
            .accessibilityIdentifier("conversationTranscript")
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(.top, for: .alignment)
            .defaultScrollAnchor(viewport.chasing && page?.hasNewer != true ? .bottom : nil, for: .sizeChanges)
            .onScrollTargetVisibilityChange(idType: String.self) { visible = Set($0) }
            .onScrollPhaseChange { _, phase in
                if phase == .tracking || phase == .interacting {
                    if !viewport.interacting { viewport.beginInteraction() }
                } else if phase == .idle {
                    let followed = viewport.following
                    viewport.endInteraction(hasNewer: page?.hasNewer == true)
                    if viewport.following != followed { session.setHistoryFollowing(viewport.following) }
                }
            }
            .onScrollGeometryChange(for: TranscriptGeometry.self) { geometry in
                TranscriptGeometry(offset: geometry.contentOffset.y, content: geometry.contentSize.height,
                                   frame: geometry.containerSize.height, topInset: geometry.contentInsets.top,
                                   bottomInset: geometry.contentInsets.bottom)
            } action: { old, next in
                let followed = viewport.following
                viewport.update(next, hasNewer: page?.hasNewer == true)
                if viewport.following != followed { session.setHistoryFollowing(viewport.following) }
                if viewport.chasing && page?.hasNewer != true && old.content != next.content {
                    proxy.scrollTo("transcript-bottom", anchor: .bottom)
                }
            }
            .overlay(alignment: .bottom) {
                if viewport.showsJump(hasNewer: page?.hasNewer == true) {
                    Button {
                        Task {
                            viewport.beginPage()
                            if page?.hasNewer == true { await session.loadHistory(direction: "latest") }
                            let confirmed = session.viewingRunID == runID && session.historyError == nil && page?.hasNewer != true
                            viewport.finishPage(latestConfirmed: confirmed)
                            guard confirmed else { return }
                            session.setHistoryFollowing(true)
                            await Task.yield()
                            withAnimation(reduceMotion ? nil : .snappy(duration: 0.25, extraBounce: 0)) {
                                proxy.scrollTo("transcript-bottom", anchor: .bottom)
                            }
                        }
                    } label: {
                        Image(systemName: "arrow.down").font(.system(size: 22, weight: .regular))
                            .frame(width: 40, height: 40).modifier(GlassSurface(radius: 20))
                    }
                    .buttonStyle(ChatPressStyle())
                    .accessibilityLabel("Jump to latest").accessibilityIdentifier("jumpToLatest")
                    .padding(.bottom, 8).disabled(session.historyLoading || page?.hasNewer == true && !session.isConnected)
                }
            }
        }
    }

    @ViewBuilder private var activity: some View {
        if session.stoppingRunID == runID {
            ChatActivity(title: "Stopping reply…", symbol: "stop.circle", busy: true)
        } else if session.waitingForDecision {
            ChatNotice(title: "Your agent needs a decision", message: "Answer the request in Mains on your computer.", symbol: "hand.raised", warning: false) { EmptyView() }
        } else if run?.isActive == true {
            ChatActivity(title: session.isConnected ? (rows.contains(where: { $0.kind == .response && $0.live }) ? "Responding…" : "Working on your computer…") : "Reply continues on your computer", symbol: "sparkle", busy: session.isConnected)
        } else if run?.status == "canceled" {
            ChatActivity(title: "Reply stopped", symbol: "stop.circle", busy: false)
        } else if run?.status == "failed" {
            ChatNotice(title: "Reply interrupted", message: run?.lastError ?? "You can send a follow-up to continue.", symbol: "exclamationmark.circle", warning: true) { EmptyView() }
        }
    }

    private func pageButton(_ title: String, direction: String, proxy: ScrollViewProxy) -> some View {
        Button {
            let anchor = sections.first { visible.contains($0.id) }?.id
            viewport.beginPage()
            session.setHistoryFollowing(false)
            Task {
                await session.loadHistory(direction: direction)
                guard session.viewingRunID == runID else { return }
                viewport.finishPage(latestConfirmed: false)
                await Task.yield()
                if let anchor, sections.contains(where: { $0.id == anchor }) { proxy.scrollTo(anchor, anchor: .top) }
            }
        } label: {
            HStack(spacing: 8) {
                if session.historyLoading { ProgressView().controlSize(.mini) }
                Text(title).font(.subheadline.weight(.medium))
            }.frame(maxWidth: .infinity).padding(.vertical, 8)
        }.disabled(session.historyLoading || !session.isConnected)
    }

    private var sections: [TranscriptSection] { TranscriptSection.build(rows) }
}

private struct ChatTurnView: View {
    let session: BackendSession
    let section: TranscriptSection
    let providerID: String
    let live: Bool
    let readContent: (Int) -> Void
    @State private var expanded = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if section.folded {
                if !live {
                    Button { expanded.toggle() } label: {
                        HStack(spacing: 9) {
                            Text(section.label).font(.footnote)
                            Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.caption2)
                        }.foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                            .padding(.bottom, 8).contentShape(Rectangle().inset(by: -6))
                            .overlay(alignment: .bottom) { Color(.separator).frame(height: 0.5) }
                    }.buttonStyle(.plain).accessibilityIdentifier("executionDetails-" + section.id)
                }
                if live || expanded { messages(section.previous) }
                if !section.breakout.isEmpty { messages(section.breakout) }
            }
            messages(section.last)
        }
        .onChange(of: live) { _, active in if active { expanded = false } }
    }
    private func messages(_ rows: [TranscriptRow]) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            ForEach(TranscriptGroup.build(rows)) { group in
                if group.rows.first?.kind == .tool { ChatToolBlock(session: session, rows: group.rows) }
                else if group.rows.first?.kind == .media { ChatMediaGallery(session: session, media: group.rows.flatMap(\.media)) }
                else if let row = group.rows.first { ChatMessage(session: session, row: row, providerID: providerID, readContent: readContent) }
            }
        }
    }
}
