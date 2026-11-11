import Foundation
import Testing
@testable import MainsCore

@MainActor private final class ContextFaults {
    struct Call { let channel: String; let args: [JSONValue]; let id: String? }
    var calls: [Call] = []
    var failSkills = false
    var failCommands = false
    var delaySkills = false
    var failSendAfter = false
    var overrideSkills: JSONValue?
    var emit: ((String, JSONValue) -> Void)?
}

@MainActor private final class ContextTransport: BackendTransport {
    let base: DemoTransport
    let faults: ContextFaults
    var onEvent: ((String, JSONValue) -> Void)? { get { base.onEvent } set { base.onEvent = newValue } }
    var onDisconnect: ((MainsError) -> Void)? { get { base.onDisconnect } set { base.onDisconnect = newValue } }
    init(_ backend: DemoBackend, _ faults: ContextFaults) {
        base = DemoTransport(backend: backend); self.faults = faults
        faults.emit = { [weak self] channel, payload in self?.onEvent?(channel, payload) }
    }
    func open(endpoint: URL, token: String) throws { try base.open(endpoint: endpoint, token: token) }
    func close() { base.close() }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        faults.calls.append(.init(channel: channel, args: args, id: commandId))
        if channel == "providers:getSkills" {
            let value = faults.overrideSkills
            if faults.delaySkills { faults.delaySkills = false; try await Task.sleep(for: .milliseconds(100)) }
            if faults.failSkills { throw MainsError.server("Skills unavailable") }
            if let value { return value }
        }
        if channel == "providers:getCommands" && faults.failCommands { throw MainsError.server("Commands unavailable") }
        let value = try await base.perform(channel, args: args, commandId: commandId, timeout: timeout)
        if channel == "runs:execute" && faults.failSendAfter { faults.failSendAfter = false; throw MainsError.timeout }
        return value
    }
}

