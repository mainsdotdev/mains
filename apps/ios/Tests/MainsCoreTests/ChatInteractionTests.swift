import Foundation
import Testing
@testable import MainsCore

@Test @MainActor func anAcknowledgementNeverClearsTheNextDraft() {
    let draft = ConversationDraft()
    draft.text = "First message"
    let submission = draft.begin()!
    #expect(draft.text.isEmpty)
    #expect(draft.isSending)
    draft.text = "My next thought"
    draft.accept(submission)
    #expect(draft.text == "My next thought")
    #expect(!draft.isSending)
}

@Test @MainActor func steerDraftClearsOnlyItsUnchangedSourceAfterAcceptance() throws {
    let draft = ConversationDraft()
    draft.text = "Focus on the tests"
    let first = try #require(draft.begin(retainingContent: true))
    #expect(draft.text == first.text && draft.isSending)
    #expect(draft.begin(retainingContent: true) == nil)
    draft.accept(first)
    #expect(!draft.hasContent && !draft.isSending)
    draft.text = "Look at the server"
    let next = try #require(draft.begin(retainingContent: true))
    draft.text = "A newer thought"
    draft.accept(first)
    #expect(draft.isSending && draft.text == "A newer thought")
    draft.accept(next)
    #expect(!draft.isSending && draft.text == "A newer thought")
}

@Test @MainActor func refusedSteerPreservesItsFilesAndMentionsWhileUncertainSteerBelongsToItsReceipt() throws {
    let draft = ConversationDraft()
    let scope = ContextScope(providerID: "codex")
    let skill = ContextSkill(name: "review", displayName: "Review")
    let file = PromptAttachment(name: "notes.txt", type: "document", mimeType: "text/plain", bytes: Data("Context".utf8))
    draft.insert(skill, scope: scope); draft.attachments = [file]
    let refused = try #require(draft.begin(retainingContent: true))
    draft.reject(refused, message: MainsError.steerTurnEnded.localizedDescription, uncertain: false)
    #expect(draft.text == refused.text && draft.attachments == [file] && draft.contextSkills == [skill])
    #expect(draft.unsentText == nil && !draft.isSending)
    let uncertain = try #require(draft.begin(retainingContent: true))
    draft.reject(uncertain, message: "Unknown outcome", uncertain: true)
    #expect(!draft.hasContent && draft.contextSkills.isEmpty && draft.unsentText == nil)
    draft.text = "Another request"
    let edited = try #require(draft.begin(retainingContent: true))
    draft.text = "Keep my edits"
    draft.reject(edited, message: "Unknown outcome", uncertain: true)
    #expect(draft.text == "Keep my edits")
}

@Test func steerSupportRequiresARunningLocalCodexOrClaudeConversation() {
    for provider in ["codex", "claude_code", "copilot_cli", "cursor", "opencode"] {
        for status in ["queued", "running", "succeeded", "canceled", "failed"] {
            var run = Conversation(id: "run", accountId: "account", providerId: provider, mode: "developer", spaceId: nil,
                                   title: nil, status: status, model: nil, isArchived: false, isReplica: false, lastError: nil,
                                   createdAt: Date(), updatedAt: Date())
            #expect(run.canSteer == (status == "running" && ["codex", "claude_code"].contains(provider)))
            run = Conversation(id: "run", accountId: "account", providerId: provider, mode: "developer", spaceId: nil,
                               title: nil, status: status, model: nil, isArchived: false, isReplica: true, lastError: nil,
                               createdAt: Date(), updatedAt: Date())
            #expect(!run.canSteer)
        }
    }
}

@Test func steerWaitsForItsDurableMessageIdentityWithoutAnOptimisticTurn() throws {
    let at = Date()
    var pending = PendingMessage(runID: "run", text: "Same message", date: at, status: .sending, commandID: "steer-command",
                                 channel: "runs:steer", payload: .object(["clientUserMessageId": .string("steer-input")]),
                                 backendID: "computer", owner: 1, previousArtifactID: 0)
    func prompt(_ messageID: String) -> Artifact {
        Artifact(id: 1, runId: "run", kind: "user-prompt", content: pending.text,
                 metadata: .object(["clientUserMessageId": .string(messageID)]), createdAt: at)
    }
    var transcript = Transcript()
    #expect(!pending.matches(prompt("another-input")))
    #expect(pending.matches(prompt("steer-input")))
    for status in [PendingMessage.Status.sending, .accepted, .uncertain] {
        pending.status = status
        #expect(transcript.rows(pending: pending, runID: "run").isEmpty)
    }
    transcript.replace(HistoryPage(artifacts: [prompt("steer-input")], toolCalls: [], turns: [], start: nil, end: nil, last: nil, hasOlder: false, hasNewer: false), pending: pending)
    let row = try #require(transcript.rows(pending: pending, runID: "run").first)
    #expect(row.id == "artifact:1" && row.delivery == nil)
    #expect(transcript.rows(pending: pending, runID: "run").count == 1)
}

