import Foundation
import Testing
@testable import MainsCore

@Test func forksAnchorOnlyToTheLatestSettledResponse() {
    func row(_ id: String, _ kind: TranscriptRow.Kind, live: Bool = false) -> TranscriptRow {
        TranscriptRow(id: id, kind: kind, text: id, date: Date(), live: live, deferredArtifactID: nil)
    }
    let settled = [row("p1", .prompt), row("a1", .response), row("p2", .prompt), row("a2", .response)]
    #expect(TranscriptForkAnchor.rowID(in: settled, atLatest: true, active: false, hasLocalContinuation: false) == "a2")
    #expect(TranscriptForkAnchor.rowID(in: settled, atLatest: false, active: false, hasLocalContinuation: false) == nil)
    #expect(TranscriptForkAnchor.rowID(in: settled + [row("p3", .prompt), row("stream", .response, live: true)], atLatest: true, active: true, hasLocalContinuation: false) == "a2")
    #expect(TranscriptForkAnchor.rowID(in: settled, atLatest: true, active: true, hasLocalContinuation: true) == "a2")
    #expect(TranscriptForkAnchor.rowID(in: [row("stream", .response, live: true)], atLatest: true, active: true, hasLocalContinuation: false) == nil)
}

@MainActor private final class ForkProbe {
    struct Call { let args: [JSONValue]; let commandID: String? }
    var calls: [Call] = []
    var acceptedIDs: [String] = []
    var failBefore: MainsError?
    var failAfter: MainsError?
    var holdAfter = false
    var release: CheckedContinuation<Void, Never>?
    var corruptReply = false
}

@MainActor private final class ForkTransport: BackendTransport {
    let base: DemoTransport
    let probe: ForkProbe
    var onEvent: ((String, JSONValue) -> Void)? { get { base.onEvent } set { base.onEvent = newValue } }
    var onDisconnect: ((MainsError) -> Void)? { get { base.onDisconnect } set { base.onDisconnect = newValue } }
    init(_ backend: DemoBackend, _ probe: ForkProbe) { base = DemoTransport(backend: backend); self.probe = probe }
    func open(endpoint: URL, token: String) throws { try base.open(endpoint: endpoint, token: token) }
    func close() { base.close() }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        if channel == "runs:fork" {
            probe.calls.append(.init(args: args, commandID: commandId))
            if let error = probe.failBefore { probe.failBefore = nil; throw error }
        }
        let response = try await base.perform(channel, args: args, commandId: commandId, timeout: timeout)
        if channel == "runs:fork" {
            if let id = response["runId"].string { probe.acceptedIDs.append(id) }
            if probe.holdAfter { probe.holdAfter = false; await withCheckedContinuation { probe.release = $0 } }
            if let error = probe.failAfter { probe.failAfter = nil; throw error }
            if probe.corruptReply { probe.corruptReply = false; return .object(["runId": response["runId"], "sourceRunId": .string("wrong-source")]) }
        }
        return response
    }
}

@Suite(.serialized) struct ConversationForkTests {
    @MainActor private func setup() async throws -> (BackendSession, DemoBackend, ForkProbe, String) {
        let backend = try DemoBackend(stepDelay: .milliseconds(2), streamDelay: .milliseconds(1)), probe = ForkProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in ForkTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        try await eventually { session.isConnected }
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        let id = try await session.send("Source conversation", spaceID: "codex", workspaceID: backend.defaultWorkspaceID)
        await session.selectConversation(id)
        try await eventually { session.pendingMessage == nil && session.conversations.first { $0.id == id }?.status == "succeeded" }
        return (session, backend, probe, id)
    }

