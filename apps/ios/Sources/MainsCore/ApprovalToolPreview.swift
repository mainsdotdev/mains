import Foundation

public struct ApprovalCommandPreview: Sendable, Equatable {
    public let command: String
    public let shell: String?
    public let directory: String
    public let timeout: String?

    /// Matches desktop's shell-command-preview: ambiguous shell quoting stays raw.
    public init(command raw: String, directory: String = "", timeout: String? = nil) {
        self.directory = directory; self.timeout = timeout
        let pattern = #"^(?:(?:/usr)?/bin/)?(zsh|bash|sh)\s+(-[A-Za-z]*c[A-Za-z]*)\s+([\s\S]+)$"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)),
              let shellRange = Range(match.range(at: 1), in: raw), let flagsRange = Range(match.range(at: 2), in: raw),
              let bodyRange = Range(match.range(at: 3), in: raw) else { command = raw; shell = nil; return }
        let value = Array(raw[bodyRange].trimmingCharacters(in: .whitespacesAndNewlines))
        guard value.count >= 2, let quote = value.first, ["\"", "'"].contains(quote), value.last == quote else { command = raw; shell = nil; return }
        for index in 1..<(value.count - 1) where value[index] == quote {
            var slashes = 0, previous = index - 1
            while previous >= 0, value[previous] == "\\" { slashes += 1; previous -= 1 }
            if quote != "\"" || slashes % 2 == 0 { command = raw; shell = nil; return }
        }
        command = String(value.dropFirst().dropLast()); shell = "\(raw[shellRange]) \(raw[flagsRange])"
    }
}

public struct ApprovalFilePreview: Sendable, Identifiable {
    public let path: String
    public let content: String
    public let diff: Bool
    public var id: String { path }
}

public enum ApprovalToolPreview: Sendable {
    case command(ApprovalCommandPreview)
    case files([ApprovalFilePreview])
    case fields

    static func normalized(_ value: JSONValue) -> JSONValue {
        var input = ToolPresentation.unwrap(value).objectValue
        if case .object(let nested) = ToolPresentation.unwrap(input["args"] ?? .null) {
            input.removeValue(forKey: "args")
            input.merge(nested) { _, value in value }
        }
        return .object(input)
    }

    static func resolve(name: String, input: JSONValue) -> Self {
        let name = name.lowercased()
        let commandNames = ["bash", "shell", "terminal", "exec_command", "command_execution", "monitor", "[permission:shell]"]
        if commandNames.contains(name), let command = input["command"].string ?? input["fullCommandText"].string ?? input["cmd"].string {
            let directory = input["cwd"].string ?? input["resolvedWorkingDirectory"].string ?? ""
            let timeout = input["timeout"].number.map { "\($0.formatted())ms" } ?? input["timeout"].string.map { $0 + "ms" }
            return .command(ApprovalCommandPreview(command: command, directory: directory, timeout: timeout))
        }
        let path = ["fileName", "filePath", "file_path", "path", "file", "notebook_path"].compactMap { input[$0].string }.first ?? ""
        let edit = ["edit", "replace", "edit_file", "filechange", "[permission:write]"].contains(name)
        let write = ["write", "writeifempty", "write_file", "create_file", "create"].contains(name) || name == "[permission:write]" && ["add", "create"].contains(input["kind"].string ?? "")
        let delete = ["delete", "delete_file"].contains(name) || name == "[permission:write]" && input["kind"].string == "delete"
        if name == "apply_patch" {
            let candidates = ["args", "patch", "input", "content"].compactMap { input[$0].string }
            if let envelope = candidates.first(where: { $0.contains("*** Begin Patch") }) {
                let files = patchFiles(envelope)
                if !files.isEmpty { return .files(files) }
            }
        }
        if edit || write || delete {
            let patch = input["diff"].string ?? input["patch"].string
            if let patch, !patch.contains("*** Begin Patch") { return .files([.init(path: path, content: patch, diff: true)]) }
            let old = input["old_string"].string ?? input["old_str"].string ?? input["oldString"].string
            let new = input["new_string"].string ?? input["new_str"].string ?? input["newString"].string
            let text = input["content"].string ?? input["contents"].string ?? input["file_text"].string ?? input["newFileContents"].string ?? ""
            guard !path.isEmpty, delete || write || old != nil || new != nil else { return .fields }
            let lines: [String]
            if delete { lines = [] }
            else if write { lines = text.isEmpty ? [] : text.components(separatedBy: "\n").map { "+" + $0 } }
            else if edit { lines = (old.map { $0.components(separatedBy: "\n").map { "-" + $0 } } ?? []) + (new.map { $0.components(separatedBy: "\n").map { "+" + $0 } } ?? []) }
            else { lines = [] }
            return .files([.init(path: path, content: lines.joined(separator: "\n"), diff: edit || write || delete)])
        }
        return .fields
    }

    private static func patchFiles(_ patch: String) -> [ApprovalFilePreview] {
        var files: [ApprovalFilePreview] = [], path: String?, lines: [String] = []
        func flush() {
            if let path { files.append(.init(path: path, content: lines.joined(separator: "\n"), diff: true)) }
            path = nil; lines = []
        }
        for line in patch.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
            if let prefix = ["*** Update File: ", "*** Add File: ", "*** Delete File: "].first(where: { line.hasPrefix($0) }) {
                flush(); path = String(line.dropFirst(prefix.count))
            } else if line.hasPrefix("*** Move to: ") { path = String(line.dropFirst(13)) }
            else if line.hasPrefix("*** End Patch") { flush() }
            else if path != nil, !line.hasPrefix("***") { lines.append(line) }
        }
        flush(); return files
    }
}