@Test @MainActor func aFailedSendRestoresTextWithoutOverwritingNewInput() {
    let draft = ConversationDraft()
    draft.text = "Original message"
    let first = draft.begin()!
    draft.reject(first, message: "Refused", uncertain: false)
    #expect(draft.text == "Original message")
    let second = draft.begin()!
    draft.text = "New draft"
    draft.reject(second, message: "Refused", uncertain: false)
    #expect(draft.text == "New draft")
    #expect(draft.unsentText == "Original message")
    let third = draft.begin()!
    draft.accept(first) // A late completion belongs to its original submission.
    #expect(draft.submission?.id == third.id)
}

@Test @MainActor func uncertainDeliveryDoesNotBecomeAFreshSend() {
    let draft = ConversationDraft()
    draft.text = "Possibly delivered"
    let submission = draft.begin()!
    draft.reject(submission, message: "Unknown outcome", uncertain: true)
    #expect(draft.text.isEmpty)
    #expect(draft.unsentText == nil)
    #expect(draft.failure == "Unknown outcome")
}

@Test @MainActor func failedAttachmentsStayWithTheirOriginalMessage() {
    let draft = ConversationDraft()
    let attachment = PromptAttachment(name: "note.txt", type: "document", mimeType: "text/plain", bytes: Data("Context".utf8))
    draft.text = "Read this file"; draft.attachments = [attachment]
    let sent = draft.begin()!
    draft.text = "An unrelated next thought"
    draft.reject(sent, message: "Refused", uncertain: false)
    #expect(draft.attachments.isEmpty)
    #expect(draft.unsentAttachments == [attachment])
    draft.restoreUnsent()
    #expect(draft.text == "Read this file" && draft.attachments == [attachment])
    #expect(draft.unsentText == "An unrelated next thought")
}

@Test @MainActor func emptyDraftsCannotSendAfterTheLastAttachmentIsRemoved() {
    let draft = ConversationDraft()
    for text in ["", " \n\t"] {
        draft.text = text
        #expect(!draft.hasContent && draft.begin() == nil)
    }
    draft.attachments = [PromptAttachment(name: "note.pdf", type: "document", mimeType: "application/pdf", bytes: Data("PDF".utf8))]
    #expect(draft.hasContent)
    draft.attachments.removeAll()
    #expect(!draft.hasContent && draft.begin() == nil)
}

@Test(arguments: ["image", "document"]) @MainActor
func attachmentOnlyDraftsPreserveFilesAcrossRefusalRecoveryAndUncertainDelivery(type: String) throws {
    let draft = ConversationDraft()
    let first = PromptAttachment(name: "first", type: type, mimeType: "application/octet-stream", bytes: Data([1]))
    let next = PromptAttachment(name: "next", type: type, mimeType: "application/octet-stream", bytes: Data([2]))
    draft.attachments = [first]
    let sent = try #require(draft.begin())
    #expect(sent.text.isEmpty && sent.attachments == [first])
    #expect(draft.attachments.isEmpty && draft.isSending && draft.begin() == nil)
    draft.reject(sent, message: "Refused", uncertain: false)
    #expect(draft.text.isEmpty && draft.attachments == [first])

    draft.text = " \n\t"
    let retry = try #require(draft.begin())
    draft.attachments = [next]
    draft.reject(retry, message: "Refused", uncertain: false)
    #expect(draft.attachments == [next] && draft.unsentAttachments == [first])
    draft.restoreUnsent()
    #expect(draft.text == retry.text && draft.attachments == [first])
    draft.restoreUnsent()
    #expect(draft.text.isEmpty && draft.attachments == [next], "Restoring the failed files must also preserve a newer attachment-only draft.")

    let uncertain = try #require(draft.begin())
    draft.reject(uncertain, message: "Unknown outcome", uncertain: true)
    #expect(!draft.hasContent && draft.unsentText == nil && draft.unsentAttachments.isEmpty)
}

