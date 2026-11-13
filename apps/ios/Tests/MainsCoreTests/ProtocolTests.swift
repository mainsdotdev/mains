import Foundation
import Testing
@testable import MainsCore

@Test func openCodeModelLabelsKeepDesktopGroupsAndOriginalSelectionIdentities() throws {
    let names = [
        ("github-copilot/raw-sonnet", "github-copilot/Claude Sonnet 5.5"),
        ("openai/raw-sol", "openai/GPT-6.1 Sol"),
        ("copilot/raw-haiku", "copilot/Claude Haiku 4.5"),
        ("openai/raw-fast", "openai/GPT-6.1 Sol Fast"),
        ("local/custom", "local-ai-lab/some-org/model-v2"),
        ("auto", "Auto"),
    ]
    let models = try JSONValue.array(names.map { .object(["id": .string($0.0), "displayName": .string($0.1)]) }).decode([ModelChoice].self)
    let groups = OpenCodeModelDisplay.groups(models)
    #expect(groups.map(\.provider) == ["GitHub Copilot", "OpenAI", "Local AI Lab", "Other"])
    #expect(groups[0].models.map(\.id) == ["github-copilot/raw-sonnet", "copilot/raw-haiku"])
    #expect(groups[1].models.map(\.id) == ["openai/raw-sol", "openai/raw-fast"])
    #expect(models[0].label(for: "opencode") == "Claude Sonnet 5.5")
    #expect(models[1].label(for: "opencode") == "GPT-6.1 Sol")
    #expect(models[4].label(for: "opencode") == "some-org/model-v2")
    #expect(OpenCodeModelDisplay.parts(models[4].displayName)?.name == "some-org/model-v2")
    var settings = ComposerSettings()
    settings.select(groups[0].models[1], provider: "opencode")
    #expect(settings.model == "copilot/raw-haiku")
    #expect(Set(groups.flatMap(\.models).map(\.id)) == Set(models.map(\.id)))
}
@Test func pairingLinkPreservesEncodedEndpointsAndAcceptsVariants() throws {
    for scheme in ["mains", "mains-dev", "mains-preview", "mains-native"] {
        let link = try PairingLink("\(scheme)://pair#code=a%2Bb&name=Work+Mac&endpoint=http%3A%2F%2F192.168.1.2%3A8787&endpoint=https%3A%2F%2Fmac.example.com&endpoint=javascript%3Abad")
        #expect(link.code == "a+b")
        #expect(link.name == "Work Mac")
        #expect(link.endpoints.map(\.absoluteString) == ["http://192.168.1.2:8787", "https://mac.example.com"])
    }
    #expect(throws: MainsError.invalidLink) { try PairingLink("https://example.com/#code=secret") }
    #expect(throws: MainsError.invalidLink) { try PairingLink("mains://pair#code=x&endpoint=http%3A%2F%2Fu%3Ap%40host") }
    #expect(throws: MainsError.invalidLink) { try PairingLink("mains://pair#endpoint=http://localhost") }
}