@Suite(.serialized) struct ContextTests {
    @Test func triggersRespectUnicodeWhitespaceAndTokenBoundaries() throws {
        for (text, trigger, query) in [("@", "@", ""), ("şunu /rev", "/", "rev"), ("👋\n$yazı", "$", "yazı")] {
            let match = try #require(ContextMentions.detect(text))
            #expect(match.trigger == trigger && match.filter == query)
            #expect(String(text[match.range]) == trigger + query)
            #expect(ContextMentions.replacingTrigger(in: text, with: "Review") == String(text[..<match.range.lowerBound]) + "Review ")
        }
        for text in ["hello@example.com", "https://example.com", "/review ", "şu $skill sonra"] { #expect(ContextMentions.detect(text) == nil) }
    }

    @Test func cataloguePresentationKeepsDescriptionsAndAlwaysShowsAScopeOrType() throws {
        let skill = try JSONValue.object(["name": .string("sample"), "shortDescription": .string("  "),
            "description": .string("A real skill description"), "scope": .string("repo")]).decode(ContextSkill.self)
        #expect(skill.detail == "A real skill description")
        #expect(skill.badge == "Project" && skill.group == "Skills")
        #expect(ContextSkill(name: "global").badge == "Skill")
        #expect(ContextSkill(name: "plugin", scope: "PLUGIN").badge == "Plugin")
        #expect(ContextSkill(name: "computer", scope: "mac_app").badge == "Mac app")
        let claude = try JSONValue.object(["name": .string("create-project"), "description": .string("Interactive project setup"),
            "source": .string("user"), "scope": .object(["$undefined": .bool(true)])]).decode(ContextSkill.self)
        #expect(claude.badge == "User" && claude.group == "Skills" && claude.detail == "Interactive project setup")
    }

    @Test func catalogueHandlesUndefinedAndDeduplicatesBeforeVisibilityFiltering() throws {
        let raw: JSONValue = .object(["name": .string("hidden"), "description": .object(["$undefined": .bool(true)]), "userInvokable": .bool(false)])
        let hidden = try raw.decode(ContextSkill.self)
        #expect(hidden.description == nil)
        var catalogue = ContextCatalogue()
        catalogue.replaceSkills([hidden, ContextSkill(name: "hidden"), ContextSkill(name: "pdf:pdf", displayName: "PDF", description: "Read documents", scope: "plugin"), ContextSkill(name: "review", scope: "project")])
        catalogue.replaceCommands([ContextCommand(name: "internal", userFacing: false), ContextCommand(name: "internal"), ContextCommand(name: "review", description: "Review changes")])
        #expect(catalogue.skills.map(\.name) == ["pdf:pdf", "review"])
        #expect(catalogue.matchingSkills("DOCUMENTS").map(\.name) == ["pdf:pdf"])
        #expect(catalogue.matchingSkills("", pluginsOnly: true).count == 1)
        #expect(catalogue.matchingCommands("", trigger: "$").isEmpty)
        #expect(catalogue.matchingCommands("", trigger: "/").map(\.name) == ["review"])
        #expect(catalogue.matchingCommands("", trigger: "@", pluginsOnly: true).isEmpty)
        #expect(hidden.wire["userInvokable"] == .null)
    }

    @Test func namelessCatalogueRowsDoNotDiscardValidProviderMetadata() throws {
        let invalid: [JSONValue] = [.null, .object(["name": .string("")]), .object(["description": .string("Missing name")])]
        let valid: JSONValue = .object(["name": .string("review"), "displayName": .string("Review workspace"),
            "description": .string("Inspect workspace conventions."), "shortDescription": .null, "scope": .string("repo"), "userInvokable": .bool(true)])
        var catalogue = ContextCatalogue()
        catalogue.replaceSkills(try ContextCatalogue.skills(from: .object(["skills": .array(invalid + [valid])])))
        #expect(catalogue.skills.map(\.name) == ["review"])
        #expect(catalogue.skills.first?.detail == "Inspect workspace conventions.")
        #expect(catalogue.skills.first?.badge == "Project")
        catalogue.replaceCommands(try ContextCatalogue.commands(from: .array(invalid + [.object(["name": .string("review"), "description": .string("Review this change")])])) )
        #expect(catalogue.commands.first?.description == "Review this change")
        #expect(throws: MainsError.self) { try ContextCatalogue.skills(from: .object(["unexpected": .array([])])) }
    }

    @Test @MainActor func mentionsFollowEditingScopeChangesAndImmutableSubmissionRecovery() throws {
        let scope = ContextScope(providerID: "codex", workspaceID: "one", workspacePath: "/Demo/one")
        let skill = ContextSkill(name: "demo-writing", displayName: "Clear writing")
        let draft = ConversationDraft(); draft.text = "👋 $cle"; draft.insert(skill, scope: scope)
        #expect(draft.contextSkills == [skill])
        #expect(ContextMentions.goal(draft.text, skills: draft.contextSkills) == "👋 $demo-writing")
        let sent = try #require(draft.begin())
        #expect(sent.contextSkills == [skill] && draft.contextSkills.isEmpty)
        draft.text = "Next"; draft.reject(sent, message: "Offline", uncertain: false)
        draft.restoreUnsent()
        #expect(draft.contextSkills == [skill] && draft.text == sent.text)
        draft.synchronizeContext(ContextScope(providerID: "claude_code"))
        #expect(draft.contextSkills.isEmpty && !draft.text.contains("Clear writing"))
        draft.insert(skill, scope: scope); draft.text = "erased"; draft.reconcileContext()
        #expect(draft.contextSkills.isEmpty)
        draft.insert(skill, scope: scope)
        let uncertain = try #require(draft.begin()); draft.reject(uncertain, message: "Unknown", uncertain: true)
        #expect(draft.text.isEmpty && draft.contextSkills.isEmpty && draft.unsentText == nil)
        #expect(ContextMentions.display("$demo-writing $demo-writing-extra", skills: [skill]) == "Clear writing $demo-writing-extra")
    }

    @Test @MainActor func lazyCataloguesPreservePartialResultsAndReplaceRemovedEntries() async throws {
        let (session, _, faults) = try setup(); defer { session.exitDemo() }
        try await eventually { session.isConnected }
        #expect(!faults.calls.contains { $0.channel == "providers:getSkills" || $0.channel == "providers:getCommands" })
        let scope = session.contextScope(providerID: "codex", workspaceID: session.homeTargets["codex"]?.workspaceID)
        let catalogue = try await session.loadContext(scope)
        #expect(catalogue.skills.contains { $0.scope == "project" } && !catalogue.commands.isEmpty)
        let read = try #require(faults.calls.first { $0.channel == "providers:getSkills" })
        #expect(read.args == [.string("codex"), .string(try #require(scope.workspacePath))])
        faults.failCommands = true; faults.overrideSkills = .array([])
        let partial = try await session.loadContext(scope)
        #expect(partial.skills.isEmpty && partial.commands == catalogue.commands && partial.error != nil)
        let other = try await session.loadContext(session.contextScope(providerID: "claude_code"))
        #expect(other.commands.isEmpty && !other.skills.contains { $0.scope == "project" })
        session.exitDemo()
        #expect(session.cachedContext(scope) == nil)
    }

    @Test @MainActor func lateOrSupersededCataloguesCannotWriteIntoCurrentContext() async throws {
        let (session, _, faults) = try setup(); defer { session.exitDemo() }
        try await eventually { session.isConnected }
        let scope = session.contextScope(providerID: "codex")
        faults.overrideSkills = .array([try .encode(ContextSkill(name: "old"))]); faults.delaySkills = true
        let old = Task { try await session.loadContext(scope) }
        try await Task.sleep(for: .milliseconds(10))
        faults.overrideSkills = .array([try .encode(ContextSkill(name: "new"))])
        _ = try await session.loadContext(scope)
        await #expect(throws: MainsError.self) { try await old.value }
        #expect(session.cachedContext(scope)?.skills.map(\.name) == ["new"])
        faults.delaySkills = true
        let abandoned = Task { try await session.loadContext(scope) }
        try await Task.sleep(for: .milliseconds(10)); session.exitDemo()
        await #expect(throws: MainsError.self) { try await abandoned.value }
        #expect(session.cachedContext(scope) == nil)
    }

    @Test @MainActor func sourceEventsInvalidateOnlyTheVisibleProvidersFetchKey() async throws {
        let (session, _, faults) = try setup(); defer { session.exitDemo() }
        try await eventually { session.isConnected }
        let scope = session.contextScope(providerID: "codex")
        _ = try await session.loadContext(scope)
        let count = faults.calls.filter { $0.channel == "providers:getSkills" }.count
        faults.emit?("providers:skillsUpdated", .object(["providerId": .string("codex")]))
        #expect(session.contextRevisions["codex"] == 1 && session.contextRevisions["claude_code"] == nil)
        #expect(faults.calls.filter { $0.channel == "providers:getSkills" }.count == count, "Closed pickers must not eagerly refetch catalogues.")
        faults.overrideSkills = .array([])
        let refreshed = try await session.loadContext(scope)
        #expect(refreshed.skills.isEmpty && refreshed.error == nil)
    }

    @Test @MainActor func executeContinueAndReceiptChecksKeepCanonicalContextAndDemoHistory() async throws {
        let (session, backend, faults) = try setup(); defer { session.exitDemo() }
        try await eventually { session.isConnected }
        let workspace = session.homeTargets["codex"]?.workspaceID
        let scope = session.contextScope(providerID: "codex", workspaceID: workspace)
        let catalogue = try await session.loadContext(scope)
        let skill = try #require(catalogue.skills.first { $0.scope == "plugin" })
        let text = ContextMentions.replacingTrigger(in: "Use $pla", with: ContextMentions.mention(skill))
        let wrong = ContextScope(providerID: "claude_code")
        await #expect(throws: MainsError.self) { try await session.send(text, spaceID: "codex", workspaceID: workspace, contextSkills: [skill], contextScope: wrong) }
        #expect(!faults.calls.contains { $0.channel == "runs:execute" })
        faults.failSendAfter = true
        await #expect(throws: MainsError.self) { try await session.send(text, spaceID: "codex", workspaceID: workspace, contextSkills: [skill], contextScope: scope) }
        #expect(session.pendingMessage?.status == .uncertain)
        let id = try await session.checkDelivery()
        let sends = faults.calls.filter { $0.channel == "runs:execute" }
        #expect(sends.count == 2 && sends[0].id == sends[1].id && sends[0].args == sends[1].args)
        #expect(sends[0].args[0]["goal"].string == "Use $" + skill.name)
        #expect(sends[0].args[0]["contextSkills"].array == [skill.wire])
        await session.selectConversation(id)
        try await eventually { (try? backend.invoke("runs:getById", args: [.string(id)]))?["status"].string == "succeeded" }
        await session.refresh(); await session.loadHistory(direction: "latest")
        let prompt = try #require(session.transcript.rows.first { $0.kind == .prompt })
        #expect(prompt.contextSkills.first?.name == skill.name)
        #expect(ContextMentions.display(prompt.text, skills: prompt.contextSkills) == "Use " + skill.title)
        let second = ContextMentions.mention(skill) + " again"
        _ = try await session.send(second, runID: id, contextSkills: [skill], contextScope: scope)
        #expect(faults.calls.last { $0.channel == "runs:continue" }?.args[0]["contextSkills"].array == [skill.wire])
    }

    @MainActor private func setup() throws -> (BackendSession, DemoBackend, ContextFaults) {
        let backend = try DemoBackend(stepDelay: .milliseconds(1), streamDelay: .milliseconds(1)), faults = ContextFaults()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in ContextTransport(backend, faults) })
        session.restore(); session.setActive(true); try session.startDemo()
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        return (session, backend, faults)
    }
}


