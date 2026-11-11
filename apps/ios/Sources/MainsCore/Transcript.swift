import Foundation

public struct TranscriptRow: Identifiable, Equatable, Sendable {
    public enum Kind: String, Sendable { case prompt, response, tool, notice, media, subagents }
    public let id: String
    public let kind: Kind
    public let text: String
    public let date: Date
    public let live: Bool
    public let deferredArtifactID: Int?
    public var tool: ToolCall? = nil
    public var media: [TranscriptMedia] = []
    public var turnID: Int? = nil
    public var contextSkills: [ContextSkill] = []
    public var delivery: PendingMessage.Status? = nil
    public var pendingAttachments: [PromptAttachment] = []
    public var subagents: [SessionSubagent] = []
}

/// One bounded backend page plus ephemeral previews. Acknowledgements outlive page replacement.
public struct Transcript: Sendable {
    public private(set) var page: HistoryPage?
    private var streams: [String: TranscriptRow] = [:]
    private var childStreams: [String: SubagentMessagePreview] = [:]
    private var acknowledged: Set<String> = []
    private var settled: Set<String> = []
    private var following = true
    private var frozenEnd: HistoryCursor?
    private struct PromptIdentity: Equatable, Sendable { let id: String; let date: Date }
    private var promptIdentities: [Int: PromptIdentity] = [:]
    private var streamDates: [String: Date] = [:]
    private struct Thought: Sendable {
        let text: String
        let date: Date
        let turnID: Int?
        let sequence: Int
    }
    private var thoughts: [String: Thought] = [:]
    private var thoughtSequence = 0
    private var suppressStoredThoughts = false
    public init() {}
    public var isFollowing: Bool { following }
    public private(set) var isHistorical = false

    public mutating func replace(_ page: HistoryPage, direction: String = "refresh", pending: PendingMessage? = nil) {
        let previousPrompt = self.page?.artifacts.last { $0.kind == "user-prompt" }?.id
        if self.page == nil { isHistorical = page.hasNewer }
        self.page = page
        let artifactIDs = Set(page.artifacts.map(\.id))
        promptIdentities = promptIdentities.filter { artifactIDs.contains($0.key) }
        if let pending, !pending.isSteering, !pending.isQueueOwned, let artifact = page.artifacts.first(where: pending.matches) {
            promptIdentities[artifact.id] = PromptIdentity(id: "pending:" + pending.id, date: pending.date)
        }
        if previousPrompt != page.artifacts.last(where: { $0.kind == "user-prompt" })?.id { suppressStoredThoughts = false }
        if direction == "latest" { following = true; frozenEnd = nil; isHistorical = false }
        else if direction == "older" || direction == "newer" { isHistorical = page.end != nil }
        if direction == "older" || direction == "newer" || page.hasNewer {
            following = false
            frozenEnd = page.end ?? page.last?.exclusiveEnd
        } else if !following { frozenEnd = page.end ?? frozenEnd ?? page.last?.exclusiveEnd }
        for artifact in page.artifacts {
            if let id = artifact.metadata?["streamId"].string {
                acknowledged.insert(id)
                if let preview = streams[id] { streamDates[id] = preview.date }
                if let preview = childStreams[id] { streamDates[id] = preview.row.date }
                streams.removeValue(forKey: id)
                childStreams.removeValue(forKey: id)
                thoughts.removeValue(forKey: id)
            }
        }
        let retainedStreams = Set(page.artifacts.compactMap { $0.metadata?["streamId"].string })
        streamDates = streamDates.filter { retainedStreams.contains($0.key) }
    }

