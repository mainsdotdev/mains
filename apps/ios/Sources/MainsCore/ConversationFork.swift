import Foundation

/// A fork starts a new provider session. Its receipt must survive an unknown
/// response without becoming an optimistic message in the source conversation.
public struct PendingFork: Sendable {
    public enum Status: Equatable, Sendable { case sending, uncertain }
    public let sourceRunID: String
    public var status: Status
    let commandID: String
    let payload: JSONValue
    let owner: Int
    public var id: String { commandID }
}

public enum TranscriptForkAnchor {
    /// Fork always branches the current session, never an arbitrary older row.
    public static func rowID(in rows: [TranscriptRow], atLatest: Bool, active: Bool, hasLocalContinuation: Bool) -> String? {
        guard atLatest else { return nil }
        let boundary = active && !hasLocalContinuation ? rows.lastIndex(where: { $0.kind == .prompt }) ?? 0 : rows.count
        return rows.prefix(boundary).last { $0.kind == .response && !$0.live }?.id
    }
}