extension SessionIntegrationTests {
    @Test @MainActor func codexContextDiscoveryAllowsTheSameThirtySecondsAsReactNative() async throws {
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true); defer { session.setActive(false) }
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        var request = URLRequest(url: URL(string: endpoint + "/test/context")!)
        request.httpMethod = "POST"; request.httpBody = Data("{\"delayMs\":10500,\"invalidRows\":true}".utf8)
        _ = try await URLSession.shared.data(for: request)
        let catalogue = try await session.loadContext(session.contextScope(providerID: "codex"))
        #expect(catalogue.error == nil)
        #expect(catalogue.skills.map(\.name) == ["fixture-review"])
    }

    @Test @MainActor func contextUsesTypeScriptCodecAndDeviceAllowedCatalogueChannels() async throws {
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let storage = MemoryStorage()
        let session = BackendSession(storage: storage)
        session.restore(); session.setActive(true); defer { session.setActive(false) }
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        let scope = session.contextScope(providerID: "codex", workspaceID: session.workspaces.first?.id)
        let catalogue = try await session.loadContext(scope)
        #expect(catalogue.error == nil)
        #expect(catalogue.skills.map(\.name) == ["fixture-review"])
        #expect(catalogue.skills.first?.description == nil)
        #expect(catalogue.commands.map(\.name) == ["review"])
        #expect(catalogue.commands.first?.description == nil)
        let cache = String(decoding: try Wire.encoder().encode(try #require(storage.snapshot)), as: UTF8.self)
        #expect(!cache.contains("fixture-review"), "Context catalogues stay out of the disposable snapshot.")
        session.grantConsent(providerID: "codex", backendID: "ios-fixture")
        let skill = try #require(catalogue.skills.first)
        let text = "Use " + ContextMentions.mention(skill)
        let id = try await session.send(text, spaceID: "fixture-code", workspaceID: scope.workspaceID, contextSkills: [skill], contextScope: scope)
        await session.selectConversation(id)
        try await eventually { !session.conversations.contains { $0.id == id && $0.isActive } && session.pendingMessage == nil }
        _ = try await session.send(text, runID: id, contextSkills: [skill], contextScope: scope)
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data)
        for channel in ["runs:execute", "runs:continue"] {
            let call = try #require(calls.last { $0["channel"].string == channel })
            #expect(call["args"].array[0]["contextSkills"].array == [skill.wire])
            #expect(call["args"].array[0][channel == "runs:execute" ? "goal" : "message"].string == "Use $fixture-review")
        }
    }
}
