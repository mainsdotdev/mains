import Foundation
import SQLite3
import Testing
@testable import MainsCore

@Test func sqliteCacheRestoresOnlyThePairedDeviceAndRecentHistory() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let cache = SQLiteConversationCache(directory: directory)
    defer { cache.removeAll() }
    let snapshot = CachedSnapshot(backendID: "mac", conversations: [], spaces: [], workspaces: [])
    #expect(cache.loadSnapshot(backendID: "mac", deviceID: "phone") == nil)
    for runID in (1...20).map(String.init) + ["1", "21"] {
        cache.save(snapshot, deviceID: "phone", history: .replace(runID: runID, page: try historyPage(runID)))
    }
    #expect(await cache.loadHistory(backendID: "mac", deviceID: "phone", runID: "2") == nil)

    let reopened = SQLiteConversationCache(directory: directory)
    #expect(reopened.loadSnapshot(backendID: "mac", deviceID: "phone")?.backendID == "mac")
    #expect(reopened.loadSnapshot(backendID: "mac", deviceID: "other") == nil)
    #expect(await reopened.loadHistory(backendID: "mac", deviceID: "other", runID: "1") == nil)
    #expect(await reopened.loadHistory(backendID: "other", deviceID: "phone", runID: "1") == nil)
    for runID in ["1", "3", "20", "21"] {
        let expected = try historyPage(runID)
        #expect(await reopened.loadHistory(backendID: "mac", deviceID: "phone", runID: runID) == expected)
    }

    cache.save(snapshot, deviceID: "phone", history: .remove(runID: "1"))
    #expect(await cache.loadHistory(backendID: "mac", deviceID: "phone", runID: "1") == nil)
    let retained = try historyPage("21")
    #expect(await cache.loadHistory(backendID: "mac", deviceID: "phone", runID: "21") == retained)
    let matches = await reopened.searchSavedMessages("ornek", backendID: "mac", deviceID: "phone")
    #expect(matches.count == 19)
    #expect(matches.first?.runID == "21")
    #expect(matches.first?.cursor.id == 34)
    #expect(matches.first?.snippet.contains("Örnek 💡") == true)
    #expect(await reopened.searchSavedMessages("ornek", backendID: "mac", deviceID: "other").isEmpty)
    try withDatabase(directory) { database in
        let messages = try scalar(database, "SELECT count(*) FROM run_artifacts WHERE content LIKE 'Örnek %'")
        let artifacts = try scalar(database, "SELECT count(*) FROM run_artifacts")
        let tools = try scalar(database, "SELECT count(*) FROM tool_calls WHERE tool_name = 'Read' AND status = 'completed'")
        let turns = try scalar(database, "SELECT count(*) FROM run_turns WHERE turn_index = 2")
        #expect(messages == 19)
        #expect(artifacts == 38)
        #expect(tools == 19)
        #expect(turns == 19)
    }
    cache.save(snapshot, deviceID: "phone", history: .replace(runID: "a", page: try historyPage("a")))
    cache.removeAll()
    #expect(reopened.loadSnapshot(backendID: "mac", deviceID: "phone") == nil)
    #expect(await reopened.loadHistory(backendID: "mac", deviceID: "phone", runID: "a") == nil)
}

@Test func sqliteHistoryReplacementKeepsThePreviousPageIfTheTransactionFails() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let cache = SQLiteConversationCache(directory: directory)
    defer { cache.removeAll() }
    let snapshot = CachedSnapshot(backendID: "mac", conversations: [], spaces: [], workspaces: [])
    let first = try historyPage("run")
    cache.save(snapshot, deviceID: "phone", history: .replace(runID: "run", page: first))
    let latest = HistoryPage(artifacts: [try #require(first.artifacts.last)], toolCalls: [], turns: [],
                             start: nil, end: nil, last: nil, hasOlder: false, hasNewer: false)
    cache.save(snapshot, deviceID: "phone", history: .replace(runID: "run", page: latest))
    #expect(await cache.loadHistory(backendID: "mac", deviceID: "phone", runID: "run") == latest)

    let duplicate = HistoryPage(artifacts: first.artifacts + first.artifacts, toolCalls: first.toolCalls, turns: first.turns,
                                start: first.start, end: first.end, last: first.last, hasOlder: true, hasNewer: true)
    cache.save(snapshot, deviceID: "phone", history: .replace(runID: "run", page: duplicate))
    #expect(await cache.loadHistory(backendID: "mac", deviceID: "phone", runID: "run") == latest)
}

