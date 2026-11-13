import Foundation
import Testing
@testable import MainsCore

@Suite struct AtlasSaveTests {
    @Test @MainActor func demoSavesOutputsAndBookmarksOnceWithoutChangingChatsOrStorage() async throws {
        let backend = try DemoBackend(), storage = MemoryStorage()
        let session = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let owner = session.ownership, space = session.selectedSpaceID
        let output = try #require(try await session.listOutputs(DemoBackend.tourID).items.first)
        let saved = try await session.saveAtlasFile(.output(output), owner: owner)
        let same = try await session.saveAtlasFile(.output(output), owner: owner)
        #expect(saved.id == same.id && saved.kind == "file")
        let bookmark = try await session.saveAtlasBookmark("https://example.org/notes?utm_source=mail", collectionID: nil, owner: owner)
        let duplicate = try await session.saveAtlasBookmark("https://example.org/notes", collectionID: nil, owner: owner)
        #expect(bookmark.id == duplicate.id && duplicate.kind == "bookmark")
        var query = AtlasQuery(); query.scope = "saved"
        let library = try await session.atlasLibrary(query)
        #expect(library.items.filter { $0.id == saved.id || $0.id == bookmark.id }.count == 2)
        let file = try await session.describeAtlasFile(.saved(saved.id))
        #expect(file.byteSize == output.byteSize)
        #expect(session.pendingAtlasSave == nil && session.selectedSpaceID == space && session.viewingRunID == nil && session.transcript.rows.isEmpty)
        #expect(storage.snapshot == nil)
    }

    @Test @MainActor func lostAcknowledgementBlocksNewSavesAndChecksTheOriginalReceiptAfterNavigation() async throws {
        let backend = try DemoBackend(), probe = AtlasSaveProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasSaveTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.loseACK = true
        await #expect(throws: MainsError.self) { try await session.saveAtlasBookmark("https://example.org/recovery", collectionID: nil, owner: session.ownership) }
        let pending = try #require(session.pendingAtlasSave)
        #expect(pending.status == .uncertain && !session.canSaveToAtlas)
        await #expect(throws: MainsError.self) { try await session.saveAtlasBookmark("https://example.org/another", collectionID: nil, owner: session.ownership) }
        let run = try #require(session.conversations.first?.id)
        await session.selectConversation(run)
        let rows = session.transcript.rows.map(\.id)
        let result = try await session.checkAtlasSaveDelivery()
        #expect(result.kind == "bookmark" && session.pendingAtlasSave == nil)
        #expect(session.viewingRunID == run && session.transcript.rows.map(\.id) == rows)
        let saves = probe.calls.filter { $0.0 == "atlas:saveMobileBookmark" }
        #expect(saves.count == 2 && saves[0].1 == saves[1].1 && saves[0].2 == saves[1].2 && saves[0].2 == pending.id)
        var query = AtlasQuery(); query.text = "example.org"
        #expect(try await session.atlasLibrary(query).items.count == 1)
    }

    @Test @MainActor func definiteRefusalReleasesAdmissionAndLateSuccessCannotCrossPairingOwnership() async throws {
        let backend = try DemoBackend(), probe = AtlasSaveProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasSaveTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { probe.release(); session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.reject = true
        await #expect(throws: MainsError.self) { try await session.saveAtlasBookmark("https://example.org/refused", collectionID: nil, owner: session.ownership) }
        #expect(session.pendingAtlasSave == nil && session.canSaveToAtlas)
        probe.hold = true
        let owner = session.ownership
        let save = Task { try await session.saveAtlasBookmark("https://example.org/late", collectionID: nil, owner: owner) }
        try await eventually { probe.held != nil }
        session.exitDemo(); try session.startDemo()
        try await eventually { session.isConnected }
        probe.release()
        await #expect(throws: MainsError.self) { try await save.value }
        #expect(session.ownership != owner && session.pendingAtlasSave == nil)
    }

    @Test func bookmarkInputAcceptsOnlyExplicitWebLinks() {
        #expect(AtlasBookmarkURL.validate(" https://example.com/a?x=1 ") == "https://example.com/a?x=1")
        for value in ["example.com", "file:///private/file", "javascript:alert(1)", "https://user:password@example.com", "https://example.com/\nsecret"] { #expect(AtlasBookmarkURL.validate(value) == nil) }
    }
}

extension SessionIntegrationTests {
    @Test @MainActor func atlasSavesUseReceiptBackedCommandsAndAppearInTheLibrary() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        let file = try #require(try await session.listOutputs("fixture-run").items.first)
        let item = try await session.saveAtlasFile(.output(file), owner: session.ownership)
        let again = try await session.saveAtlasFile(.output(file), owner: session.ownership)
        #expect(item.id == again.id)
        let bookmark = try await session.saveAtlasBookmark("https://example.org/native?utm_source=ios", collectionID: nil, owner: session.ownership)
        let duplicate = try await session.saveAtlasBookmark("https://example.org/native", collectionID: nil, owner: session.ownership)
        #expect(bookmark.id == duplicate.id)
        var query = AtlasQuery(); query.scope = "saved"; query.text = "example.org"
        #expect(try await session.atlasLibrary(query).items.map(\.id) == [bookmark.id])
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data).filter { $0["channel"].string?.hasPrefix("atlas:save") == true }
        #expect(calls.count == 4 && calls.allSatisfy { $0["commandId"].string?.isEmpty == false })
        #expect(calls.allSatisfy { $0["args"].array.first?["path"].string == nil })
    }
}

@MainActor private final class AtlasSaveProbe {
    var loseACK = false, hold = false, reject = false
    var held: CheckedContinuation<Void, Never>?
    var calls: [(String, [JSONValue], String?)] = []
    func release() { let continuation = held; held = nil; continuation?.resume() }
}
@MainActor private final class AtlasSaveTransport: BackendTransport {
    let base: DemoTransport
    let probe: AtlasSaveProbe
    init(_ backend: DemoBackend, _ probe: AtlasSaveProbe) { base = DemoTransport(backend: backend); self.probe = probe }
    var onEvent: ((String, JSONValue) -> Void)? { get { base.onEvent } set { base.onEvent = newValue } }
    var onDisconnect: ((MainsError) -> Void)? { get { base.onDisconnect } set { base.onDisconnect = newValue } }
    func open(endpoint: URL, token: String) throws { try base.open(endpoint: endpoint, token: token) }
    func close() { base.close() }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        probe.calls.append((channel, args, commandId))
        if channel.hasPrefix("atlas:save"), probe.reject { probe.reject = false; throw MainsError.server("Invalid bookmark URL") }
        let value = try await base.perform(channel, args: args, commandId: commandId, timeout: timeout)
        if channel.hasPrefix("atlas:save"), probe.loseACK { probe.loseACK = false; throw MainsError.timeout }
        if channel.hasPrefix("atlas:save"), probe.hold { probe.hold = false; await withCheckedContinuation { probe.held = $0 } }
        return value
    }
}
