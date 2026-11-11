import Foundation

/// A short, foreground-only status. Live provider thoughts remain in memory;
/// they never become transcript prose. Tool labels share the existing presentation.
public struct AgentActivity: Equatable, Sendable {
    public let title: String
    public let detail: String
    public let toolID: Int?

    public init(thinking: String? = nil, tool: ToolCall? = nil) {
        if let tool {
            let display = ToolPresentation(tool)
            title = display.verb.trimmingCharacters(in: CharacterSet(charactersIn: "…"))
            detail = display.detail; toolID = tool.id
        } else {
            let text = Self.preview(thinking ?? "")
            title = text.isEmpty ? "Thinking" : text
            detail = ""; toolID = nil
        }
    }
    public var label: String { detail.isEmpty ? title : title + " " + detail }

    public static func preview(_ source: String) -> String {
        let tail = String(source.suffix(4096))
        let line = tail.components(separatedBy: .newlines).last { !$0.trimmingCharacters(in: .whitespaces).isEmpty } ?? ""
        let cleaned = line.trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: #"^#+\s*"#, with: "", options: .regularExpression)
        let rendered = (try? AttributedString(markdown: cleaned, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            .map { String($0.characters) } ?? cleaned
        return String(rendered.prefix(240)) + (rendered.count > 240 ? "…" : "")
    }
    static func foreground(_ metadata: JSONValue) -> Bool {
        !metadata["isFromSubagent"].bool && !metadata["voice"].bool &&
        ["parentToolCallId", "parentToolUseId"].allSatisfy { metadata[$0].string == nil && metadata[$0].number == nil }
    }
    static func thinking(kind: String, metadata: JSONValue) -> Bool {
        kind == "thinking" || metadata["kind"].string == "thinking" ||
        ["agent_thinking_streaming", "assistant.reasoning_delta"].contains(metadata["source"].string ?? "")
    }
}
