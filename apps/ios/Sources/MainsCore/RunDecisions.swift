import Foundation
import Observation

public struct PlanProposal: Equatable, Sendable, Identifiable {
    public enum Status: String, Sendable { case pending, applied, dismissed, failed }
    public enum Decision: String, Sendable {
        case apply, dismiss
        var status: Status { self == .apply ? .applied : .dismissed }
    }

    public let id: Int
    public let text: String
    public let fullContentSource: String?
    public let status: Status
    public let isExitPlan: Bool

    static func toolKey(_ name: String) -> String {
        name.lowercased().filter { !$0.isWhitespace && $0 != "_" && $0 != "-" }
    }

    public init?(_ call: ToolCall) {
        let name = Self.toolKey(call.toolName)
        guard ["plan", "createplan", "exitplanmode"].contains(name), call.parentToolCallId == nil,
              AgentActivity.foreground(call.metadata ?? .null) else { return nil }
        let input = ToolPresentation.unwrap(call.input ?? .null)
        let output = ToolPresentation.unwrap(call.output ?? .null)
        let body = input["plan"].string ?? ""
        let deferred = input["type"].string
        if deferred == "mains/deferred-plan" {
            text = input["preview"].string ?? ""; fullContentSource = "plan"
        } else if deferred == "mains/deferred-tool-output" {
            text = ""; fullContentSource = "tool-input"
        } else {
            guard !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            text = body; fullContentSource = nil
        }
        let marker = call.metadata?["planStatus"].string ?? output["planStatus"].string
        status = marker.flatMap(Status.init(rawValue:)) ?? (["error", "failed"].contains(call.status) ? .failed : .pending)
        id = call.id; isExitPlan = name == "exitplanmode"
    }
}

public struct PendingPlanDecision: Sendable {
    public let runID: String
    public let planID: Int
    public let decision: PlanProposal.Decision
    public internal(set) var checking: Bool
    public internal(set) var uncertain: Bool
    let commandID: String
    let owner: Int
    let payload: JSONValue
}

public enum DecisionIdentity: Hashable, Sendable {
    case approval(runID: String, requestID: String, token: String?)
    case questions(runID: String, artifactID: Int)
}

public struct PendingApproval: Decodable, Identifiable, Sendable {
    public struct Option: Decodable, Sendable {
        public let label: String
        public var description: String?
        private enum CodingKeys: String, CodingKey { case label, description }
        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            label = try c.decode(String.self, forKey: .label)
            description = try c.decodeWireIfPresent(String.self, forKey: .description)
        }
    }
    public let requestId: String
    public let runId: String
    public let toolName: String
    public let kind: String
    public let expiresAt: Date
    public var approvalToken: String?
    public var toolInput: JSONValue?
    public var header: String?
    public var question: String?
    public var options: [Option]?
    public var multiSelect: Bool?
    public var isOther: Bool?
    public var isSecret: Bool?
    public var elicitationMode: String?
    public var requestedSchema: JSONValue?
    public var url: String?
    public var description: String?
    public var defaultToNo: Bool?
    public var suppressAlwaysAllowRule: Bool?
    var sessionOwner: Int? = nil
    public var id: DecisionIdentity { .approval(runID: runId, requestID: requestId, token: approvalToken) }
    public var supported: Bool { ["tool_approval", "ask_user", "elicitation"].contains(kind) }
    public var isForm: Bool { kind == "elicitation" && elicitationMode != "url" }
    public var isExitPlan: Bool { kind == "tool_approval" && PlanProposal.toolKey(toolName) == "exitplanmode" }
    public var safeURL: URL? {
        guard let url, let parsed = URL(string: url), ["http", "https"].contains(parsed.scheme?.lowercased() ?? ""), parsed.host != nil else { return nil }
        return parsed
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case requestId, runId, toolName, kind, expiresAt, approvalToken, toolInput, header, question, options, multiSelect,
             isOther, isSecret, elicitationMode, requestedSchema, url, description, defaultToNo, suppressAlwaysAllowRule
    }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        requestId = try c.decode(String.self, forKey: .requestId); runId = try c.decode(String.self, forKey: .runId)
        toolName = try c.decode(String.self, forKey: .toolName); kind = try c.decode(String.self, forKey: .kind)
        expiresAt = try c.decode(Date.self, forKey: .expiresAt)
        approvalToken = try c.decodeWireIfPresent(String.self, forKey: .approvalToken)
        toolInput = try c.decodeWireIfPresent(JSONValue.self, forKey: .toolInput)
        header = try c.decodeWireIfPresent(String.self, forKey: .header); question = try c.decodeWireIfPresent(String.self, forKey: .question)
        options = try c.decodeWireIfPresent([Option].self, forKey: .options)
        multiSelect = try c.decodeWireIfPresent(Bool.self, forKey: .multiSelect); isOther = try c.decodeWireIfPresent(Bool.self, forKey: .isOther)
        isSecret = try c.decodeWireIfPresent(Bool.self, forKey: .isSecret); elicitationMode = try c.decodeWireIfPresent(String.self, forKey: .elicitationMode)
        requestedSchema = try c.decodeWireIfPresent(JSONValue.self, forKey: .requestedSchema)
        url = try c.decodeWireIfPresent(String.self, forKey: .url); description = try c.decodeWireIfPresent(String.self, forKey: .description)
        defaultToNo = try c.decodeWireIfPresent(Bool.self, forKey: .defaultToNo)
        suppressAlwaysAllowRule = try c.decodeWireIfPresent(Bool.self, forKey: .suppressAlwaysAllowRule)
    }
}

