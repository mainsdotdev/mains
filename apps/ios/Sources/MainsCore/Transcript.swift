import Foundation

public struct TranscriptRow: Identifiable, Equatable, Sendable {
    public enum Kind: String, Sendable { case prompt, response, tool, notice, media }
    public let id: String
    public let kind: Kind
    public let text: String
    public let date: Date
    public let live: Bool
    public let deferredArtifactID: Int?
    public var tool: ToolCall? = nil
    public var media: [TranscriptMedia] = []
}

/// One bounded backend page plus ephemeral previews. Acknowledgements outlive page replacement.
public struct Transcript: Sendable {
    public private(set) var page: HistoryPage?
    private var streams: [String: TranscriptRow] = [:]
    private var acknowledged: Set<String> = []
    private var settled: Set<String> = []
    private var following = true
    private var frozenEnd: HistoryCursor?
    public init() {}
    public var isFollowing: Bool { following }

    public mutating func replace(_ page: HistoryPage, direction: String = "refresh") {
        self.page = page
        if direction == "latest" { following = true; frozenEnd = nil }
        if direction == "older" || direction == "newer" || page.hasNewer {
            following = false
            frozenEnd = page.end ?? page.last?.exclusiveEnd
        } else if !following { frozenEnd = page.end ?? frozenEnd ?? page.last?.exclusiveEnd }
        for artifact in page.artifacts {
            if let id = artifact.metadata?["streamId"].string {
                acknowledged.insert(id)
                streams.removeValue(forKey: id)
            }
        }
    }

    public mutating func receive(_ payload: JSONValue) {
        let event = payload["event"], metadata = event["metadata"]
        guard event["type"].string == "artifact", metadata["source"].string == "agent_message_streaming",
              !metadata["isFromSubagent"].bool, !metadata["voice"].bool,
              event["kind"].string == "report", let id = event["streamId"].string,
              !acknowledged.contains(id), !settled.contains(id) else { return }
        guard let text = event["content"].string, !text.isEmpty else { streams.removeValue(forKey: id); return }
        streams[id] = TranscriptRow(id: "stream:" + id, kind: .response, text: text,
                                    date: streams[id]?.date ?? Date(timeIntervalSince1970: (payload["ts"].number ?? 0) / 1000),
                                    live: true, deferredArtifactID: nil)
        if metadata["streaming"] == .bool(false) { settle(id) }
    }

    private mutating func settle(_ id: String) {
        settled.insert(id)
        if let row = streams[id] {
            streams[id] = TranscriptRow(id: row.id, kind: row.kind, text: row.text, date: row.date, live: false, deferredArtifactID: nil)
        }
    }
    public mutating func settleTurn() { for id in Array(streams.keys) { settle(id) } }
    public mutating func clearStreams() { streams.removeAll() }

    public mutating func setFollowing(_ value: Bool) {
        following = value && page?.hasNewer != true
        if following { frozenEnd = nil }
        else if frozenEnd == nil { frozenEnd = page?.end ?? page?.last?.exclusiveEnd }
    }

    public var rows: [TranscriptRow] {
        var rows = (page?.artifacts ?? []).compactMap { artifact -> TranscriptRow? in
            let metadata = artifact.metadata ?? .null
            guard !metadata["isFromSubagent"].bool, metadata["parentToolUseId"].string == nil,
                  !["thinking", "prompt_suggestion"].contains(artifact.kind) else { return nil }
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
            let id = metadata["streamId"].string.map { "stream:" + $0 } ?? "artifact:\(artifact.id)"
            return TranscriptRow(id: id, kind: kind, text: text, date: artifact.createdAt, live: false,
                                 deferredArtifactID: metadata["mobileContentDeferred"].bool ? artifact.id : nil, media: media)
        }
        rows += (page?.toolCalls ?? []).filter { $0.parentToolCallId == nil && $0.metadata?["isFromSubagent"].bool != true }.map {
            TranscriptRow(id: "tool:\($0.id)", kind: .tool, text: "\($0.toolName) · \($0.status)", date: $0.createdAt,
                          live: ["queued", "running"].contains($0.status), deferredArtifactID: nil, tool: $0)
        }
        // Historical pages never pull live output into an older reading position.
        if page?.hasNewer != true { rows += streams.values }
        return rows.sorted { $0.date == $1.date ? $0.id < $1.id : $0.date < $1.date }
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
