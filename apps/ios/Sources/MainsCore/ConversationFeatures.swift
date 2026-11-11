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
    public var downloadLimit: Int { RunFilePolicy.maxBytes }
}
public struct RunOutputsPage: Decodable, Sendable {
    public let items: [RunOutput]
    public let nextOffset: Int?

    /// Missing files can leave an empty descriptor page before a later output.
    /// Presence checks read metadata only, never the files themselves.
    @MainActor public static func containsOutput(read: (Int) async throws -> Self) async throws -> Bool {
        var offset = 0
        while true {
            try Task.checkCancellation()
            let page = try await read(offset)
            try Task.checkCancellation()
            if !page.items.isEmpty { return true }
            guard let next = page.nextOffset else { return false }
            guard next > offset else { throw MainsError.invalidReply }
            offset = next
        }
    }
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
    public let rows: [TranscriptRow]
    public let previous: [TranscriptRow]
    public let breakout: [TranscriptRow]
    public let last: [TranscriptRow]
    public var folded: Bool { !previous.isEmpty }
    /// Copy all visible-window assistant prose in the turn, including folded work.
    /// Tool output, prompts and notices do not belong on the clipboard.
    public var responseText: String { rows.filter { $0.kind == .response }.map(\.text).joined(separator: "\n\n") }
    public var responseIsPreview: Bool { rows.contains { $0.kind == .response && $0.deferredArtifactID != nil } }
    public func displayedRows(expanded: Bool) -> [TranscriptRow] {
        guard folded && !expanded else { return rows }
        let hidden = Set(previous.map(\.id))
        return rows.filter { !hidden.contains($0.id) }
    }
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
                result.append(Self(id: first.id, rows: turn, previous: earlier.filter { $0.kind != .notice && $0.kind != .media && $0.kind != .subagents },
                                   breakout: earlier.filter { $0.kind == .notice || $0.kind == .media || $0.kind == .subagents }, last: Array(turn[cut...])))
            } else { result.append(Self(id: first.id, rows: turn, previous: [], breakout: [], last: turn)) }
            turn = []
        }
        for row in rows {
            if row.kind == .prompt {
                flush(); result.append(Self(id: row.id, rows: [row], previous: [], breakout: [], last: [row]))
            } else { turn.append(row) }
        }
        flush(); return result
    }
}

/// Work observed in progress keeps its layout after completion. Reopened history
/// starts compact; only an explicit user action changes an observed disclosure.
public struct TranscriptDisclosure: Sendable {
    private var observedActive = false
    private var selection: Bool?
    public init() {}
    public func isExpanded(active: Bool) -> Bool { selection ?? (active || observedActive) }
    public mutating func observe(active: Bool) { observedActive = observedActive || active }
    public mutating func toggle(active: Bool) { selection = !isExpanded(active: active) }
}