    public mutating func receive(_ payload: JSONValue) {
        let event = payload["event"], metadata = event["metadata"]
        guard event["type"].string == "artifact", let id = event["streamId"].string,
              !acknowledged.contains(id), !settled.contains(id) else { return }
        if !AgentActivity.foreground(metadata) {
            guard ["report", "result", "command_result"].contains(event["kind"].string ?? ""),
                  !AgentActivity.thinking(kind: event["kind"].string ?? "", metadata: metadata),
                  let parent = metadata["parentToolUseId"].string ?? metadata["parentToolCallId"].string ?? metadata["agentId"].string,
                  let text = event["content"].string, !text.isEmpty else { return }
            let row = TranscriptRow(id: "stream:" + id, kind: .response, text: String(text.prefix(8192)),
                date: childStreams[id]?.row.date ?? Date(timeIntervalSince1970: (payload["ts"].number ?? 0) / 1000),
                live: metadata["streaming"] != .bool(false), deferredArtifactID: nil)
            childStreams[id] = SubagentMessagePreview(streamID: id, parentID: parent, row: row)
            if !row.live { settled.insert(id) }
            if childStreams.count > 4, let oldest = childStreams.filter({ $0.key != id }).min(by: { $0.value.row.date < $1.value.row.date })?.key {
                childStreams.removeValue(forKey: oldest)
            }
            return
        }
        if AgentActivity.thinking(kind: event["kind"].string ?? "", metadata: metadata) {
            let text = String((event["content"].string ?? "").suffix(4096))
            guard !AgentActivity.preview(text).isEmpty, metadata["streaming"] != .bool(false) else {
                thoughts.removeValue(forKey: id); settled.insert(id); return
            }
            thoughtSequence += 1
            thoughts[id] = Thought(text: text, date: Date(timeIntervalSince1970: (payload["ts"].number ?? 0) / 1000),
                                   turnID: Self.turnID(metadata), sequence: thoughtSequence)
            if thoughts.count > 4, let oldest = thoughts.min(by: { $0.value.sequence < $1.value.sequence })?.key { thoughts.removeValue(forKey: oldest) }
            return
        }
        guard event["kind"].string == "report", ["agent_message_streaming", "assistant.message_delta"].contains(metadata["source"].string ?? "") else { return }
        guard let text = event["content"].string, !text.isEmpty else { streams.removeValue(forKey: id); return }
        clearThoughts(); suppressStoredThoughts = true
        streams[id] = TranscriptRow(id: "stream:" + id, kind: .response, text: text,
                                    date: streams[id]?.date ?? Date(timeIntervalSince1970: (payload["ts"].number ?? 0) / 1000),
                                    live: true, deferredArtifactID: nil, turnID: Self.turnID(metadata))
        if metadata["streaming"] == .bool(false) { settle(id) }
    }

    private mutating func settle(_ id: String) {
        settled.insert(id)
        if let row = streams[id] {
            streams[id] = TranscriptRow(id: row.id, kind: row.kind, text: row.text, date: row.date, live: false, deferredArtifactID: nil, turnID: row.turnID)
        }
    }
    public mutating func settleTurn() {
        for id in Array(streams.keys) { settle(id) }
        for id in Array(childStreams.keys) {
            if let preview = childStreams[id] {
                let row = preview.row
                childStreams[id]?.row = TranscriptRow(id: row.id, kind: row.kind, text: row.text, date: row.date, live: false, deferredArtifactID: nil)
                settled.insert(id)
            }
        }
        clearThoughts(); suppressStoredThoughts = true
    }
    private mutating func clearThoughts() { settled.formUnion(thoughts.keys); thoughts.removeAll() }
    public mutating func clearStreams() { streams.removeAll(); childStreams.removeAll(); clearThoughts(); suppressStoredThoughts = true }

    public var subagents: [SessionSubagent] { SubagentProjection(calls: page?.toolCalls ?? []).agents }
    public func subagentFlow(for agent: SessionSubagent) -> SubagentFlow? {
        guard let page else { return nil }
        return SubagentProjection.flow(for: agent, page: page, previews: isHistorical ? [] : Array(childStreams.values), dates: streamDates)
    }

    public var activity: AgentActivity? {
        guard !isHistorical else { return nil }
        let artifacts = (page?.artifacts ?? []).filter { AgentActivity.foreground($0.metadata ?? .null) }
        let prompt = artifacts.last { $0.kind == "user-prompt" }
        let turnID = prompt.flatMap { Self.turnID($0.metadata ?? .null) } ?? page?.turns.last?.id
        func current(_ date: Date, _ candidateTurn: Int?) -> Bool {
            if let turnID, let candidateTurn { return candidateTurn == turnID }
            return prompt.map { date >= $0.createdAt } ?? true
        }
        if let tool = page?.toolCalls.last(where: {
            ["running", "queued"].contains($0.status) && $0.parentToolCallId == nil && AgentActivity.foreground($0.metadata ?? .null) &&
            !SubagentProjection.isAgent($0) &&
            current($0.createdAt, Self.turnID($0.metadata ?? .null))
        }) { return AgentActivity(tool: tool) }
        if streams.values.contains(where: { $0.live && current($0.date, $0.turnID) }) { return nil }
        if let thought = thoughts.values.filter({ current($0.date, $0.turnID) }).max(by: { $0.sequence < $1.sequence }) {
            return AgentActivity(thinking: thought.text)
        }
        if !suppressStoredThoughts {
            for artifact in artifacts.reversed() {
                if artifact.kind == "user-prompt" { break }
                guard current(artifact.createdAt, Self.turnID(artifact.metadata ?? .null)) else { continue }
                let text = artifact.content ?? ""
                if AgentActivity.thinking(kind: artifact.kind, metadata: artifact.metadata ?? .null), !text.isEmpty { return AgentActivity(thinking: text) }
                if artifact.kind == "log", let prefix = ["[thinking] ", "[reasoning] "].first(where: text.hasPrefix) {
                    return AgentActivity(thinking: String(text.dropFirst(prefix.count)))
                }
            }
        }
        return AgentActivity()
    }