@Test func sqliteRebuildsAnObsoleteSchemaWithoutRestoringItsCache() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let cache = SQLiteConversationCache(directory: directory)
    defer { cache.removeAll() }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let snapshot = CachedSnapshot(backendID: "mac", conversations: [], spaces: [], workspaces: [], selectedSpaceID: "codex")
    let payload = try Wire.encoder().encode(snapshot).map { String(format: "%02x", $0) }.joined()
    try withDatabase(directory) { database in
        try #require(sqlite3_exec(database, """
            CREATE TABLE metadata (id INTEGER PRIMARY KEY, backend_id TEXT, device_id TEXT, payload BLOB);
            INSERT INTO metadata VALUES (1, 'mac', 'phone', x'\(payload)');
            CREATE TABLE history_pages (backend_id TEXT, device_id TEXT, run_id TEXT, payload BLOB);
            INSERT INTO history_pages VALUES ('mac', 'phone', 'run', x'7b7d');
            PRAGMA user_version = 1;
            """, nil, nil, nil) == SQLITE_OK)
    }

    #expect(cache.loadSnapshot(backendID: "mac", deviceID: "phone") == nil)
    #expect(await cache.loadHistory(backendID: "mac", deviceID: "phone", runID: "run") == nil)
    let page = try historyPage("run")
    cache.save(snapshot, deviceID: "phone", history: .replace(runID: "run", page: page))
    #expect(await cache.loadHistory(backendID: "mac", deviceID: "phone", runID: "run") == page)
}

@Test func sqliteHistoryReclaimsDiskSpaceUnderTheByteBudget() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let cache = SQLiteConversationCache(directory: directory)
    defer { cache.removeAll() }
    let snapshot = CachedSnapshot(backendID: "mac", conversations: [], spaces: [], workspaces: [])
    let content = String(repeating: "x", count: 5_100)
    for index in 1...15 {
        let runID = "heavy-\(index)"
        let page = HistoryPage(artifacts: (1...400).map {
            Artifact(id: $0, runId: runID, kind: "report", content: content, metadata: nil, createdAt: .now)
        }, toolCalls: [], turns: [], start: nil, end: nil, last: nil, hasOlder: true, hasNewer: false)
        cache.save(snapshot, deviceID: "phone", history: .replace(runID: runID, page: page))
    }
    #expect(await cache.loadHistory(backendID: "mac", deviceID: "phone", runID: "heavy-15")?.artifacts.count == 400)
    #expect(await cache.loadHistory(backendID: "mac", deviceID: "phone", runID: "heavy-1") == nil)
    let file = directory.appendingPathComponent("conversations.sqlite")
    let size = try #require(file.resourceValues(forKeys: [.fileSizeKey]).fileSize)
    #expect(size <= 32 * 1024 * 1024)
}

@Test func sqliteKeepsOfflineMetadataAndOriginalFilesWithIndependentLimits() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let cache = SQLiteConversationCache(directory: directory)
    defer { cache.removeAll() }
    let large = Data(repeating: 1, count: 1_600_000)
    let current = Data(repeating: 2, count: 600_000)
    cache.saveOfflineValue(large, key: "atlas:page:one", backendID: "mac", deviceID: "phone")
    cache.saveOfflineValue(current, key: "atlas:page:two", backendID: "mac", deviceID: "phone")
    #expect(await cache.offlineValues("atlas:", prefix: true, backendID: "mac", deviceID: "phone") == [current])
    #expect(await cache.offlineValues("atlas:", prefix: true, backendID: "mac", deviceID: "other").isEmpty)

    let original = Data("Original file contents".utf8)
    let source = directory.appendingPathComponent("source.pdf")
    try original.write(to: source)
    let file = OfflineFile(key: .output(runID: "run", artifactID: 1), name: "Report.pdf",
                           previewType: "pdf", version: "v1", byteSize: original.count)
    try await cache.saveOfflineFile(file, copying: source, backendID: "mac", deviceID: "phone")
    try FileManager.default.removeItem(at: source)
    let reopened = SQLiteConversationCache(directory: directory)
    let copy = try #require(await reopened.offlineFileURL(file, backendID: "mac", deviceID: "phone"))
    let restored = try Data(contentsOf: copy)
    #expect(restored == original)
    #expect(await reopened.offlineFiles(backendID: "mac", deviceID: "other").isEmpty)
    #expect(await reopened.offlineFiles(backendID: "mac", deviceID: "phone").map(\.key) == [file.key])
    try await reopened.removeOfflineFile(file, backendID: "mac", deviceID: "phone")
    #expect(!FileManager.default.fileExists(atPath: copy.path))
    #expect(await reopened.offlineFiles(backendID: "mac", deviceID: "phone").isEmpty)
}

@Test @MainActor func sqliteOfflineSearchOpensTheMatchingMessageWithoutATransport() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let cache = SQLiteConversationCache(directory: directory)
    defer { cache.removeAll() }
    let storage = MemoryStorage()
    storage.sqliteCache = cache
    let descriptor = BackendDescriptor(backendId: "mac", name: "Mac", appVersion: "1", protocolVersion: 1,
                                       capabilities: [], serverTime: "2026-11-10T10:00:00Z")
    storage.pairing = PairedBackend(descriptor: descriptor, endpoints: [URL(string: "https://mac.example")!], deviceId: "phone", deviceToken: "test")
    let run = try Wire.decoder().decode(Conversation.self, from: Data(#"{"id":"run","accountId":"account","providerId":"codex","mode":"chat","title":"Saved chat","status":"succeeded","isArchived":false,"createdAt":1000,"updatedAt":2000}"#.utf8))
    cache.save(CachedSnapshot(backendID: "mac", conversations: [run], spaces: [], workspaces: []),
               deviceID: "phone", history: .replace(runID: run.id, page: try historyPage(run.id)))
    let session = BackendSession(storage: storage)
    session.setOnline(false)
    session.restore()
    session.setActive(true)
    #expect(session.connection == .offline)
    let results = await session.searchSavedConversations("ornek")
    let result = try #require(results.first)
    #expect(result.title == "Saved chat")
    let cursor = try #require(result.messageCursor)
    await session.selectConversation(result.runId, around: cursor)
    #expect(session.transcript.rows.contains { $0.text == "Örnek 💡 run" })
    #expect(session.connection == .offline)
}

@Test func sqliteCacheRebuildsACorruptDisposableDatabase() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let cache = SQLiteConversationCache(directory: directory)
    defer { cache.removeAll() }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data("not a database".utf8).write(to: directory.appendingPathComponent("conversations.sqlite"))

    let snapshot = CachedSnapshot(backendID: "mac", conversations: [], spaces: [], workspaces: [])
    cache.save(snapshot, deviceID: "phone", history: nil)
    #expect(cache.loadSnapshot(backendID: "mac", deviceID: "phone")?.backendID == "mac")
}

private func historyPage(_ runID: String) throws -> HistoryPage {
    let date = Date(timeIntervalSinceReferenceDate: 50.75)
    let artifacts = [
        Artifact(id: 34, runId: runID, kind: "report", content: "Örnek 💡 \(runID)", metadata: .object(["streamId": .string("stream")]),
                 createdAt: date, path: "output", contentHash: "hash"),
        Artifact(id: 12, runId: runID, kind: "prompt", content: "", metadata: nil, createdAt: date),
    ]
    let tool = try JSONDecoder().decode(ToolCall.self, from: Data(#"{"id":15,"toolName":"Read","status":"completed","createdAt":50.75,"output":{"preview":true}}"#.utf8))
    let turn = try JSONDecoder().decode(RunTurn.self, from: Data(#"{"id":6,"status":"completed","turnIndex":2,"createdAt":50.75}"#.utf8))
    let cursor = HistoryCursor(timestamp: 1000, source: "artifact", id: 12)
    return HistoryPage(artifacts: artifacts, toolCalls: [tool], turns: [turn], start: cursor, end: nil, last: cursor,
                       hasOlder: true, hasNewer: false, activity: HistoryActivityRange(start: cursor, end: cursor.exclusiveEnd, omittedCount: 3))
}

private func withDatabase(_ directory: URL, _ body: (OpaquePointer) throws -> Void) throws {
    var connection: OpaquePointer?
    defer { sqlite3_close(connection) }
    try #require(sqlite3_open(directory.appendingPathComponent("conversations.sqlite").path, &connection) == SQLITE_OK)
    try body(#require(connection))
}

private func scalar(_ database: OpaquePointer, _ sql: String) throws -> Int32 {
    var statement: OpaquePointer?
    defer { sqlite3_finalize(statement) }
    try #require(sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK)
    try #require(sqlite3_step(statement) == SQLITE_ROW)
    return sqlite3_column_int(statement, 0)
}
