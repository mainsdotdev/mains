import Foundation

/// Only the identity and expiry of a decision enter the inbox. Its evidence,
/// answers and forms are loaded by the existing conversation decision reader.
public struct WorkInboxRequest: Decodable, Sendable {
    public let requestId: String
    public let runId: String
    public let kind: String
    public let expiresAt: Date
    public var approvalToken: String?

    private enum CodingKeys: String, CodingKey { case requestId, runId, kind, expiresAt, approvalToken }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        requestId = try c.decode(String.self, forKey: .requestId)
        runId = try c.decode(String.self, forKey: .runId)
        kind = try c.decode(String.self, forKey: .kind)
        expiresAt = try c.decode(Date.self, forKey: .expiresAt)
        approvalToken = try c.decodeWireIfPresent(String.self, forKey: .approvalToken)
    }
}

public struct WorkInboxItem: Identifiable, Sendable {
    public let run: Conversation
    public let requestCount: Int
    public let hasQuestion: Bool
    public var id: String { run.id }
}

public struct WorkInboxGroups: Sendable {
    public var needsYou: [WorkInboxItem] = []
    public var running: [WorkInboxItem] = []
    public var failed: [WorkInboxItem] = []
    public var finished: [WorkInboxItem] = []
    public var isEmpty: Bool { needsYou.isEmpty && running.isEmpty && failed.isEmpty && finished.isEmpty }
}

/// A bounded, memory-only projection across spaces/providers, independent of
/// the selected conversation and its transcript window.
public struct WorkInboxSnapshot: Sendable {
    public static let runLimit = 100
    public static let requestLimit = 200
    public let runs: [Conversation]
    public let activeIDs: Set<String>
    public var requests: [WorkInboxRequest]
    public let updatedAt: Date?
    public let isLimited: Bool

    public init(saved runs: [Conversation] = []) {
        self.runs = Array(runs.prefix(Self.runLimit))
        activeIDs = Set(self.runs.filter { $0.isActive && $0.isReplica != true }.map(\.id))
        requests = []; updatedAt = nil; isLimited = runs.count > Self.runLimit
    }

    init(runs: [Conversation], activeIDs: Set<String>, requests: [WorkInboxRequest], updatedAt: Date, isLimited: Bool) {
        self.runs = runs; self.activeIDs = activeIDs; self.requests = requests
        self.updatedAt = updatedAt; self.isLimited = isLimited
    }

    public func groups(now: Date = .now, live: Bool) -> WorkInboxGroups {
        let validRequests = live ? requests.filter { $0.expiresAt > now } : []
        let byRun = Dictionary(grouping: validRequests, by: \.runId)
        var result = WorkInboxGroups()
        for run in runs.filter({ !$0.isArchived }).sorted(by: { $0.updatedAt == $1.updatedAt ? $0.id < $1.id : $0.updatedAt > $1.updatedAt }) {
            let waiting = run.isReplica == true ? [] : byRun[run.id] ?? []
            let item = WorkInboxItem(run: run, requestCount: waiting.count, hasQuestion: waiting.contains { $0.kind != "tool_approval" })
            if !waiting.isEmpty { result.needsYou.append(item) }
            else if activeIDs.contains(run.id), run.isActive, run.isReplica != true { result.running.append(item) }
            else if run.status == "failed", run.updatedAt >= now.addingTimeInterval(-7 * 86_400) { result.failed.append(item) }
            else if ["succeeded", "canceled"].contains(run.status), run.updatedAt >= now.addingTimeInterval(-86_400) { result.finished.append(item) }
        }
        result.failed = Array(result.failed.prefix(20))
        result.finished = Array(result.finished.prefix(20))
        return result
    }

    @MainActor
    static func read(accountID: String, invoke: @escaping @MainActor (String, [JSONValue]) async throws -> JSONValue) async throws -> Self {
        // listActive is authoritative: old running DB rows after a host crash
        // must not become actionable just because they appear in recent chats.
        let activeValue = try await invoke("runs:listActive", [])
        let requestValue = try await invoke("runs:listPendingApprovals", [])
        let recentValue = try await invoke("runs:getAll", [.number(Double(runLimit))])
        let activeRows = try rows(activeValue, key: "runs")
        let recentRows = try rows(recentValue, key: "runs")
        let requestRows = try rows(requestValue, key: "approvals")
        let active = try activeRows.prefix(runLimit).map { try $0.decode(Conversation.self) }
        let recent = try recentRows.prefix(runLimit).map { try $0.decode(Conversation.self) }
        let requests = try requestRows.prefix(requestLimit).map { try $0.decode(WorkInboxRequest.self) }.filter { $0.expiresAt > Date() }
        var limited = activeRows.count >= runLimit || recentRows.count >= runLimit || requestRows.count > requestLimit
        var byID: [String: Conversation] = [:]
        for var run in recent + active where run.accountId == accountID && !run.isArchived {
            run.configSnapshot = nil
            byID[run.id] = run
        }
        // A request may belong to a conversation older than the recent 100.
        // Resolve descriptors only; never fetch that conversation's history.
        let missing = Set(requests.map(\.runId)).subtracting(byID.keys).sorted()
        if missing.count > 20 { limited = true }
        for id in missing.prefix(20) {
            let value = try await invoke("runs:getById", [.string(id)])
            if value == .null { continue }
            var run = try value.decode(Conversation.self)
            guard run.id == id else { throw MainsError.invalidReply }
            run.configSnapshot = nil
            if run.accountId == accountID && !run.isArchived { byID[id] = run }
        }
        let activeIDs = Set(active.filter { $0.accountId == accountID && $0.isReplica != true && !$0.isArchived && $0.isActive }.map(\.id))
        // Pending and live work take precedence over completed recent rows.
        let requestedIDs = Set(requests.map(\.runId))
        let ordered = byID.values.sorted {
            let a = requestedIDs.contains($0.id) ? 0 : activeIDs.contains($0.id) ? 1 : 2
            let b = requestedIDs.contains($1.id) ? 0 : activeIDs.contains($1.id) ? 1 : 2
            return a == b ? ($0.updatedAt == $1.updatedAt ? $0.id < $1.id : $0.updatedAt > $1.updatedAt) : a < b
        }
        if ordered.count > runLimit { limited = true }
        let retained = Array(ordered.prefix(runLimit)), retainedIDs = Set(retained.map(\.id))
        return Self(runs: retained, activeIDs: activeIDs.intersection(retainedIDs),
                    requests: requests.filter { retainedIDs.contains($0.runId) }, updatedAt: Date(), isLimited: limited)
    }

    private static func rows(_ value: JSONValue, key: String) throws -> [JSONValue] {
        if case .array(let rows) = value { return rows }
        if case .array(let rows) = value[key] { return rows }
        throw MainsError.invalidReply
    }
}
