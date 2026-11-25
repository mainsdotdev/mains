import Foundation

public struct ConversationSearchCursor: Codable, Equatable, Sendable {
    public let rank: Int
    public let createdAt: Double
    public let runId: String
}
public struct ConversationSearchHit: Decodable, Identifiable, Sendable {
    public var id: String { runId }
    public let runId: String
    public let title: String
    public let providerId: String
    public let mode: String
    public let context: String?
    public let updatedAt: Double
    public let snippet: String?
    public let messageCursor: HistoryCursor?
}
public struct ConversationSearchPage: Decodable, Sendable {
    public let items: [ConversationSearchHit]
    public let nextCursor: ConversationSearchCursor?
}
