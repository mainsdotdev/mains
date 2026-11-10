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
