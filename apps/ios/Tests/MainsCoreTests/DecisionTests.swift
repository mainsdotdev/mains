import Foundation
import Testing
@testable import MainsCore

@MainActor
private final class DecisionFaults {
    struct Call { let channel: String; let args: [JSONValue]; let commandID: String? }
    var calls: [Call] = []
    var failBefore: String?
    var failAfter: String?
    var delay: String?
}

extension SessionIntegrationTests {
    @Test @MainActor func decisionsUseRealWireCodecAndExistingBackendChannels() async throws {
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let storage = MemoryStorage()
        let session = BackendSession(storage: storage)
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        await session.selectConversation("fixture-run")
        var request = URLRequest(url: URL(string: endpoint + "/test/decisions")!)
        request.httpMethod = "POST"; request.httpBody = Data("{}".utf8)
        _ = try await URLSession.shared.data(for: request)
        try await eventually { session.pendingApprovals.count == 1 }
        let approval = try #require(session.pendingApprovals.first)
        #expect(approval.options?.first?.description == nil, "Optional undefined values survive the real TypeScript codec.")
        #expect(approval.isSecret == true)
        let cache = try Wire.encoder().encode(try #require(storage.snapshot))
        #expect(!String(decoding: cache, as: UTF8.self).contains("pending-input-must-not-cache"))
        request.httpBody = Data("{\"questions\":true}".utf8)
        _ = try await URLSession.shared.data(for: request)
        await session.loadHistory(direction: "refresh")
        #expect(session.pendingQuestions == nil, "Async questions wait behind the broker's approval.")
        try await session.respondToApproval(approval, approved: true, answer: "Review")
        #expect(session.pendingApprovals.isEmpty)
        try await eventually { session.pendingQuestions != nil }
        let questions = try #require(session.pendingQuestions)
        await #expect(throws: MainsError.self) { try await session.answerQuestions(questions, answers: ["Plan"]) }
        session.grantConsent(providerID: "codex", backendID: "ios-fixture")
        try await session.answerQuestions(questions, answers: ["Plan"])
        #expect(session.pendingQuestions == nil)
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data)
        #expect(calls.filter { $0["channel"].string == "runs:toolApprovalResponse" }.count == 1)
        #expect(calls.filter { $0["channel"].string == "runs:answerAsyncQuestions" }.count == 1)
    }
}

@MainActor
private final class DecisionFaultTransport: BackendTransport {
    let base: DemoTransport
    let faults: DecisionFaults
    var onEvent: ((String, JSONValue) -> Void)? { get { base.onEvent } set { base.onEvent = newValue } }
    var onDisconnect: ((MainsError) -> Void)? { get { base.onDisconnect } set { base.onDisconnect = newValue } }
    init(_ backend: DemoBackend, faults: DecisionFaults) { base = DemoTransport(backend: backend); self.faults = faults }
    func open(endpoint: URL, token: String) throws { try base.open(endpoint: endpoint, token: token) }
    func close() { base.close() }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        faults.calls.append(.init(channel: channel, args: args, commandID: commandId))
        if faults.failBefore == channel { faults.failBefore = nil; throw MainsError.timeout }
        if faults.delay == channel { faults.delay = nil; try await Task.sleep(for: .milliseconds(150)) }
        let result = try await base.perform(channel, args: args, commandId: commandId, timeout: timeout)
        if faults.failAfter == channel { faults.failAfter = nil; throw MainsError.timeout }
        return result
    }
}

