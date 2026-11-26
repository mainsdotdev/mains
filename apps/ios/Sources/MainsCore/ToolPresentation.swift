import Foundation

public struct ToolPluginIcon: Decodable, Sendable {
    let vendorID: String
    public let label: String
    public let brandColor: String?
    public let image: Data?

    private enum CodingKeys: String, CodingKey {
        case vendorID = "vendorId", label, brandColor, image = "imageBase64"
    }
}

extension ToolCall {
    /// Mirrors desktop's eventToolStatus. A background MCP result acknowledges
    /// launch only; explicit task lifecycle still owns the visible outcome.
    func statusForDisplay(overriding status: String? = nil) -> String {
        if metadata?["task"]["taskType"].string == "mcp_task" {
            return switch SubagentProjection.state(self) {
            case .running: "running"
            case .idle: "queued"
            case .done: "done"
            case .failed: "error"
            case .stopped: "canceled"
            }
        }
        return status ?? self.status
    }
}

/// Native counterpart of desktop's tool registry and status-aware ToolHeader.
public struct ToolPresentation: Sendable {
    public enum Kind: Sendable { case command, read, view, image, edit, write, delete, glob, grep, web, task, plan, todo, generic }
    public let name: String
    public let verb: String
    public let icon: String
    public let vendorID: String?
    public let kind: Kind
    public let detail: String
    public let body: String
    public let input: String
    public let showsInput: Bool
    public let stat: String
    public let added: Int
    public let removed: Int
    public let deferredInput: Bool
    public let deferredOutput: Bool
    public let running: Bool
    public let failed: Bool
    public var diff: Bool { kind == .edit || kind == .write }
    public var showsFile: Bool { [.read, .view, .edit, .write].contains(kind) && !detail.isEmpty && !deferredInput }
    public var hasDetails: Bool { !body.isEmpty || deferredOutput || showsInput && (!input.isEmpty || deferredInput) }