public struct ApprovalPresentation: Sendable {
    public struct Parameter: Identifiable, Sendable {
        public let id: Int
        public let label: String
        public let value: String
    }
    public let label: String
    public let title: String
    public let subtitle: String?
    public let risk: String?
    public let symbol: String
    public let preview: ApprovalToolPreview
    public let parameters: [Parameter]
    public init(_ approval: PendingApproval) {
        let input = ApprovalToolPreview.normalized(approval.toolInput ?? .null), meta = input["_meta"]
        let header = ToolPresentation.header(for: approval.toolName)
        preview = ApprovalToolPreview.resolve(name: approval.toolName, input: input)
        switch preview {
        case .command: symbol = "terminal"
        case .files: symbol = header.symbol == "puzzlepiece.extension" ? "pencil" : header.symbol
        case .fields: symbol = header.symbol
        }
        let fallback = symbol == "terminal" ? "Bash" : header.name
        label = meta["connector_name"].string ?? input["serverName"].string ?? fallback
        title = approval.kind == "tool_approval" ? (approval.question ?? input["message"].string ?? "Allow \(label)?")
            : (approval.header ?? approval.question ?? approval.toolName)
        subtitle = meta["subtitle"].string ?? input["description"].string ?? approval.description
        let candidate = meta["riskLevel"].string?.lowercased()
        risk = ["low", "medium", "high"].contains(candidate ?? "") ? candidate : nil
        var pairs: [(String, JSONValue)] = []
        for item in meta["tool_params_display"].array {
            if let name = item["display_name"].string ?? item["name"].string { pairs.append((name, item["value"])) }
        }
        if pairs.isEmpty {
            if case .object(let fields) = meta["tool_params"] {
                pairs = fields.keys.sorted().map { (Self.titleCase($0), fields[$0]!) }
            } else {
                var hidden: Set<String> = ["message", "mode", "requestedSchema", "serverName", "threadId", "turnId", "elicitationId", "description", "_meta"]
                if approval.kind != "tool_approval" { hidden.insert("url") }
                pairs = input.objectValue.keys.sorted().filter { !hidden.contains($0) }.map { (Self.titleCase($0), input[$0]) }
            }
        }
        if pairs.isEmpty {
            pairs = input["requestedSchema"]["properties"].objectValue.keys.sorted().map { (Self.titleCase($0), .null) }
        }
        parameters = pairs.enumerated().map { index, pair in
            Parameter(id: index, label: pair.0, value: decisionJSONText(pair.1))
        }
    }
    private static func titleCase(_ value: String) -> String {
        value.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
            .replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ").capitalized
    }
}

struct MateQuestion: Equatable, Sendable {
    struct Option: Equatable, Sendable {
        let label: String
        let description: String?
    }

    let text: String
    let options: [Option]
    let answer: [String]
    let unanswered: String?

    var selectedOptions: [Int] {
        guard !answer.isEmpty, answer.allSatisfy({ label in options.contains { $0.label == label } }) else { return [] }
        return options.indices.filter { answer.contains(options[$0].label) }
    }

