import Foundation

/// Another client's pending input is a display projection, never work for this phone to drain.
public struct RemoteQueueMessage: Decodable, Identifiable, Sendable {
    public let id: String
    public let text: String
    public let attachmentNames: [String]
    public let status: String
    public let error: String?
    public var preview: String { text.isEmpty ? attachmentNames.joined(separator: ", ") : text }
}
public struct RemoteRunQueue: Decodable, Identifiable, Sendable {
    public var id: String { producerId }
    public let runId: String
    public let producerId: String
    public let revision: Int
    public let messages: [RemoteQueueMessage]
    public let pauseReason: String?
    public let expiresAt: Double
    public var isCurrent: Bool { expiresAt > Date().timeIntervalSince1970 * 1000 }
}
struct RemoteRunQueues: Decodable { let queues: [RemoteRunQueue] }
