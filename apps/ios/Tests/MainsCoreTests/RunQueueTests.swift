import Foundation
import Testing
@testable import MainsCore

@MainActor private final class QueueProbe {
    struct Call { let channel: String; let args: [JSONValue]; let commandID: String? }
    var calls: [Call] = []
    var loseNextACK = false
    var busyOnce = false
    var holdRead = false
    var readRelease: CheckedContinuation<Void, Never>?
    var queueSnapshot: JSONValue?
    var holdQueueRead = false
    var queueRelease: CheckedContinuation<Void, Never>?
    var completedQueueReads = 0
    var event: ((String, JSONValue) -> Void)?
    var sent: [Call] { calls.filter { ["runs:continue", "runs:steer"].contains($0.channel) && $0.args[0]["clientUserMessageId"].string != nil } }
}

@MainActor private final class QueueTransport: BackendTransport {
    let base: DemoTransport
    let probe: QueueProbe
    var onEvent: ((String, JSONValue) -> Void)? { get { base.onEvent } set { base.onEvent = newValue } }
    var onDisconnect: ((MainsError) -> Void)? { get { base.onDisconnect } set { base.onDisconnect = newValue } }
    init(_ backend: DemoBackend, _ probe: QueueProbe) {
        let demo = DemoTransport(backend: backend)
        base = demo; self.probe = probe
        probe.event = { [weak demo] channel, payload in demo?.onEvent?(channel, payload) }
    }
    func open(endpoint: URL, token: String) throws { try base.open(endpoint: endpoint, token: token) }
    func close() { base.close() }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        probe.calls.append(.init(channel: channel, args: args, commandID: commandId))
        if channel == "runs:getQueue", let snapshot = probe.queueSnapshot {
            if probe.holdQueueRead {
                probe.holdQueueRead = false
                await withCheckedContinuation { probe.queueRelease = $0 }
            }
            probe.completedQueueReads += 1
            return snapshot
        }
        if channel == "runs:continue", args[0]["clientUserMessageId"].string != nil, probe.busyOnce {
            probe.busyOnce = false; throw MainsError.server("This conversation already has an active response.")
        }
        let value = try await base.perform(channel, args: args, commandId: commandId, timeout: timeout)
        if channel == "runs:getById", probe.holdRead {
            probe.holdRead = false
            await withCheckedContinuation { probe.readRelease = $0 }
        }
        if ["runs:continue", "runs:steer"].contains(channel), args[0]["clientUserMessageId"].string != nil, probe.loseNextACK {
            probe.loseNextACK = false; throw MainsError.timeout
        }
        return value
    }
}

@Suite(.serialized) struct RunQueueTests {
    @Test @MainActor func retiredDesktopQueueReadsCannotLeakAcrossConversationsAndExpiredQueuesDisappear() async throws {
        let (session, backend, probe, id) = try await setup(slow: true)
        defer { session.exitDemo(); backend.shutdown() }
        func snapshot(_ runID: String, expires: Double = Date().timeIntervalSince1970 * 1000 + 60_000) -> JSONValue {
            .object(["queues": .array([.object(["runId": .string(runID), "producerId": .string("desktop"), "revision": .number(1), "expiresAt": .number(expires),
                "messages": .array([.object(["id": .string("waiting"), "text": .string(runID), "attachmentNames": .array([]), "status": .string("queued")])])])])])
        }
        probe.queueSnapshot = snapshot(DemoBackend.tourID); probe.holdQueueRead = true
        await session.selectConversation(DemoBackend.tourID)
        try await eventually { probe.queueRelease != nil }
        probe.queueSnapshot = snapshot(id)
        await session.selectConversation(id)
        try await eventually { session.remoteQueues.first?.runId == id }
        let completed = probe.completedQueueReads
        probe.queueRelease?.resume(); probe.queueRelease = nil
        try await eventually { probe.completedQueueReads > completed }
        #expect(session.remoteQueues.first?.runId == id)
        #expect(session.messageQueue(for: id).messages.isEmpty && probe.sent.isEmpty)
        probe.queueSnapshot = snapshot(id, expires: 1)
        probe.event?("runs:queueChanged", .object(["runId": .string(id)]))
        try await eventually { session.remoteQueues.isEmpty }
        probe.queueSnapshot = snapshot(id)
        probe.event?("runs:queueChanged", .object(["runId": .string(id)]))
        try await eventually { !session.remoteQueues.isEmpty }
        session.setActive(false)
        #expect(session.remoteQueues.isEmpty)
    }

    @MainActor private func setup(slow: Bool = false) async throws -> (BackendSession, DemoBackend, QueueProbe, String) {
        let backend = try DemoBackend(stepDelay: slow ? .seconds(30) : .milliseconds(2), streamDelay: .milliseconds(1))
        let probe = QueueProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in QueueTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        try await eventually { session.isConnected }
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        let id = try await session.send("Initial review", spaceID: "codex", workspaceID: backend.defaultWorkspaceID)
        await session.selectConversation(id)
        try await eventually { session.pendingMessage == nil }
        return (session, backend, probe, id)
    }