    static func read(_ call: ToolCall) -> [Self] {
        let input = ToolPresentation.unwrap(call.input ?? .null)
        let output = toolResult(call.output ?? .null)
        let questions = [output["questions"].array, input["questions"].array, [input], [output]]
            .lazy.map { $0.filter { nonempty($0["question"]) != nil } }.first { !$0.isEmpty } ?? []
        let prefix = "User responded:"
        let plainReply = [output, output["content"], output["detailedContent"]].compactMap(\.string)
            .first { $0.lowercased().hasPrefix(prefix.lowercased()) }
            .map { String($0.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines) }
        return questions.enumerated().compactMap { index, question in
            guard let text = nonempty(question["question"]) else { return nil }
            let options = question["options"].array.compactMap { option -> Option? in
                guard let label = nonempty(option["label"]) else { return nil }
                return Option(label: label, description: nonempty(option["description"]))
            }
            let resolved = [output["answers"][text], output["answers"][String(index)],
                            index == 0 ? output["answer"] : .null].first { $0 != .null }
                ?? (index == 0 ? plainReply.map(JSONValue.string) : nil) ?? .null
            var answer = nonempty(resolved).map { [$0] } ?? resolved.array.compactMap(nonempty)
            if question["multiSelect"].bool, let label = nonempty(resolved), !options.contains(where: { $0.label == label }) {
                answer = label.components(separatedBy: ", ")
            }
            let reason: String? = switch output["annotations"][text]["unanswered"].string {
            case "dismissed": "Dismissed"
            case "skipped": "Skipped"
            case "replied_in_chat": "Answered in chat"
            default: output["status"].string == "canceled" || (answer.isEmpty && ["error", "canceled"].contains(call.status)) ? "Unanswered" : nil
            }
            if reason != nil || input["isSecret"].bool || question["isSecret"].bool || output["isSecret"].bool { answer = [] }
            return Self(text: text, options: options, answer: answer, unanswered: reason)
        }
    }

    /// Retain the structured question and its reply in history, even if one arrived before the other.
    static func asyncHistory(_ artifacts: [Artifact]) -> (questions: [Int: [Self]], representedReplies: Set<Int>) {
        var replies: [Int: (artifact: Artifact, answers: [String])] = [:]
        for artifact in artifacts where artifact.kind == "user-prompt" {
            let metadata = artifact.metadata ?? .null
            let reply = metadata["asyncQuestionReply"]
            guard let id = reply["artifactId"].number.flatMap(Int.init(exactly:)), id > 0,
                  metadata["clientUserMessageId"].string == "codex-async-answer-\(id)",
                  let answers = readAsyncAnswers(reply) else { continue }
            replies[id] = (artifact, answers)
        }
        var questions: [Int: [Self]] = [:]
        var representedReplies: Set<Int> = []
        for artifact in artifacts where artifact.metadata?["source"].string == "codex_async_questions" {
            let metadata = artifact.metadata ?? .null
            let entries = PendingAsyncQuestions.readQuestions(metadata["questions"])
            guard !entries.isEmpty, AgentActivity.foreground(metadata),
                  metadata["outputSelected"].bool || (!metadata["working"].bool && !metadata["viewed"].bool) else { continue }
            let saved = metadata["asyncQuestionAnswer"]
            let savedAnswers = saved["artifactId"].number == Double(artifact.id) &&
                saved["clientUserMessageId"].string == "codex-async-answer-\(artifact.id)" ? readAsyncAnswers(saved) : nil
            let reply = replies[artifact.id].flatMap { $0.artifact.runId == artifact.runId && $0.answers.count == entries.count ? $0 : nil }
            let answers = savedAnswers?.count == entries.count ? savedAnswers : reply?.answers
            if let reply, reply.answers == answers { representedReplies.insert(reply.artifact.id) }
            let state = metadata["asyncQuestionState"]
            let unanswered = state["dismissed"].bool ? "Dismissed" : (state["supersededBy"].number ?? 0) > 0 ? "Answered in chat" : nil
            questions[artifact.id] = entries.enumerated().map { index, entry in
                Self(text: entry.title, options: entry.options.map { Option(label: $0, description: nil) },
                     answer: answers.map { [$0[index]] } ?? [], unanswered: answers == nil ? unanswered : nil)
            }
        }
        return (questions, representedReplies)
    }

    private static func nonempty(_ value: JSONValue) -> String? {
        guard let text = value.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }

