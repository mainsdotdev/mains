import Foundation

public struct PairingLink: Equatable, Sendable {
    public let code: String
    public let name: String
    public let endpoints: [URL]

    public init(_ input: String) throws {
        guard let url = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["mains", "mains-dev", "mains-preview", "mains-native"].contains(url.scheme ?? ""),
              url.host == "pair", let fragment = url.percentEncodedFragment else { throw MainsError.invalidLink }
        var code = "", name = "", endpoints: [URL] = []
        for entry in fragment.split(separator: "&") {
            let parts = entry.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            func decoded(_ text: Substring) -> String {
                let plus = text.replacingOccurrences(of: "+", with: " ")
                return plus.removingPercentEncoding ?? plus
            }
            let key = decoded(parts[0]), value = parts.count > 1 ? decoded(parts[1]) : ""
            if key == "code" { code = value }
            if key == "name" { name = value }
            if key == "endpoint", let endpoint = URL(string: value),
               ["http", "https"].contains(endpoint.scheme?.lowercased() ?? ""), endpoint.host != nil,
               endpoint.user == nil, endpoint.password == nil, endpoint.fragment == nil, endpoint.query == nil,
               !endpoints.contains(endpoint) { endpoints.append(endpoint) }
        }
        guard !code.isEmpty, !endpoints.isEmpty else { throw MainsError.invalidLink }
        self.code = code
        self.name = name.isEmpty ? "Mains" : name
        self.endpoints = endpoints
    }
}

public struct BackendDescriptor: Codable, Equatable, Sendable {
    public let backendId: String
    public let name: String
    public let appVersion: String
    public let protocolVersion: Int
    public let capabilities: [String]
    public let serverTime: String
}

public struct PairedBackend: Codable, Equatable, Sendable {
    public let descriptor: BackendDescriptor
    public let endpoints: [URL]
    public let deviceId: String
    public let deviceToken: String
    // Local metadata; older saved pairings have no timestamp.
    public var pairedAt: Date? = nil
}

public struct Conversation: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let accountId: String
    public let providerId: String
    public let mode: String
    public let spaceId: String?
    public var workspaceId: String? = nil
    public var collectionId: String? = nil
    public let title: String?
    public var status: String
    public let model: String?
    public var configSnapshot: JSONValue? = nil
    public let isArchived: Bool
    public let isReplica: Bool?
    public let lastError: String?
    public let createdAt: Date
    public let updatedAt: Date
    public var displayTitle: String { title?.isEmpty == false ? title! : "New conversation" }
    public var isActive: Bool { status == "queued" || status == "running" }
}

public struct Space: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let providerId: String
    public var mode: String
    public let model: String?
    public let isArchived: Bool?
    public var icon: String? = nil
    public var sortOrder: Int? = nil
}

public struct Workspace: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let isArchived: Bool
    public let isReplica: Bool?
    public var projectId: String? = nil
    public var rootPath: String? = nil
    public var status: String? = nil
    public var updatedAt: Date? = nil
}

public struct HistoryCursor: Codable, Equatable, Sendable {
    public let timestamp: Double
    public let source: String
    public var id: Int
    public var exclusiveEnd: Self { var next = self; next.id += 1; return next }
}

public struct Artifact: Codable, Equatable, Identifiable, Sendable {
    public let id: Int
    public let runId: String
    public let kind: String
    public let content: String?
    public let metadata: JSONValue?
    public let createdAt: Date
    public var path: String? = nil
    public init(id: Int, runId: String, kind: String, content: String?, metadata: JSONValue?, createdAt: Date, path: String? = nil) {
        self.id = id; self.runId = runId; self.kind = kind; self.content = content; self.metadata = metadata; self.createdAt = createdAt; self.path = path
    }
    private enum CodingKeys: String, CodingKey { case id, runId, kind, content, metadata, createdAt, path }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id); runId = try c.decode(String.self, forKey: .runId); kind = try c.decode(String.self, forKey: .kind)
        content = try c.decodeWireIfPresent(String.self, forKey: .content); metadata = try c.decodeIfPresent(JSONValue.self, forKey: .metadata)
        createdAt = try c.decode(Date.self, forKey: .createdAt); path = try c.decodeWireIfPresent(String.self, forKey: .path)
    }
}

public struct ToolCall: Codable, Equatable, Identifiable, Sendable {
    public let id: Int
    public let toolName: String
    public let status: String
    public let createdAt: Date
    public var input: JSONValue? = nil
    public var output: JSONValue? = nil
    public var error: String? = nil
    public var startedAt: Date? = nil
    public var endedAt: Date? = nil
    public var parentToolCallId: String? = nil
    public var metadata: JSONValue? = nil

    private enum CodingKeys: String, CodingKey { case id, toolName, status, createdAt, input, output, error, startedAt, endedAt, parentToolCallId, metadata }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id); toolName = try c.decode(String.self, forKey: .toolName)
        status = try c.decode(String.self, forKey: .status); createdAt = try c.decode(Date.self, forKey: .createdAt)
        input = try c.decodeIfPresent(JSONValue.self, forKey: .input); output = try c.decodeIfPresent(JSONValue.self, forKey: .output)
        error = try c.decodeWireIfPresent(String.self, forKey: .error)
        startedAt = try c.decodeWireIfPresent(Date.self, forKey: .startedAt); endedAt = try c.decodeWireIfPresent(Date.self, forKey: .endedAt)
        parentToolCallId = try c.decodeWireIfPresent(String.self, forKey: .parentToolCallId)
        metadata = try c.decodeIfPresent(JSONValue.self, forKey: .metadata)
    }
}

public struct RunTurn: Codable, Equatable, Sendable {
    public let id: Int
    public let status: String
    public var model: String? = nil
    public var turnIndex: Int? = nil
}

public struct HistoryPage: Codable, Equatable, Sendable {
    public let artifacts: [Artifact]
    public let toolCalls: [ToolCall]
    public let turns: [RunTurn]
    public let start: HistoryCursor?
    public let end: HistoryCursor?
    public let last: HistoryCursor?
    public let hasOlder: Bool
    public let hasNewer: Bool
}

public enum Provider {
    public static func name(_ id: String) -> String {
        switch id {
        case "codex": "Codex"
        case "claude_code": "Claude Code"
        case "copilot_cli": "GitHub Copilot"
        case "cursor": "Cursor"
        case "opencode": "OpenCode"
        default: id
        }
    }
    public static func recipient(_ id: String) -> String {
        switch id {
        case "codex": "OpenAI"
        case "claude_code": "Anthropic"
        case "copilot_cli": "GitHub and its selected model provider"
        case "cursor": "Anysphere and its selected model provider"
        default: "the model provider configured on your computer"
        }
    }
    public static func privacyURL(_ id: String) -> URL? {
        let value = switch id {
        case "codex": "https://openai.com/policies/privacy-policy/"
        case "claude_code": "https://www.anthropic.com/legal/privacy"
        case "copilot_cli": "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
        case "cursor": "https://cursor.com/privacy"
        default: "https://opencode.ai/docs/"
        }
        return URL(string: value)
    }
}