    private struct Definition {
        let name: String, verb: String, active: String, symbol: String, icon: String
        let kind: Kind
        let aliases: [String]
    }
    private static let definitions: [Definition] = [
        .init(name: "Todos", verb: "Updated todos", active: "Updating todos", symbol: "checklist", icon: "tool-check", kind: .todo, aliases: ["taskcreate", "taskupdate", "updatetodos", "todowrite", "update_plan"]),
        .init(name: "TaskGet", verb: "TaskGet", active: "TaskGet", symbol: "eye", icon: "tool-view", kind: .todo, aliases: ["taskget"]),
        .init(name: "TaskList", verb: "TaskList", active: "TaskList", symbol: "magnifyingglass", icon: "tool-search", kind: .todo, aliases: ["tasklist"]),
        .init(name: "WebFetch", verb: "Fetched", active: "Fetching", symbol: "globe", icon: "tool-web", kind: .web, aliases: ["webfetch", "web_fetch", "fetch", "[permission:url]"]),
        .init(name: "WebSearch", verb: "Searched", active: "Searching", symbol: "globe", icon: "tool-web", kind: .web, aliases: ["websearch", "web_search"]),
        .init(name: "Read", verb: "Read", active: "Reading", symbol: "doc.text", icon: "tool-read", kind: .read, aliases: ["read", "read_file", "[permission:read]"]),
        .init(name: "View", verb: "Viewed", active: "Viewing", symbol: "doc.text", icon: "tool-view", kind: .view, aliases: ["view"]),
        .init(name: "ImageView", verb: "Viewed", active: "Viewing", symbol: "photo", icon: "atlas-image", kind: .image, aliases: ["imageview", "image_view"]),
        .init(name: "Apply Patch", verb: "Edited", active: "Editing", symbol: "pencil", icon: "tool-edit", kind: .edit, aliases: ["apply_patch"]),
        .init(name: "Edit", verb: "Edited", active: "Editing", symbol: "pencil", icon: "tool-edit", kind: .edit, aliases: ["edit", "replace", "edit_file", "[permission:write]"]),
        .init(name: "Write", verb: "Wrote", active: "Writing", symbol: "square.and.pencil", icon: "tool-write", kind: .write, aliases: ["write", "writeifempty", "create_file", "write_file"]),
        .init(name: "Create", verb: "Wrote", active: "Writing", symbol: "square.and.pencil", icon: "tool-write", kind: .write, aliases: ["create"]),
        .init(name: "Delete", verb: "Deleted", active: "Deleting", symbol: "trash", icon: "tool-trash", kind: .delete, aliases: ["delete", "delete_file"]),
        .init(name: "Bash", verb: "Ran", active: "Running", symbol: "terminal", icon: "tool-bash", kind: .command, aliases: ["bash", "terminal", "exec_command", "command_execution", "[permission:shell]"]),
        .init(name: "Shell", verb: "Ran", active: "Running", symbol: "terminal", icon: "tool-bash", kind: .command, aliases: ["shell"]),
        .init(name: "Monitor", verb: "Monitored", active: "Monitoring", symbol: "infinity", icon: "tool-monitor", kind: .task, aliases: ["monitor"]),
        .init(name: "Glob", verb: "Searched", active: "Searching", symbol: "folder", icon: "tool-glob", kind: .glob, aliases: ["glob", "find"]),
        .init(name: "Grep", verb: "Grepped", active: "Grepping", symbol: "text.magnifyingglass", icon: "tool-grep", kind: .grep, aliases: ["grep", "rg"]),
        .init(name: "Search", verb: "Grepped", active: "Grepping", symbol: "magnifyingglass", icon: "tool-grep", kind: .grep, aliases: ["search"]),
        .init(name: "ToolSearch", verb: "Searched tools", active: "Searching tools", symbol: "magnifyingglass", icon: "tool-search", kind: .task, aliases: ["toolsearch"]),
        .init(name: "Skill", verb: "Skill", active: "Skill", symbol: "sparkles", icon: "sparkles", kind: .task, aliases: ["skill"]),
        .init(name: "Plan", verb: "Plan", active: "Plan", symbol: "list.bullet.rectangle", icon: "tool-enter-plan", kind: .plan, aliases: ["plan", "create plan"]),
        .init(name: "EnterPlanMode", verb: "Entered plan mode", active: "Entering plan mode", symbol: "list.bullet.rectangle", icon: "tool-enter-plan", kind: .plan, aliases: ["enterplanmode"]),
        .init(name: "ExitPlanMode", verb: "Plan", active: "Plan", symbol: "list.bullet.rectangle", icon: "tool-exit-plan", kind: .plan, aliases: ["exitplanmode"]),
        .init(name: "Task", verb: "Task", active: "Task", symbol: "person.crop.square", icon: "tool-task", kind: .task, aliases: ["task"]),
        .init(name: "Agent", verb: "Agent", active: "Agent", symbol: "person.crop.square", icon: "tool-task", kind: .task, aliases: ["agent"]),
        .init(name: "Workflow", verb: "Workflow", active: "Workflow", symbol: "person.crop.square", icon: "tool-workflow", kind: .task, aliases: ["workflow"]),
        .init(name: "SendMessage", verb: "Sent", active: "Sending", symbol: "paperplane", icon: "tool-send-message", kind: .task, aliases: ["sendmessage", "send_message"]),
        .init(name: "AskUserQuestion", verb: "Asked", active: "Asking", symbol: "questionmark.bubble", icon: "tool-question", kind: .task, aliases: ["askuserquestion", "ask_user", "askuser"]),
        .init(name: "Intent", verb: "Intent", active: "Intent", symbol: "note.text", icon: "tool-notes", kind: .task, aliases: ["report_intent"]),
        .init(name: "SQL", verb: "SQL", active: "SQL", symbol: "tablecells", icon: "tool-layers", kind: .generic, aliases: ["sql"]),
    ]
    static func header(for name: String) -> (name: String, symbol: String) {
        let definition = definition(for: name.lowercased())
        let fallback = name.replacingOccurrences(of: "mcp__", with: "").replacingOccurrences(of: ".", with: " ")
        return (definition?.name ?? friendlyName(fallback), definition?.symbol ?? "puzzlepiece.extension")
    }
    private static func definition(for lower: String) -> Definition? {
        lower.hasPrefix("mcp__") ? nil : Self.definitions.first { $0.aliases.contains(lower) }
            ?? Self.definitions.first { $0.aliases.contains { $0.count >= 4 && lower.contains($0) } }
    }
    fileprivate static func groupIcon(for name: String) -> (key: String, asset: String, vendorID: String?) {
        let lower = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let integration = integration(for: lower) {
            let vendorID = pluginVendorID(integration.id)
            return ("vendor:" + (vendorID ?? integration.id), integration.icon, vendorID)
        }
        let builtin = definition(for: lower)
        let key = builtin?.aliases.first ?? lower
        let asset = switch key {
        case "skill": "box"
        case "search": "tool-search"
        case "sql": "tool-sql"
        case "report_intent": "sparkles"
        default: builtin?.icon ?? "tool-generic"
        }
        return (key, asset, nil)
    }
    public static func pluginVendorIDs(in calls: [ToolCall]) -> [String] {
        var seen = Set<String>()
        return calls.reversed().compactMap { call in
            let name = call.toolName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard let vendorID = pluginVendorID(integration(for: name)?.id), seen.insert(vendorID).inserted else { return nil }
            return vendorID
        }
    }
    private static func pluginVendorID(_ id: String?) -> String? {
        // Mains and the computer-use runtime already have dedicated artwork.
        guard let id, id != "mains", id != "cua_repl", id.utf16.count <= 128 else { return nil }
        let key = id.replacingOccurrences(of: #"[\s._-]+"#, with: "", options: .regularExpression)
        return key.isEmpty ? nil : key
    }
    public init(_ call: ToolCall, status: String? = nil) {
        let lower = call.toolName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let builtin = Self.definition(for: lower)
        let integration = Self.integration(for: lower)
        let params = Self.unwrap(call.input ?? .null)
        let output = Self.unwrap(call.output ?? .null)
        let status = call.statusForDisplay(overriding: status)
        running = ["running", "queued"].contains(status)
        failed = ["error", "failed"].contains(status)
        deferredInput = params["type"].string == "mains/deferred-tool-output"
        deferredOutput = output["type"].string == "mains/deferred-tool-output"
        kind = builtin?.kind ?? .generic
        // Desktop's dedicated and MCP displays render their result, not a raw
        // argument disclosure. Only its unknown-tool fallback shows Input.
        showsInput = builtin == nil && !lower.hasPrefix("mcp__")
        name = builtin?.name ?? integration?.name ?? Self.friendlyName(call.toolName)
        let queryOnly = kind == .web && params["url"].string?.isEmpty != false && params["query"].string?.isEmpty == false
        if queryOnly { verb = running ? "Searching" : "Searched" }
        else if let builtin { verb = running ? builtin.active : builtin.verb }
        else if let integration { verb = running ? integration.active : integration.name }
        else { verb = name }
        icon = builtin?.icon ?? integration?.icon ?? "tool-generic"
        vendorID = Self.pluginVendorID(integration?.id)
        let path = Self.string(params, ["file_path", "filePath", "path", "filename", "file"])
        let title = params["_title"].string ?? ""
        let raw = params.string ?? Self.string(params, ["_raw", "patch", "input"])
        let summary: String
        switch kind {
        case .command:
            let command = Self.string(params, ["description", "command", "cmd"])
            summary = command.isEmpty ? "command" : command
        case .read:
            let value = path.isEmpty && (title.contains("/") || title.contains(".")) ? title : path
            summary = Self.shortPath(value, count: 1)
        case .delete:
            summary = path.isEmpty ? "file" : Self.shortPath(path, count: 1)
        case .view, .image, .edit, .write:
            let header = raw.components(separatedBy: "\n").first { $0.hasPrefix("*** Update File: ") || $0.hasPrefix("*** Add File: ") || $0.hasPrefix("*** Delete File: ") }
            let patchPath = header?.components(separatedBy: ": ").dropFirst().joined(separator: ": ") ?? ""
            let value = path.isEmpty ? patchPath : path
            summary = value.isEmpty ? (kind == .image ? "image" : "") : TranscriptMedia.fileName(value)
        case .glob: summary = params["pattern"].string ?? "?"
        case .grep: summary = Self.string(params, ["pattern", "query", "regex"])
        case .web: summary = Self.string(params, ["url", "query"])
        default:
            if integration?.id == "cua_repl" { summary = Self.string(params, ["title", "code"]) }
            else if integration != nil { summary = "" }
            else { summary = Self.string(params, ["description", "summary", "skill", "name", "question", "query", "title", "message"]) }
        }
        detail = String((deferredInput ? params["preview"].string ?? summary : summary).replacingOccurrences(of: "\n", with: " ").prefix(300))
        input = deferredInput ? params["preview"].string ?? "" : Self.hasInputContent(params) ? Self.text(params) : ""
        var outputText = deferredOutput ? output["preview"].string ?? "" : Self.text(output)
        var files = (output["filenames"].array.isEmpty ? output["files"].array : output["filenames"].array).compactMap(\.string)
        if !deferredOutput {
            if kind == .glob, let raw = output.string {
                files = raw.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            }
            if kind == .glob, !files.isEmpty || output["numFiles"].number != nil || output["filenames"] != .null {
                outputText = files.map { Self.shortPath($0, count: 3) }.joined(separator: "\n")
            }
            if kind == .grep, !files.isEmpty {
                outputText = output["content"].string ?? files.map { Self.shortPath($0, count: 3) }.joined(separator: "\n")
            }
        }
        var diffLines: [String] = []
        if kind == .edit || kind == .write, !deferredOutput {
            for hunk in output["structuredPatch"].array { diffLines += hunk["lines"].array.compactMap(\.string) }
            if diffLines.isEmpty {
                let unified = Self.string(output, ["diff", "patch", "detailedContent"])
                let patch = !unified.isEmpty ? unified : raw.contains("*** Begin Patch") ? raw : ""
                if !patch.isEmpty { diffLines = patch.components(separatedBy: "\n").filter { !$0.hasPrefix("***") } }
            }
            if diffLines.isEmpty {
                let before = Self.string(params, ["old_string", "old_str"])
                let after = Self.string(params, ["new_string", "new_str", "content", "contents", "file_text"])
                if !before.isEmpty { diffLines += before.components(separatedBy: "\n").map { "-" + $0 } }
                if !after.isEmpty { diffLines += after.components(separatedBy: "\n").map { "+" + $0 } }
            }
            if !diffLines.isEmpty { outputText = diffLines.joined(separator: "\n") }
        }
        let cleanOutput = outputText.replacingOccurrences(of: "\u{1B}\\[[0-9;?]*[ -/]*[@-~]", with: "", options: .regularExpression)
        body = kind == .command ? cleanOutput.trimmingCharacters(in: .whitespacesAndNewlines) : cleanOutput
        added = diffLines.filter { $0.hasPrefix("+") && !$0.hasPrefix("+++") }.count
        removed = diffLines.filter { $0.hasPrefix("-") && !$0.hasPrefix("---") }.count
        let previewLines = body.isEmpty || deferredOutput ? 0 : body.components(separatedBy: "\n").count
        let lines = Self.count(output["numLines"]) ?? Self.count(output["file"]["numLines"])
        let fileCount = Self.count(output["numFiles"]) ?? Self.count(output["totalFiles"]) ?? files.count
        switch kind {
        case .glob:
            stat = fileCount > 0 ? "\(fileCount) files" : ""
        case .grep:
            let matches = Self.count(output["totalMatches"]) ?? 0
            let lineCount = lines ?? (output.string == nil ? 0 : previewLines)
            let stats = [
                matches > 0 ? "\(matches) matches" : nil,
                lineCount > 0 && lineCount != matches ? "\(lineCount) lines" : nil,
                fileCount > 0 ? "\(fileCount) files" : nil,
                output["truncated"].bool ? "truncated" : nil,
            ].compactMap { $0 }
            stat = stats.isEmpty ? "" : "(\(stats.joined(separator: ", ")))"
        case .read:
            let lineCount = lines ?? previewLines
            stat = lineCount > 0 ? "(\(lineCount) lines)" : ""
        case .view:
            let lineCount = lines ?? body.split(separator: "\n").count
            stat = !deferredOutput && lineCount > 0 ? "\(lineCount) lines" : ""
        case .web:
            stat = Self.count(params["max_length"]).map { "(max \($0))" } ?? ""
        default:
            stat = ""
        }
    }
    private static func shortPath(_ value: String, count: Int) -> String {
        let parts = value.components(separatedBy: CharacterSet(charactersIn: "/\\"))
        guard parts.count > 3 else { return value }
        return (count == 1 ? "" : ".../") + parts.suffix(count).joined(separator: "/")
    }
    private static func count(_ value: JSONValue) -> Int? {
        guard let number = value.number, number >= 0, number < 1_000_000_000 else { return nil }
        return Int(number)
    }
    public static func unwrap(_ value: JSONValue) -> JSONValue {
        if value == .object(["$undefined": .bool(true)]) { return .null }
        var result = value
        for _ in 0..<2 {
            guard let string = result.string, let data = string.data(using: .utf8), let parsed = try? JSONDecoder().decode(JSONValue.self, from: data) else { break }
            result = parsed
        }
        return result
    }
    private static func string(_ value: JSONValue, _ keys: [String]) -> String {
        keys.compactMap { value[$0].string }.first { !$0.isEmpty } ?? ""
    }
    private static func hasInputContent(_ value: JSONValue) -> Bool {
        switch value {
        case .null: return false
        case .object(let fields): return !fields.isEmpty
        case .array(let items): return !items.isEmpty
        case .string(let text): return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        default: return true
        }
    }
    fileprivate struct Integration {
        let id: String
        let label: String
        let name: String
        let active: String
        let icon: String
    }
    private static let integrationVerbs = [
        "list": ("listed", "listing"), "get": ("got", "getting"), "view": ("viewed", "viewing"),
        "fetch": ("fetched", "fetching"), "read": ("read", "reading"), "search": ("searched", "searching"),
        "research": ("researched", "researching"), "save": ("saved", "saving"), "create": ("created", "creating"),
        "update": ("updated", "updating"), "delete": ("deleted", "deleting"), "archive": ("archived", "archiving"),
        "extract": ("extracted", "extracting"), "add": ("added", "adding"), "remove": ("removed", "removing"),
        "send": ("sent", "sending"), "run": ("ran", "running"), "draft": ("drafted", "drafting"),
        "reply": ("replied", "replying"), "open": ("opened", "opening"), "close": ("closed", "closing"),
    ]
    fileprivate static func integration(for lower: String) -> Integration? {
        guard lower.hasPrefix("mcp__") else { return nil }
        let parts = String(lower.dropFirst(5)).components(separatedBy: "__")
        let server = parts[0]
        var tool = parts.dropFirst().joined(separator: "__")
        if server == "cua_repl" {
            return Integration(id: server, label: "Computer use", name: "Computer use", active: "Computer use", icon: "tool-cursor")
        }
        var id = server
        if server != "mains" {
            let dot = tool.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
            let prefix = tool.split(separator: "_", maxSplits: 1, omittingEmptySubsequences: false)
            if dot.count == 2 && !dot[0].isEmpty {
                id = String(dot[0])
                tool = String(dot[1])
            } else if prefix.count == 2 && !prefix[0].isEmpty && integrationVerbs[String(prefix[0])] == nil {
                id = String(prefix[0])
                tool = String(prefix[1])
            }
        }
        let label = friendlyName(id)
        let icon = id == "mains" ? "tool-mains" : "tool-generic"
        let verb = tool.split(separator: "_", maxSplits: 1, omittingEmptySubsequences: false)
        if let key = verb.first, let (past, present) = integrationVerbs[String(key)] {
            let entity = verb.dropFirst().first?.replacingOccurrences(of: "_", with: " ") ?? ""
            return Integration(id: id, label: label, name: [label, past, entity].filter { !$0.isEmpty }.joined(separator: " "),
                               active: [label, present, entity].filter { !$0.isEmpty }.joined(separator: " "), icon: icon)
        }
        let name = [label, tool.replacingOccurrences(of: "_", with: " ")].filter { !$0.isEmpty }.joined(separator: " ")
        return Integration(id: id, label: label, name: name, active: name, icon: icon)
    }
    public static func text(_ value: JSONValue) -> String {
        if let text = value.string { return text }
        if value == .null { return "" }
        if let text = value["stdout"].string ?? value["text"].string ?? value["file"]["content"].string { return text }
        if value["content"] != .null { return Self.text(value["content"]) }
        if case .array(let array) = value {
            return array.map(Self.text).filter { !$0.isEmpty }.joined(separator: "\n")
        }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(value)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }
    private static func friendlyName(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "[_-]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "Tool" : cleaned.prefix(1).uppercased() + cleaned.dropFirst()
    }
}

/// A stable sentence about the work, independent of individual call lifecycle.
/// Keep phrases/ranks aligned with desktop's tool-group-summary/tool-registry.
public struct ToolGroupPresentation: Sendable {
    public let summary: String
    public struct Icon: Identifiable, Sendable {
        public let id: String
        public let asset: String
        public let vendorID: String?
    }
    public let icons: [Icon]
    private struct Phrase {
        let one: String, many: String
        let rank: Int
        init(_ one: String, _ many: String, _ rank: Int) { self.one = one; self.many = many; self.rank = rank }
    }
    private static let phrases: [String: Phrase] = [
        "atlasreadpage": .init("read an Atlas page", "read Atlas pages", 30),
        "atlasupdatepage": .init("updated an Atlas page", "updated Atlas pages", 20),
        "atlascreatepage": .init("created an Atlas page", "created Atlas pages", 20),
        "atlaslistcovers": .init("browsed Atlas covers", "browsed Atlas covers", 30),
        "atlasreadpage:failed": .init("tried to read an Atlas page", "tried to read Atlas pages", 30),
        "atlasupdatepage:failed": .init("tried to update an Atlas page", "tried to update Atlas pages", 20),
        "atlascreatepage:failed": .init("tried to create an Atlas page", "tried to create Atlas pages", 20),
        "atlaslistcovers:failed": .init("tried to browse Atlas covers", "tried to browse Atlas covers", 30),
        "skill": .init("loaded a tool", "loaded tools", 10),
        "intent": .init("stated its intent", "stated its intent", 10),
        "enterplanmode": .init("entered plan mode", "entered plan mode", 12),
        "exitplanmode": .init("shared a plan", "shared a plan", 12),
        "plan": .init("wrote a plan", "wrote plans", 12),
        "taskget": .init("checked the plan", "checked the plan", 12),
        "tasklist": .init("listed the plan", "listed the plan", 12),
        "edit": .init("edited a file", "edited files", 20),
        "write": .init("wrote a file", "wrote files", 20),
        "create": .init("created a file", "created files", 20),
        "apply_patch": .init("applied a patch", "applied patches", 20),
        "delete": .init("deleted a file", "deleted files", 22),
        "read": .init("read a file", "read files", 30),
        "view": .init("viewed a file", "viewed files", 30),
        "imageview": .init("viewed an image", "viewed images", 30),
        "glob": .init("looked for files", "looked for files", 32),
        "grep": .init("searched the code", "searched the code", 32),
        "search": .init("searched", "searched", 32),
        "toolsearch": .init("looked up a tool", "looked up tools", 32),
        "webfetch": .init("read a page", "read pages", 35),
        "websearch": .init("searched the web", "searched the web", 35),
        "bash": .init("ran a command", "ran commands", 40),
        "shell": .init("ran a command", "ran commands", 40),
        "monitor": .init("watched a command", "watched commands", 42),
        "sql": .init("ran a query", "ran queries", 42),
        "task": .init("ran an agent", "ran agents", 50),
        "agent": .init("ran an agent", "ran agents", 50),
        "workflow": .init("ran a workflow", "ran workflows", 50),
        "sendmessage": .init("messaged an agent", "messaged agents", 52),
        "askuserquestion": .init("asked a question", "asked questions", 54),
        "checkpackage": .init("checked a package", "checked packages", 60),
        "savereview": .init("saved a review", "saved reviews", 60),
        "savefinding": .init("saved a finding", "saved findings", 60),
        "savefindings": .init("saved findings", "saved findings", 60),
    ]
    private static let aliases: [String: String] = [
        "read_file": "read", "[permission:read]": "read", "image_view": "imageview",
        "replace": "edit", "edit_file": "edit", "[permission:write]": "edit",
        "writeifempty": "write", "create_file": "write", "write_file": "write", "delete_file": "delete",
        "terminal": "bash", "[permission:shell]": "bash", "exec_command": "bash", "command_execution": "bash",
        "find": "glob", "rg": "grep", "web_fetch": "webfetch", "fetch": "webfetch", "web_search": "websearch",
        "report_intent": "intent", "create plan": "plan", "send_message": "sendmessage",
        "ask_user": "askuserquestion", "askuser": "askuserquestion",
    ]
    public init(_ calls: [ToolCall]) {
        var seenIcons: Set<String> = []
        var groupIcons: [Icon] = []
        for call in calls where groupIcons.count < 3 {
            let icon = ToolPresentation.groupIcon(for: call.toolName)
            if seenIcons.insert(icon.key).inserted { groupIcons.append(Icon(id: icon.key, asset: icon.asset, vendorID: icon.vendorID)) }
        }
        icons = groupIcons
        if !calls.isEmpty && calls.allSatisfy({ $0.metadata?["codexItemType"].string == "imageView" }) {
            summary = calls.count == 1 ? "Viewed an image" : "Viewed \(calls.count) images"
            return
        }
        struct Clause { let phrase: Phrase; let order: Int; var count: Int }
        var clauses: [String: Clause] = [:], vendors: [String] = [], vendorIDs: Set<String> = []
        var vendorOrder = Int.max
        for (order, call) in calls.enumerated() {
            let lower = call.toolName.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            let bare = lower.replacingOccurrences(of: "mcp__mains__", with: "")
            if let vendor = ToolPresentation.integration(for: lower),
               vendor.id != "mains" || Self.phrases[bare] == nil && !bare.hasPrefix("atlas") {
                if vendorIDs.insert(vendor.id).inserted { vendors.append(vendor.label) }
                vendorOrder = min(vendorOrder, order)
                continue
            }
            let alias = Self.aliases[bare] ?? bare
            let key = Self.phrases[alias] != nil ? alias : ToolPresentation.header(for: call.toolName).name.lowercased()
            let failedAtlas = key.hasPrefix("atlas") && (["error", "failed", "canceled"].contains(call.status) || ToolPresentation.unwrap(call.output ?? .null)["isError"].bool)
            let clauseKey = key + (failedAtlas ? ":failed" : "")
            let fallback = "used \(ToolPresentation.header(for: call.toolName).name)"
            let phrase = Self.phrases[clauseKey] ?? .init(fallback, fallback, 70)
            if clauses[clauseKey] != nil { clauses[clauseKey]?.count += 1 }
            else { clauses[clauseKey] = Clause(phrase: phrase, order: order, count: 1) }
        }
        var parts = clauses.values.map { (rank: $0.phrase.rank, order: $0.order, text: $0.count == 1 ? $0.phrase.one : $0.phrase.many) }
        if let last = vendors.last {
            let names = vendors.count == 1 ? last : vendors.dropLast().joined(separator: ", ") + " and " + last
            parts.append((15, vendorOrder, "used the \(names) \(vendors.count == 1 ? "integration" : "integrations")"))
        }
        let sentence = parts.sorted { $0.rank == $1.rank ? $0.order < $1.order : $0.rank < $1.rank }.prefix(3).map(\.text).joined(separator: ", ")
        summary = sentence.prefix(1).uppercased() + sentence.dropFirst()
    }

}

/// Consecutive calls share one work summary; messages keep their original order.
public struct TranscriptGroup: Identifiable, Sendable {
    public private(set) var rows: [TranscriptRow]
    public private(set) var browserActivity: TranscriptRow? = nil
    public var id: String { rows[0].id }
    public static func build(_ rows: [TranscriptRow]) -> [Self] {
        var groups: [Self] = []
        var lastBrowserCall: (groupIndex: Int, turnID: Int?)?
        var followsBrowserActivity = false
        for row in rows {
            if row.kind == .prompt { lastBrowserCall = nil }
            if row.kind == .browserActivity {
                if let call = lastBrowserCall, call.turnID == nil || row.turnID == nil || call.turnID == row.turnID {
                    groups[call.groupIndex].browserActivity = row
                } else { groups.append(Self(rows: [row])) }
                lastBrowserCall = nil
                followsBrowserActivity = true
                continue
            }
            if !followsBrowserActivity, let last = groups.last, (row.kind == .tool || row.kind == .media), last.rows.first?.kind == row.kind,
               row.plan == nil, last.rows.first?.plan == nil {
                groups[groups.count - 1].rows.append(row)
            } else { groups.append(Self(rows: [row])) }
            followsBrowserActivity = false
            if let name = row.tool?.toolName, ToolPresentation.integration(for: name.lowercased())?.id == "cua_repl" {
                lastBrowserCall = (groups.count - 1, row.turnID)
            }
        }
        return groups
    }
}
