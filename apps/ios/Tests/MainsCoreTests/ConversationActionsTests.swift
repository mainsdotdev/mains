import Foundation
import Testing
@testable import MainsCore

@MainActor private final class ChatActionProbe {
    struct Call { let channel: String; let args: [JSONValue]; let commandID: String? }
    var calls: [Call] = []
    var failBefore: MainsError?
    var failAfter: MainsError?
    var holdAfter = false
    var release: CheckedContinuation<Void, Never>?
    var corruptReply = false
    var holdSnapshot = false
    var releaseSnapshot: CheckedContinuation<Void, Never>?
    var runOverrides: [String: [String: JSONValue]] = [:]
}

@MainActor private final class ChatActionTransport: BackendTransport {
    let base: DemoTransport
    let probe: ChatActionProbe
    var onEvent: ((String, JSONValue) -> Void)? { get { base.onEvent } set { base.onEvent = newValue } }
    var onDisconnect: ((MainsError) -> Void)? { get { base.onDisconnect } set { base.onDisconnect = newValue } }
    init(_ backend: DemoBackend, _ probe: ChatActionProbe) { base = DemoTransport(backend: backend); self.probe = probe }
    func open(endpoint: URL, token: String) throws { try base.open(endpoint: endpoint, token: token) }
    func close() { base.close() }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        let action = ["runs:archive", "runs:delete", "runs:moveToCollection"].contains(channel)
        if action {
            probe.calls.append(.init(channel: channel, args: args, commandID: commandId))
            if let error = probe.failBefore { probe.failBefore = nil; throw error }
        }
        var result = try await base.perform(channel, args: args, commandId: commandId, timeout: timeout)
        if channel == "runs:getAll", probe.holdSnapshot {
            probe.holdSnapshot = false
            await withCheckedContinuation { probe.releaseSnapshot = $0 }
        }
        if action {
            if probe.holdAfter { probe.holdAfter = false; await withCheckedContinuation { probe.release = $0 } }
            if let error = probe.failAfter { probe.failAfter = nil; throw error }
            if probe.corruptReply { probe.corruptReply = false; return .object(["id": .string("wrong-chat")]) }
        }
        func patch(_ row: JSONValue) -> JSONValue {
            guard let id = row["id"].string, let overrides = probe.runOverrides[id] else { return row }
            var fields = row.objectValue; fields.merge(overrides) { _, new in new }; return .object(fields)
        }
        if channel == "runs:getAll" { result = .array(result.array.map(patch)) }
        if channel == "runs:getById", result != .null { result = patch(result) }
        return result
    }
}

@Suite(.serialized) struct ConversationActionsTests {
    @MainActor private func setup(_ mode: String = "work") async throws -> (BackendSession, DemoBackend, ChatActionProbe, String) {
        let backend = try DemoBackend(stepDelay: .milliseconds(2), streamDelay: .milliseconds(1)), probe = ChatActionProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in ChatActionTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        try await eventually { session.isConnected }
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        try await session.setSpaceMode(mode, spaceID: "codex")
        let id = try await session.send("Chat to organize", spaceID: "codex", workspaceID: mode == "developer" ? backend.defaultWorkspaceID : nil)
        await session.selectConversation(id)
        try await eventually { session.pendingMessage == nil && session.conversations.first { $0.id == id }?.status == "succeeded" }
        return (session, backend, probe, id)
    }

    @Test(arguments: ["work", "chat"]) @MainActor func projectMovesKeepTheChatAndDraftAndUseAnExplicitNullToDetach(mode: String) async throws {
        let (session, backend, probe, id) = try await setup(mode)
        defer { session.exitDemo(); backend.shutdown() }
        let project = try #require(session.collections.first)
        let source = try #require(session.conversations.first { $0.id == id })
        let rows = session.transcript.rows
        let draft = session.draft(for: id); draft.text = "Keep my unfinished reply"
        try await session.manageConversation(id, action: .moveToProject(project.id))
        try await eventually { session.conversations.first { $0.id == id }?.collectionId == project.id }
        let moved = try #require(session.conversations.first { $0.id == id })
        #expect(moved.id == source.id && moved.mode == source.mode && moved.providerId == source.providerId && moved.workspaceId == source.workspaceId)
        #expect(session.viewingRunID == id && session.transcript.rows == rows && draft.text == "Keep my unfinished reply")
        try await session.manageConversation(id, action: .moveToProject(nil))
        try await eventually { session.conversations.first { $0.id == id }?.collectionId == nil }
        #expect(probe.calls.count == 2)
        #expect(probe.calls[0].args == [.object(["runId": .string(id), "accountId": .string("demo-account"), "collectionId": .string(project.id)])])
        #expect(probe.calls[1].args[0]["collectionId"] == .null)
        #expect(probe.calls.allSatisfy { $0.commandID?.isEmpty == false })
    }

