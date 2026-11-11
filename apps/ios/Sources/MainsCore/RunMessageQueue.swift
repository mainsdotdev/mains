import Foundation
import Observation

public enum MessageDelivery: String, Sendable { case queue, steer }

public struct QueuedRunMessage: Identifiable, Sendable {
    public enum Status: Sendable { case queued, editing, sending, unknown, error }
    public let id: String
    public var input: ConversationDraft.Submission
    public var settings: ComposerSettings
    public var status: Status = .queued
    public var error: String?
    public var delivery: MessageDelivery?
    public var preview: String {
        let text = ContextMentions.display(input.text, skills: input.contextSkills).trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { return text }
        if input.attachments.count == 1 { return input.attachments[0].name }
        return "\(input.attachments.count) \(input.attachments.allSatisfy { $0.type == "image" } ? "images" : "attachments")"
    }
}

/// Phone-owned queue, scoped to one pairing and conversation. Nothing here enters the disk cache.
@MainActor @Observable
public final class ConversationQueue {
    public let runID: String
    public internal(set) var messages: [QueuedRunMessage] = []
    public internal(set) var pauseReason: String?
    public internal(set) var editingID: String?
    public internal(set) var editingSettings: ComposerSettings?
    public internal(set) var runStatus = "running"
    var backup: ConversationDraft.Submission?
    var revision = 0
    var resumeRequested = false
    var retired = false
    var deferredUntil: ContinuousClock.Instant?
    public var busy: Bool { messages.contains { $0.status == .sending } }
    public var hasUnknown: Bool { messages.contains { $0.status == .unknown } }
    public var canReorder: Bool { messages.count > 1 && !busy && !hasUnknown && editingID == nil }
    init(runID: String) { self.runID = runID }
    public func reorder(_ ids: [String]) {
        guard canReorder, ids.count == messages.count, Set(ids) == Set(messages.map(\.id)) else { return }
        let lookup = Dictionary(uniqueKeysWithValues: messages.map { ($0.id, $0) })
        messages = ids.compactMap { lookup[$0] }
    }
    func pause(_ reason: String) { revision += 1; pauseReason = reason; resumeRequested = false }
    func observe(_ status: String) {
        runStatus = status
        if ["failed", "canceled"].contains(status), !messages.isEmpty, !resumeRequested {
            pause(status == "canceled" ? "Run stopped. Queued messages are paused." : "Run failed. Queued messages are paused.")
        }
    }
    func retire() {
        retired = true; revision += 1; messages = []; backup = nil; editingID = nil; editingSettings = nil
    }
}

