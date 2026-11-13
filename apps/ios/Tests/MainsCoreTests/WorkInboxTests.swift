import Foundation
import Testing
@testable import MainsCore

private func inboxRun(_ id: String, status: String = "succeeded", age: TimeInterval = 0, replica: Bool = false, account: String = "account") -> Conversation {
    Conversation(id: id, accountId: account, providerId: "codex", mode: "chat", spaceId: nil,
                 title: id, status: status, model: nil, isArchived: false, isReplica: replica, lastError: nil,
                 createdAt: Date().addingTimeInterval(-age), updatedAt: Date().addingTimeInterval(-age))
}

private func inboxRequest(_ runID: String, expires: TimeInterval = 300) throws -> JSONValue {
    .object(["runId": .string(runID), "requestId": .string("request-" + runID), "kind": .string("ask_user"),
             "expiresAt": try .encode(Date().addingTimeInterval(expires)), "approvalToken": .object(["$undefined": .bool(true)]),
             "toolInput": .string("must-not-enter-inbox")])
}

@Suite struct WorkInboxTests {
    @Test @MainActor func oldPendingAndLiveWorkSurviveTheRecentHundredWithoutReadingHistory() async throws {
        let active = inboxRun("old-active", status: "running", age: 90 * 86_400)
        let waiting = inboxRun("old-waiting", age: 90 * 86_400)
        let ghost = inboxRun("stale-running-row", status: "running")
        let other = inboxRun("other-account", status: "running", account: "another")
        let recent = [ghost] + (0..<99).map { inboxRun("recent-\($0)") }
        var calls: [String] = []
        let snapshot = try await WorkInboxSnapshot.read(accountID: "account") { channel, args in
            calls.append(channel)
            switch channel {
            case "runs:listActive": return try .encode([active, other])
            case "runs:listPendingApprovals": return .array([try inboxRequest(waiting.id)])
            case "runs:getAll":
                #expect(args == [.number(100)])
                return try .encode(recent)
            case "runs:getById":
                #expect(args == [.string(waiting.id)])
                return try .encode(waiting)
            default: throw MainsError.invalidReply
            }
        }
        let groups = snapshot.groups(live: true)
        #expect(groups.needsYou.map(\.id) == [waiting.id])
        #expect(groups.running.map(\.id) == [active.id])
        #expect(snapshot.runs.count == 100 && snapshot.isLimited)
        #expect(!snapshot.runs.contains { $0.id == other.id })
        #expect(!calls.contains { $0.contains("History") || $0.contains("Artifact") })
        #expect(snapshot.requests.first?.approvalToken == nil)
    }

    @Test func requestsExpireAndOfflineViewsHaveNoActionableDecisions() throws {
        let now = Date(), waiting = inboxRun("waiting", status: "running")
        let runs = [waiting, inboxRun("failed", status: "failed"), inboxRun("finished"),
                    inboxRun("old-finished", age: 2 * 86_400), inboxRun("old-failed", status: "failed", age: 8 * 86_400),
                    inboxRun("replica", status: "running", replica: true)]
        let snapshot = WorkInboxSnapshot(runs: runs, activeIDs: Set(runs.filter(\.isActive).map(\.id)),
            requests: [try inboxRequest(waiting.id, expires: 1).decode(WorkInboxRequest.self)], updatedAt: now, isLimited: false)
        let live = snapshot.groups(now: now, live: true)
        #expect(live.needsYou.map(\.id) == [waiting.id] && live.running.isEmpty)
        #expect(live.failed.map(\.id) == ["failed"] && live.finished.map(\.id) == ["finished"])
        #expect(snapshot.groups(now: now.addingTimeInterval(2), live: true).needsYou.isEmpty)
        #expect(snapshot.groups(now: now, live: false).needsYou.isEmpty)
        #expect(snapshot.groups(now: now, live: false).running.map(\.id) == [waiting.id])
    }

