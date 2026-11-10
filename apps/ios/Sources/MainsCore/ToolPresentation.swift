import Foundation

/// Native counterpart of mobile/lib/tool-registry and tool-output.
public struct ToolPresentation: Sendable {
    public enum Kind: Sendable { case command, read, edit, write, delete, glob, grep, web, task, plan, todo, generic }
    public let name: String
    public let verb: String
    public let symbol: String
    public let kind: Kind
    public let detail: String
    public let body: String
    public let input: String
    public let stat: String
    public let added: Int
    public let removed: Int
    public let deferredInput: Bool
    public let deferredOutput: Bool
    public let running: Bool
    public let failed: Bool
    public var diff: Bool { kind == .edit || kind == .write }

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
    public init(_ call: ToolCall) {
        let lower = call.toolName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let builtin = lower.hasPrefix("mcp__") ? nil : Self.definitions.first { $0.aliases.contains(lower) }
            ?? Self.definitions.first { $0.aliases.contains { $0.count >= 4 && lower.contains($0) } }
        let params = Self.unwrap(call.input ?? .null)
        let output = Self.unwrap(call.output ?? .null)
        running = ["running", "queued"].contains(call.status)
        failed = ["error", "failed"].contains(call.status)
        deferredInput = params["type"].string == "mains/deferred-tool-output"
        deferredOutput = output["type"].string == "mains/deferred-tool-output"
        kind = builtin?.kind ?? .generic
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
        input = deferredInput ? params["preview"].string ?? "" : Self.text(params)
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