    @Test @MainActor func queueIsDefaultAndDeliversFIFOAcrossConversationNavigationWithFrozenSettingsAndFiles() async throws {
        let (session, backend, probe, id) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        let queue = session.messageQueue(for: id), draft = session.draft(for: id)
        let scope = session.contextScope(providerID: "codex", workspaceID: backend.defaultWorkspaceID)
        let skill = ContextSkill(name: "review", displayName: "Review")
        draft.insert(skill, scope: scope)
        let frozen = try #require(session.settings(forRunID: id))
        try session.submitQueuedDraft(id)
        let firstID = try #require(queue.messages.first?.id)
        let file = PromptAttachment(name: "readme.pdf", type: "document", mimeType: "application/pdf", bytes: DemoFile.pdf.bytes)
        draft.attachments = [file]; try session.submitQueuedDraft(id)
        let secondID = try #require(queue.messages.last?.id)
        #expect(!draft.hasContent && probe.sent.isEmpty)
        var newer = frozen; newer.model = "another-model"
        try await session.updateConversationSettings(newer, runID: id)
        session.leaveConversation(id)
        await session.selectConversation(DemoBackend.tourID)
        try await eventually { queue.messages.isEmpty }
        #expect(probe.sent.map { $0.args[0]["clientUserMessageId"].string } == [firstID, secondID])
        #expect(probe.sent.allSatisfy { $0.channel == "runs:continue" && $0.args[0]["runId"].string == id })
        #expect(probe.sent[0].args[0]["conversationSettings"] == (try .encode(frozen)))
        #expect(probe.sent[0].args[0]["message"].string == "$review")
        #expect(probe.sent[1].args[0]["message"].string == "")
        #expect(probe.sent[1].args[0]["attachments"].array == [try .encode(file)])
        #expect(session.viewingRunID == DemoBackend.tourID)
    }

    @Test @MainActor func queuedMessagesSupportReorderingEditingCancelAndSavingWithoutLosingTheNewerDraft() async throws {
        let (session, backend, _, id) = try await setup(slow: true)
        defer { session.exitDemo(); backend.shutdown() }
        let queue = session.messageQueue(for: id), draft = session.draft(for: id)
        queue.pause("Hold for editing")
        draft.text = "First"; try session.submitQueuedDraft(id)
        draft.text = "Second"; try session.submitQueuedDraft(id)
        let ids = queue.messages.map(\.id)
        queue.reorder(Array(ids.reversed()))
        #expect(queue.messages.map(\.id) == Array(ids.reversed()))
        queue.reorder([ids[0], ids[0]])
        #expect(queue.messages.map(\.id) == Array(ids.reversed()))
        let photo = PromptAttachment(name: "new.png", type: "image", mimeType: "image/png", bytes: Data([1]))
        draft.text = "Unsent draft"; draft.attachments = [photo]
        session.editQueuedMessage(id, id: ids[0])
        #expect(queue.editingID == ids[0] && draft.text == "First" && draft.attachments.isEmpty)
        draft.text = "Discard this edit"
        session.cancelQueuedEdit(id)
        #expect(draft.text == "Unsent draft" && draft.attachments == [photo])
        #expect(queue.messages.last?.input.text == "First")
        session.editQueuedMessage(id, id: ids[0])
        draft.text = "Saved edit"
        queue.editingSettings?.model = "edited-model"
        try session.submitQueuedDraft(id)
        #expect(queue.editingID == nil && queue.messages.last?.input.text == "Saved edit")
        #expect(queue.messages.last?.settings.model == "edited-model")
        #expect(draft.text == "Unsent draft" && draft.attachments == [photo])
        session.removeQueuedMessage(id, id: ids[1])
        #expect(queue.messages.map(\.id) == [ids[0]])
    }

    @Test @MainActor func onlyExplicitPerMessageSteerBypassesTheQueue() async throws {
        let (session, backend, probe, id) = try await setup(slow: true)
        defer { session.exitDemo(); backend.shutdown() }
        let queue = session.messageQueue(for: id), draft = session.draft(for: id)
        draft.text = "Wait for later"; try session.submitQueuedDraft(id)
        let waitingID = try #require(queue.messages.first?.id)
        draft.text = "Send this now"; try session.submitQueuedDraft(id)
        let steerID = try #require(queue.messages.last?.id)
        await session.steerQueuedMessage(id, id: steerID)
        #expect(probe.sent.count == 1 && probe.sent[0].channel == "runs:steer")
        #expect(probe.sent[0].args[0]["clientUserMessageId"].string == steerID)
        #expect(queue.messages.map(\.id) == [waitingID])
        draft.text = "Also wait"; try session.submitQueuedDraft(id)
        #expect(queue.messages.count == 2 && probe.sent.count == 1)
    }