@Test func wireDatesAndUndefinedMatchTypeScriptCodec() throws {
    struct Value: Codable { let at: Date; let trailing: JSONValue }
    let json = Data(#"{"at":{"$date":"2026-11-09T10:20:30.123Z"},"trailing":{"$undefined":true}}"#.utf8)
    let value = try Wire.decoder().decode(Value.self, from: json)
    let roundtrip = try JSONDecoder().decode(JSONValue.self, from: Wire.encoder().encode(value))
    #expect(roundtrip["at"]["$date"].string == "2026-11-09T10:20:30.123Z")
    #expect(roundtrip["trailing"] == .object(["$undefined": .bool(true)]))
    #expect(try Wire.webSocketURL(URL(string: "https://mac.example.com:8787/socket")!).absoluteString == "wss://mac.example.com:8787/socket")
}

@Test func unknownCommandReceiptIsNeverTreatedAsDefiniteRefusal() {
    #expect(MainsError.server("Command outcome is unknown because its result was not recorded. Check the conversation before sending another command.").isUnconfirmedCommand)
    #expect(MainsError.server("Could not verify the previous command result. The command was not run again.").isUnconfirmedCommand)
    #expect(!MainsError.server("Provider is disabled").isUnconfirmedCommand)
}

@Test func modelCatalogueDecodesTaggedUndefinedOptionalFields() throws {
    // The TypeScript codec tags explicitly undefined keys in Claude's SDK projection.
    let data = Data(#"[{"id":"sonnet","displayName":"Claude Sonnet","description":"Live catalogue","isDefault":true,"supportsFastMode":false,"supportsEffort":{"$undefined":true},"supportedEffortLevels":{"$undefined":true}},{"id":"haiku","displayName":"Claude Haiku","description":{"$undefined":true},"isDefault":{"$undefined":true},"supportsFastMode":{"$undefined":true},"supportedEffortLevels":{"$undefined":true},"serviceTiers":{"$undefined":true}},{"id":"capable","displayName":"Capable","supportedEffortLevels":["medium","high"],"supportsFastMode":true,"serviceTiers":[{"id":"fast","name":"Fast","description":{"$undefined":true}}]}]"#.utf8)
    let wire = try JSONDecoder().decode(JSONValue.self, from: data)
    let models = try wire.decode([ModelChoice].self)
    #expect(models.count == 3)
    #expect(models[0].isDefault == true && models[0].supportsFastMode == false)
    #expect(models[0].description == "Live catalogue" && models[0].supportedEffortLevels == nil)
    #expect(models[1].description == nil && models[1].isDefault == nil && models[1].supportsFastMode == nil)
    #expect(models[1].supportedEffortLevels == nil && models[1].serviceTiers == nil)
    #expect(models[2].supportedEffortLevels == ["medium", "high"] && models[2].supportsFastMode == true)
    #expect(models[2].serviceTiers?.first?.id == "fast")
    #expect(models[2].serviceTiers?.first?.description == nil)
    #expect(wire.array[0]["supportedEffortLevels"] == .object(["$undefined": .bool(true)]))
}

@Test func modelCatalogueStillRejectsMalformedCapabilities() throws {
    let value: JSONValue = .object(["id": .string("bad"), "displayName": .string("Bad"), "supportedEffortLevels": .string("high")])
    #expect(throws: DecodingError.self) { try value.decode(ModelChoice.self) }
}

func samplePage(artifacts: String = "[]", hasNewer: Bool = false) throws -> HistoryPage {
    try Wire.decoder().decode(HistoryPage.self, from: Data("""
    {"artifacts":\(artifacts),"toolCalls":[],"turns":[],"start":{"timestamp":1000,"source":"artifact","id":1},
    "end":\(hasNewer ? "{\"timestamp\":2000,\"source\":\"artifact\",\"id\":3}" : "null"),
    "last":{"timestamp":1500,"source":"artifact","id":2},"hasOlder":true,"hasNewer":\(hasNewer)}
    """.utf8))
}

func delta(_ text: String, id: String = "answer-1") -> JSONValue {
    .object(["ts": .number(1200), "event": .object([
        "type": .string("artifact"), "kind": .string("report"), "streamId": .string(id), "content": .string(text),
        "metadata": .object(["source": .string("agent_message_streaming"), "streaming": .bool(true)]),
    ])])
}

@Test func streamSettlesAndDurableIdentityAcknowledgesWithoutDuplicates() throws {
    var transcript = Transcript()
    transcript.receive(delta("Hello"))
    transcript.receive(delta("Hello world"))
    #expect(transcript.rows.map(\.text) == ["Hello world"])
    transcript.settleTurn()
    transcript.receive(delta("late stale delta"))
    #expect(transcript.rows.first?.text == "Hello world")
    #expect(transcript.rows.first?.live == false)
    let artifacts = #"[{"id":2,"runId":"run","kind":"report","content":"Hello world","metadata":{"streamId":"answer-1"},"createdAt":{"$date":"1970-01-01T00:00:01.200Z"}}]"#
    transcript.replace(try samplePage(artifacts: artifacts))
    #expect(transcript.rows.count == 1)
    #expect(transcript.rows.first?.id == "stream:answer-1")
    transcript.receive(delta("another late delta"))
    #expect(transcript.rows.count == 1)
    transcript.replace(try samplePage())
    transcript.receive(delta("acknowledgement survives page eviction"))
    #expect(transcript.rows.isEmpty)
}

@Test func historicalPagesHideLiveStreamsAndUseBackendBounds() throws {
    var transcript = Transcript()
    transcript.receive(delta("New answer"))
    transcript.replace(try samplePage(hasNewer: true))
    #expect(transcript.rows.isEmpty)
    let older = try transcript.request(runID: "run", direction: "older")
    #expect(older["cursor"]["id"].number == 1)
    #expect(older["profile"].string == "mobile")
    let refresh = try transcript.request(runID: "run", direction: "refresh")
    #expect(refresh["end"]["id"].number == 3)
    let latest = try transcript.request(runID: "run", direction: "latest")
    #expect(latest["cursor"] == .null)
}

@Test func subagentAndThinkingContentNeverBecomesParentProse() throws {
    let artifacts = #"[{"id":1,"runId":"run","kind":"thinking","content":"hidden","metadata":null,"createdAt":{"$date":"1970-01-01T00:00:01Z"}},{"id":2,"runId":"run","kind":"report","content":"child","metadata":{"isFromSubagent":true},"createdAt":{"$date":"1970-01-01T00:00:02Z"}},{"id":3,"runId":"run","kind":"user-prompt","content":"Hi","metadata":{"kind":"report"},"createdAt":{"$date":"1970-01-01T00:00:03Z"}}]"#
    var transcript = Transcript()
    transcript.replace(try samplePage(artifacts: artifacts))
    #expect(transcript.rows.map(\.text) == ["Hi"])
    #expect(transcript.rows.first?.kind == .prompt)
}

@Test @MainActor func aiConsentRevocationIsScopedAndSurvivesRestore() throws {
    let storage = MemoryStorage()
    let descriptor = BackendDescriptor(backendId: "my-computer", name: "My Mac", appVersion: "1.0", protocolVersion: 1,
                                       capabilities: [], serverTime: "2026-11-10T10:00:00Z")
    storage.pairing = PairedBackend(descriptor: descriptor, endpoints: [URL(string: "https://mac.example")!], deviceId: "phone", deviceToken: "secret")
    storage.grantConsent(backendID: "my-computer", providerID: "codex")
    storage.grantConsent(backendID: "my-computer", providerID: "claude_code")
    storage.grantConsent(backendID: "other-computer", providerID: "codex")
    let session = BackendSession(storage: storage)
    session.restore()
    session.revokeConsent(providerID: "codex", backendID: "other-computer")
    session.revokeAllConsents(backendID: "other-computer")
    #expect(session.hasConsent(providerID: "codex"))
    #expect(storage.hasConsent(backendID: "other-computer", providerID: "codex"))
    session.revokeConsent(providerID: "codex", backendID: "my-computer")
    #expect(!session.hasConsent(providerID: "codex"))
    #expect(session.hasConsent(providerID: "claude_code"))
    let restored = BackendSession(storage: storage)
    restored.restore()
    #expect(!restored.hasConsent(providerID: "codex"))
    restored.revokeAllConsents(backendID: "my-computer")
    #expect(!restored.hasConsent(providerID: "claude_code"))
    #expect(storage.hasConsent(backendID: "other-computer", providerID: "codex"))
    restored.grantConsent(providerID: "codex", backendID: "my-computer")
    #expect(restored.hasConsent(providerID: "codex"))
}

@Test func settingsMetadataLoadsOlderPairingsAndCaches() throws {
    let data = Data(#"{"descriptor":{"backendId":"mac","name":"Mac","appVersion":"1","protocolVersion":1,"capabilities":[],"serverTime":"2026-11-10T10:00:00Z"},"endpoints":["https://mac.example"],"deviceId":"phone","deviceToken":"secret"}"#.utf8)
    var pairing = try Wire.decoder().decode(PairedBackend.self, from: data)
    #expect(pairing.pairedAt == nil)
    pairing.pairedAt = Date(timeIntervalSince1970: 1_794_306_600)
    let saved = try Wire.decoder().decode(PairedBackend.self, from: Wire.encoder().encode(pairing))
    #expect(saved == pairing)
    let oldCache = Data(#"{"backendID":"mac","conversations":[],"spaces":[],"workspaces":[],"histories":{}}"#.utf8)
    var cache = try Wire.decoder().decode(CachedSnapshot.self, from: oldCache)
    #expect(cache.lastSyncedAt == nil)
    cache.lastSyncedAt = pairing.pairedAt
    let savedCache = try Wire.decoder().decode(CachedSnapshot.self, from: Wire.encoder().encode(cache))
    #expect(savedCache.lastSyncedAt == pairing.pairedAt)
}