    @Test @MainActor func forkInheritsTheSourceWithoutConsumingItsDraftFilesHistoryOrQueue() async throws {
        let (session, backend, probe, sourceID) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        var settings = try #require(session.settings(forRunID: sourceID)); settings.model = "inherited-model"
        try await session.updateConversationSettings(settings, runID: sourceID)
        let source = try #require(session.conversations.first { $0.id == sourceID })
        let queue = session.messageQueue(for: sourceID), draft = session.draft(for: sourceID)
        queue.pause("Keep on the original conversation")
        draft.text = "Waiting on the source"; try session.submitQueuedDraft(sourceID)
        let queuedIDs = queue.messages.map(\.id)
        draft.text = "An unfinished draft"
        draft.attachments = [PromptAttachment(name: "notes.txt", type: "document", mimeType: "text/plain", bytes: Data("Notes".utf8))]
        let before = session.transcript.rows
        let id = try await session.forkConversation(sourceID)
        #expect(id != sourceID && session.pendingFork == nil && session.pendingMessage == nil)
        #expect(session.viewingRunID == sourceID && session.transcript.rows == before)
        #expect(draft.text == "An unfinished draft" && draft.attachments.count == 1 && queue.messages.map(\.id) == queuedIDs)
        let child = try #require(try await session.readQueuedRun(id))
        #expect(child.mode == source.mode && child.workspaceId == source.workspaceId && child.collectionId == source.collectionId)
        #expect(child.providerId == source.providerId && child.spaceId == source.spaceId)
        #expect(session.settings(forRunID: id) == settings)
        #expect(session.existingMessageQueue(for: id) == nil && !session.draft(for: id).hasContent)
        let call = try #require(probe.calls.first)
        #expect(call.commandID?.isEmpty == false)
        #expect(call.args == [.object(["sourceRunId": .string(sourceID), "accountId": .string("demo-account"), "message": .string("Continue from where this session left off.")])])
        await session.selectConversation(id)
        #expect(session.transcript.rows.contains { $0.kind == .prompt && $0.text == "Continue from where this session left off." })
    }

    @Test @MainActor func consentOfflineAndActiveOrReplicaRunsCannotStartAFork() async throws {
        let (session, backend, probe, id) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        session.revokeConsent(providerID: "codex", backendID: DemoBackend.backendID)
        await #expect(throws: MainsError.self) { try await session.forkConversation(id) }
        #expect(probe.calls.isEmpty && session.pendingFork == nil)
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        var source = try #require(session.conversations.first { $0.id == id })
        source.status = "running"; #expect(!source.canFork)
        source.status = "queued"; #expect(!source.canFork)
        let replica = Conversation(id: "replica", accountId: source.accountId, providerId: source.providerId, mode: "chat", spaceId: nil,
                                   title: nil, status: "succeeded", model: nil, isArchived: false, isReplica: true, lastError: nil, createdAt: Date(), updatedAt: Date())
        #expect(!replica.canFork)
        session.setActive(false)
        #expect(!session.canForkConversation(id))
        await #expect(throws: MainsError.self) { try await session.forkConversation(id) }
        #expect(probe.calls.isEmpty)
    }

    @Test @MainActor func duplicateTapsAndFreshMessagesAreBlockedWhileAForkIsInFlight() async throws {
        let (session, backend, probe, id) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        probe.holdAfter = true
        let first = Task { try await session.forkConversation(id) }
        try await eventually { probe.release != nil }
        #expect(session.pendingFork?.status == .sending && !session.canForkConversation(id))
        await #expect(throws: MainsError.self) { try await session.forkConversation(id) }
        await #expect(throws: MainsError.self) { try await session.send("Do not race the fork", runID: id) }
        probe.release?.resume(); probe.release = nil
        _ = try await first.value
        #expect(probe.calls.count == 1 && session.pendingFork == nil)
    }

    @Test(arguments: [false, true]) @MainActor func anUnknownOrMalformedReplyRecoversTheOriginalForkAfterReconnect(malformed: Bool) async throws {
        let (session, backend, probe, id) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        if malformed { probe.corruptReply = true } else { probe.failAfter = .timeout }
        await #expect(throws: MainsError.self) { try await session.forkConversation(id) }
        let original = try #require(session.pendingFork)
        #expect(original.status == .uncertain && session.pendingMessage == nil)
        await #expect(throws: MainsError.self) { try await session.forkConversation(id) }
        await #expect(throws: MainsError.self) { try await session.send("Never start a second command", runID: id) }
        session.setActive(false); session.setActive(true)
        try await eventually { session.isConnected }
        #expect(session.pendingFork?.id == original.id)
        let forkID = try await session.checkForkDelivery()
        #expect(session.pendingFork == nil && probe.calls.count == 2)
        #expect(probe.calls.allSatisfy { $0.commandID == original.id && $0.args == [original.payload] })
        #expect(probe.acceptedIDs == [forkID, forkID], "The demo receipt replays one child, even while it is already active.")
    }