@Test func contentGrowthAndKeyboardChangesNeverBecomeUserIntent() {
    var viewport = TranscriptViewport()
    viewport.update(.init(offset: 500, content: 1000, frame: 500), hasNewer: false)
    viewport.update(.init(offset: 500, content: 1500, frame: 500), hasNewer: false)
    #expect(viewport.chasing)
    #expect(!viewport.showsJump(hasNewer: false))
    viewport.beginInteraction()
    #expect(!viewport.chasing)
    viewport.update(.init(offset: 600, content: 1500, frame: 400), hasNewer: false)
    viewport.endInteraction(hasNewer: false)
    #expect(viewport.following)
    #expect(viewport.chasing)
}

@Test func readingOlderMessagesPausesFollowingUntilTheUserReturns() {
    var viewport = TranscriptViewport()
    viewport.update(.init(offset: 1000, content: 1500, frame: 500), hasNewer: false)
    viewport.beginInteraction()
    viewport.update(.init(offset: 850, content: 1500, frame: 500), hasNewer: false)
    #expect(!viewport.following)
    #expect(!viewport.showsJump(hasNewer: false)) // No arrow flicker for a small departure.
    viewport.update(.init(offset: 700, content: 1500, frame: 500), hasNewer: false)
    viewport.endInteraction(hasNewer: false)
    #expect(viewport.showsJump(hasNewer: false))
    viewport.update(.init(offset: 700, content: 1800, frame: 500), hasNewer: false)
    #expect(!viewport.chasing)
    viewport.beginInteraction()
    viewport.update(.init(offset: 1250, content: 1800, frame: 500), hasNewer: false)
    viewport.endInteraction(hasNewer: false)
    #expect(viewport.chasing)
}

@Test func latestNavigationOnlyStartsChasingAfterItsPageIsConfirmed() {
    var viewport = TranscriptViewport()
    viewport.beginPage()
    viewport.finishPage(latestConfirmed: false)
    #expect(!viewport.chasing)
    #expect(viewport.showsJump(hasNewer: true))
    viewport.beginPage()
    viewport.finishPage(latestConfirmed: true)
    #expect(viewport.chasing)
    #expect(!viewport.showsJump(hasNewer: false))
}

@Test func historyRefreshKeepsTheReadersWindowWithoutBlockingExplicitNavigation() throws {
    var transcript = Transcript()
    transcript.replace(try samplePage(), direction: "latest")
    transcript.setFollowing(false)
    #expect(try transcript.request(runID: "run", direction: "refresh")["end"]["id"].number == 3)
    #expect(try transcript.request(runID: "run", direction: "older")["cursor"]["id"].number == 1)
    transcript.replace(try samplePage(hasNewer: true), direction: "refresh")
    transcript.setFollowing(true)
    #expect(!transcript.isFollowing)
    transcript.replace(try samplePage(), direction: "latest")
    #expect(transcript.isFollowing)
    #expect(try transcript.request(runID: "run", direction: "refresh")["end"] == .null)
}

@Test func shortTranscriptsDoNotLeaveFollowingOnARubberBandBounce() {
    var viewport = TranscriptViewport()
    viewport.update(.init(offset: -100, content: 200, frame: 700, topInset: 100), hasNewer: false)
    viewport.beginInteraction()
    viewport.update(.init(offset: -140, content: 200, frame: 700, topInset: 100), hasNewer: false)
    viewport.endInteraction(hasNewer: false)
    #expect(viewport.chasing)
    #expect(!viewport.showsJump(hasNewer: false))
}

@Test func resumingLiveFollowingReleasesAFrozenEndEvenWithoutNewerMessages() throws {
    var transcript = Transcript()
    transcript.replace(try samplePage(), direction: "latest")
    transcript.setFollowing(false)
    let page = try samplePage()
    transcript.replace(HistoryPage(artifacts: page.artifacts, toolCalls: page.toolCalls, turns: page.turns,
                                  start: page.start, end: page.last?.exclusiveEnd, last: page.last,
                                  hasOlder: false, hasNewer: false), direction: "refresh")
    let before = try transcript.request(runID: "run", direction: "refresh")
    #expect(before["end"] != .null)
    transcript.setFollowing(true)
    #expect(try transcript.request(runID: "run", direction: "refresh")["end"] == .null)
}

