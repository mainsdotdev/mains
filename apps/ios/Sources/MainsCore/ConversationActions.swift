import Foundation

public enum ConversationAction: Equatable, Sendable {
    case moveToProject(String?), archive, delete
    public var retiresConversation: Bool {
        switch self { case .moveToProject: false; case .archive, .delete: true }
    }
    public var title: String {
        switch self { case .moveToProject: "Move to project"; case .archive: "Archive chat"; case .delete: "Delete chat" }
    }
    var channel: String {
        switch self { case .moveToProject: "runs:moveToCollection"; case .archive: "runs:archive"; case .delete: "runs:delete" }
    }
}

/// The original command and arguments survive navigation and reconnects. Only
/// an acknowledgement or definite refusal releases the next conversation write.
public struct PendingConversationAction: Sendable {
    public enum Status: Equatable, Sendable { case sending, uncertain }
    public let runID: String
    public let action: ConversationAction
    public var status: Status
    let commandID: String
    let accountID: String
    let args: [JSONValue]
    let owner: Int
    public var id: String { commandID }

    func validate(_ result: JSONValue) throws {
        if action == .delete {
            guard result == .null || result == .object(["$undefined": .bool(true)]) else { throw MainsError.invalidReply }
            return
        }
        guard let run = try? result.decode(Conversation.self) else { throw MainsError.invalidReply }
        guard run.id == runID, run.accountId == accountID, run.isReplica != true else { throw MainsError.invalidReply }
        switch action {
        case .archive: guard run.isArchived else { throw MainsError.invalidReply }
        case .moveToProject(let id):
            guard ["work", "chat"].contains(run.mode), !run.isArchived, run.collectionId == id else { throw MainsError.invalidReply }
        case .delete: break
        }
    }
}

public struct RetiredConversation: Equatable, Sendable {
    public let id: String
    public let runID: String
}
