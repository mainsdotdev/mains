import Foundation

public struct MateDirectory: Decodable, Sendable {
    public let mates: [Mate]
    public let teams: [MateTeam]
}

public struct MateTeam: Decodable, Identifiable, Sendable {
    public let id: String
    public let name: String
}

public struct MateAvatar: Codable, Sendable {
    public var shape: String
    public var color: String
    public init(shape: String, color: String) { self.shape = shape; self.color = color }
}

public struct Mate: Decodable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let description: String
    public let avatar: MateAvatar
    public let teamId: String?
    public let providerId: String
    public let model: String
    public let needsSetup: Bool
    public let welcome: MateWelcome?
    public var ready: Bool { !needsSetup }
}

public struct MateWelcome: Decodable, Sendable {
    public let runId: String
    public let state: String
    public let question: Question?
    public let error: String?

    public struct Question: Decodable, Sendable {
        public let question: String
        public let options: [Option]
        public let idleMessage: String
        public let profileSetup: Setup?
    }
    public struct Option: Decodable, Sendable {
        public let label: String
        public let description: String
    }
    public struct Setup: Decodable, Sendable {
        public let turns: [Turn]
        public let draft: MateProfile?
        public let saved: Bool?
    }
    public struct Turn: Decodable, Sendable {
        public let question: String
        public let answer: String
    }
}

public struct MateProfile: Codable, Sendable {
    public var description: String
    public var instructions: String
    public init(description: String, instructions: String) { self.description = description; self.instructions = instructions }
}

public struct MateChat: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: String?
    public let updatedAt: Date
    public var displayTitle: String { title.flatMap { $0.split(separator: "\n").first.map(String.init) } ?? "New conversation" }
}

public struct MateAssignment: Decodable, Sendable {
    public let id: String
    public let title: String
    public let status: String
    public let result: String?
    public let error: String?
    public let workerRunId: String?
}

public struct MateAssignmentLink: Equatable, Sendable {
    public let id: String
    public let runID: String
}

struct PendingMateCommand {
    let id = UUID().uuidString
    let channel: String
    let args: [JSONValue]
    let owner: Int
    var uncertain = false
}