    @Test @MainActor func stopAndDisconnectPauseUntilAnExplicitResume() async throws {
        let (session, backend, probe, id) = try await setup(slow: true)
        defer { session.exitDemo(); backend.shutdown() }
        let queue = session.messageQueue(for: id), draft = session.draft(for: id)
        draft.text = "Queued after stop"; try session.submitQueuedDraft(id)
        try await session.stop(id)
        #expect(queue.pauseReason != nil && probe.sent.isEmpty)
        session.setActive(false); session.setActive(true)
        try await eventually { session.isConnected }
        #expect(queue.pauseReason != nil && probe.sent.isEmpty)
        await session.resumeMessageQueue(id)
        try await eventually { queue.messages.isEmpty }
        #expect(probe.sent.count == 1 && probe.sent[0].channel == "runs:continue")
    }

    @Test @MainActor func uncertainDeliveryChecksTheOriginalInputAndNeverAutomaticallyResendsIt() async throws {
        let (session, backend, probe, id) = try await setup(slow: true)
        defer { session.exitDemo(); backend.shutdown() }
        let queue = session.messageQueue(for: id), draft = session.draft(for: id)
        probe.loseNextACK = true
        draft.text = "Unconfirmed steer"; try session.submitQueuedDraft(id)
        await session.steerQueuedMessage(id, id: try #require(queue.messages.last?.id))
        try await eventually { queue.hasUnknown }
        let original = try #require(queue.messages.first)
        #expect(probe.sent.count == 1 && session.pendingMessage?.status == .uncertain)
        await session.loadHistory(direction: "refresh")
        #expect(queue.hasUnknown && session.pendingMessage?.queueInputID == original.id)
        draft.text = "A later message"; try session.submitQueuedDraft(id)
        #expect(queue.messages.count == 2 && probe.sent.count == 1)
        await session.resumeMessageQueue(id)
        #expect(!queue.hasUnknown && session.pendingMessage == nil && probe.sent.count == 1)
        let check = try #require(probe.calls.last { $0.channel == "runs:inputStatus" })
        #expect(check.args[0]["clientUserMessageId"].string == original.id)
        #expect(check.args[0]["input"]["message"].string == original.input.text)
    }

    @Test @MainActor func retiredPreflightCannotSendToAReplacementPairingOrConsumeItsQueue() async throws {
        let (session, backend, probe, id) = try await setup(slow: true)
        defer { session.exitDemo(); backend.shutdown() }
        let queue = session.messageQueue(for: id), draft = session.draft(for: id)
        probe.holdRead = true
        draft.text = "Never cross pairings"; try session.submitQueuedDraft(id)
        try await eventually { probe.readRelease != nil }
        session.exitDemo(); try session.startDemo()
        try await eventually { session.isConnected }
        probe.readRelease?.resume(); probe.readRelease = nil
        await session.refresh()
        #expect(queue.messages.isEmpty && probe.sent.isEmpty)
    }

    @Test @MainActor func removingAnUnknownRowRetainsItsOriginalReceiptAndBlocksFreshDelivery() async throws {
        let (session, backend, probe, id) = try await setup(slow: true)
        defer { session.exitDemo(); backend.shutdown() }
        let queue = session.messageQueue(for: id), draft = session.draft(for: id)
        probe.loseNextACK = true
        draft.text = "Keep the receipt"; try session.submitQueuedDraft(id)
        await session.steerQueuedMessage(id, id: try #require(queue.messages.last?.id))
        try await eventually { queue.hasUnknown }
        let originalID = try #require(queue.messages.first?.id)
        session.removeQueuedMessage(id, id: originalID)
        #expect(queue.messages.isEmpty && session.pendingMessage?.queueInputID == originalID)
        await #expect(throws: MainsError.self) { try await session.send("Do not send twice", runID: id, steering: true) }
        #expect(try await session.checkQueuedInput(originalID))
        #expect(session.pendingMessage == nil && probe.sent.count == 1)
    }

    @Test @MainActor func aClosingResponseDefersTheSameFIFOInputWithoutPausingOrSpinning() async throws {
        let (session, backend, probe, id) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.conversations.first { $0.id == id }?.status == "succeeded" }
        probe.busyOnce = true
        let queue = session.messageQueue(for: id), draft = session.draft(for: id)
        draft.text = "After the previous response closes"; try session.submitQueuedDraft(id)
        try await eventually { probe.sent.count == 1 && queue.messages.first?.status == .queued }
        #expect(queue.pauseReason == nil)
        try await eventually { queue.messages.isEmpty }
        #expect(probe.sent.count == 2)
        #expect(probe.sent.first?.args == probe.sent.last?.args)
    }
}