    @Test @MainActor func inFlightDecisionResolutionCannotResurrectAWaitingRowOrMoveTheReader() async throws {
        let backend = try DemoBackend(), probe = InboxProbe(), storage = MemoryStorage()
        let session = BackendSession(storage: storage, makeTransport: { _ in InboxTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { probe.release(); session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let run = try #require(session.conversations.first)
        await session.selectConversation(run.id)
        let rowIDs = session.transcript.rows.map(\.id)
        session.setHistoryFollowing(false)
        probe.requests = [try inboxRequest(run.id)]
        probe.holdNextRecent = true
        session.setWorkInboxVisible(true)
        try await eventually { probe.held != nil }
        probe.requests = []
        probe.emit?("runs:toolApprovalResolved", .object(["runId": .string(run.id), "requestId": .string("request-" + run.id)]))
        probe.release()
        try await eventually { session.workInboxIsCurrent }
        #expect(session.workInbox.requests.isEmpty)
        #expect(session.viewingRunID == run.id && session.transcript.rows.map(\.id) == rowIDs)
        #expect(!session.transcript.isFollowing && storage.snapshot == nil)
        session.setWorkInboxVisible(false)
    }

    @Test @MainActor func aRetiredInboxReadCannotPopulateTheNewConnectionAndFailuresDisableActions() async throws {
        let backend = try DemoBackend(), probe = InboxProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in InboxTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { probe.release(); session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.requests = [try inboxRequest(try #require(session.conversations.first?.id))]
        probe.holdNextRecent = true
        let read = Task { await session.refreshWorkInbox() }
        try await eventually { probe.held != nil }
        session.setActive(false); session.setActive(true)
        try await eventually { session.isConnected }
        probe.release(); await read.value
        #expect(!session.workInboxIsCurrent && session.workInbox.updatedAt == nil && session.workInbox.requests.isEmpty)
        await session.refreshWorkInbox()
        #expect(session.workInboxIsCurrent && !session.workInbox.requests.isEmpty)
        probe.failActive = true
        await session.refreshWorkInbox()
        #expect(!session.workInboxIsCurrent && session.workInboxError != nil && session.workInbox.requests.isEmpty)
        #expect(!session.canStopInboxRun(try #require(session.conversations.first?.id)))
    }
}

@MainActor private final class InboxProbe {
    var requests: [JSONValue] = []
    var holdNextRecent = false
    var failActive = false
    var held: CheckedContinuation<Void, Never>?
    var emit: ((String, JSONValue) -> Void)?
    func release() { let continuation = held; held = nil; continuation?.resume() }
}

extension SessionIntegrationTests {
    @Test @MainActor func inboxReadsAndStopsOldBackgroundWorkThroughTheExistingDeviceProtocol() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setWorkInboxVisible(false); session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        var request = URLRequest(url: URL(string: endpoint + "/test/inbox")!)
        request.httpMethod = "POST"; request.httpBody = Data(#"{"older":true}"#.utf8)
        _ = try await URLSession.shared.data(for: request)
        await session.refresh()
        #expect(session.conversations.count == 100 && !session.conversations.contains { $0.id == "inbox-running" })
        session.setWorkInboxVisible(true)
        try await eventually { session.workInboxIsCurrent }
        let groups = session.workInbox.groups(live: true)
        #expect(groups.needsYou.map(\.id) == ["inbox-waiting"])
        #expect(groups.running.map(\.id) == ["inbox-running"])
        #expect(session.workInbox.runs.count <= 100 && session.canStopInboxRun("inbox-running"))
        #expect(session.viewingRunID == nil && session.transcript.rows.isEmpty)
        try await session.stop("inbox-running")
        try await eventually { !session.workInbox.activeIDs.contains("inbox-running") }
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data)
        let stops = calls.filter { $0["channel"].string == "runs:abort" }
        #expect(stops.count == 1 && stops[0]["args"].array == [.string("inbox-running")])
        #expect(stops[0]["commandId"].string?.isEmpty == false)
        #expect(!calls.contains { $0["channel"].string == "runs:getHistory" })
    }
}

@MainActor private final class InboxTransport: BackendTransport {
    let base: DemoTransport
    let probe: InboxProbe
    init(_ backend: DemoBackend, _ probe: InboxProbe) { base = DemoTransport(backend: backend); self.probe = probe }
    var onEvent: ((String, JSONValue) -> Void)? {
        get { base.onEvent }
        set { base.onEvent = newValue; probe.emit = newValue }
    }
    var onDisconnect: ((MainsError) -> Void)? { get { base.onDisconnect } set { base.onDisconnect = newValue } }
    func open(endpoint: URL, token: String) throws { try base.open(endpoint: endpoint, token: token) }
    func close() { base.close() }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        if channel == "runs:listActive", probe.failActive { throw MainsError.server("Activity unavailable") }
        if channel == "runs:listPendingApprovals" && args.isEmpty { return .array(probe.requests) }
        let value = try await base.perform(channel, args: args, commandId: commandId, timeout: timeout)
        if channel == "runs:getAll", probe.holdNextRecent {
            probe.holdNextRecent = false
            await withCheckedContinuation { probe.held = $0 }
        }
        return value
    }
}