    public mutating func setFollowing(_ value: Bool) {
        following = value && page?.hasNewer != true
        if following { frozenEnd = nil; isHistorical = false }
        else if frozenEnd == nil { frozenEnd = page?.end ?? page?.last?.exclusiveEnd }
    }

    public var rows: [TranscriptRow] {
        var rows = (page?.artifacts ?? []).compactMap { artifact -> TranscriptRow? in
            let metadata = artifact.metadata ?? .null
            guard AgentActivity.foreground(metadata), !AgentActivity.thinking(kind: artifact.kind, metadata: metadata),
                  artifact.kind != "prompt_suggestion" else { return nil }
            var text = artifact.content ?? ""
            let kind: TranscriptRow.Kind
            var media: [TranscriptMedia] = []
            switch artifact.kind {
            case "user-prompt":
                kind = .prompt
                media = TranscriptMedia.prompt(metadata, runID: artifact.runId)
            case "report", "result", "command_result": kind = .response
            case "log":
                guard metadata["level"].string == "error" else { return nil }
                kind = .notice
            case "file", "document", "image", "visualization":
                guard let item = TranscriptMedia.artifact(artifact) else { return nil }
                kind = .media; media = [item]; text = ""
            default: return nil
            }
            guard !text.isEmpty || !media.isEmpty else { return nil }
            let streamID = metadata["streamId"].string
            let identity = promptIdentities[artifact.id]
            let id = identity?.id ?? streamID.map { "stream:" + $0 } ?? "artifact:\(artifact.id)"
            let date = identity?.date ?? streamID.flatMap { streamDates[$0] } ?? artifact.createdAt
            return TranscriptRow(id: id, kind: kind, text: text, date: date, live: false,
                                 deferredArtifactID: metadata["mobileContentDeferred"].bool ? artifact.id : nil, media: media,
                                 turnID: Self.turnID(metadata), contextSkills: (try? metadata["skills"].decode([ContextSkill].self)) ?? [],
                                 delivery: identity == nil ? nil : .accepted)
        }
        let projection = SubagentProjection(calls: page?.toolCalls ?? [])
        rows += (page?.toolCalls ?? []).filter { $0.parentToolCallId == nil && AgentActivity.foreground($0.metadata ?? .null) && !projection.rootCallIDs.contains($0.id) }.map {
            TranscriptRow(id: "tool:\($0.id)", kind: .tool, text: "\($0.toolName) · \($0.status)", date: $0.createdAt,
                          live: ["queued", "running"].contains($0.status), deferredArtifactID: nil, tool: $0, turnID: Self.turnID($0.metadata ?? .null))
        }
        if let first = projection.firstCall, !projection.agents.isEmpty {
            rows.append(TranscriptRow(id: "subagents:\(first.id)", kind: .subagents,
                text: "Spawned \(projection.agents.count) \(projection.agents.count == 1 ? "agent" : "agents")", date: first.createdAt,
                live: false, deferredArtifactID: nil, turnID: Self.turnID(first.metadata ?? .null), subagents: projection.agents))
        }
        // Historical pages never pull live output into an older reading position.
        if !isHistorical { rows += streams.values }
        return rows.sorted { $0.date == $1.date ? $0.id < $1.id : $0.date < $1.date }
    }

    /// The optimistic prompt occupies its chronological slot from the first frame,
    /// then the durable artifact takes over that same identity without a second row.
    public func rows(pending: PendingMessage?, runID: String) -> [TranscriptRow] {
        var result = rows
        guard !isHistorical, let pending, !pending.isSteering, !pending.isQueueOwned, pending.runID == runID, page?.artifacts.contains(where: pending.matches) != true else { return result }
        result.append(TranscriptRow(id: "pending:" + pending.id, kind: .prompt, text: pending.text, date: pending.date,
                                    live: false, deferredArtifactID: nil, contextSkills: pending.contextSkills,
                                    delivery: pending.status, pendingAttachments: pending.attachments))
        return result.sorted { $0.date == $1.date ? $0.id < $1.id : $0.date < $1.date }
    }

    private static func turnID(_ metadata: JSONValue) -> Int? {
        guard let number = metadata["turnId"].number, number > 0, number < Double(Int.max), number.rounded() == number else { return nil }
        return Int(number)
    }

    public func request(runID: String, direction: String) throws -> JSONValue {
        var body: [String: JSONValue] = ["runId": .string(runID), "profile": .string("mobile"), "direction": .string(direction), "deferToolOutput": .bool(true)]
        if direction == "older", let cursor = page?.start { body["cursor"] = try .encode(cursor) }
        if direction == "newer", let cursor = page?.end { body["cursor"] = try .encode(cursor) }
        if direction == "refresh" {
            if let start = page?.start { body["cursor"] = try .encode(start) }
            if !following, let end = page?.end ?? frozenEnd { body["end"] = try .encode(end) }
        }
        return .object(body)
    }
}
