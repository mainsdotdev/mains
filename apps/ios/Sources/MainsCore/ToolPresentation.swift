import Foundation

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
    public enum Kind: Sendable { case command, read, edit, write, delete, glob, grep, web, task, plan, todo, generic }
    public let name: String
    public let verb: String
    public let symbol: String
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
    public var hasDetails: Bool { !body.isEmpty || deferredOutput || showsInput && (!input.isEmpty || deferredInput) }

    private struct Definition {
        let name: String, verb: String, active: String, symbol: String
        let kind: Kind
        let aliases: [String]
    }
    private static let definitions: [Definition] = [
        .init(name: "Todos", verb: "Updated todos", active: "Updating todos", symbol: "checklist", kind: .todo, aliases: ["taskcreate", "taskupdate", "taskget", "tasklist", "updatetodos", "todowrite", "update_plan"]),
        .init(name: "WebFetch", verb: "Fetched", active: "Fetching", symbol: "globe", kind: .web, aliases: ["webfetch", "web_fetch", "fetch"]),
        .init(name: "WebSearch", verb: "Searched", active: "Searching", symbol: "globe", kind: .web, aliases: ["websearch", "web_search"]),
        .init(name: "Read", verb: "Read", active: "Reading", symbol: "doc.text", kind: .read, aliases: ["read", "read_file", "view"]),
        .init(name: "Edit", verb: "Edited", active: "Editing", symbol: "pencil", kind: .edit, aliases: ["edit", "replace", "edit_file", "apply_patch"]),
        .init(name: "Write", verb: "Wrote", active: "Writing", symbol: "square.and.pencil", kind: .write, aliases: ["write", "writeifempty", "create_file", "write_file", "create"]),
        .init(name: "Delete", verb: "Deleted", active: "Deleting", symbol: "trash", kind: .delete, aliases: ["delete", "delete_file"]),
        .init(name: "Bash", verb: "Ran", active: "Running", symbol: "terminal", kind: .command, aliases: ["bash", "terminal", "shell", "exec_command", "command_execution", "monitor"]),
        .init(name: "Glob", verb: "Searched", active: "Searching", symbol: "folder", kind: .glob, aliases: ["glob", "find"]),
        .init(name: "Grep", verb: "Grepped", active: "Grepping", symbol: "text.magnifyingglass", kind: .grep, aliases: ["grep", "rg", "search", "toolsearch"]),
        .init(name: "Skill", verb: "Skill", active: "Using skill", symbol: "sparkles", kind: .task, aliases: ["skill"]),
        .init(name: "Plan", verb: "Plan", active: "Planning", symbol: "list.bullet.rectangle", kind: .plan, aliases: ["plan", "enterplanmode", "exitplanmode", "create plan"]),
        .init(name: "Task", verb: "Ran subagent", active: "Running subagent", symbol: "person.crop.square", kind: .task, aliases: ["task", "agent", "workflow", "sendmessage", "send_message"]),
        .init(name: "SQL", verb: "SQL", active: "Querying", symbol: "tablecells", kind: .generic, aliases: ["sql"]),
    ]
    static func header(for name: String) -> (name: String, symbol: String) {
        let definition = definition(for: name.lowercased())
        return (definition?.name ?? friendlyName(name), definition?.symbol ?? "puzzlepiece.extension")
    }
    private static func definition(for lower: String) -> Definition? {
        lower.hasPrefix("mcp__") ? nil : Self.definitions.first { $0.aliases.contains(lower) }
            ?? Self.definitions.first { $0.aliases.contains { $0.count >= 4 && lower.contains($0) } }
    }
    public init(_ call: ToolCall, status: String? = nil) {
        let lower = call.toolName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let builtin = Self.definition(for: lower)
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
        name = builtin?.name ?? Self.friendlyName(call.toolName)
        verb = running ? (builtin?.active ?? name) + "…" : builtin?.verb ?? name
        symbol = builtin?.symbol ?? (lower.hasPrefix("mcp__") ? "puzzlepiece.extension" : "wrench.and.screwdriver")
        let path = Self.string(params, ["file_path", "filePath", "path", "filename", "file"])
        let raw = params.string ?? Self.string(params, ["_raw", "patch", "input"])
        let summary: String
        switch kind {
        case .command: summary = Self.string(params, ["description", "command", "cmd"])
        case .read, .edit, .write, .delete:
            let patchPath = raw.components(separatedBy: "\n").first { $0.hasPrefix("*** Update File: ") || $0.hasPrefix("*** Add File: ") }?.components(separatedBy: ": ").dropFirst().joined(separator: ": ") ?? ""
            let value = path.isEmpty ? patchPath : path
            summary = value.isEmpty ? "" : TranscriptMedia.fileName(value)
        case .glob: summary = Self.string(params, ["pattern", "path"])
        case .grep: summary = Self.string(params, ["pattern", "query", "regex"])
        case .web: summary = Self.string(params, ["url", "query"])
        default: summary = Self.string(params, ["description", "summary", "skill", "name", "question", "query", "title", "message"])
        }
        detail = String((deferredInput ? params["preview"].string ?? summary : summary).replacingOccurrences(of: "\n", with: " ").prefix(300))
        input = deferredInput ? params["preview"].string ?? "" : Self.hasInputContent(params) ? Self.text(params) : ""
        var outputText = deferredOutput ? output["preview"].string ?? "" : Self.text(output)
        if kind == .glob, !deferredOutput {
            let files = output["filenames"].array.isEmpty ? output["files"].array : output["filenames"].array
            if !files.isEmpty { outputText = files.compactMap(\.string).joined(separator: "\n") }
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
        body = outputText.replacingOccurrences(of: "\u{1B}\\[[0-9;?]*[ -/]*[@-~]", with: "", options: .regularExpression)
        added = diffLines.filter { $0.hasPrefix("+") && !$0.hasPrefix("+++") }.count
        removed = diffLines.filter { $0.hasPrefix("-") && !$0.hasPrefix("---") }.count
        let files = output["filenames"].array.isEmpty ? output["files"].array : output["filenames"].array
        let lines = output["numLines"].number ?? output["file"]["numLines"].number
        if kind == .glob && !files.isEmpty { stat = "\(files.count) files" }
        else if let lines, lines.isFinite && lines > 0 && lines < 1_000_000 { stat = "\(Int(lines)) lines" }
        else if kind == .grep || kind == .read, !body.isEmpty && !deferredOutput { stat = "\(body.components(separatedBy: "\n").count) lines" }
        else { stat = "" }
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
        let cleaned = name.replacingOccurrences(of: "mcp__", with: "").replacingOccurrences(of: "__", with: " ")
            .replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ".", with: " ")
        return cleaned.isEmpty ? "Tool" : cleaned.prefix(1).uppercased() + cleaned.dropFirst()
    }
}