@Suite(.serialized)
struct DecisionTests {
    @Test func shellApprovalPreviewMatchesDesktopWithoutRewritingAmbiguousCommands() {
        let simple = ApprovalCommandPreview(command: #"/bin/zsh -lc "pwd && rg --files -g 'AGENTS.md'""#)
        #expect(simple.shell == "zsh -lc" && simple.command == "pwd && rg --files -g 'AGENTS.md'")
        #expect(ApprovalCommandPreview(command: "sh -c 'echo hello'").command == "echo hello")
        let escaped = ApprovalCommandPreview(command: #"/usr/bin/bash -lc "echo \"hello\"""#)
        #expect(escaped.shell == "bash -lc" && escaped.command == #"echo \"hello\""#)
        for raw in [#"sh -c "echo"' hello'"#, #"sh -c "echo""world""#, "sh -c echo hello", "python -c 'print(1)'"] {
            let preview = ApprovalCommandPreview(command: raw)
            #expect(preview.shell == nil && preview.command == raw)
        }
    }

    @Test func bashApprovalShowsTheFullCommandWithoutProtocolAndDuplicateActionRows() throws {
        let command = "echo " + String(repeating: "sample ", count: 800)
        let input: JSONValue = .object(["args": .string(decisionJSONText(.object([
            "command": .string("/bin/zsh -lc \"\(command)\""), "cwd": .string("/Demo/workspace"),
            "commandActions": .array([.object(["command": .string(command), "type": .string("unknown")])]),
            "environmentId": .string("local"),
        ])))])
        let display = ApprovalPresentation(try approval(name: "Bash", input: input))
        guard case .command(let preview) = display.preview else { Issue.record("Bash must use its command preview."); return }
        #expect(display.label == "Bash" && display.symbol == "terminal")
        #expect(preview.command == command && preview.shell == "zsh -lc" && preview.directory == "/Demo/workspace")
        #expect(!display.parameters.contains { $0.label == "Args" })
        let alias = ApprovalPresentation(try approval(name: "shell", input: .object([
            "fullCommandText": .string("pwd"), "resolvedWorkingDirectory": .string("/Demo"),
        ])))
        guard case .command(let aliased) = alias.preview else { Issue.record("Shell aliases must work."); return }
        #expect(aliased.directory == "/Demo" && aliased.command == "pwd")
    }

    @Test func connectorApprovalsPreferDesktopCuratedParametersAndKeepRealToolArguments() throws {
        let display = ApprovalPresentation(try approval(name: "mcp__calendar__create_event", input: try json("""
        {"message":"Create this event?","threadId":"hidden","_meta":{"connector_name":"Calendar",
        "subtitle":"Proposed meeting","riskLevel":"medium","tool_params_display":[
          {"display_name":"Title","value":"Review"},{"name":"Participants","value":["demo@example.com"]}
        ],"tool_params":{"url":"https://example.com/event"}}}
        """)))
        #expect(display.label == "Calendar" && display.title == "Create this event?" && display.subtitle == "Proposed meeting")
        #expect(display.risk == "medium" && display.parameters.map(\.label) == ["Title", "Participants"])
        let fallback = ApprovalPresentation(try approval(name: "mcp__sample__open", input: try json("""
        {"threadId":"hidden","_meta":{"tool_params":{"url":"https://example.com","send_email":false}}}
        """)))
        #expect(fallback.parameters.map(\.label) == ["Send Email", "Url"])
        #expect(fallback.parameters.last?.value == "https://example.com", "Curated tool arguments named url are data, not protocol metadata.")
        let fetch = ApprovalPresentation(try approval(name: "WebFetch", input: .object(["url": .string("https://example.com/page")])))
        #expect(fetch.parameters.first?.value == "https://example.com/page", "A web tool's destination must remain visible.")
    }

    @Test func fileApprovalsShowProposedChangesAndFallbackWhenTheirShapeIsUnknown() throws {
        let display = ApprovalPresentation(try approval(name: "Edit", input: try json("""
        {"file_path":"src/hero.tsx","old_string":"before","new_string":"after"}
        """)))
        guard case .files(let edits) = display.preview else { Issue.record("Edit needs a diff preview."); return }
        #expect(edits.count == 1 && edits[0].path == "src/hero.tsx" && edits[0].content == "-before\n+after")
        let patch = "*** Begin Patch\n*** Update File: a.swift\n@@\n-old\n+new\n*** Add File: b.swift\n+hello\n*** End Patch"
        let batch = ApprovalPresentation(try approval(name: "apply_patch", input: .object(["patch": .string(patch)])))
        guard case .files(let files) = batch.preview else { Issue.record("Patch needs separate files."); return }
        #expect(files.map(\.path) == ["a.swift", "b.swift"] && files[1].content == "+hello")
        let unknown = ApprovalPresentation(try approval(name: "FileChange", input: try json("{\"changes\":[{\"path\":\"a.swift\"}]}")))
        guard case .fields = unknown.preview else { Issue.record("Unknown file payloads must remain inspectable."); return }
        #expect(unknown.parameters.first?.value.contains("a.swift") == true)
    }

    @Test func formsMatchContractValidationAndKeepSecretsLocal() throws {
        let form = ElicitationForm(schema: try json("""
        {"type":"object","required":["name","count"],"properties":{
          "name":{"type":"string","minLength":2},"count":{"type":"integer","minimum":1,"maximum":3},
          "email":{"type":"string","format":"email"},"date":{"type":"string","format":"date"},
          "password":{"type":"string","format":"password"},"notifications":{"type":"boolean","default":true},
          "level":{"type":"string","oneOf":[{"const":"high","title":"High"}]},
          "tags":{"type":"array","items":{"type":"string","anyOf":[{"const":"one"},{"const":"two"}]},"maxItems":1}
        }}
        """))
        #expect(form.unsupported.isEmpty)
        #expect(form.fields.first { $0.name == "password" }?.secret == true)
        #expect(form.defaults["notifications"] == .bool(true))
        var values = form.defaults
        values["name"] = .string("A"); values["count"] = .string("1.5"); values["email"] = .string("bad")
        values["date"] = .string("2026-02-30"); values["tags"] = .array([.string("one"), .string("two")])
        let invalid = form.build(values)
        #expect(invalid.content == nil && Set(invalid.errors.keys) == ["name", "count", "email", "date", "tags"])
        values["name"] = .string(" Demo "); values["count"] = .string("2"); values["email"] = .string("demo@example.com")
        values["date"] = .string("2028-02-29"); values["tags"] = .array([.string("one")]); values["level"] = .string("high")
        let valid = form.build(values)
        #expect(valid.errors.isEmpty && valid.content?["count"] == .number(2) && valid.content?["name"] == .string("Demo"))
        #expect(valid.content?["password"] == .null, "Unentered secrets are never added to a response.")
        #expect(!form.validate(try json("{\"name\":\"ok\",\"count\":2,\"injected\":true}")).isEmpty)
        let damaged = ElicitationForm(schema: nil)
        #expect(damaged.build([:]).content == nil)
        let nested = ElicitationForm(schema: try json("{\"type\":\"object\",\"properties\":{\"nested\":{\"type\":\"object\"}}}"))
        #expect(nested.unsupported == ["nested"] && nested.build([:]).content == nil)
        let missing = ElicitationForm(schema: try json("{\"type\":\"object\",\"required\":[\"missing\"]}"))
        #expect(missing.unsupported == ["missing"])
        let pattern = ElicitationForm(schema: try json("{\"properties\":{\"code\":{\"type\":\"string\",\"pattern\":\"[\"}}}"))
        #expect(pattern.build(["code": .string("x")]).content == nil)
    }

    @Test func asyncQuestionProjectionRejectsAnsweredSupersededAndChildRequests() throws {
        let pending = try artifact(id: 2, kind: "report", metadata: ["source": .string("codex_async_questions"), "questions": .array([
            .object(["title": .string(" Choose one "), "options": .array([.string("Yes"), .number(3)])]),
        ])])
        #expect(PendingAsyncQuestions.latest(in: [pending])?.questions == [AsyncQuestion(title: "Choose one", options: ["Yes"])])
        let prompt = try artifact(id: 3, kind: "user-prompt", metadata: [:])
        #expect(PendingAsyncQuestions.latest(in: [pending, prompt]) == nil)
        var metadata = pending.metadata!.objectValue
        metadata["asyncQuestionState"] = .object(["dismissed": .bool(true)])
        #expect(PendingAsyncQuestions.latest(in: [try artifact(id: 2, kind: "report", metadata: metadata)]) == nil)
        metadata["asyncQuestionState"] = .null; metadata["isFromSubagent"] = .bool(true)
        #expect(PendingAsyncQuestions.latest(in: [try artifact(id: 2, kind: "report", metadata: metadata)]) == nil)
        metadata["isFromSubagent"] = .bool(false)
        metadata["asyncQuestionAnswer"] = .object(["artifactId": .number(2), "answers": .array([.string("Yes")]), "clientUserMessageId": .string("codex-async-answer-2")])
        #expect(PendingAsyncQuestions.latest(in: [try artifact(id: 2, kind: "report", metadata: metadata)]) == nil)
    }

    @Test @MainActor func approvalQuestionFormLinkAndAsyncAnswersUseSessionChannels() async throws {
        let (session, backend, faults) = try makeSession()
        defer { session.exitDemo(); backend.shutdown() }
        try await openWalkthrough(session)
        let first = try #require(session.pendingApprovals.first)
        #expect(first.kind == "tool_approval")
        #expect(ApprovalPresentation(first).risk == "low")
        try await session.respondToApproval(first, approved: true, answer: "acceptForSession")
        try await eventually { session.pendingApprovals.first?.kind == "ask_user" }
        let question = try #require(session.pendingApprovals.first)
        try await session.respondToApproval(question, approved: true, answer: "Review only, Make a plan")
        try await eventually { session.pendingApprovals.first?.isForm == true }
        let form = try #require(session.pendingApprovals.first)
        await #expect(throws: MainsError.self) { try await session.respondToApproval(form, approved: true, answer: "{}") }
        try await session.respondToApproval(form, approved: true, answer: "{\"project\":\"Native demo\",\"notifications\":false,\"priority\":\"normal\"}")
        try await eventually { session.pendingApprovals.first?.elicitationMode == "url" }
        try await session.respondToApproval(try #require(session.pendingApprovals.first), approved: true)
        try await eventually { session.pendingQuestions != nil }
        let pending = try #require(session.pendingQuestions)
        #expect(pending.questions.count == 2)
        try await session.answerQuestions(pending, answers: ["Functionality", "Keep it native"])
        #expect(session.decisionState(for: pending.id).phase == .done)
        #expect(session.pendingQuestions == nil)
        let approvals = faults.calls.filter { $0.channel == "runs:toolApprovalResponse" }
        #expect(approvals.count == 4 && approvals.allSatisfy { $0.args[0]["approvalToken"].string != nil && $0.commandID != nil })
        #expect(approvals[0].args[0]["answer"] == .string("acceptForSession"))
        #expect(faults.calls.filter { $0.channel == "runs:answerAsyncQuestions" }.count == 1)
    }

    @Test @MainActor func uncertainApprovalCannotChangeAnswerAndChecksOriginalReceipt() async throws {
        let (session, backend, faults) = try makeSession()
        defer { session.exitDemo(); backend.shutdown() }
        try await openWalkthrough(session)
        let approval = try #require(session.pendingApprovals.first)
        faults.failBefore = "runs:toolApprovalResponse"
        await #expect(throws: MainsError.self) { try await session.respondToApproval(approval, approved: true) }
        #expect(session.decisionState(for: approval.id).phase == .uncertain)
        await #expect(throws: MainsError.self) { try await session.respondToApproval(approval, approved: false) }
        #expect(faults.calls.filter { $0.channel == "runs:toolApprovalResponse" }.count == 1)
        try await session.respondToApproval(approval, approved: false, checkOnly: true)
        let calls = faults.calls.filter { $0.channel == "runs:toolApprovalResponse" }
        #expect(calls.count == 2 && calls[0].commandID == calls[1].commandID && calls[0].args == calls[1].args)
        #expect(calls[1].args[0]["approved"] == .bool(true))
    }

    @Test @MainActor func uncertainAsyncAnswerOnlyChecksAndDismissDoesNotSend() async throws {
        let (session, backend, faults) = try makeSession()
        defer { session.exitDemo(); backend.shutdown() }
        try await openWalkthrough(session)
        try await skipApprovals(session)
        let pending = try #require(session.pendingQuestions)
        faults.failBefore = "runs:answerAsyncQuestions"
        await #expect(throws: MainsError.self) { try await session.answerQuestions(pending, answers: ["Interface", "Nothing else"]) }
        try await session.checkQuestionDelivery(pending)
        #expect(session.decisionState(for: pending.id).phase == .uncertain)
        let calls = faults.calls.filter { $0.channel == "runs:answerAsyncQuestions" }
        #expect(calls.count == 2 && calls[1].args[0]["checkOnly"] == .bool(true))
        #expect(calls[0].args[0]["answers"] == calls[1].args[0]["answers"])
        await #expect(throws: MainsError.self) { try await session.dismissQuestions(pending) }
        // A later authoritative dismissal retires an unknown answer rather than blocking the run forever.
        _ = try backend.invoke("runs:dismissAsyncQuestions", args: [.object(["runId": .string(pending.runID), "artifactId": .number(Double(pending.artifactID))])], commandID: "desktop-dismiss")
        await session.loadHistory(direction: "refresh")
        #expect(session.pendingQuestions == nil && session.decisionState(for: pending.id).phase == .done)
    }

    @Test @MainActor func pendingDecisionSurvivesReconnectButCannotCrossRunOrBackend() async throws {
        let (session, backend, faults) = try makeSession()
        defer { session.exitDemo(); backend.shutdown() }
        let id = try await openWalkthrough(session)
        let approval = try #require(session.pendingApprovals.first)
        session.setActive(false); session.setActive(true)
        try await eventually { session.isConnected && session.pendingApprovals.first?.id == approval.id }
        await session.selectConversation(DemoBackend.tourID)
        await #expect(throws: MainsError.self) { try await session.respondToApproval(approval, approved: true) }
        await session.selectConversation(id)
        faults.delay = "runs:toolApprovalResponse"
        let answer = Task { try await session.respondToApproval(approval, approved: true) }
        try await eventually { session.decisionState(for: approval.id).phase == .sending }
        session.exitDemo()
        _ = try? await answer.value
        #expect(session.pendingApprovals.isEmpty && session.pendingQuestions == nil && session.pairing == nil)
        // Even identical run/request/token values after a new pairing are a different owner.
        try session.startDemo()
        try await eventually { session.isConnected }
        await session.selectConversation(id)
        #expect(session.pendingApprovals.first?.id == approval.id)
        await #expect(throws: MainsError.self) { try await session.respondToApproval(approval, approved: true) }
    }

    @Test @MainActor func lostAsyncAcknowledgementReconcilesWithoutAnotherAnswerPrompt() async throws {
        let (session, backend, faults) = try makeSession()
        defer { session.exitDemo(); backend.shutdown() }
        let id = try await openWalkthrough(session)
        try await skipApprovals(session)
        let pending = try #require(session.pendingQuestions)
        faults.failAfter = "runs:answerAsyncQuestions"
        await #expect(throws: MainsError.self) { try await session.answerQuestions(pending, answers: ["Functionality", "Stay local"]) }
        #expect(session.decisionState(for: pending.id).phase == .uncertain)
        try await session.checkQuestionDelivery(pending)
        #expect(session.decisionState(for: pending.id).phase == .done)
        let calls = faults.calls.filter { $0.channel == "runs:answerAsyncQuestions" }
        #expect(calls.count == 2 && calls[1].args[0]["checkOnly"] == .bool(true))
        let page = try backend.invoke("runs:getHistory", args: [.object(["runId": .string(id), "direction": .string("latest")])]).decode(HistoryPage.self)
        #expect(page.artifacts.filter { $0.metadata?["clientUserMessageId"].string == "codex-async-answer-\(pending.artifactID)" }.count == 1)
    }

    @Test @MainActor func dismissingAsyncQuestionsNeedsNoSharingConsentAndSendsNoPrompt() async throws {
        let (session, backend, faults) = try makeSession()
        defer { session.exitDemo(); backend.shutdown() }
        try await openWalkthrough(session); try await skipApprovals(session)
        let pending = try #require(session.pendingQuestions)
        session.revokeConsent(providerID: "codex", backendID: DemoBackend.backendID)
        try await session.dismissQuestions(pending)
        #expect(session.pendingQuestions == nil)
        #expect(faults.calls.filter { $0.channel == "runs:dismissAsyncQuestions" }.count == 1)
        #expect(faults.calls.allSatisfy { $0.channel != "runs:answerAsyncQuestions" })
    }

    @Test @MainActor func lateQuestionAnswerDoesNotChangeAnotherConversationsReadingPosition() async throws {
        let (session, backend, faults) = try makeSession()
        defer { session.exitDemo(); backend.shutdown() }
        try await openWalkthrough(session); try await skipApprovals(session)
        let pending = try #require(session.pendingQuestions)
        faults.delay = "runs:answerAsyncQuestions"
        let answer = Task { try await session.answerQuestions(pending, answers: ["Interface", "Keep the reading position"]) }
        try await eventually { session.decisionState(for: pending.id).phase == .sending }
        await session.selectConversation(DemoBackend.tourID)
        session.setHistoryFollowing(false)
        try await answer.value
        #expect(session.viewingRunID == DemoBackend.tourID && !session.transcript.isFollowing)
    }

    @Test @MainActor func demoRequestsExpireAndOldTokensCannotAnswerNewRequests() async throws {
        let backend = try DemoBackend(stepDelay: .milliseconds(1), streamDelay: .milliseconds(1), decisionLifetime: 0.12)
        let transport = DemoTransport(backend: backend)
        try transport.open(endpoint: DemoBackend.endpoint, token: "")
        defer { transport.close(); backend.shutdown() }
        let result = try backend.invoke("runs:execute", args: [.object(["spaceId": .string("codex"), "goal": .string(DemoBackend.decisionPrompt)])], commandID: "start")
        let id = try #require(result["runId"].string)
        var request: JSONValue = .null
        try await eventually {
            request = (try? backend.invoke("runs:listPendingApprovals", args: [.string(id)]))?.array.first ?? .null
            return request != .null
        }
        #expect(throws: MainsError.self) {
            try backend.invoke("runs:toolApprovalResponse", args: [.object(["requestId": request["requestId"], "approvalToken": .string("wrong-token"), "approved": .bool(true)])], commandID: "stale")
        }
        try await eventually { (try? backend.invoke("runs:listPendingApprovals", args: [.string(id)]))?.array.first?["requestId"] != request["requestId"] }
        #expect(throws: MainsError.self) {
            try backend.invoke("runs:toolApprovalResponse", args: [.object(["requestId": request["requestId"], "approvalToken": request["approvalToken"], "approved": .bool(true)])], commandID: "expired")
        }
    }

    @MainActor private func makeSession() throws -> (BackendSession, DemoBackend, DecisionFaults) {
        let backend = try DemoBackend(stepDelay: .milliseconds(1), streamDelay: .milliseconds(1))
        let faults = DecisionFaults()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in DecisionFaultTransport(backend, faults: faults) })
        session.restore(); session.setActive(true); try session.startDemo()
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        return (session, backend, faults)
    }
    @MainActor @discardableResult private func openWalkthrough(_ session: BackendSession) async throws -> String {
        try await eventually { session.isConnected }
        let id = try await session.send(DemoBackend.decisionPrompt, spaceID: "codex", workspaceID: session.homeTargets["codex"]?.workspaceID)
        await session.selectConversation(id)
        try await eventually { !session.pendingApprovals.isEmpty }
        return id
    }
    @MainActor private func skipApprovals(_ session: BackendSession) async throws {
        for _ in 0..<4 {
            try await eventually { !session.pendingApprovals.isEmpty }
            try await session.respondToApproval(try #require(session.pendingApprovals.first), approved: false)
        }
        try await eventually { session.pendingQuestions != nil }
    }
    private func json(_ string: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(string.utf8)) }
    private func approval(name: String, input: JSONValue) throws -> PendingApproval {
        try JSONValue.object(["requestId": .string("approval"), "runId": .string("run"), "toolName": .string(name),
            "kind": .string("tool_approval"), "expiresAt": .number(Date().addingTimeInterval(300).timeIntervalSince1970 * 1000),
            "toolInput": input]).decode(PendingApproval.self)
    }
    private func artifact(id: Int, kind: String, metadata: [String: JSONValue]) throws -> Artifact {
        try JSONValue.object(["id": .number(Double(id)), "runId": .string("test-run"), "kind": .string(kind), "content": .string(""),
            "createdAt": .number(Double(id) * 1000), "metadata": .object(metadata)]).decode(Artifact.self)
    }
}