    @Test(arguments: ["developer", "work", "chat"], [false, true]) @MainActor func retirementWorksInEveryModeOnlyAfterAcknowledgement(mode: String, deleting: Bool) async throws {
        let (session, backend, probe, id) = try await setup(mode)
        defer { session.exitDemo(); backend.shutdown() }
        let draft = session.draft(for: id); draft.text = "Unsent reply"
        probe.holdAfter = true
        let task = Task { try await session.manageConversation(id, action: deleting ? .delete : .archive) }
        try await eventually { probe.release != nil }
        #expect(session.pendingConversationAction?.status == .sending)
        #expect(session.retiredConversation == nil)
        #expect(!session.canManageConversation(id, action: .archive))
        await #expect(throws: MainsError.self) { try await session.send("Do not race retirement", runID: id) }
        probe.release?.resume(); probe.release = nil
        try await task.value
        #expect(session.pendingConversationAction == nil && session.retiredConversation?.runID == id)
        #expect(session.viewingRunID == nil && session.transcript.rows.isEmpty)
        #expect(!session.conversations.contains { $0.id == id })
        let canonical = try backend.invoke("runs:getById", args: [.string(id)])
        if deleting {
            #expect(canonical == .null && session.draft(for: id).text.isEmpty)
        } else {
            #expect(canonical["isArchived"] == .bool(true) && session.draft(for: id).text == "Unsent reply")
        }
        #expect(probe.calls.count == 1)
    }

