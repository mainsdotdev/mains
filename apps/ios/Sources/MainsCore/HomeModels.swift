import Foundation

public enum Experience {
    public static func label(_ mode: String) -> String {
        switch mode { case "developer": "Code"; case "work": "Work"; case "chat": "Chat"; default: mode.capitalized }
    }
    // packages/contracts/src/modes.ts — provider and experience are independent.
    public static func modes(for provider: String) -> [String] {
        ["copilot_cli", "cursor", "opencode"].contains(provider) ? ["developer"] : ["developer", "work", "chat"]
    }

    // Mirrors the backend's assistant mention modes and Code workspace requirement.
    public static func allowsMateMentions(_ mode: String?, isMateConversation: Bool, hasLocalWorkspace: Bool) -> Bool {
        !isMateConversation && (mode == "work" || mode == "developer" && hasLocalWorkspace)
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
    public var defaultBranch: String? = nil
    public var isArchived: Bool? = nil
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
    /// Display older incompatible settings without silently writing a repair.
    /// Explicit model selection saves the same compatible value below.
    public func effort(provider: String, model: ModelChoice?) -> String {
        let value = effort(provider: provider)
        guard provider == "claude_code", value == "ultracode", let model else { return value }
        let levels = model.supportedEffortLevels ?? []
        guard !EffortControlKind.supportsUltracode(provider: provider, levels: levels) else { return value }
        return EffortControlKind.ordered(levels).last ?? ""
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
        let compatible = effort(provider: provider, model: model)
        if compatible != current {
            let thinking = config["thinkingMode"]?.bool ?? true
            setEffort(compatible, provider: provider)
            // Claude models with no graded effort still have a Thinking switch.
            if levels.isEmpty { config["thinkingMode"] = .bool(thinking) }
        } else if !levels.isEmpty, !current.isEmpty, current != "ultracode", !levels.contains(current) {
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
    public static func effortLabel(_ value: String, provider: String? = nil) -> String {
        switch value {
        case "": ["codex", "opencode"].contains(provider ?? "") ? "Default" : "Off"
        case "xhigh": "Extra High"
        default: value.capitalized
        }
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
    /// Compact composer label; catalogue identities and provider groups stay intact.
    public func label(for providerID: String) -> String {
        switch providerID {
        case "claude_code": claudeLabel
        case "opencode": OpenCodeModelDisplay.parts(displayName)?.name ?? name
        default: name
        }
    }

    // Older Claude catalogues put the version in the lead-in to the description.
    // Match desktop's model-display.ts and retain the catalogue name for taglines.
    private var claudeLabel: String {
        guard let description else { return name }
        let prefix = description.prefix(while: { $0 != "·" }).trimmingCharacters(in: .whitespacesAndNewlines)
        let contextSuffix = " with 1M context"
        guard description.contains("·") || prefix.hasSuffix(contextSuffix) else { return name }

        func withoutBrand(_ value: String) -> String {
            value.replacingOccurrences(of: #"^Claude\s+"#, with: "", options: [.regularExpression, .caseInsensitive])
        }
        let catalogueName = withoutBrand(displayName).trimmingCharacters(in: .whitespacesAndNewlines)
        let describedName = withoutBrand(prefix)
        guard !catalogueName.isEmpty, describedName.lowercased().hasPrefix(catalogueName.lowercased()) else { return name }
        if let boundary = describedName.dropFirst(catalogueName.count).first,
           !boundary.isWhitespace, boundary != "(", boundary != "[" { return name }
        return prefix.hasSuffix(contextSuffix) ? String(prefix.dropLast(contextSuffix.count)) + " [1M]" : prefix
    }
}

/// Mirrors desktop's model-display.ts; presentation never replaces a catalogue id.
public enum OpenCodeModelDisplay {
    public struct Parts: Equatable, Sendable {
        public let provider: String
        public let name: String
    }
    public struct Group: Identifiable, Sendable {
        public var id: String { provider }
        public let provider: String
        public var models: [ModelChoice]
    }
    private static let providers = [
        "github-copilot": "GitHub Copilot", "copilot": "GitHub Copilot", "openai": "OpenAI",
        "anthropic": "Anthropic", "google": "Google", "opencode": "OpenCode", "openrouter": "OpenRouter",
        "groq": "Groq", "mistral": "Mistral", "xai": "xAI", "azure": "Azure",
        "amazon-bedrock": "Amazon Bedrock", "bedrock": "Amazon Bedrock", "claude-agent": "Claude",
    ]
    public static func parts(_ model: String) -> Parts? {
        guard let slash = model.firstIndex(of: "/"), slash > model.startIndex else { return nil }
        let slug = String(model[..<slash]).trimmingCharacters(in: .whitespacesAndNewlines)
        let name = String(model[model.index(after: slash)...]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !slug.isEmpty, !name.isEmpty else { return nil }
        let provider = providers[slug.lowercased()] ?? slug.split(separator: "-").map { word in
            word.count <= 2 ? word.uppercased() : String(word.prefix(1)).uppercased() + word.dropFirst()
        }.joined(separator: " ")
        return Parts(provider: provider, name: name)
    }
    public static func groups(_ models: [ModelChoice]) -> [Group] {
        var result: [Group] = [], indices: [String: Int] = [:]
        for model in models {
            let provider = parts(model.displayName)?.provider ?? "Other"
            if let index = indices[provider] { result[index].models.append(model) }
            else { indices[provider] = result.count; result.append(Group(provider: provider, models: [model])) }
        }
        return result
    }
}

public struct PermissionChoice: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let detail: String
    public var shortTitle: String? = nil
    public var disabledReason: String? = nil

    public static func shortTitle(for value: String, provider: String) -> String? {
        let mode = provider == "codex" ? CodexPermissions.builtinProfiles.first { "profile:" + $0.value == value }?.key ?? value : value
        if let choice = choices(provider: provider).first(where: { $0.id == mode }) { return choice.shortTitle ?? choice.title }
        if provider == "codex", value.hasPrefix("profile:"), value.count > 8 { return String(value.dropFirst(8)) }
        return nil
    }

    public static func choices(provider: String) -> [Self] {
        switch provider {
        case "claude_code": [
            Self(id: "default", title: "Ask permissions", detail: "Ask before changes", shortTitle: "Ask"),
            Self(id: "auto", title: "Auto", detail: "Claude decides when to ask"),
            Self(id: "acceptEdits", title: "Accept edits", detail: "Accept all edits"),
            Self(id: "plan", title: "Plan mode", detail: "Plan before changes", shortTitle: "Plan"),
            Self(id: "bypassPermissions", title: "Bypass permissions", detail: "Bypass all permissions", shortTitle: "Bypass"),
            Self(id: "dontAsk", title: "Don’t ask", detail: "Deny unapproved tools silently"),
        ]
        case "copilot_cli": [
            Self(id: "default", title: "Ask permissions", detail: "Ask before changes", shortTitle: "Ask"),
            Self(id: "acceptEdits", title: "Auto accept edits", detail: "Accept all edits", shortTitle: "Accept edits"),
            Self(id: "plan", title: "Plan mode", detail: "Plan before changes", shortTitle: "Plan"),
            Self(id: "bypassPermissions", title: "Bypass permissions", detail: "Bypass all permissions", shortTitle: "Bypass"),
        ]
        case "codex": [
            Self(id: "read-only", title: "Read Only", detail: "Read files without making changes"),
            Self(id: "workspace-write", title: "Auto", detail: "Edit files in this workspace"),
            Self(id: "danger-full-access", title: "Full Access", detail: "No restrictions"),
        ]
        case "cursor": [
            Self(id: "ask", title: "Ask", detail: "Ask before changes"),
            Self(id: "agent", title: "Agent", detail: "Autonomous agent mode"),
            Self(id: "plan", title: "Plan", detail: "Plan before executing"),
        ]
        case "opencode": [
            Self(id: "build", title: "Build", detail: "Default coding agent"),
            Self(id: "plan", title: "Plan", detail: "Plan before changing files"),
        ]
        default: []
        }
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
