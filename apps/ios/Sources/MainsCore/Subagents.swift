import Foundation

public enum SubagentState: String, Equatable, Sendable {
    case running, idle, done, failed, stopped
    public var label: String {
        switch self {
        case .running: "Working"
        case .idle: "Idle"
        case .done: "Done"
        case .failed: "Failed"
        case .stopped: "Stopped"
        }
    }
}

public struct SessionSubagent: Identifiable, Equatable, Sendable {
    public let id: Int
    public let toolName: String
    public let title: String
    public let detail: String
    public let agentID: String?
    public var state: SubagentState
    public var latestCallID: Int
    public var callIDs: [Int]
    public var anchors: [String]
    public var providerRunID: String?
    public var parentAgentID: String?
    public var parentCallID: String?
    public var depth = 0
}

/// A read-only projection of one bounded history window. Shell/MCP background
/// tasks never become agents. Provider lifecycle outranks the launch call's ack.
public struct SubagentProjection: Sendable {
    private static let spawnNames: Set<String> = ["agent", "task", "spawnagent"]
    private static let claudeNames: Set<String> = ["agent", "task"]
    public let agents: [SessionSubagent]
    public let rootCallIDs: Set<Int>
    public let firstCall: ToolCall?

    public static func isAgent(_ call: ToolCall) -> Bool {
        let metadata = call.metadata ?? .null, task = metadata["task"]
        if let type = task["taskType"].string, !type.isEmpty, type != "local_agent" { return false }
        return !metadata["subagent"].objectValue.isEmpty || task["subagentType"].string != nil ||
            task["taskType"].string == "local_agent" || spawnNames.contains(call.toolName.lowercased()) ||
            (call.toolName.lowercased() == "sendmessage" && task["taskId"].string?.isEmpty == false)
    }
    private static func lifecycle(_ call: ToolCall) -> JSONValue {
        let metadata = call.metadata ?? .null
        if let current = metadata["task"]["providerRunId"].string,
           let previous = metadata["subagent"]["providerRunId"].string, current != previous { return .null }
        return metadata["subagent"]
    }
    public static func state(_ call: ToolCall) -> SubagentState {
        let task = call.metadata?["task"] ?? .null, agent = lifecycle(call)
        if task["error"].string?.isEmpty == false || task["status"].string == "failed" || agent["phase"].string == "failed" { return .failed }
        if ["stopped", "killed"].contains(task["status"].string ?? "") || agent["phase"].string == "stopped" { return .stopped }
        if task["phase"].string == "completed" || task["status"].string == "completed" || agent["phase"].string == "completed" { return .done }
        if task["ambient"].bool || task["isBackgrounded"].bool && task["backgroundActive"] == .bool(false) { return .idle }
        if ["error", "failed"].contains(call.status) { return .failed }
        if call.status == "canceled" { return .stopped }
        if call.status == "done", task.objectValue.isEmpty, claudeNames.contains(call.toolName.lowercased()) { return .done }
        return .running
    }
    public init(calls: [ToolCall]) {
        let roots = calls.filter(Self.isAgent).sorted { $0.id < $1.id }
        rootCallIDs = Set(roots.map(\.id))
        firstCall = roots.min { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt }
        var selected: [SessionSubagent] = [], identities: [String: Int] = [:]
        // Spawns precede continuations even if the caller supplies rows out of order.
        let ordered = roots.filter { $0.toolName.lowercased() != "sendmessage" } + roots.filter { $0.toolName.lowercased() == "sendmessage" }
        for call in ordered {
            let task = call.metadata?["task"] ?? .null, agent = Self.lifecycle(call)
            let input = ToolPresentation.unwrap(call.input ?? .null)
            let legacyID = agent["result"].string.flatMap { result in
                result.range(of: #"(?i)agentId:\s*([a-z0-9_-]+)"#, options: .regularExpression)
                    .map { String(result[$0]).components(separatedBy: ":").dropFirst().joined(separator: ":").trimmingCharacters(in: .whitespaces) }
            }
            let agentID = task["taskId"].string ?? agent["agentId"].string ?? legacyID
            let to = call.toolName.lowercased() == "sendmessage" ? input["to"].string : nil
            let keys = [to, agentID, agent["agentId"].string].compactMap { $0 }.filter { !$0.isEmpty }
            if let index = keys.compactMap({ identities[$0] }).first {
                selected[index].callIDs.append(call.id)
                if let anchor = call.toolId, !selected[index].anchors.contains(anchor) { selected[index].anchors.append(anchor) }
                let nextExecution = task["providerRunId"].string
                let newer = nextExecution.flatMap { next in selected[index].providerRunID.map { next > $0 || next == $0 && call.id >= selected[index].latestCallID } }
                    ?? (call.id >= selected[index].latestCallID)
                if newer {
                    selected[index].state = Self.state(call); selected[index].latestCallID = call.id
                    if let nextExecution { selected[index].providerRunID = nextExecution }
                    if let parent = task.objectValue["parentTaskId"] {
                        selected[index].parentAgentID = parent.string
                        if parent == .null { selected[index].parentCallID = nil }
                    }
                }
                for key in keys { identities[key] = index }
                continue
            }
            let type = agent["agentType"].string ?? task["subagentType"].string ?? input["subagent_type"].string ?? "Subagent"
            let description = input["description"].string ?? task["description"].string ?? agent["prompt"].string?.components(separatedBy: "\n").first ?? ""
            let descriptionTitle = Self.claudeNames.contains(call.toolName.lowercased()) || call.toolName.lowercased() == "sendmessage"
            let title = descriptionTitle && !description.isEmpty ? description : Self.humanize(type)
            let detail = descriptionTitle && !description.isEmpty ? Self.humanize(type) : description
            let index = selected.count
            selected.append(SessionSubagent(id: call.id, toolName: call.toolName, title: title, detail: detail,
                agentID: agentID ?? to, state: Self.state(call), latestCallID: call.id, callIDs: [call.id],
                anchors: call.toolId.map { [$0] } ?? [], providerRunID: task["providerRunId"].string,
                parentAgentID: task["parentTaskId"].string, parentCallID: call.parentToolCallId))
            for key in keys { identities[key] = index }
        }
        // A child follows its parent. Cyclic/missing parent links stay usable.
        let byAgent = Dictionary(selected.enumerated().compactMap { index, agent in agent.agentID.map { ($0, index) } }, uniquingKeysWith: { first, _ in first })
        let byAnchor = Dictionary(selected.enumerated().flatMap { index, agent in agent.anchors.map { ($0, index) } }, uniquingKeysWith: { first, _ in first })
        var children: [Int: [Int]] = [:], top: [Int] = []
        for index in selected.indices.sorted(by: { selected[$0].id > selected[$1].id }) {
            let parent = selected[index].parentAgentID.flatMap { byAgent[$0] } ?? selected[index].parentCallID.flatMap { byAnchor[$0] }
            if let parent, parent != index { children[parent, default: []].append(index) }
            else { top.append(index) }
        }
        var result: [SessionSubagent] = [], visited: Set<Int> = []
        for root in top + selected.indices.sorted(by: { selected[$0].id > selected[$1].id }) {
            var stack = [(root, 0)]
            while let (index, depth) = stack.popLast() {
                guard visited.insert(index).inserted else { continue }
                var item = selected[index]; item.depth = depth; result.append(item)
                for child in (children[index] ?? []).reversed() { stack.append((child, depth + 1)) }
            }
        }
        agents = result
    }
    private static func humanize(_ value: String) -> String {
        let text = value.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
        return text.prefix(1).uppercased() + text.dropFirst()
    }

    public static func flow(for agent: SessionSubagent, page: HistoryPage, previews: [SubagentMessagePreview] = [], dates: [String: Date] = [:]) -> SubagentFlow {
        let calls = page.toolCalls.filter { agent.callIDs.contains($0.id) }.sorted { $0.id < $1.id }
        let latest = calls.first { $0.id == agent.latestCallID }
        let spawn = calls.first
        let metadata = latest.map(Self.lifecycle) ?? .null
        let task = latest?.metadata?["task"] ?? .null
        let prompt = spawn.flatMap { Self.lifecycle($0)["prompt"].string ?? ToolPresentation.unwrap($0.input ?? .null)["prompt"].string }
        let anchors = Set(agent.anchors + (agent.agentID.map { [$0] } ?? []))
        var rows: [TranscriptRow] = []
        for call in calls where call.toolName.lowercased() == "sendmessage" {
            if let message = ToolPresentation.unwrap(call.input ?? .null)["message"].string, !message.isEmpty {
                rows.append(.init(id: "subagent-prompt:\(call.id)", kind: .prompt, text: message, date: call.createdAt, live: false, deferredArtifactID: nil))
            }
        }
        for call in page.toolCalls where !agent.callIDs.contains(call.id) &&
            (call.parentToolCallId.map(anchors.contains) == true || agent.agentID.map({ call.metadata?["agentId"].string == $0 }) == true) {
            rows.append(.init(id: "tool:\(call.id)", kind: .tool, text: "", date: call.createdAt,
                              live: ["running", "queued"].contains(call.status), deferredArtifactID: nil, tool: call))
        }
        var persisted: Set<String> = []
        for artifact in page.artifacts {
            let meta = artifact.metadata ?? .null
            let parent = meta["parentToolUseId"].string ?? meta["parentToolCallId"].string
            guard parent.map(anchors.contains) == true || agent.agentID.map({ meta["agentId"].string == $0 }) == true,
                  ["report", "result", "command_result"].contains(artifact.kind),
                  let text = artifact.content, !text.isEmpty, !AgentActivity.thinking(kind: artifact.kind, metadata: meta) else { continue }
            let stream = meta["streamId"].string
            if let stream { persisted.insert(stream) }
            rows.append(.init(id: stream.map { "stream:" + $0 } ?? "artifact:\(artifact.id)", kind: .response, text: text,
                              date: stream.flatMap { dates[$0] } ?? artifact.createdAt, live: false,
                              deferredArtifactID: meta["mobileContentDeferred"] != .null && meta["mobileContentDeferred"] != .bool(false) ? artifact.id : nil))
        }
        for preview in previews where anchors.contains(preview.parentID) && !persisted.contains(preview.streamID) { rows.append(preview.row) }
        func rank(_ kind: TranscriptRow.Kind) -> Int { kind == .prompt ? 0 : kind == .tool ? 1 : 2 }
        rows.sort { a, b in
            if a.date != b.date { return a.date < b.date }
            if rank(a.kind) != rank(b.kind) { return rank(a.kind) < rank(b.kind) }
            let aID = a.id.split(separator: ":").last.flatMap { Int($0) }, bID = b.id.split(separator: ":").last.flatMap { Int($0) }
            if let aID, let bID { return aID < bID }
            return a.id < b.id
        }
        let rawReport = metadata["result"].string ?? task["summary"].string
        let lastRow = rows.last { $0.kind == .response }
        let lastMessage = lastRow?.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let sameReport = rawReport?.trimmingCharacters(in: .whitespacesAndNewlines) == lastMessage ||
            (lastRow?.deferredArtifactID != nil && lastMessage.map { rawReport?.hasPrefix($0) == true } == true)
        let report = sameReport ? nil : rawReport
        let lifecycleElapsed = metadata["invokedAt"].number.flatMap { start in metadata["updatedAt"].number.map { max(0, $0 - start) / 1000 } }
        let elapsed = task["usage"]["durationMs"].number.map { $0 / 1000 } ?? lifecycleElapsed ?? latest.flatMap { call in call.endedAt.map { $0.timeIntervalSince(call.startedAt ?? call.createdAt) } }
        return SubagentFlow(prompt: prompt, rows: rows, report: report,
                            error: metadata["error"].string ?? task["error"].string ?? (agent.state == .failed ? latest?.error : nil), duration: elapsed)
    }
}

public struct SubagentFlow: Sendable {
    public let prompt: String?
    public let rows: [TranscriptRow]
    public let report: String?
    public let error: String?
    public let duration: TimeInterval?
}

public struct SubagentMessagePreview: Equatable, Sendable {
    public let streamID: String
    public let parentID: String
    public var row: TranscriptRow
}