    @Test(arguments: [ConversationAction.archive, .delete, .moveToProject(nil)]) @MainActor func lostRepliesRecoverTheOriginalCommandAfterReconnect(kind: ConversationAction) async throws {
        let (session, backend, probe, id) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        let action: ConversationAction = kind.retiresConversation ? kind : .moveToProject(try #require(session.collections.first).id)
        probe.failAfter = .timeout
        await #expect(throws: MainsError.self) { try await session.manageConversation(id, action: action) }
        let pending = try #require(session.pendingConversationAction)
        #expect(pending.status == .uncertain && session.retiredConversation == nil)
        await #expect(throws: MainsError.self) { try await session.manageConversation(id, action: action) }
        await #expect(throws: MainsError.self) { try await session.send("Do not replace an uncertain command", runID: id) }
        session.setActive(false); session.setActive(true)
        try await eventually { session.isConnected }
        try await session.checkConversationAction()
        #expect(session.pendingConversationAction == nil && probe.calls.count == 2)
        #expect(probe.calls[0].commandID == pending.id && probe.calls[1].commandID == pending.id)
        #expect(probe.calls[0].args == probe.calls[1].args)
    }

    @Test @MainActor func aRecoveredMoveReadsCurrentMetadataInsteadOfReplayingItsOldProject() async throws {
        let (session, backend, probe, id) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        let project = try #require(session.collections.first)
        probe.corruptReply = true
        await #expect(throws: MainsError.self) { try await session.manageConversation(id, action: .moveToProject(project.id)) }
        #expect(session.pendingConversationAction?.status == .uncertain)
        _ = try backend.invoke("runs:moveToCollection", args: [.object([
            "runId": .string(id), "accountId": .string("demo-account"), "collectionId": .null,
        ])], commandID: UUID().uuidString)
        try await session.checkConversationAction()
        await session.refresh()
        #expect(session.conversations.first { $0.id == id }?.collectionId == nil)
    }

    @Test @MainActor func replicaActiveOfflineAndDeveloperMovesRefuseBeforeSending() async throws {
        let (session, backend, probe, id) = try await setup("developer")
        defer { session.exitDemo(); backend.shutdown() }
        #expect(!session.canManageConversation(id, action: .moveToProject(nil)))
        await #expect(throws: MainsError.self) { try await session.manageConversation(id, action: .moveToProject(nil)) }
        probe.runOverrides[id] = ["isReplica": .bool(true)]
        await session.refresh()
        // refresh() can join an already scheduled snapshot read. Wait for the
        // requested metadata, rather than asserting against the previous row.
        try await eventually { session.conversations.first { $0.id == id }?.isReplica == true }
        #expect(!session.canManageConversation(id, action: .delete))
        probe.runOverrides[id] = ["status": .string("running")]
        await session.refresh()
        try await eventually { session.conversations.first { $0.id == id }?.status == "running" }
        #expect(!session.canManageConversation(id, action: .archive))
        probe.runOverrides = [:]; await session.refresh()
        try await eventually {
            session.conversations.contains { $0.id == id && $0.status == "succeeded" && $0.isReplica != true }
        }
        session.setActive(false)
        #expect(!session.canManageConversation(id, action: .delete))
        #expect(probe.calls.isEmpty)
    }

    @Test @MainActor func lateRetirementDoesNotLeaveAnotherViewedChatOrReplacementPairing() async throws {
        let (session, backend, probe, id) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        let other = try await session.send("Another chat", spaceID: "codex")
        await session.selectConversation(other)
        try await eventually { session.pendingMessage == nil && session.conversations.first { $0.id == other }?.status == "succeeded" }
        await session.selectConversation(id)
        probe.holdAfter = true
        let task = Task { try await session.manageConversation(id, action: .archive) }
        try await eventually { probe.release != nil }
        await session.selectConversation(other)
        let rows = session.transcript.rows
        probe.release?.resume(); probe.release = nil
        try await task.value
        #expect(session.viewingRunID == other && session.transcript.rows == rows)
        probe.holdAfter = true
        let deleting = Task { try await session.manageConversation(other, action: .delete) }
        try await eventually { probe.release != nil }
        session.exitDemo()
        probe.release?.resume(); probe.release = nil
        await #expect(throws: MainsError.self) { try await deleting.value }
        #expect(session.pendingConversationAction == nil && session.retiredConversation == nil && session.conversations.isEmpty)
    }

    @Test @MainActor func refusalKeepsTheChatAndDraftAndReleasesAdmission() async throws {
        let (session, backend, probe, id) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        session.draft(for: id).text = "Keep this"
        probe.failBefore = .server("Stop the active reply first")
        await #expect(throws: MainsError.self) { try await session.manageConversation(id, action: .delete) }
        #expect(session.pendingConversationAction == nil && session.retiredConversation == nil)
        #expect(session.conversations.contains { $0.id == id } && session.draft(for: id).text == "Keep this")
        #expect(session.canManageConversation(id, action: .delete))
    }

    @Test @MainActor func anOlderSnapshotCannotResurrectAConfirmedDeletionAndQueuedInputCannotRaceIt() async throws {
        let (session, backend, probe, id) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        let queue = session.messageQueue(for: id)
        queue.pause("Wait for manual resume")
        session.draft(for: id).text = "Queued input"
        try session.submitQueuedDraft(id)
        #expect(queue.messages.count == 1)
        probe.holdSnapshot = true
        let read = Task { await session.refresh() }
        try await eventually { probe.releaseSnapshot != nil }
        probe.holdAfter = true
        let deleting = Task { try await session.manageConversation(id, action: .delete) }
        try await eventually { probe.release != nil }
        await session.resumeMessageQueue(id)
        #expect(queue.messages.count == 1 && !queue.busy)
        probe.release?.resume(); probe.release = nil
        try await deleting.value
        probe.releaseSnapshot?.resume(); probe.releaseSnapshot = nil
        await read.value
        #expect(!session.conversations.contains { $0.id == id })
        #expect(session.existingMessageQueue(for: id) == nil && queue.messages.isEmpty)
    }
}
