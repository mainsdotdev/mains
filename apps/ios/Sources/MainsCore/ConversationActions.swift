import Foundation

public enum ConversationAction: Equatable, Sendable {
    case rename(String), setPinned(Bool), moveToProject(String?), archive, delete
    public var retiresConversation: Bool {
        self == .archive || self == .delete
    }
    public var title: String {
        switch self {
        case .rename: "Rename chat"
        case .setPinned(let pinned): pinned ? "Pin chat" : "Unpin chat"
        case .moveToProject: "Move to project"
        case .archive: "Archive chat"
        case .delete: "Delete chat"
        }
    }
    var channel: String {
        switch self {
        case .rename: "runs:rename"
        case .setPinned: "runs:setPinned"
        case .moveToProject: "runs:moveToCollection"
        case .archive: "runs:archive"
        case .delete: "runs:delete"
        }
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
        case .rename(let title): guard run.title == title else { throw MainsError.invalidReply }
        case .setPinned(let pinned): guard run.isPinnableChat, (run.pinnedAt != nil) == pinned else { throw MainsError.invalidReply }
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

public enum WorkspaceAction: Equatable, Sendable {
    case setPinned(Bool), archive, delete, renameBranch(expected: String, name: String), newWorktree

    var retiresWorkspace: Bool { self == .archive || self == .delete }

    var wireName: String {
        switch self {
        case .setPinned: "setPinned"
        case .archive: "archive"
        case .delete: "delete"
        case .renameBranch: "renameBranch"
        case .newWorktree: "newWorktree"
        }
    }

    var wire: JSONValue {
        var fields: [String: JSONValue] = ["action": .string(wireName)]
        switch self {
        case .setPinned(let pinned): fields["pinned"] = .bool(pinned)
        case .renameBranch(let expected, let name):
            fields["expectedBranch"] = .string(expected)
            fields["branch"] = .string(name)
        case .archive, .delete, .newWorktree: break
        }
        return .object(fields)
    }
}

public struct PendingWorkspaceAction: Sendable {
    public let id: String
    public let workspaceID: String
    public let action: WorkspaceAction
    public var status: PendingConversationAction.Status
    let owner: Int
}

public struct RetiredWorkspace: Equatable, Sendable {
    public let id: String
    public let workspaceID: String
}