@Test func automaticPagingRequiresDirectionalUserMovementAtTheRelevantBoundary() {
    var viewport = TranscriptViewport()
    viewport.update(.init(offset: 700, content: 1200, frame: 500), hasNewer: false, hasOlder: true)
    viewport.beginInteraction()
    #expect(viewport.update(.init(offset: 180, content: 1200, frame: 500), hasNewer: false, hasOlder: true) == .older)
    viewport.beginPage()
    #expect(viewport.update(.init(offset: 100, content: 1500, frame: 500), hasNewer: true, hasOlder: true) == nil)
    viewport.finishPage(latestConfirmed: false)
    #expect(viewport.update(.init(offset: 950, content: 1500, frame: 500), hasNewer: true) == nil)
    viewport.beginInteraction()
    #expect(viewport.update(.init(offset: 980, content: 1500, frame: 500), hasNewer: true) == .newer)
    viewport.beginPage(); viewport.finishPage(latestConfirmed: false)
    viewport.beginInteraction()
    // Resizing the keyboard and growing content never trigger another page.
    #expect(viewport.update(.init(offset: 1150, content: 1500, frame: 300), hasNewer: true, hasOlder: true) == nil)
    #expect(viewport.update(.init(offset: 1150, content: 1800, frame: 300), hasNewer: true, hasOlder: true) == nil)
}

@Test func shortPagesNeverAutomaticallyPageOnRubberBanding() {
    var viewport = TranscriptViewport()
    viewport.update(.init(offset: -100, content: 200, frame: 700, topInset: 100), hasNewer: true, hasOlder: true)
    viewport.beginInteraction()
    #expect(viewport.update(.init(offset: -140, content: 200, frame: 700, topInset: 100), hasNewer: true, hasOlder: true) == nil)
    #expect(viewport.update(.init(offset: -70, content: 200, frame: 700, topInset: 100), hasNewer: true, hasOlder: true) == nil)
}

@Test func pagingAlsoChecksTheFinalPositionAfterMomentumAndLazyLayoutSettle() {
    var viewport = TranscriptViewport()
    viewport.update(.init(offset: 600, content: 1500, frame: 500), hasNewer: true)
    viewport.beginInteraction()
    viewport.update(.init(offset: 800, content: 1500, frame: 500), hasNewer: true)
    // A lazy row resolves its measured size in the same frame as the last scroll.
    #expect(viewport.update(.init(offset: 1100, content: 1600, frame: 500), hasNewer: true) == nil)
    #expect(viewport.endInteraction(hasNewer: true) == .newer)
    #expect(viewport.endInteraction(hasNewer: true) == nil)
}

@Test func swiftUIVisibleHeightDoesNotCountComposerAndNavigationInsetsTwice() {
    let bottom = TranscriptGeometry(offset: 1621, content: 2349, visibleFrame: 612, topInset: 116, bottomInset: 146)
    #expect(bottom.end == 1621 && bottom.distanceFromEnd == 0)
    var viewport = TranscriptViewport()
    viewport.update(.init(offset: 1300, content: 2349, visibleFrame: 612, topInset: 116, bottomInset: 146), hasNewer: true)
    viewport.beginInteraction()
    #expect(viewport.update(bottom, hasNewer: true) == .newer)
    viewport.endInteraction(hasNewer: false)
    #expect(viewport.chasing && !viewport.showsJump(hasNewer: false))
}

@Test func observedWorkDoesNotCollapseWhenItCompletesOrReopenAgainstUserChoice() {
    var disclosure = TranscriptDisclosure()
    #expect(!disclosure.isExpanded(active: false))
    #expect(disclosure.isExpanded(active: true))
    disclosure.observe(active: true)
    disclosure.observe(active: false)
    #expect(disclosure.isExpanded(active: false))
    disclosure.toggle(active: false)
    #expect(!disclosure.isExpanded(active: false))
    disclosure.observe(active: true)
    #expect(!disclosure.isExpanded(active: true))
}

