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
        public let retainsContent: Bool
    }
    public var text = "" { didSet { if text != oldValue { persistVisibleText() } } }
    public internal(set) var storageError: String?
    @ObservationIgnored var textChanged: ((String) -> Void)?
    @ObservationIgnored var persistencePaused = false
    func resumePersistence() { persistencePaused = false; persistVisibleText() }
    private func persistVisibleText() {
        guard !persistencePaused else { return }
        let inFlight = submission.map { $0.retainsContent && stillContains($0) } ?? false
        textChanged?(inFlight ? "" : text)
    }
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
    public var hasContent: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty }
    public init() {}

    public func snapshot() -> Submission {
        Submission(text: text, attachments: attachments, contextSkills: ContextMentions.attached(in: text, skills: contextSkills), contextScope: contextScope, retainsContent: false)
    }
    public func restore(_ snapshot: Submission) {
        text = snapshot.text; attachments = snapshot.attachments; contextSkills = snapshot.contextSkills
        if let contextScope, contextScope != snapshot.contextScope { clearContext() }
        else { contextScope = snapshot.contextScope }
    }

    public func begin(retainingContent: Bool = false) -> Submission? {
        guard submission == nil, hasContent else { return nil }
        let next = Submission(text: text, attachments: attachments, contextSkills: ContextMentions.attached(in: text, skills: contextSkills), contextScope: contextScope, retainsContent: retainingContent)
        if !retainingContent { clearContent() }
        failure = nil; unsentText = nil; unsentAttachments = []; unsentSkills = []; unsentScope = nil
        submission = next
        persistVisibleText()
        return next
    }
    public func accept(_ sent: Submission) {
        guard submission?.id == sent.id else { return }
        defer { persistVisibleText() }
        if sent.retainsContent && stillContains(sent) { clearContent() }
        submission = nil
    }
    public func reject(_ sent: Submission, message: String, uncertain: Bool) {
        guard submission?.id == sent.id else { return }
        defer { persistVisibleText() }
        submission = nil
        failure = message
        failureTitle = "Couldn't send"
        // An unconfirmed prompt belongs to the receipt UI, never back in a fresh send.
        if uncertain {
            if sent.retainsContent && stillContains(sent) { clearContent() }
            return
        }
        if sent.retainsContent && stillContains(sent) { return }
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
        self.unsentText = currentText.isEmpty && currentAttachments.isEmpty ? nil : currentText; unsentAttachments = currentAttachments; unsentSkills = currentSkills; unsentScope = currentScope
    }
    public func synchronizeContext(_ scope: ContextScope) {
        if let contextScope, contextScope != scope { clearContext() }
        contextScope = scope
    }
    private func stillContains(_ sent: Submission) -> Bool {
        text == sent.text && attachments == sent.attachments && contextScope == sent.contextScope &&
            ContextMentions.attached(in: text, skills: contextSkills) == sent.contextSkills
    }
    private func clearContent() { text = ""; attachments = []; contextSkills = [] }
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