/// A stable sentence about the work, independent of individual call lifecycle.
/// Keep phrases/ranks aligned with desktop's tool-group-summary/tool-registry.
public struct ToolGroupPresentation: Sendable {
    public let summary: String
    public let symbols: [String]
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
    private static let vendorVerbs: Set<String> = ["list", "get", "view", "fetch", "read", "search", "research", "save", "create", "update", "delete", "archive", "extract", "add", "remove", "send", "run", "draft", "reply", "open", "close"]

    public init(_ calls: [ToolCall]) {
        var icons: [String] = []
        for call in calls {
            let icon = ToolPresentation.header(for: call.toolName).symbol
            if !icons.contains(icon) { icons.append(icon) }
        }
        symbols = Array(icons.prefix(3))
        if !calls.isEmpty && calls.allSatisfy({ $0.metadata?["codexItemType"].string == "imageView" }) {
            summary = calls.count == 1 ? "Viewed an image" : "Viewed \(calls.count) images"
            return
        }
        struct Clause { let phrase: Phrase; let order: Int; var count: Int }
        var clauses: [String: Clause] = [:], vendors: [String] = [], vendorIDs: Set<String> = []
        var vendorOrder = Int.max
        for (order, call) in calls.enumerated() {
            let lower = call.toolName.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            if let vendor = Self.vendor(lower) {
                if vendorIDs.insert(vendor.id).inserted { vendors.append(vendor.label) }
                vendorOrder = min(vendorOrder, order)
                continue
            }
            let bare = lower.replacingOccurrences(of: "mcp__mains__", with: "")
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

    private static func vendor(_ lower: String) -> (id: String, label: String)? {
        guard lower.hasPrefix("mcp__") else { return nil }
        let components = String(lower.dropFirst(5)).components(separatedBy: "__")
        let server = components[0], tool = components.dropFirst().joined(separator: "__")
        if server == "mains", tool.hasPrefix("atlas") || phrases[tool] != nil { return nil }
        if server == "cua_repl" { return (server, "Computer use") }
        if server == "mains" { return (server, "Mains") }
        var slug = server
        if let dot = tool.firstIndex(of: ".") { slug = String(tool[..<dot]) }
        else if let separator = tool.firstIndex(of: "_") {
            let candidate = String(tool[..<separator])
            if !vendorVerbs.contains(candidate) { slug = candidate }
        }
        let words = slug.replacingOccurrences(of: "_", with: " ")
        return (slug, words.prefix(1).uppercased() + words.dropFirst())
    }
}

/// Consecutive calls share one work summary; messages keep their original order.
public struct TranscriptGroup: Identifiable, Sendable {
    public let rows: [TranscriptRow]
    public var id: String { rows[0].id }
    public static func build(_ rows: [TranscriptRow]) -> [Self] {
        var groups: [Self] = []
        for row in rows {
            if let last = groups.last, (row.kind == .tool || row.kind == .media), last.rows.first?.kind == row.kind {
                groups[groups.count - 1] = Self(rows: last.rows + [row])
            } else { groups.append(Self(rows: [row])) }
        }
        return groups
    }
}
