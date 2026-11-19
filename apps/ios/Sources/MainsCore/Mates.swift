import Foundation

public struct MateDirectory: Decodable, Sendable {
    public let mates: [Mate]
    public let teams: [MateTeam]
}

public struct MateTeam: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
}

public struct MateAvatar: Codable, Hashable, Sendable {
    public var shape: String
    public var color: String
    public init(shape: String, color: String) { self.shape = shape; self.color = color }
}

struct MateRobotCatalogue: Decodable, Sendable {
    struct Style: Decodable, Identifiable, Sendable {
        let id: String
        let label: String
        let presets: [Preset]
    }

    struct Preset: Decodable, Identifiable, Sendable {
        let id: String
        let label: String
        let color: String
        var avatar: MateAvatar { MateAvatar(shape: id, color: color) }
    }

    let defaultShape: String
    let styles: [Style]

    var defaultPreset: Preset? { styles.lazy.flatMap(\.presets).first { $0.id == defaultShape } }

    func preset(for avatar: MateAvatar?, mateID: String) -> Preset? {
        let presets = styles.flatMap(\.presets)
        if let avatar, let exact = presets.first(where: { $0.id == avatar.shape }) { return exact }
        guard !presets.isEmpty else { return nil }
        // Keep a legacy profile's display stable across relaunches and navigation.
        let hash = mateID.utf8.reduce(UInt32(2_166_136_261)) { ($0 ^ UInt32($1)) &* 16_777_619 }
        return presets[Int(hash % UInt32(presets.count))]
    }
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
    public let details: MateDetails?
    public var ready: Bool { !needsSetup }
}

public struct MateDetails: Decodable, Sendable {
    public let spaceName: String
    public let effort: String
    public let instructions: String
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
    public struct Turn: Decodable, Equatable, Sendable {
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
