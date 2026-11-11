import Foundation
import Observation

/// Phone-owned input for one conversation. A late send result cannot erase the next draft.
@MainActor @Observable
public final class ConversationDraft {
    public struct Submission: Sendable {
        public let id = UUID()
        public let text: String
        public let attachments: [PromptAttachment]
        public let contextSkills: [ContextSkill]
        public let contextScope: ContextScope?
    }
    public var text = ""
    public var attachments: [PromptAttachment] = []
    public var contextSkills: [ContextSkill] = []
    public private(set) var contextScope: ContextScope?
    private var unsentSkills: [ContextSkill] = []
    private var unsentScope: ContextScope?
    public private(set) var submission: Submission?
    public private(set) var failure: String?
    public private(set) var failureTitle = "Couldn't send"
    public private(set) var unsentText: String?
    public private(set) var unsentAttachments: [PromptAttachment] = []
    public var isSending: Bool { submission != nil }
    public init() {}

    public func begin() -> Submission? {
        guard submission == nil, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let next = Submission(text: text, attachments: attachments, contextSkills: ContextMentions.attached(in: text, skills: contextSkills), contextScope: contextScope)
        text = ""
        attachments = []; contextSkills = []
        failure = nil; unsentText = nil; unsentAttachments = []; unsentSkills = []; unsentScope = nil
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
        if text.isEmpty && attachments.isEmpty {
            text = sent.text; attachments = sent.attachments; contextSkills = sent.contextSkills
            if let scope = contextScope { synchronizeContext(scope) } else { contextScope = sent.contextScope }
            if contextScope != sent.contextScope { clearContext() }
        } else { unsentText = sent.text; unsentAttachments = sent.attachments; unsentSkills = sent.contextSkills; unsentScope = sent.contextScope }
    }
    public func showFailure(_ message: String, title: String = "Something went wrong") { failure = message; failureTitle = title }
    public func restoreUnsent() {
        guard let unsentText else { return }
        let currentText = text, currentAttachments = attachments, currentSkills = contextSkills, currentScope = contextScope
        text = unsentText; attachments = unsentAttachments; contextSkills = unsentSkills
        if currentScope != unsentScope { clearContext() }
        self.unsentText = currentText.isEmpty ? nil : currentText; unsentAttachments = currentAttachments; unsentSkills = currentSkills; unsentScope = currentScope
    }
    public func synchronizeContext(_ scope: ContextScope) {
        if let contextScope, contextScope != scope { clearContext() }
        contextScope = scope
    }
    public func reconcileContext() { contextSkills = ContextMentions.attached(in: text, skills: contextSkills) }
    public func insert(_ skill: ContextSkill, scope: ContextScope) {
        synchronizeContext(scope)
        text = ContextMentions.replacingTrigger(in: text, with: ContextMentions.mention(skill))
        if !contextSkills.contains(where: { $0.name == skill.name }) { contextSkills.append(skill) }
    }
    public func removeContext(_ skill: ContextSkill) {
        text = ContextMentions.removing(skill, from: text); contextSkills.removeAll { $0.name == skill.name }
    }
    private func clearContext() {
        for skill in contextSkills { text = ContextMentions.removing(skill, from: text) }
        contextSkills = []
    }
    public func transfer(to other: ConversationDraft) {
        other.text = text; other.attachments = attachments; other.contextSkills = contextSkills; other.contextScope = contextScope
        text = ""; attachments = []; contextSkills = []
    }
    public func dismissFailure() { failure = nil; unsentText = nil; unsentAttachments = []; unsentSkills = []; unsentScope = nil }
}
