import Foundation

public struct RunOutput: Decodable, Identifiable, Sendable {
    public var id: Int { artifactId }
    public let artifactId: Int
    public let runId: String
    public let name: String
    public let mimeType: String
    public let byteSize: Int
    public let version: String
    public let previewType: String
    public var previewLimit: Int { ["text", "markdown"].contains(previewType) ? 2 * 1024 * 1024 : 25 * 1024 * 1024 }
}
public struct RunOutputsPage: Decodable, Sendable {
    public let items: [RunOutput]
    public let nextOffset: Int?
}
public struct RunOutputChunk: Decodable, Sendable {
    public let base64: String
    public let offset: Int
    public let nextOffset: Int?
    public let byteSize: Int
    public let version: String
}

/// Same turn boundaries as mobile's buildTurnRows. Errors always stay visible.
public struct TranscriptSection: Identifiable, Equatable, Sendable {
    public let id: String
    public let previous: [TranscriptRow]
    public let breakout: [TranscriptRow]
    public let last: [TranscriptRow]
    public var folded: Bool { !previous.isEmpty }
    public var label: String {
        let messages = previous.filter { $0.kind == .response }.count
        let tools = previous.filter { $0.kind == .tool }.count
        return [messages > 0 ? "\(messages) \(messages == 1 ? "message" : "messages")" : "",
                tools > 0 ? "\(tools) \(tools == 1 ? "tool call" : "tool calls")" : ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }
    public static func build(_ rows: [TranscriptRow]) -> [Self] {
        var result: [Self] = [], turn: [TranscriptRow] = []
        func flush() {
            guard let first = turn.first else { return }
            let responses = turn.indices.filter { turn[$0].kind == .response }
            if responses.count > 1, let cut = responses.last {
                let earlier = Array(turn[..<cut])
                result.append(Self(id: first.id, previous: earlier.filter { $0.kind != .notice && $0.kind != .media },
                                   breakout: earlier.filter { $0.kind == .notice || $0.kind == .media }, last: Array(turn[cut...])))
            } else { result.append(Self(id: first.id, previous: [], breakout: [], last: turn)) }
            turn = []
        }
        for row in rows {
            if row.kind == .prompt {
                flush(); result.append(Self(id: row.id, previous: [], breakout: [], last: [row]))
            } else { turn.append(row) }
        }
        flush(); return result
    }
}