    private static func readAsyncAnswers(_ value: JSONValue) -> [String]? {
        let raw = value["answers"].array
        let answers = raw.compactMap(nonempty)
        return !answers.isEmpty && answers.count == raw.count ? answers : nil
    }

    private static func toolResult(_ value: JSONValue, depth: Int = 0) -> JSONValue {
        guard depth < 8 else { return .null }
        let result = ToolPresentation.unwrap(value)
        if result["structuredContent"] != .null { return toolResult(result["structuredContent"], depth: depth + 1) }
        if result["contentItems"] != .null { return toolResult(result["contentItems"], depth: depth + 1) }
        let blocks = result.array.isEmpty ? result["content"].array : result.array
        if blocks.count == 1, let block = blocks.first, ["text", "inputText"].contains(block["type"].string ?? ""),
           let text = block["text"].string {
            return toolResult(.string(text), depth: depth + 1)
        }
        return result
    }
}

extension ToolCall {
    var isMateQuestion: Bool {
        let name = toolName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let prefix = "mcp__mains__"
        let shortName = name.hasPrefix(prefix) ? String(name.dropFirst(prefix.count)) : name
        return ["askassistantquestion", "askuserquestion", "ask_user", "askuser", "userinput", "request_user_input"].contains(shortName)
    }
}

public struct AsyncQuestion: Equatable, Sendable {
    public let title: String
    public let options: [String]
}

public struct PendingAsyncQuestions: Equatable, Identifiable, Sendable {
    public let runID: String
    public let artifactID: Int
    public let questions: [AsyncQuestion]
    var sessionOwner: Int? = nil
    public var id: DecisionIdentity { .questions(runID: runID, artifactID: artifactID) }

    /// Mirrors mobile's pendingAsyncQuestions; a later ordinary prompt supersedes the request.
    public static func latest(in artifacts: [Artifact]) -> Self? {
        for artifact in artifacts.sorted(by: { $0.createdAt == $1.createdAt ? $0.id > $1.id : $0.createdAt > $1.createdAt }) {
            let meta = artifact.metadata ?? .null
            if meta["isFromSubagent"].bool || meta["parentToolUseId"].string != nil { continue }
            if artifact.kind == "user-prompt" {
                let reply = meta["asyncQuestionReply"], id = reply["artifactId"].number
                let valid = id.map { $0 > 0 && $0.rounded() == $0 && $0 < Double(Int.max) } ?? false
                let answers = reply["answers"].array
                if valid, let id, !answers.isEmpty, answers.allSatisfy({ !($0.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }),
                   meta["clientUserMessageId"].string == "codex-async-answer-\(Int(id))" { continue }
                return nil
            }
            guard meta["source"].string == "codex_async_questions", artifact.id > 0 else { continue }
            let questions = readQuestions(meta["questions"])
            guard !questions.isEmpty else { continue }
            let answer = meta["asyncQuestionAnswer"], state = meta["asyncQuestionState"]
            let answered = answer["artifactId"].number == Double(artifact.id) && answer["clientUserMessageId"].string == "codex-async-answer-\(artifact.id)"
                && !answer["answers"].array.isEmpty && answer["answers"].array.allSatisfy { !($0.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            if answered || state["dismissed"].bool || (state["supersededBy"].number ?? 0) > 0 { continue }
            return Self(runID: artifact.runId, artifactID: artifact.id, questions: questions)
        }
        return nil
    }

    static func readQuestions(_ value: JSONValue) -> [AsyncQuestion] {
        value.array.compactMap { item in
            guard let title = item["title"].string?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else { return nil }
            return AsyncQuestion(title: title, options: item["options"].array.compactMap { $0.string?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
        }
    }
}

@MainActor @Observable
public final class DecisionDelivery {
    public enum Phase: Sendable { case editing, sending, uncertain, done }
    public internal(set) var phase: Phase = .editing
    public internal(set) var error: String?
    // Memory only: an uncertain decision retains its original payload and receipt identity.
    @ObservationIgnored var attempt: DecisionAttempt?
    public var locked: Bool { phase != .editing }
    init() {}
}

struct DecisionAttempt {
    let identity: DecisionIdentity
    let runID: String
    let owner: Int
    let channel: String
    let payload: JSONValue
    let commandID: String
}

func decisionJSONText(_ value: JSONValue) -> String {
    if let string = value.string { return string }
    if value == .null { return "" }
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
    return (try? encoder.encode(value)).map { String(decoding: $0, as: UTF8.self) } ?? ""
}
