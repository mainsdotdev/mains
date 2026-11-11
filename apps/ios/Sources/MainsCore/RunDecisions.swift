import Foundation
import Observation

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
