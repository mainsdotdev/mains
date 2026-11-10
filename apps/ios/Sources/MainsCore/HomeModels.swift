import Foundation

public enum Experience {
    public static func label(_ mode: String) -> String {
        switch mode { case "developer": "Code"; case "work": "Work"; case "chat": "Chat"; default: mode.capitalized }
    }
    // packages/contracts/src/modes.ts — provider and experience are independent.
    public static func modes(for provider: String) -> [String] {
        ["copilot_cli", "cursor", "opencode"].contains(provider) ? ["developer"] : ["developer", "work", "chat"]
    }
}

public struct ProjectCollection: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let icon: String?
    public let isArchived: Bool
}

public struct CodeProject: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let icon: String?
}

public struct WorkspaceGitState: Codable, Equatable, Sendable {
    public let workspaceId: String
    public let branch: String?
    public let pathExists: Bool
}

public struct HomeTarget: Codable, Equatable, Sendable {
    public var workspaceID: String?
    public var collectionID: String?
    public init(workspaceID: String? = nil, collectionID: String? = nil) {
        self.workspaceID = workspaceID; self.collectionID = collectionID
    }
}

public struct ComposerSettings: Codable, Equatable, Sendable {
    public var model: String
    public var config: [String: JSONValue]
    public init(model: String = "", config: [String: JSONValue] = [:]) { self.model = model; self.config = config }

    public static let allowedKeys = Set(["effortLevel", "modelReasoningEffort", "thinkingMode", "ultracode", "permissionMode", "sandboxMode", "permissionProfile", "mode", "fastMode", "serviceTier", "goalMode", "planMode", "agent"])
    public static func permissionKey(_ provider: String) -> String {
        switch provider { case "codex": "sandboxMode"; case "cursor": "mode"; case "opencode": "agent"; default: "permissionMode" }
    }
    public static func defaults(provider: String, model: String, config: [String: JSONValue]) -> Self {
        let permission: String = switch provider {
        case "claude_code": "auto"; case "codex": "workspace-write"; case "cursor": "agent"; case "opencode": "build"; default: "default"
        }
        var result = Self(model: model, config: [
            "effortLevel": .string(""), "modelReasoningEffort": .string(""),
            "thinkingMode": .bool(["codex", "copilot_cli"].contains(provider) && !(config["modelReasoningEffort"]?.string ?? "").isEmpty),
            "ultracode": .bool(false), "fastMode": .bool(false), "serviceTier": .string(""),
            "goalMode": .bool(false), "planMode": .bool(false), Self.permissionKey(provider): .string(permission),
        ])
        if provider == "codex" { result.config["permissionProfile"] = .string("") }
        result.config.merge(config.filter { allowedKeys.contains($0.key) }) { _, next in next }
        result.config["goalMode"] = .bool(false); result.config["planMode"] = .bool(false)
        return result
    }
    public func effort(provider: String) -> String {
        if provider == "claude_code", config["ultracode"]?.bool == true { return "ultracode" }
        return config[["codex", "copilot_cli"].contains(provider) ? "modelReasoningEffort" : "effortLevel"]?.string ?? ""
    }
    public mutating func setEffort(_ value: String, provider: String) {
        config["thinkingMode"] = .bool(!value.isEmpty)
        if provider == "claude_code", value == "ultracode" { config["ultracode"] = .bool(true); return }
        config["ultracode"] = .bool(false)
        config[["codex", "copilot_cli"].contains(provider) ? "modelReasoningEffort" : "effortLevel"] = .string(value)
    }
    public func permission(provider: String) -> String {
        if provider == "codex", let profile = config["permissionProfile"]?.string, !profile.isEmpty { return "profile:" + profile }
        return config[Self.permissionKey(provider)]?.string ?? ""
    }
    public mutating func setPermission(_ value: String, provider: String) {
        if provider == "codex" {
            if value.hasPrefix("profile:") { config["permissionProfile"] = .string(String(value.dropFirst(8))); return }
            config["permissionProfile"] = .string("")
        }
        config[Self.permissionKey(provider)] = .string(value)
    }
    public mutating func select(_ model: ModelChoice, provider: String) {
        self.model = model.id
        let levels = model.supportedEffortLevels ?? []
        let current = effort(provider: provider)
        if !levels.isEmpty, !current.isEmpty, current != "ultracode", !levels.contains(current) {
            let ranked = ["minimal", "low", "medium", "high", "xhigh", "max"]
            let rank = ranked.firstIndex(of: current) ?? ranked.count
            let next = levels.min { abs((ranked.firstIndex(of: $0) ?? 0) - rank) < abs((ranked.firstIndex(of: $1) ?? 0) - rank) } ?? ""
            setEffort(next, provider: provider)
        }
        if provider == "codex", let storedTier = config["serviceTier"]?.string, !storedTier.isEmpty, storedTier != "default" {
            let tiers = (model.serviceTiers ?? []).map(\.id) + (model.supportsFastMode == true ? ["fast"] : [])
            let tier = storedTier == "priority" && tiers.contains("fast") ? "fast" : storedTier
            config["serviceTier"] = .string(tiers.contains(tier) ? tier : "default")
        }
    }
    public static func effortLabel(_ value: String) -> String {
        switch value { case "": "Off"; case "xhigh": "Extra High"; default: value.capitalized }
    }
}

public struct ProviderSummary: Decodable, Sendable {
    public let id: String
    public let config: [String: JSONValue]?
}

