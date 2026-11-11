import Foundation

/// Device-safe catalogue metadata. Paths refer to the computer and are never opened by the phone.
public struct ContextSkill: Codable, Hashable, Identifiable, Sendable {
    public let name: String
    public var displayName: String?
    public var description: String?
    public var shortDescription: String?
    public var argumentHint: String?
    public var userInvokable: Bool?
    public var path: String?
    public var iconSmall: String?
    public var iconLarge: String?
    public var brandColor: String?
    public var scope: String?
    public var id: String { name }
    public var title: String { displayName.flatMap { $0.isEmpty ? nil : $0 } ?? name }
    public var detail: String? {
        [shortDescription, description].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.first { !$0.isEmpty }
    }
    public var group: String {
        switch scope?.lowercased() { case "plugin": "Plugins"; case "mac", "mac_app", "computer": "Mac apps"; default: "Skills" }
    }
    public var badge: String {
        switch scope?.lowercased() {
        case "user": "User"
        case "project", "repo": "Project"
        case "system": "System"
        case "plugin": "Plugin"
        case "mac", "mac_app", "computer": "Mac app"
        default: "Skill"
        }
    }
    public init(name: String, displayName: String? = nil, description: String? = nil, scope: String? = nil, path: String? = nil) {
        self.name = name; self.displayName = displayName; self.description = description; self.scope = scope; self.path = path
    }
    public init(from decoder: Decoder) throws {
        let v = try JSONValue(from: decoder)
        guard let name = v["name"].string, !name.isEmpty else { throw MainsError.invalidReply }
        self.name = name; displayName = v["displayName"].string; description = v["description"].string
        shortDescription = v["shortDescription"].string; argumentHint = v["argumentHint"].string
        if case .bool(let value) = v["userInvokable"] { userInvokable = value }
        path = v["path"].string; iconSmall = v["iconSmall"].string; iconLarge = v["iconLarge"].string
        brandColor = v["brandColor"].string
        // Claude's local skill discovery uses source; desktop falls back to it
        // when scope is absent. Keep the same User/Project presentation here.
        scope = [v["scope"].string, v["source"].string].compactMap { $0 }.first { !$0.isEmpty }
    }
    /// Only the context fields accepted by execute/continue, without catalogue flags.
    public var wire: JSONValue {
        var value: [String: JSONValue] = ["name": .string(name)]
        for (key, item) in [("displayName", displayName), ("description", description), ("shortDescription", shortDescription),
                            ("path", path), ("iconSmall", iconSmall), ("iconLarge", iconLarge), ("brandColor", brandColor), ("scope", scope)] {
            if let item { value[key] = .string(item) }
        }
        return .object(value)
    }
}

public struct ContextCommand: Codable, Hashable, Identifiable, Sendable {
    public let name: String
    public var description: String?
    public var argumentHint: String?
    public var userFacing: Bool?
    public var id: String { name }
    public init(name: String, description: String? = nil, argumentHint: String? = nil, userFacing: Bool? = nil) {
        self.name = name; self.description = description; self.argumentHint = argumentHint; self.userFacing = userFacing
    }
    public init(from decoder: Decoder) throws {
        let v = try JSONValue(from: decoder)
        guard let name = v["name"].string, !name.isEmpty else { throw MainsError.invalidReply }
        self.name = name; description = v["description"].string; argumentHint = v["argumentHint"].string
        if case .bool(let value) = v["userFacing"] { userFacing = value }
    }
}

public struct ContextScope: Hashable, Sendable {
    public let providerID: String
    public let workspaceID: String?
    public let workspacePath: String?
    public init(providerID: String, workspaceID: String? = nil, workspacePath: String? = nil) {
        self.providerID = providerID; self.workspaceID = workspaceID; self.workspacePath = workspacePath
    }
}

