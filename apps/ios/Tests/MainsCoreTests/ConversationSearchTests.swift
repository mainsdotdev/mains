import Foundation
import Testing
@testable import MainsCore

extension SessionIntegrationTests {
    @Test @MainActor func searchFindsConversationsBeyondTheRecentHundredAndOpensTheMatchingHistoricalMessage() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        var request = URLRequest(url: URL(string: endpoint + "/test/search-data")!); request.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: request)
        await session.refresh()
        #expect(session.conversations.count == 100 && !session.conversations.contains { $0.id == "old-search-000" })
        var found: [String] = [], cursor: ConversationSearchCursor?
        repeat {
            let page = try await session.searchConversations("telescope", cursor: cursor)
            #expect(page.items.count <= 25)
            found += page.items.map(\.runId); cursor = page.nextCursor
        } while cursor != nil
        #expect(found.count == 140 && Set(found).count == 140 && found.contains("old-search-000"))
        let results = try await session.searchConversations("deepneedle")
        let hit = try #require(results.items.first), anchor = try #require(hit.messageCursor)
        #expect(hit.runId == "old-search-000" && hit.snippet?.contains("Deepneedle") == true)
        await session.selectConversation(hit.runId, around: anchor)
        #expect(session.transcript.page?.artifacts.contains { $0.id == anchor.id } == true)
        #expect(session.transcript.page?.artifacts.first?.kind == "user-prompt")
        #expect(session.transcript.page?.hasNewer == true && !session.transcript.isFollowing)
        #expect(session.transcript.rows.contains { $0.text.contains("Deepneedle") })
        await session.refresh()
        #expect(session.conversations.contains { $0.id == hit.runId } && session.conversations.count <= 101)
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data)
        let read = try #require(calls.last { $0["channel"].string == "runs:getHistory" && $0["args"].array[0]["runId"].string == hit.runId })
        let encodedAnchor = try JSONValue.encode(anchor)
        #expect(read["args"].array[0]["profile"].string == "mobile" && read["args"].array[0]["cursor"] == encodedAnchor)
        #expect(read["args"].array[0]["conversationWindow"] == .bool(true))
        #expect(!calls.contains { $0["channel"].string == "search:query" })
    }
}

@MainActor private final class SearchProbe { var release: CheckedContinuation<Void, Never>?; var hold = true }
@MainActor private final class SearchTransport: BackendTransport {
    let base: DemoTransport
    let probe: SearchProbe
    var onEvent: ((String, JSONValue) -> Void)? { get { base.onEvent } set { base.onEvent = newValue } }
    var onDisconnect: ((MainsError) -> Void)? { get { base.onDisconnect } set { base.onDisconnect = newValue } }
    init(_ backend: DemoBackend, _ probe: SearchProbe) { base = DemoTransport(backend: backend); self.probe = probe }
    func open(endpoint: URL, token: String) throws { try base.open(endpoint: endpoint, token: token) }
    func close() { base.close() }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        let value = try await base.perform(channel, args: args, commandId: commandId, timeout: timeout)
        if channel == "search:conversations", probe.hold { probe.hold = false; await withCheckedContinuation { probe.release = $0 } }
        return value
    }
}

@Test @MainActor func aRetiredSearchResponseCannotReturnIntoAReconnectedSession() async throws {
    let backend = try DemoBackend(), probe = SearchProbe()
    let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in SearchTransport(backend, probe) })
    session.restore(); session.setActive(true); try session.startDemo()
    defer { session.exitDemo(); backend.shutdown() }
    try await eventually { session.isConnected }
    let task = Task { try await session.searchConversations("demo") }
    try await eventually { probe.release != nil }
    session.setActive(false); session.setActive(true)
    try await eventually { session.isConnected }
    probe.release?.resume(); probe.release = nil
    await #expect(throws: MainsError.changedBackend) { try await task.value }
    let current = try await session.searchConversations("demo")
    #expect(!current.items.isEmpty && current.items.count <= 25)
}
