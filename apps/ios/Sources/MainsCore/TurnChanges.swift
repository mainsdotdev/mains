import Foundation

public struct TurnFileChange: Codable, Hashable, Sendable {
    public let path: String
    public let status: String
    public let additions: Int
    public let deletions: Int
    public let binary: Bool
    public var oldPath: String? = nil
    public var shared: Bool? = nil
    private enum CodingKeys: String, CodingKey { case path, status, additions, deletions, binary, oldPath, shared }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        path = try c.decode(String.self, forKey: .path); status = try c.decode(String.self, forKey: .status)
        additions = try c.decode(Int.self, forKey: .additions); deletions = try c.decode(Int.self, forKey: .deletions)
        binary = try c.decode(Bool.self, forKey: .binary)
        oldPath = try c.decodeWireIfPresent(String.self, forKey: .oldPath); shared = try c.decodeWireIfPresent(Bool.self, forKey: .shared)
    }
}

public struct RunTurnChanges: Codable, Equatable, Sendable {
    public let id: String
    public let files: [TurnFileChange]
    public let additions: Int
    public let deletions: Int
    public let truncated: Bool
    public var fileCount: Int? = nil
    public var undoneAt: Date? = nil
    private enum CodingKeys: String, CodingKey { case id, files, additions, deletions, truncated, fileCount, undoneAt }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id); files = try c.decode([TurnFileChange].self, forKey: .files)
        additions = try c.decode(Int.self, forKey: .additions); deletions = try c.decode(Int.self, forKey: .deletions)
        truncated = try c.decode(Bool.self, forKey: .truncated)
        fileCount = try c.decodeWireIfPresent(Int.self, forKey: .fileCount); undoneAt = try c.decodeWireIfPresent(Date.self, forKey: .undoneAt)
    }
}

public enum TurnChangeFooters {
    /// Match mobile's historyEntryTurn and turnChangeFooters, including historical page cutoffs.
    public static func build(sections: [TranscriptSection], turns: [RunTurn], atLatest: Bool) -> [String: [RunTurn]] {
        var lastRows: [Int: String] = [:], lastAt = Date.distantPast
        for section in sections {
            for row in section.previous + section.breakout + section.last {
                lastAt = max(lastAt, row.date)
                guard row.kind != .prompt else { continue }
                if let id = row.turnID {
                    if turns.contains(where: { $0.id == id }) { lastRows[id] = section.id }
                } else {
                    let eligible = turns.filter { ($0.startedAt ?? $0.createdAt).map { $0 <= row.date } ?? false }
                    if let at = eligible.compactMap({ $0.startedAt ?? $0.createdAt }).max() {
                        let matches = eligible.filter { ($0.startedAt ?? $0.createdAt) == at }
                        if matches.count == 1 { lastRows[matches[0].id] = section.id }
                    }
                }
            }
        }
        var result: [String: [RunTurn]] = [:]
        for turn in turns {
            guard let key = lastRows[turn.id], turn.status == "completed", turn.changes != nil,
                  atLatest || (turn.endedAt.map { $0 <= lastAt } ?? false) else { continue }
            result[key, default: []].append(turn)
        }
        return result
    }
}