public struct ModelServiceTier: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let description: String?
    private enum CodingKeys: String, CodingKey { case id, name, description }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        description = try values.decodeWireIfPresent(String.self, forKey: .description)
    }
}

public struct ModelChoice: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let displayName: String
    public let description: String?
    public let isDefault: Bool?
    public let supportedEffortLevels: [String]?
    public let supportsFastMode: Bool?
    public let serviceTiers: [ModelServiceTier]?
    private enum CodingKeys: String, CodingKey {
        case id, displayName, description, isDefault, supportedEffortLevels, supportsFastMode, serviceTiers
    }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        displayName = try values.decode(String.self, forKey: .displayName)
        description = try values.decodeWireIfPresent(String.self, forKey: .description)
        isDefault = try values.decodeWireIfPresent(Bool.self, forKey: .isDefault)
        supportedEffortLevels = try values.decodeWireIfPresent([String].self, forKey: .supportedEffortLevels)
        supportsFastMode = try values.decodeWireIfPresent(Bool.self, forKey: .supportsFastMode)
        serviceTiers = try values.decodeWireIfPresent([ModelServiceTier].self, forKey: .serviceTiers)
    }
    public var name: String {
        displayName.lowercased().hasPrefix("gpt-") ? "GPT " + displayName.dropFirst(4).replacingOccurrences(of: "-", with: " ") : displayName
    }
}

public struct PermissionChoice: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let detail: String
    public var disabledReason: String? = nil
    public static func title(for value: String, provider: String) -> String? {
        let mode = provider == "codex" ? CodexPermissions.builtinProfiles.first { "profile:" + $0.value == value }?.key ?? value : value
        if let choice = choices(provider: provider).first(where: { $0.id == mode }) { return choice.title }
        if provider == "codex", value.hasPrefix("profile:"), value.count > 8 { return String(value.dropFirst(8)) }
        return nil
    }
    public static func choices(provider: String) -> [Self] {
        let rows: [(String, String, String)] = switch provider {
        case "claude_code": [("default", "Ask permissions", "Ask before changes"), ("auto", "Auto", "Claude decides when to ask"), ("acceptEdits", "Auto accept edits", "Accept all edits"), ("plan", "Plan mode", "Plan before changes"), ("bypassPermissions", "Bypass permissions", "Bypass all permissions"), ("dontAsk", "Don’t ask", "Deny unapproved tools silently")]
        case "copilot_cli": [("default", "Ask permissions", "Ask before changes"), ("acceptEdits", "Auto accept edits", "Accept all edits"), ("plan", "Plan mode", "Plan before changes"), ("bypassPermissions", "Bypass permissions", "Bypass all permissions")]
        case "codex": [("read-only", "Read Only", "Read files without making changes"), ("workspace-write", "Auto", "Edit files in this workspace"), ("danger-full-access", "Full Access", "No restrictions")]
        case "cursor": [("ask", "Ask", "Ask before changes"), ("agent", "Agent", "Autonomous agent mode"), ("plan", "Plan", "Plan before executing")]
        case "opencode": [("build", "Build", "Default coding agent"), ("plan", "Plan", "Plan before changing files")]
        default: []
        }
        return rows.map { Self(id: $0.0, title: $0.1, detail: $0.2) }
    }
}

public struct CodexPermissions: Decodable, Sendable {
    // packages/contracts/src/codex-permissions.ts — aliases share presentation,
    // while the saved profile and sandbox values remain distinct.
    static let builtinProfiles = ["read-only": ":read-only", "workspace-write": ":workspace", "danger-full-access": ":danger-full-access"]
    public struct Profile: Decodable, Sendable { public let id: String; public let description: String?; public let allowed: Bool }
    public let profilesSupported: Bool
    public let profiles: [Profile]
    public let allowedSandboxModes: [String]?
    public let requiresNamedProfile: Bool
    public func choices(current: String) -> [PermissionChoice] {
        let builtins = Self.builtinProfiles
        var result = PermissionChoice.choices(provider: "codex").map { choice in
            let native = "profile:" + builtins[choice.id]!
            let profile = profiles.first { "profile:" + $0.id == native }
            let legacyBlocked = requiresNamedProfile || allowedSandboxModes.map { !$0.contains(choice.id) } == true
            let nativeAllowed = profilesSupported && profile?.allowed == true
            let useNative = profile != nil && (nativeAllowed && (current == native || legacyBlocked) || legacyBlocked && (current == native || requiresNamedProfile))
            let allowed = useNative ? profilesSupported && profile?.allowed == true : !legacyBlocked
            return PermissionChoice(id: useNative ? native : choice.id, title: choice.title, detail: useNative ? profile?.description ?? choice.detail : choice.detail,
                                    disabledReason: allowed ? nil : "Unavailable under your computer’s Codex policy.")
        }
        result += profiles.filter { !builtins.values.contains($0.id) }.map {
            PermissionChoice(id: "profile:" + $0.id, title: $0.id, detail: $0.description ?? "", disabledReason: profilesSupported && $0.allowed ? nil : "Unavailable under your computer’s Codex policy.")
        }
        return result
    }
}

public struct PromptAttachment: Encodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
    public let type: String
    public let mimeType: String
    public let data: String
    private enum CodingKeys: String, CodingKey { case name, type, mimeType, data }
    public init(name: String, type: String, mimeType: String, bytes: Data) {
        id = UUID(); self.name = name; self.type = type; self.mimeType = mimeType; data = bytes.base64EncodedString()
    }
}