@Test func pendingPromptAndPersistedPromptKeepOneIdentityAndChronologicalPosition() throws {
    let pending = PendingMessage(runID: "run", text: "Hi", date: Date(timeIntervalSince1970: 0.9), status: .sending,
                                 commandID: "native-send", channel: "runs:continue", payload: .null,
                                 backendID: "computer", owner: 1, previousArtifactID: 0)
    var transcript = Transcript()
    transcript.receive(delta("A response already streaming"))
    let before = transcript.rows(pending: pending, runID: "run")
    #expect(before.map(\.id) == ["pending:native-send", "stream:answer-1"])
    #expect(before.first?.delivery == .sending)
    let page = try samplePage(artifacts: #"[{"id":1,"runId":"run","kind":"user-prompt","content":"Hi","metadata":{},"createdAt":{"$date":"1970-01-01T00:00:02Z"}},{"id":2,"runId":"run","kind":"report","content":"A response already streaming","metadata":{"streamId":"answer-1"},"createdAt":{"$date":"1970-01-01T00:00:03Z"}}]"#)
    transcript.replace(page, pending: pending)
    let confirmed = transcript.rows(pending: nil, runID: "run")
    #expect(confirmed.map(\.id) == before.map(\.id))
    #expect(confirmed.map(\.date) == before.map(\.date))
    #expect(confirmed.first?.delivery == .accepted)
    transcript.replace(page)
    #expect(transcript.rows.map(\.id) == confirmed.map(\.id))
    #expect(transcript.rows(pending: pending, runID: "another-run").count == confirmed.count)
    transcript.replace(try samplePage())
    transcript.replace(page)
    #expect(transcript.rows.first?.id == "artifact:1", "Presentation aliases leave memory with their bounded history page.")
}

@Test func durableResponseAcknowledgementDoesNotMoveItPastFollowingToolActivity() throws {
    var transcript = Transcript()
    transcript.receive(delta("Inspecting the workspace"))
    let page = try JSONValue.object(["artifacts": .array([
        .object(["id": .number(1), "runId": .string("run"), "kind": .string("report"), "content": .string("Inspecting the workspace"),
                 "metadata": .object(["streamId": .string("answer-1")]), "createdAt": .object(["$date": .string("1970-01-01T00:00:04Z")])])
    ]), "toolCalls": .array([
        .object(["id": .number(2), "toolName": .string("Read"), "status": .string("done"), "createdAt": .object(["$date": .string("1970-01-01T00:00:02Z")])])
    ]), "turns": .array([]), "start": .null, "end": .null, "last": .null, "hasOlder": .bool(false), "hasNewer": .bool(false)]).decode(HistoryPage.self)
    transcript.replace(page)
    #expect(transcript.rows.map(\.id) == ["stream:answer-1", "tool:2"])
    #expect(transcript.rows.first?.date == Date(timeIntervalSince1970: 1.2))
}

@Test func pausedLiveHistoryKeepsStreamingButExplicitHistoryHidesIt() throws {
    var transcript = Transcript()
    transcript.replace(try samplePage(), direction: "latest")
    transcript.setFollowing(false)
    transcript.replace(try samplePage(hasNewer: true), direction: "refresh")
    transcript.receive(delta("A new live answer"))
    #expect(!transcript.isHistorical)
    #expect(transcript.rows.contains { $0.text == "A new live answer" })
    transcript.replace(try samplePage(hasNewer: true), direction: "older")
    #expect(transcript.isHistorical)
    #expect(!transcript.rows.contains { $0.text == "A new live answer" })
    transcript.replace(try samplePage(hasNewer: true), direction: "refresh")
    #expect(transcript.isHistorical)
    transcript.replace(try samplePage(), direction: "newer")
    #expect(!transcript.isHistorical && !transcript.isFollowing)
    transcript.setFollowing(true)
    #expect(transcript.isFollowing)
}

@MainActor private final class HistoryReaderTransport: BackendTransport {
    let base: DemoTransport
    var failDirection: String?
    var hold = false
    var release: CheckedContinuation<Void, Never>?
    var onEvent: ((String, JSONValue) -> Void)? { get { base.onEvent } set { base.onEvent = newValue } }
    var onDisconnect: ((MainsError) -> Void)? { get { base.onDisconnect } set { base.onDisconnect = newValue } }
    init(_ backend: DemoBackend) { base = DemoTransport(backend: backend) }
    func open(endpoint: URL, token: String) throws { try base.open(endpoint: endpoint, token: token) }
    func close() { base.close() }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        if channel == "runs:getHistory" {
            if hold { hold = false; await withCheckedContinuation { release = $0 } }
            if args.first?["direction"].string == failDirection { throw MainsError.server("History unavailable") }
        }
        return try await base.perform(channel, args: args, commandId: commandId, timeout: timeout)
    }
}

@Test @MainActor func failedOrRetiredHistoryNavigationNeverConfirmsLatest() async throws {
    let backend = try DemoBackend()
    let transport = HistoryReaderTransport(backend)
    let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in transport })
    session.restore(); session.setActive(true); try session.startDemo()
    defer { session.exitDemo(); backend.shutdown() }
    try await eventually { session.isConnected }
    let id = try #require(session.conversations.first?.id)
    await session.selectConversation(id)
    let page = try #require(session.transcript.page)
    transport.failDirection = "older"
    let failed = await session.loadHistory(direction: "older")
    #expect(!failed && session.historyRetryDirection == "older")
    #expect(session.historyError == "History unavailable" && session.transcript.page == page)
    transport.failDirection = nil; transport.hold = true
    let pending = Task { await session.loadHistory(direction: "latest") }
    try await eventually { transport.release != nil }
    session.leaveConversation(id)
    transport.release?.resume(); transport.release = nil
    let retired = await pending.value
    #expect(!retired && session.transcript.page == nil && !session.historyLoading)
}
