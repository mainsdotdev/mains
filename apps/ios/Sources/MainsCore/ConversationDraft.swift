import Foundation
import Observation

/// Phone-owned input for one conversation. A late send result cannot erase the next draft.
@MainActor @Observable
public final class ConversationDraft {
    public struct Submission: Sendable {
        public let id = UUID()
        public let text: String
        public let attachments: [PromptAttachment]
    }
    public var text = ""
    public var attachments: [PromptAttachment] = []
    public private(set) var submission: Submission?
    public private(set) var failure: String?
    public private(set) var failureTitle = "Couldn't send"
    public private(set) var unsentText: String?
    public private(set) var unsentAttachments: [PromptAttachment] = []
    public var isSending: Bool { submission != nil }
    public init() {}

    public func begin() -> Submission? {
        guard submission == nil, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let next = Submission(text: text, attachments: attachments)
        text = ""
        attachments = []
        failure = nil; unsentText = nil; unsentAttachments = []
        submission = next
        return next
    }
    public func accept(_ sent: Submission) {
        guard submission?.id == sent.id else { return }
        submission = nil
    }
    public func reject(_ sent: Submission, message: String, uncertain: Bool) {
        guard submission?.id == sent.id else { return }
        submission = nil
        failure = message
        failureTitle = "Couldn't send"
        // An unconfirmed prompt belongs to the receipt UI, never back in a fresh send.
        guard !uncertain else { return }
        if text.isEmpty { text = sent.text; attachments = sent.attachments }
        else { unsentText = sent.text; unsentAttachments = sent.attachments }
    }
    public func showFailure(_ message: String, title: String = "Something went wrong") { failure = message; failureTitle = title }
    public func restoreUnsent() {
        guard let unsentText else { return }
        let currentText = text, currentAttachments = attachments
        text = unsentText; attachments = unsentAttachments
        self.unsentText = currentText.isEmpty ? nil : currentText; unsentAttachments = currentAttachments
    }
    public func dismissFailure() { failure = nil; unsentText = nil; unsentAttachments = [] }
}
