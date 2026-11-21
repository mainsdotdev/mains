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
    public let isArchived: Bool?
    public let needsSetup: Bool
    public let welcome: MateWelcome?
    public let details: MateDetails?
    public var ready: Bool { !needsSetup && isArchived != true }

    public func showsChat(_ chat: MateChat) -> Bool { chat.id != welcome?.runId || welcome?.state == "starting" }
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
    public struct Assignee: Decodable, Sendable {
        public let id: String
        public let name: String
        public let avatar: MateAvatar
        public let isArchived: Bool
    }

    public let id: String
    public let title: String
    public let status: String
    public let result: String?
    public let error: String?
    public let workerRunId: String?
    public let assignee: Assignee?
}

public struct MateAssignmentLink: Equatable, Sendable {
    public let id: String
    public let runID: String
}

public struct MateEditableProfile: Codable, Equatable, Sendable {
    public var name: String
    public var description: String
    public var instructions: String
    public var avatar: MateAvatar

    public init?(mate: Mate) {
        guard let details = mate.details else { return nil }
        name = mate.name
        description = mate.description
        instructions = details.instructions
        avatar = mate.avatar
    }
}

public struct MateMemoryNote: Codable, Identifiable, Sendable {
    public var id = UUID().uuidString
    public var title = ""
    public var content = ""
    public var pinned = false
    public var revision = 0
    public var shared = false
    public init() {}
}

public struct MateTask: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let status: String
    public let workerRunId: String?
    public let assignee: MateAssignment.Assignee?
    public let brief: String
    public let result: String?
    public let error: String?
    public let evidence: [String]
    public var isOpen: Bool { !["completed", "failed", "canceled"].contains(status) }
}

public struct MateTasks: Decodable, Sendable {
    public let items: [MateTask]
    public let activeCount: Int
    public let hasMore: Bool
}

public struct MateRoutineSchedule: Codable, Equatable, Sendable {
    public enum Frequency: String, Codable, CaseIterable, Identifiable, Sendable {
        case hourly, daily, weekdays, weekly
        public var id: Self { self }
    }

    public var title = ""
    public var prompt = ""
    public var frequency: Frequency = .daily
    public var dayOfWeek: Int? = nil
    public var hour = 9
    public var minute = 0
    public var timezone = TimeZone.current.identifier
    public init() {}
}

public struct MateRoutine: Decodable, Identifiable, Sendable {
    public let id: String
    public let workspaceId: String?
    public let isActive: Bool
    public let nextRunAt: Date?
    public let lastRunId: String?
    public let lastAssignmentStatus: String?
    public let lastError: String?
    public let revision: String
    public let schedule: MateRoutineSchedule

    private enum CodingKeys: String, CodingKey { case id, workspaceId, isActive, nextRunAt, lastRunId, lastAssignmentStatus, lastError, revision }

    public init(from decoder: any Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        id = try fields.decode(String.self, forKey: .id)
        workspaceId = try fields.decodeIfPresent(String.self, forKey: .workspaceId)
        isActive = try fields.decode(Bool.self, forKey: .isActive)
        nextRunAt = try fields.decodeIfPresent(Date.self, forKey: .nextRunAt)
        lastRunId = try fields.decodeIfPresent(String.self, forKey: .lastRunId)
        lastAssignmentStatus = try fields.decodeIfPresent(String.self, forKey: .lastAssignmentStatus)
        lastError = try fields.decodeIfPresent(String.self, forKey: .lastError)
        revision = try fields.decode(String.self, forKey: .revision)
        schedule = try MateRoutineSchedule(from: decoder)
    }
}

public struct MateRoutines: Decodable, Sendable {
    public let items: [MateRoutine]
    public let nextOffset: Int?
}

public enum MateChange: Sendable {
    case updateProfile(MateEditableProfile, original: MateEditableProfile, teamID: String?, originalTeamID: String?)
    case archive(Bool)
    case saveMemory(MateMemoryNote, expectedTeamID: String?)
    case deleteMemory(id: String, revision: Int)
    case assign(title: String, prompt: String)
    case cancelTask(String), checkTask(String), followup(id: String, message: String)
    case createRoutine(MateRoutineSchedule, workspaceID: String?)
    case updateRoutine(id: String, revision: String, schedule: MateRoutineSchedule)
    case toggleRoutine(id: String, isActive: Bool)
    case deleteRoutine(String), runRoutine(String)

    func payload() throws -> JSONValue {
        var fields: [String: JSONValue]
        switch self {
        case let .updateProfile(profile, original, teamID, originalTeamID):
            fields = ["action": .string("updateProfile"), "profile": try .encode(profile), "expectedProfile": try .encode(original)]
            if teamID != originalTeamID {
                fields["teamChange"] = .object(["teamId": teamID.map(JSONValue.string) ?? .null,
                                                 "expectedTeamId": originalTeamID.map(JSONValue.string) ?? .null])
            }
        case .archive(let archived):
            fields = ["action": .string("archive"), "archived": .bool(archived)]
        case let .saveMemory(note, expectedTeamID):
            fields = ["action": .string("saveMemory"), "note": try .encode(note),
                      "expectedTeamId": expectedTeamID.map(JSONValue.string) ?? .null]
        case let .deleteMemory(id, revision):
            fields = ["action": .string("deleteMemory"), "id": .string(id), "revision": .number(Double(revision))]
        case let .assign(title, prompt):
            fields = ["action": .string("assign"), "title": .string(title), "prompt": .string(prompt)]
        case .cancelTask(let id): fields = ["action": .string("cancelTask"), "id": .string(id)]
        case .checkTask(let id): fields = ["action": .string("checkTask"), "id": .string(id)]
        case let .followup(id, message):
            fields = ["action": .string("followup"), "id": .string(id), "message": .string(message)]
        case let .createRoutine(schedule, workspaceID):
            fields = ["action": .string("createRoutine"), "schedule": try schedule.payload(),
                      "workspaceId": workspaceID.map(JSONValue.string) ?? .null]
        case let .updateRoutine(id, revision, schedule):
            fields = ["action": .string("updateRoutine"), "id": .string(id), "revision": .string(revision),
                      "schedule": try schedule.payload()]
        case let .toggleRoutine(id, isActive):
            fields = ["action": .string("toggleRoutine"), "id": .string(id), "isActive": .bool(isActive)]
        case .deleteRoutine(let id): fields = ["action": .string("deleteRoutine"), "id": .string(id)]
        case .runRoutine(let id): fields = ["action": .string("runRoutine"), "id": .string(id)]
        }
        return .object(fields)
    }
}

private extension MateRoutineSchedule {
    func payload() throws -> JSONValue {
        var fields = try JSONValue.encode(self).objectValue
        fields["dayOfWeek"] = frequency == .weekly ? dayOfWeek.map { .number(Double($0)) } ?? .null : .null
        return .object(fields)
    }
}

struct PendingMateCommand {
    let id = UUID().uuidString
    let channel: String
    let args: [JSONValue]
    let owner: Int
    var uncertain = false
}