/// One session consumer, independent of mounted screens. Only confirmed terminal runs release FIFO input.
@MainActor
final class RunQueueController {
    private weak var session: BackendSession?
    private var queues: [String: ConversationQueue] = [:]
    private var pumpTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?
    private var locks: Set<String> = []
    private var pumpID: UUID?
    init(session: BackendSession) { self.session = session }
    func existing(_ id: String) -> ConversationQueue? { queues[id] }
    func queue(_ id: String) -> ConversationQueue {
        if let value = queues[id] { return value }
        let value = ConversationQueue(runID: id); queues[id] = value; return value
    }
    func clear() {
        pumpTask?.cancel(); pumpTask = nil; pollTask?.cancel(); pollTask = nil
        pumpID = nil
        queues.values.forEach { $0.retire() }; queues = [:]; locks = []
    }
    func pauseAll(_ reason: String) {
        for queue in queues.values where !queue.messages.isEmpty { queue.pause(reason) }
        pollTask?.cancel(); pollTask = nil
    }
    func observe(_ id: String, status: String) { queues[id]?.observe(status); kick() }
    func submit(_ id: String, draft: ConversationDraft) throws {
        guard let session, let run = session.conversations.first(where: { $0.id == id }), run.supportsSteering,
              run.isReplica != true, !run.isArchived else { throw MainsError.server("This conversation cannot queue messages.") }
        let queue = queue(id)
        if !session.isConnected, queue.pauseReason == nil { queue.pause("Backend disconnected. Queued messages are paused.") }
        let all = queues.values.flatMap(\.messages).filter { $0.id != queue.editingID }
        let input = draft.snapshot()
        let bytes = all.reduce(0) { $0 + $1.input.text.utf8.count + $1.input.attachments.reduce(0) { $0 + $1.data.utf8.count } }
        guard all.count < 32 || queue.editingID != nil,
              bytes + input.text.utf8.count + input.attachments.reduce(0, { $0 + $1.data.utf8.count }) <= 32 * 1024 * 1024 else {
            throw MainsError.server("The phone's message queue is full. Send or remove a queued message first.")
        }
        guard let settings = queue.editingSettings ?? session.settings(forRunID: id), let submission = draft.begin() else { return }
        if let editingID = queue.editingID, let index = queue.messages.firstIndex(where: { $0.id == editingID }) {
            queue.messages[index] = QueuedRunMessage(id: editingID, input: submission, settings: settings)
            draft.accept(submission)
            finishEdit(queue, draft: draft)
        } else {
            queue.runStatus = run.status
            let message = QueuedRunMessage(id: UUID().uuidString, input: submission, settings: settings)
            queue.messages.append(message); draft.accept(submission)
        }
        kick()
    }
    func edit(_ runID: String, id: String) {
        guard let session, let queue = queues[runID], queue.editingID == nil,
              let index = queue.messages.firstIndex(where: { $0.id == id }),
              [.queued, .error].contains(queue.messages[index].status) else { return }
        let draft = session.draft(for: runID)
        guard !draft.isSending else { return }
        queue.backup = draft.snapshot(); queue.editingID = id
        draft.persistencePaused = true
        queue.messages[index].status = .editing; queue.editingSettings = queue.messages[index].settings
        draft.restore(queue.messages[index].input)
    }
    func cancelEdit(_ runID: String) {
        guard let session, let queue = queues[runID], let id = queue.editingID else { return }
        if let index = queue.messages.firstIndex(where: { $0.id == id }) { queue.messages[index].status = .queued }
        finishEdit(queue, draft: session.draft(for: runID)); kick()
    }
    private func finishEdit(_ queue: ConversationQueue, draft: ConversationDraft) {
        if let backup = queue.backup { draft.restore(backup) }
        queue.backup = nil; queue.editingID = nil; queue.editingSettings = nil
        draft.resumePersistence()
    }
    func remove(_ runID: String, id: String) {
        guard let queue = queues[runID] else { return }
        queue.messages.removeAll { $0.id == id && ![.sending, .editing].contains($0.status) }
        kick()
    }
    func steer(_ runID: String, id: String) async {
        guard let queue = queues[runID] else { return }
        await send(queue, id: id, delivery: .steer)
        kick()
    }
    func resume(_ runID: String) async {
        guard let session, session.isConnected, let queue = queues[runID], !queue.busy, !locks.contains(runID) else { return }
        let owner = session.ownership
        locks.insert(runID)
        defer { if owner == session.ownership { locks.remove(runID) } }
        if queue.hasUnknown {
            for message in queue.messages where message.status == .unknown {
                do {
                    guard try await session.checkQueuedInput(message.id) else { return }
                    guard owner == session.ownership, !queue.retired else { return }
                    queue.messages.removeAll { $0.id == message.id }
                } catch {
                    guard owner == session.ownership, !queue.retired else { return }
                    if session.pendingMessage == nil, let index = queue.messages.firstIndex(where: { $0.id == message.id }) {
                        queue.messages[index].status = .error; queue.messages[index].error = error.localizedDescription
                        queue.pause(error.localizedDescription)
                    }
                    return
                }
            }
        }
        guard owner == session.ownership, !queue.retired, !queue.hasUnknown else { return }
        queue.pauseReason = nil; queue.resumeRequested = true
        for index in queue.messages.indices where queue.messages[index].status == .error {
            queue.messages[index].status = .queued; queue.messages[index].error = nil
        }
        kick()
    }
    func kick() {
        guard pumpTask == nil, let session, session.isConnected else { return }
        let ticket = UUID(); pumpID = ticket
        pumpTask = Task { [weak self] in
            guard let self else { return }
            for queue in self.queues.values.sorted(by: { $0.runID < $1.runID }) where queue.pauseReason == nil {
                guard let message = queue.messages.first, message.status == .queued else { continue }
                await self.send(queue, id: message.id, delivery: .queue)
            }
            guard self.pumpID == ticket else { return }
            self.pumpTask = nil; self.pumpID = nil
            self.armPoll()
        }
    }
    private func armPoll() {
        guard pollTask == nil, session?.isConnected == true, queues.values.contains(where: { !$0.messages.isEmpty && $0.pauseReason == nil }) else { return }
        pollTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(10)) } catch { return }
            self?.pollTask = nil; self?.kick()
        }
    }
    private func send(_ queue: ConversationQueue, id: String, delivery: MessageDelivery) async {
        guard let session, session.isConnected, !session.sending, session.pendingMessage == nil, session.pendingFork == nil,
              !queue.retired, !queue.busy, !locks.contains(queue.runID),
              delivery == .steer || queue.pauseReason == nil,
              delivery == .steer || (queue.deferredUntil.map { ContinuousClock.now >= $0 } ?? true),
              !session.savingConversationSettings.contains(queue.runID), !session.uncertainConversationSettings.contains(queue.runID),
              let entry = queue.messages.first(where: { $0.id == id }), entry.status == .queued else { return }
        let owner = session.ownership, revision = queue.revision
        locks.insert(queue.runID)
        defer { if owner == session.ownership { locks.remove(queue.runID) } }
        var admittedID = id
        do {
            if delivery == .queue {
                guard let run = try await session.readQueuedRun(queue.runID) else {
                    guard owner == session.ownership, !queue.retired else { return }
                    queue.retire(); queues[queue.runID] = nil; return
                }
                guard owner == session.ownership, !queue.retired, queue.revision == revision else { return }
                queue.observe(run.status)
                guard !run.isArchived, run.isReplica != true else { queue.pause("This conversation is archived or read-only."); return }
                guard run.status == "succeeded" || queue.resumeRequested && ["failed", "canceled"].contains(run.status) else { return }
                // Editing/removal/reordering during the read changes the FIFO head.
                guard let head = queue.messages.first, head.status == .queued, queue.pauseReason == nil else { return }
                admittedID = head.id
            }
            guard owner == session.ownership, !queue.retired, queue.revision == revision, session.isConnected, !session.sending, session.pendingMessage == nil, session.pendingFork == nil,
                  let index = queue.messages.firstIndex(where: { $0.id == admittedID }), queue.messages[index].status == .queued else { return }
            let message = queue.messages[index]
            queue.messages[index].status = .sending; queue.messages[index].delivery = delivery; queue.messages[index].error = nil
            queue.resumeRequested = false
            if delivery == .queue { queue.runStatus = "running" }
            _ = try await session.send(message.input.text, runID: queue.runID, settings: message.settings,
                                       attachments: message.input.attachments, contextSkills: message.input.contextSkills,
                                       contextScope: message.input.contextScope, steering: delivery == .steer, queuedInputID: message.id)
            guard owner == session.ownership, !queue.retired else { return }
            queue.messages.removeAll { $0.id == message.id }
        } catch {
            guard owner == session.ownership, !queue.retired, let index = queue.messages.firstIndex(where: { $0.id == admittedID }) else { return }
            if delivery == .queue, let failure = error as? MainsError, failure.isResponseBusy {
                queue.messages[index].status = .queued
                queue.deferredUntil = .now + .seconds(1)
                // Let the previous execution finish closing before retrying its successor.
                Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(1)) } catch { return }
                    guard owner == session.ownership else { return }; self?.kick()
                }
            } else {
                queue.messages[index].status = session.pendingMessage?.status == .uncertain ? .unknown : .error
                let reason = delivery == .steer && error as? MainsError == .steerTurnEnded
                    ? "The active turn ended. The message stays queued." : error.localizedDescription
                queue.messages[index].error = reason
                queue.pause(queue.messages[index].status == .unknown ? "Delivery could not be confirmed. Check before sending again." : reason)
            }
        }
    }
}