    @Test @MainActor func aDefiniteForkRefusalLeavesTheSourceUsable() async throws {
        let (session, backend, probe, id) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        probe.failBefore = .server("Provider does not support session forking")
        await #expect(throws: MainsError.self) { try await session.forkConversation(id) }
        #expect(session.pendingFork == nil && session.canForkConversation(id))
        #expect(probe.acceptedIDs.isEmpty && session.viewingRunID == id)
    }

    @Test @MainActor func aRetiredPairingsLateForkAcknowledgementCannotChangeTheNewSession() async throws {
        let (session, backend, probe, id) = try await setup()
        defer { session.exitDemo(); backend.shutdown() }
        probe.holdAfter = true
        let task = Task { try await session.forkConversation(id) }
        try await eventually { probe.release != nil }
        session.exitDemo(); try session.startDemo()
        try await eventually { session.isConnected }
        await session.selectConversation(DemoBackend.tourID)
        let before = session.transcript.rows
        probe.release?.resume(); probe.release = nil
        await #expect(throws: MainsError.changedBackend) { try await task.value }
        #expect(session.pendingFork == nil && session.viewingRunID == DemoBackend.tourID && session.transcript.rows == before)
    }
}

extension SessionIntegrationTests {
    @Test @MainActor func forkUsesTheExistingWireContractAndReplaysOneChildAcrossLostReplies() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test-design&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        session.grantConsent(providerID: "codex", backendID: "ios-fixture")
        await session.selectConversation("fixture-run")
        let source = try #require(session.conversations.first { $0.id == "fixture-run" })
        let settings = try #require(session.settings(forRunID: source.id))
        let draft = session.draft(for: source.id); draft.text = "Keep writing on the original"
        func fault(_ behavior: String) async throws {
            var request = URLRequest(url: URL(string: endpoint + "/test/fork")!)
            request.httpMethod = "POST"
            request.httpBody = try JSONSerialization.data(withJSONObject: ["behavior": behavior])
            _ = try await URLSession.shared.data(for: request)
        }
        try await fault("unknown")
        await #expect(throws: MainsError.self) { try await session.forkConversation(source.id) }
        let pending = try #require(session.pendingFork)
        #expect(pending.status == .uncertain && session.viewingRunID == source.id)
        let firstID = try await session.checkForkDelivery()
        let child = try #require(try await session.readQueuedRun(firstID))
        #expect(child.mode == source.mode && child.providerId == source.providerId && child.spaceId == source.spaceId)
        #expect(child.workspaceId == source.workspaceId && child.collectionId == source.collectionId)
        #expect(session.settings(forRunID: firstID) == settings)
        #expect(!session.transcript.rows.contains { $0.text == "Continue from where this session left off." })
        await session.selectConversation(firstID)
        #expect(session.transcript.rows.filter { $0.kind == .prompt && $0.text == "Continue from where this session left off." }.count == 1)
        await session.selectConversation(source.id)
        try await fault("disconnect")
        let secondID = try await session.forkConversation(source.id)
        #expect(firstID != secondID && session.pendingFork == nil && draft.text == "Keep writing on the original")
        await session.refresh()
        #expect(session.conversations.count == 3, "Each original command creates exactly one fork.")
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data).filter { $0["channel"].string == "runs:fork" }
        #expect(calls.count == 4 && Set(calls.compactMap { $0["commandId"].string }).count == 2)
        #expect(calls.filter { $0["commandId"].string == pending.id }.count == 2)
        #expect(calls.allSatisfy { $0["args"].array == [pending.payload] })
    }
}