public struct ContextCatalogue: Equatable, Sendable {
    public var skills: [ContextSkill] = []
    public var commands: [ContextCommand] = []
    public var error: String?
    public init() {}
    public static func skills(from value: JSONValue) throws -> [ContextSkill] {
        try namedRows(value, key: "skills").map { try $0.decode(ContextSkill.self) }
    }
    public static func commands(from value: JSONValue) throws -> [ContextCommand] {
        try namedRows(value, key: "commands").map { try $0.decode(ContextCommand.self) }
    }
    private static func namedRows(_ value: JSONValue, key: String) throws -> [JSONValue] {
        let source: JSONValue
        if case .array = value { source = value } else { source = value[key] }
        guard case .array(let rows) = source else { throw MainsError.invalidReply }
        // Match RN's name filter before decoding: a nameless provider row must
        // not take valid skills, commands and their metadata out of the picker.
        return rows.filter { $0["name"].string?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false }
    }
    public mutating func replaceSkills(_ source: [ContextSkill]) {
        var seen: Set<String> = []
        skills = source.filter { seen.insert($0.name).inserted }.filter { $0.userInvokable != false }
    }
    public mutating func replaceCommands(_ source: [ContextCommand]) {
        var seen: Set<String> = []
        commands = source.filter { seen.insert($0.name).inserted }.filter { $0.userFacing != false }
    }
    public func matchingSkills(_ query: String, pluginsOnly: Bool = false) -> [ContextSkill] {
        skills.filter { (!pluginsOnly || $0.group == "Plugins") && (query.isEmpty || [$0.name, $0.displayName, $0.shortDescription, $0.description].compactMap { $0 }.contains { $0.localizedCaseInsensitiveContains(query) }) }
    }
    public func matchingCommands(_ query: String, trigger: String?, pluginsOnly: Bool = false) -> [ContextCommand] {
        guard !pluginsOnly, trigger != "$" else { return [] }
        return commands.filter { query.isEmpty || [$0.name, $0.description].compactMap { $0 }.contains { $0.localizedCaseInsensitiveContains(query) } }
    }
}

public struct ContextTriggerMatch: Equatable, Sendable {
    public let trigger: String
    public let filter: String
    public let range: Range<String.Index>
}

public enum ContextMentions {
    public static let marker = "\u{2063}"
    public static func detect(_ text: String) -> ContextTriggerMatch? {
        guard let range = text.range(of: #"(?:^|\s)[/@$]\S*$"#, options: .regularExpression) else { return nil }
        let token = text[range].drop(while: { $0.isWhitespace })
        guard let start = token.startIndex.samePosition(in: text), let first = token.first else { return nil }
        return ContextTriggerMatch(trigger: String(first), filter: String(token.dropFirst()), range: start..<text.endIndex)
    }
    public static func replacingTrigger(in text: String, with replacement: String) -> String {
        if let match = detect(text) { return String(text[..<match.range.lowerBound]) + (replacement.isEmpty ? "" : replacement + " ") }
        return text + (text.isEmpty || text.last?.isWhitespace == true ? "" : " ") + replacement + " "
    }
    public static func mention(_ skill: ContextSkill) -> String { skill.title + marker }
    public static func attached(in text: String, skills: [ContextSkill]) -> [ContextSkill] {
        skills.filter { text.contains(mention($0)) }
    }
    public static func removing(_ skill: ContextSkill, from text: String) -> String {
        text.replacingOccurrences(of: mention(skill), with: "").replacingOccurrences(of: #" {2,}"#, with: " ", options: .regularExpression)
    }
    public static func goal(_ text: String, skills: [ContextSkill]) -> String {
        var result = text
        for skill in skills { result = result.replacingOccurrences(of: mention(skill), with: "$" + skill.name) }
        return result.replacingOccurrences(of: marker, with: "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
    public static func display(_ text: String, skills: [ContextSkill]) -> String {
        var result = text
        for skill in skills.sorted(by: { $0.name.count > $1.name.count }) {
            let pattern = #"\$"# + NSRegularExpression.escapedPattern(for: skill.name) + #"(?![\w/-])"#
            if let expression = try? NSRegularExpression(pattern: pattern) {
                result = expression.stringByReplacingMatches(in: result, range: NSRange(result.startIndex..., in: result), withTemplate: NSRegularExpression.escapedTemplate(for: skill.title))
            }
        }
        return result.replacingOccurrences(of: marker, with: "")
    }
}
