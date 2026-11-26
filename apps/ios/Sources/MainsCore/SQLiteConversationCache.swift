import Foundation
import os
import SQLite3

/// A disposable copy of the paired computer's metadata and transcript records.
final class SQLiteConversationCache: Sendable {
    private enum DatabaseError: Error {
        case sqlite(Int32)
        case unsupportedSchema
        case obsoleteSchema
        case invalidHistory
    }

    private static let metadataLimit = 8 * 1024 * 1024
    private static let pageLimit = 2 * 1024 * 1024
    private static let rowLimit = 400
    private static let cacheLimit = 32 * 1024 * 1024
    private static let metadataExtrasLimit = 2 * 1024 * 1024
    private static let fileCacheLimit = 200 * 1024 * 1024
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private struct HistoryKey: Hashable {
        let backendID: String
        let deviceID: String
        let runID: String

        var keys: [String] { [backendID, deviceID, runID] }
    }

    /// Accessed only under the pending-writes lock until handed to the queue.
    private final class WriteBatch: @unchecked Sendable {
        var snapshot: CachedSnapshot
        var deviceID: String
        var histories: [HistoryKey: (order: Int, change: CachedHistoryChange)] = [:]
        var order = 0

        init(snapshot: CachedSnapshot, deviceID: String) {
            self.snapshot = snapshot
            self.deviceID = deviceID
        }
    }

    private let directory: URL
    private let queue: DispatchQueue
    private let pendingWrites = OSAllocatedUnfairLock<WriteBatch?>(initialState: nil)

    init(directory: URL, queue: DispatchQueue = DispatchQueue(label: "dev.mains.conversation-cache", qos: .utility)) {
        self.directory = directory
        self.queue = queue
    }

    func loadSnapshot(backendID: String, deviceID: String) async -> CachedSnapshot? {
        await onQueue { [self] in
            useDatabase(create: false) { database in
                try read(CachedSnapshot.self, database, """
                    SELECT payload FROM metadata WHERE id = 1 AND backend_id = ? AND device_id = ?
                    """, keys: [backendID, deviceID], limit: Self.metadataLimit)
            }
        }
    }

    func loadHistory(backendID: String, deviceID: String, runID: String) async -> HistoryPage? {
        await onQueue { [self] in
            useDatabase(create: false) { database in
                try transaction(database, writing: false) {
                    try readHistory(database, backendID: backendID, deviceID: deviceID, runID: runID)
                }
            }
        }
    }

    func save(_ snapshot: CachedSnapshot, deviceID: String, history: CachedHistoryChange?) {
        pendingWrites.withLock { pending in
            let batch: WriteBatch
            if let pending {
                batch = pending
                batch.snapshot = snapshot
                batch.deviceID = deviceID
            } else {
                batch = WriteBatch(snapshot: snapshot, deviceID: deviceID)
                pending = batch
                queue.async { [self] in
                    pendingWrites.withLock { pending in
                        if pending === batch { pending = nil }
                    }
                    write(batch)
                }
            }
            if let history {
                let runID: String
                switch history {
                case .replace(let id, _), .remove(let id): runID = id
                }
                let key = HistoryKey(backendID: snapshot.backendID, deviceID: deviceID, runID: runID)
                batch.order += 1
                batch.histories[key] = (batch.order, history)
            }
        }
    }

    func removeAll() {
        let removal = DispatchWorkItem { [directory] in
            try? FileManager.default.removeItem(at: directory)
        }
        pendingWrites.withLockUnchecked { pending in
            pending = nil
            queue.async(execute: removal)
        }
        removal.wait()
    }

    func searchSavedMessages(_ query: String, backendID: String, deviceID: String) async -> [SavedMessageMatch] {
        guard !query.isEmpty else { return [] }
        return await onQueue {
            self.useDatabase(create: false) { database in
                try self.searchMessages(database, query: query, keys: [backendID, deviceID])
            } ?? []
        }
    }

    func offlineValues(_ key: String, prefix: Bool, backendID: String, deviceID: String) async -> [Data] {
        await onQueue {
            self.useDatabase(create: false) { database in
                let condition = prefix ? "instr(cache_key, ?) = 1" : "cache_key = ?"
                return try self.statement(database, """
                    SELECT payload FROM offline_values WHERE backend_id = ? AND device_id = ? AND \(condition)
                    ORDER BY rowid DESC LIMIT 50
                    """, keys: [backendID, deviceID, key]) { query in
                    var values: [Data] = []
                    while true {
                        let result = sqlite3_step(query)
                        if result == SQLITE_DONE { return values }
                        try self.check(result, expected: SQLITE_ROW)
                        if let data = self.blob(query, column: 0, limit: Self.metadataExtrasLimit) { values.append(data) }
                    }
                }
            } ?? []
        }
    }

    func saveOfflineValue(_ data: Data, key: String, backendID: String, deviceID: String) {
        guard data.count <= Self.metadataExtrasLimit else { return }
        enqueue { [self] in
            _ = useDatabase(create: true) { database in
                try transaction(database) {
                    try execute(database, """
                        INSERT OR REPLACE INTO offline_values (backend_id, device_id, cache_key, payload)
                        VALUES (?, ?, ?, ?)
                        """, keys: [backendID, deviceID, key], payload: data)
                    try execute(database, """
                        DELETE FROM offline_values WHERE rowid IN (
                            SELECT rowid FROM (
                                SELECT rowid, sum(length(payload)) OVER (ORDER BY rowid DESC) AS bytes,
                                       row_number() OVER (ORDER BY rowid DESC) AS position FROM offline_values
                            ) WHERE bytes > \(Self.metadataExtrasLimit) OR position > 100
                        )
                        """)
                    try trimHistory(database)
                }
                try reclaimSpace(database)
            }
        }
    }

    func removeOfflineValues(_ prefix: String, backendID: String, deviceID: String) {
        enqueue { [self] in
            _ = useDatabase(create: false) { database in
                try execute(database, "DELETE FROM offline_values WHERE backend_id = ? AND device_id = ? AND instr(cache_key, ?) = 1",
                            keys: [backendID, deviceID, prefix])
            }
        }
    }

    func offlineFiles(backendID: String, deviceID: String) async -> [OfflineFile] {
        await onQueue {
            self.useDatabase(create: false) { database in
                try self.pruneOfflineFileFolders(database)
                return try self.statement(database, """
                    SELECT folder, payload FROM offline_files WHERE backend_id = ? AND device_id = ? ORDER BY rowid DESC
                    """, keys: [backendID, deviceID]) { query in
                    var files: [OfflineFile] = []
                    while true {
                        let result = sqlite3_step(query)
                        if result == SQLITE_DONE { return files }
                        try self.check(result, expected: SQLITE_ROW)
                        if let record = self.readOfflineFile(query), self.localFileURL(record) != nil { files.append(record.file) }
                    }
                }
            } ?? []
        }
    }

    func offlineFileURL(_ file: OfflineFile, backendID: String, deviceID: String) async -> URL? {
        guard let cacheKey = file.key.cacheKey else { return nil }
        return await onQueue {
            self.useDatabase(create: false) { database in
                guard let record = try self.offlineFileRecord(database, keys: [backendID, deviceID, cacheKey]),
                      record.file.version == file.version else { return nil }
                return self.localFileURL(record)
            }
        }
    }

    func saveOfflineFile(_ file: OfflineFile, copying source: URL, backendID: String, deviceID: String) async throws {
        try await onQueue {
            Result {
                guard (0...RunFilePolicy.maxBytes).contains(file.byteSize), let cacheKey = file.key.cacheKey,
                      !file.version.isEmpty, try self.verifiedSize(source) == file.byteSize else {
                    throw MainsError.invalidReply
                }
                guard try self.withRecoveredDatabase(create: true, { database in
                    try self.saveOfflineFile(database, keys: [backendID, deviceID, cacheKey], file: file, source: source)
                    return true
                }) == true else { throw MainsError.disconnected }
            }
        }.get()
    }

    func removeOfflineFile(_ file: OfflineFile, backendID: String, deviceID: String) async throws {
        guard let cacheKey = file.key.cacheKey else { return }
        try await onQueue {
            Result {
                _ = try self.withRecoveredDatabase(create: false) { database in
                    let keys = [backendID, deviceID, cacheKey]
                    guard let record = try self.offlineFileRecord(database, keys: keys), record.file.version == file.version else { return }
                    try self.execute(database, "DELETE FROM offline_files WHERE backend_id = ? AND device_id = ? AND cache_key = ?", keys: keys)
                    try? FileManager.default.removeItem(at: self.fileFolder(record.folder))
                }
            }
        }.get()
    }

    private func enqueue(_ operation: @escaping @Sendable () -> Void) {
        // Seal the batch at a read, reset or other write so later saves cannot cross it.
        pendingWrites.withLock { pending in
            pending = nil
            queue.async(execute: operation)
        }
    }

    private func onQueue<T: Sendable>(_ operation: @escaping @Sendable () -> T) async -> T {
        await withCheckedContinuation { continuation in
            enqueue { continuation.resume(returning: operation()) }
        }
    }

    private func write(_ batch: WriteBatch) {
        let encoder = Wire.encoder()
        encoder.outputFormatting.insert(.sortedKeys)
        let metadata = try? encoder.encode(batch.snapshot)
        let keys = [batch.snapshot.backendID, batch.deviceID]
        let histories = batch.histories.sorted { $0.value.order < $1.value.order }
        _ = useDatabase(create: true) { database in
            if let metadata, metadata.count <= Self.metadataLimit {
                try transaction(database) {
                    try execute(database, """
                        INSERT INTO metadata (id, backend_id, device_id, payload) VALUES (1, ?, ?, ?)
                        ON CONFLICT (id) DO UPDATE
                        SET backend_id = excluded.backend_id, device_id = excluded.device_id, payload = excluded.payload
                        WHERE metadata.backend_id <> excluded.backend_id OR metadata.device_id <> excluded.device_id
                            OR metadata.payload <> excluded.payload
                        """, keys: keys, payload: metadata)
                    try trimHistory(database)
                }
            }
            for (key, entry) in histories {
                do {
                    switch entry.change {
                    case .replace(let runID, let page):
                        guard let records = try? HistoryRecords(runID: runID, page: page) else { continue }
                        try transaction(database) {
                            try replaceHistory(database, keys: key.keys, records: records)
                            try trimHistory(database)
                        }
                    case .remove:
                        try transaction(database) {
                            try removeHistory(database, keys: key.keys)
                        }
                    }
                } catch DatabaseError.sqlite(SQLITE_CONSTRAINT) {
                    // Keep this run's existing page and continue with the rest of the batch.
                    continue
                }
            }
            try reclaimSpace(database)
        }
    }

    private func useDatabase<T>(create: Bool, _ operation: (OpaquePointer) throws -> T?) -> T? {
        try? withRecoveredDatabase(create: create, operation)
    }

    private func withRecoveredDatabase<T>(create: Bool, _ operation: (OpaquePointer) throws -> T?) throws -> T? {
        do {
            return try withDatabase(create: create, operation)
        } catch let error as DatabaseError {
            switch error {
            case .obsoleteSchema, .sqlite(SQLITE_CORRUPT), .sqlite(SQLITE_NOTADB): break
            default: throw error
            }
            // Recovery is scoped to this dedicated cache. Temporary I/O failures are retried on the next use.
            try? FileManager.default.removeItem(at: directory)
            return create ? try withDatabase(create: true, operation) : nil
        }
    }

    private func withDatabase<T>(create: Bool, _ operation: (OpaquePointer) throws -> T?) throws -> T? {
        let url = directory.appendingPathComponent("conversations.sqlite")
        // Allow SQLite to recover an interrupted write even when opening offline.
        var flags = SQLITE_OPEN_READWRITE
        #if os(iOS)
        flags |= SQLITE_OPEN_FILEPROTECTION_COMPLETEUNTILFIRSTUSERAUTHENTICATION
        #endif
        if create {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            flags |= SQLITE_OPEN_CREATE
        } else if !FileManager.default.fileExists(atPath: url.path) {
            return nil
        }
        var connection: OpaquePointer?
        let result = sqlite3_open_v2(url.path, &connection, flags, nil)
        defer { sqlite3_close(connection) }
        try check(result)
        guard let database = connection else { return nil }
        try execute(database, "PRAGMA foreign_keys = ON")
        let version = try statement(database, "PRAGMA user_version", keys: []) { query in
            try check(sqlite3_step(query), expected: SQLITE_ROW)
            return sqlite3_column_int(query, 0)
        }
        if version != 3 {
            if version == 1 || version == 2 { throw DatabaseError.obsoleteSchema }
            guard version == 0 && create else { throw DatabaseError.unsupportedSchema }
            try execute(database, "PRAGMA auto_vacuum = INCREMENTAL")
            try createHistorySchema(database)
        }
        return try operation(database)
    }

    private func transaction<T>(_ database: OpaquePointer, writing: Bool = true, _ body: () throws -> T) throws -> T {
        try execute(database, writing ? "BEGIN IMMEDIATE" : "BEGIN DEFERRED")
        do {
            let value = try body()
            try execute(database, "COMMIT")
            return value
        } catch {
            try? execute(database, "ROLLBACK")
            throw error
        }
    }

    private func read<T: Decodable>(_ type: T.Type, _ database: OpaquePointer, _ sql: String, keys: [String], limit: Int) throws -> T? {
        try statement(database, sql, keys: keys) { query in
            let result = sqlite3_step(query)
            if result == SQLITE_DONE { return nil }
            try check(result, expected: SQLITE_ROW)
            guard let data = blob(query, column: 0, limit: limit) else { return nil }
            return try Wire.decoder().decode(type, from: data)
        }
    }

    private func execute(_ database: OpaquePointer, _ sql: String, keys: [String] = [], payload: Data? = nil) throws {
        try statement(database, sql, keys: keys) { query in
            if let payload {
                try bind(.blob(payload), to: query, parameter: Int32(keys.count + 1))
            }
            try check(sqlite3_step(query), expected: SQLITE_DONE)
        }
    }

    private func statement<T>(_ database: OpaquePointer, _ sql: String, keys: [String], _ use: (OpaquePointer) throws -> T) throws -> T {
        var prepared: OpaquePointer?
        defer { sqlite3_finalize(prepared) }
        try check(sqlite3_prepare_v2(database, sql, -1, &prepared, nil))
        guard let query = prepared else { throw DatabaseError.sqlite(SQLITE_ERROR) }
        for (offset, key) in keys.enumerated() {
            try bind(.text(key), to: query, parameter: Int32(offset + 1))
        }
        return try use(query)
    }

    private func check(_ result: Int32, expected: Int32 = SQLITE_OK) throws {
        if result != expected { throw DatabaseError.sqlite(result) }
    }
}

private extension SQLiteConversationCache {
    struct FileRecord {
        let folder: UUID
        let file: OfflineFile
    }

    var offlineFileDirectory: URL { directory.appendingPathComponent("OfflineFiles", isDirectory: true) }

    func fileFolder(_ id: UUID) -> URL { offlineFileDirectory.appendingPathComponent(id.uuidString, isDirectory: true) }

    func verifiedSize(_ url: URL) throws -> Int? {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        return values.isRegularFile == true && values.isSymbolicLink != true ? values.fileSize : nil
    }

    func localFileURL(_ record: FileRecord) -> URL? {
        let url = fileFolder(record.folder).appendingPathComponent(TranscriptMedia.fileName(record.file.name))
        return (try? verifiedSize(url)) == record.file.byteSize ? url : nil
    }

    func readOfflineFile(_ query: OpaquePointer) -> FileRecord? {
        guard let name = text(query, column: 0), let folder = UUID(uuidString: name),
              let data = blob(query, column: 1, limit: 16 * 1024),
              let file = try? JSONDecoder().decode(OfflineFile.self, from: data) else { return nil }
        return FileRecord(folder: folder, file: file)
    }

    func offlineFileRecord(_ database: OpaquePointer, keys: [String]) throws -> FileRecord? {
        try statement(database, """
            SELECT folder, payload FROM offline_files WHERE backend_id = ? AND device_id = ? AND cache_key = ?
            """, keys: keys) { query in
            let result = sqlite3_step(query)
            if result == SQLITE_DONE { return nil }
            try check(result, expected: SQLITE_ROW)
            return readOfflineFile(query)
        }
    }

    func saveOfflineFile(_ database: OpaquePointer, keys: [String], file: OfflineFile, source: URL) throws {
        try pruneOfflineFileFolders(database)
        let previous = try offlineFileRecord(database, keys: keys)
        let used = try scalar(database, "SELECT coalesce(sum(bytes), 0) FROM offline_files")
        let count = try scalar(database, "SELECT count(*) FROM offline_files")
        guard used - (previous?.file.byteSize ?? 0) + file.byteSize <= Self.fileCacheLimit,
              count < 200 || previous != nil else {
            throw MainsError.server("Offline storage is full. Remove a saved file in Settings → Offline files.")
        }
        let data = try JSONEncoder().encode(file)
        guard data.count <= 16 * 1024 else { throw MainsError.invalidReply }
        let folder = UUID()
        let targetDirectory = fileFolder(folder)
        let target = targetDirectory.appendingPathComponent(TranscriptMedia.fileName(file.name))
        do {
            var attributes: [FileAttributeKey: Any] = [:]
            #if os(iOS)
            attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
            #endif
            try FileManager.default.createDirectory(at: targetDirectory, withIntermediateDirectories: true, attributes: attributes)
            try FileManager.default.copyItem(at: source, to: target)
            guard try verifiedSize(target) == file.byteSize else { throw MainsError.invalidReply }
            try FileManager.default.setAttributes(attributes, ofItemAtPath: target.path)
            try transaction(database) {
                try statement(database, """
                    INSERT OR REPLACE INTO offline_files (backend_id, device_id, cache_key, folder, bytes, payload)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """, keys: keys + [folder.uuidString]) { query in
                    try bind(.integer(Int64(file.byteSize)), to: query, parameter: 5)
                    try bind(.blob(data), to: query, parameter: 6)
                    try check(sqlite3_step(query), expected: SQLITE_DONE)
                }
                try trimHistory(database)
            }
        } catch {
            try? FileManager.default.removeItem(at: targetDirectory)
            throw error
        }
        if let previous { try? FileManager.default.removeItem(at: fileFolder(previous.folder)) }
        try? reclaimSpace(database)
    }

    func pruneOfflineFileFolders(_ database: OpaquePointer) throws {
        let indexedFolders = try statement(database, "SELECT folder, payload FROM offline_files", keys: []) { query in
            var valid: Set<String> = [], missing: [String] = []
            while true {
                let result = sqlite3_step(query)
                if result == SQLITE_DONE { return (valid, missing) }
                try check(result, expected: SQLITE_ROW)
                guard let folder = text(query, column: 0) else { continue }
                if let record = readOfflineFile(query), localFileURL(record) != nil { valid.insert(folder) }
                else { missing.append(folder) }
            }
        }
        for folder in indexedFolders.1 {
            try execute(database, "DELETE FROM offline_files WHERE folder = ?", keys: [folder])
        }
        if let folders = try? FileManager.default.contentsOfDirectory(at: offlineFileDirectory, includingPropertiesForKeys: nil) {
            for folder in folders where !indexedFolders.0.contains(folder.lastPathComponent) {
                try? FileManager.default.removeItem(at: folder)
            }
        }
    }

    enum Value {
        case null, integer(Int64), real(Double), text(String), blob(Data)

        var byteCount: Int {
            switch self {
            case .null: 0
            case .integer, .real: 8
            case .text(let text): text.utf8.count
            case .blob(let data): data.count
            }
        }
    }

    struct HistoryBounds: Codable {
        let start: HistoryCursor?
        let end: HistoryCursor?
        let last: HistoryCursor?
        let hasOlder: Bool
        let hasNewer: Bool
        let activity: HistoryActivityRange?

        init(_ page: HistoryPage) {
            start = page.start
            end = page.end
            last = page.last
            hasOlder = page.hasOlder
            hasNewer = page.hasNewer
            activity = page.activity
        }
    }

    struct ArtifactDetails: Codable {
        let metadata: JSONValue?
        let path: String?
        let contentHash: String?
    }

    struct HistoryRecords {
        let bounds: Data
        let artifacts: [[Value]]
        let tools: [[Value]]
        let turns: [[Value]]

        init(runID: String, page: HistoryPage) throws {
            guard page.artifacts.count + page.toolCalls.count <= rowLimit, page.turns.count <= rowLimit,
                  page.artifacts.allSatisfy({ $0.runId == runID }) else { throw DatabaseError.invalidHistory }
            let encoder = JSONEncoder()
            bounds = try encoder.encode(HistoryBounds(page))
            artifacts = try page.artifacts.map { artifact in
                let details = ArtifactDetails(metadata: artifact.metadata, path: artifact.path, contentHash: artifact.contentHash)
                return [.integer(Int64(artifact.id)), .text(artifact.kind), artifact.content.map(Value.text) ?? .null,
                        .real(artifact.createdAt.timeIntervalSinceReferenceDate), .blob(try encoder.encode(details))]
            }
            tools = try page.toolCalls.map { tool in
                [.integer(Int64(tool.id)), .text(tool.toolName), .text(tool.status), .blob(try encoder.encode(tool))]
            }
            turns = try page.turns.map { turn in
                [.integer(Int64(turn.id)), turn.turnIndex.map { .integer(Int64($0)) } ?? .null,
                 .text(turn.status), .blob(try encoder.encode(turn))]
            }
            var bytes = bounds.count
            for table in [artifacts, tools, turns] {
                for row in table {
                    bytes += row.reduce(0) { $0 + $1.byteCount }
                }
            }
            guard bytes <= pageLimit else { throw DatabaseError.invalidHistory }
        }
    }

    func createHistorySchema(_ database: OpaquePointer) throws {
        try transaction(database) {
            try check(sqlite3_exec(database, """
                CREATE TABLE metadata (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    backend_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    payload BLOB NOT NULL
                );
                CREATE TABLE history_pages (
                    id INTEGER PRIMARY KEY,
                    backend_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    bounds BLOB NOT NULL,
                    UNIQUE (backend_id, device_id, run_id)
                );
                CREATE TABLE run_artifacts (
                    page_id INTEGER NOT NULL REFERENCES history_pages(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    id INTEGER NOT NULL,
                    kind TEXT NOT NULL,
                    content TEXT,
                    created_at REAL NOT NULL,
                    details BLOB NOT NULL,
                    PRIMARY KEY (page_id, position),
                    UNIQUE (page_id, id)
                ) WITHOUT ROWID;
                CREATE TABLE tool_calls (
                    page_id INTEGER NOT NULL REFERENCES history_pages(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    id INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    payload BLOB NOT NULL,
                    PRIMARY KEY (page_id, position),
                    UNIQUE (page_id, id)
                ) WITHOUT ROWID;
                CREATE TABLE run_turns (
                    page_id INTEGER NOT NULL REFERENCES history_pages(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    id INTEGER NOT NULL,
                    turn_index INTEGER,
                    status TEXT NOT NULL,
                    payload BLOB NOT NULL,
                    PRIMARY KEY (page_id, position),
                    UNIQUE (page_id, id)
                ) WITHOUT ROWID;
                CREATE TABLE offline_values (
                    backend_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    cache_key TEXT NOT NULL,
                    payload BLOB NOT NULL,
                    UNIQUE (backend_id, device_id, cache_key)
                );
                CREATE TABLE offline_files (
                    backend_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    cache_key TEXT NOT NULL,
                    folder TEXT NOT NULL,
                    bytes INTEGER NOT NULL,
                    payload BLOB NOT NULL,
                    UNIQUE (backend_id, device_id, cache_key)
                );
                PRAGMA user_version = 3;
                """, nil, nil, nil))
        }
    }

    func removeHistory(_ database: OpaquePointer, keys: [String]) throws {
        try execute(database, "DELETE FROM history_pages WHERE backend_id = ? AND device_id = ? AND run_id = ?", keys: keys)
    }

    func replaceHistory(_ database: OpaquePointer, keys: [String], records: HistoryRecords) throws {
        try removeHistory(database, keys: keys)
        try execute(database, "INSERT INTO history_pages (backend_id, device_id, run_id, bounds) VALUES (?, ?, ?, ?)",
                    keys: keys, payload: records.bounds)
        let pageID = sqlite3_last_insert_rowid(database)
        try insertRows(database, """
            INSERT INTO run_artifacts (page_id, position, id, kind, content, created_at, details) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, pageID: pageID, rows: records.artifacts)
        try insertRows(database, """
            INSERT INTO tool_calls (page_id, position, id, tool_name, status, payload) VALUES (?, ?, ?, ?, ?, ?)
            """, pageID: pageID, rows: records.tools)
        try insertRows(database, """
            INSERT INTO run_turns (page_id, position, id, turn_index, status, payload) VALUES (?, ?, ?, ?, ?, ?)
            """, pageID: pageID, rows: records.turns)
    }

    func trimHistory(_ database: OpaquePointer) throws {
        try execute(database, "DELETE FROM history_pages WHERE id IN (SELECT id FROM history_pages ORDER BY id DESC LIMIT -1 OFFSET 20)")
        let pageSize = try scalar(database, "PRAGMA page_size")
        while (try scalar(database, "PRAGMA page_count") - scalar(database, "PRAGMA freelist_count")) * pageSize > Self.cacheLimit {
            try execute(database, "DELETE FROM history_pages WHERE id = (SELECT min(id) FROM history_pages)")
            if sqlite3_changes(database) == 0 { return }
        }
    }

    func reclaimSpace(_ database: OpaquePointer) throws {
        let pageSize = try scalar(database, "PRAGMA page_size")
        let excess = try scalar(database, "PRAGMA page_count") - Self.cacheLimit / pageSize
        if excess > 0 {
            try check(sqlite3_exec(database, "PRAGMA incremental_vacuum(\(excess))", nil, nil, nil))
        }
    }

    func scalar(_ database: OpaquePointer, _ sql: String, keys: [String] = []) throws -> Int {
        try statement(database, sql, keys: keys) { query in
            try check(sqlite3_step(query), expected: SQLITE_ROW)
            return Int(sqlite3_column_int64(query, 0))
        }
    }

    func searchMessages(_ database: OpaquePointer, query needle: String, keys: [String]) throws -> [SavedMessageMatch] {
        try statement(database, """
            SELECT h.run_id, a.id, a.content, a.created_at, a.details FROM history_pages h
            JOIN run_artifacts a ON a.page_id = h.id
            WHERE h.backend_id = ? AND h.device_id = ? AND a.kind IN ('user-prompt', 'report', 'result')
              AND a.content IS NOT NULL
            ORDER BY h.id DESC, a.position DESC
            """, keys: keys) { query in
            var matches: [SavedMessageMatch] = [], found: Set<String> = []
            let decoder = JSONDecoder()
            while true {
                let result = sqlite3_step(query)
                if result == SQLITE_DONE { return matches }
                try check(result, expected: SQLITE_ROW)
                guard let runID = text(query, column: 0), !found.contains(runID),
                      let content = text(query, column: 2),
                      let range = content.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive], locale: .current) else { continue }
                let details = try decode(ArtifactDetails.self, from: query, column: 4, decoder: decoder)
                let metadata = details.metadata
                guard metadata?["kind"].string != "thinking",
                      !["agent_thinking_streaming", "assistant.reasoning_delta"].contains(metadata?["source"].string ?? ""),
                      metadata?["voice"].bool != true, metadata?["isFromSubagent"].bool != true,
                      metadata?["agentId"].string == nil, metadata?["parentToolCallId"].string == nil,
                      metadata?["parentToolUseId"].string == nil else { continue }
                let date = Date(timeIntervalSinceReferenceDate: sqlite3_column_double(query, 3))
                let timestamp = (date.timeIntervalSince1970 * 1000).rounded()
                let start = content.index(range.lowerBound, offsetBy: -60, limitedBy: content.startIndex) ?? content.startIndex
                let snippet = String(content[start...].prefix(220))
                found.insert(runID)
                matches.append(SavedMessageMatch(runID: runID, snippet: snippet,
                    cursor: HistoryCursor(timestamp: timestamp, source: "artifact", id: Int(sqlite3_column_int64(query, 1)))))
            }
        }
    }

    func readHistory(_ database: OpaquePointer, backendID: String, deviceID: String, runID: String) throws -> HistoryPage? {
        let decoder = JSONDecoder()
        let header = try statement(database, """
            SELECT id, bounds FROM history_pages WHERE backend_id = ? AND device_id = ? AND run_id = ?
            """, keys: [backendID, deviceID, runID]) { query -> (Int64, HistoryBounds)? in
            let result = sqlite3_step(query)
            if result == SQLITE_DONE { return nil }
            try check(result, expected: SQLITE_ROW)
            return (sqlite3_column_int64(query, 0), try decode(HistoryBounds.self, from: query, column: 1, decoder: decoder))
        }
        guard let (pageID, bounds) = header else { return nil }

        let artifacts = try readRows(database, """
            SELECT id, kind, content, created_at, details FROM run_artifacts WHERE page_id = ? ORDER BY position
            """, pageID: pageID) { query in
            guard let kind = text(query, column: 1) else { throw DatabaseError.invalidHistory }
            let details = try decode(ArtifactDetails.self, from: query, column: 4, decoder: decoder)
            return Artifact(id: Int(sqlite3_column_int64(query, 0)), runId: runID, kind: kind, content: text(query, column: 2),
                            metadata: details.metadata, createdAt: Date(timeIntervalSinceReferenceDate: sqlite3_column_double(query, 3)),
                            path: details.path, contentHash: details.contentHash)
        }
        let tools = try readRows(database, "SELECT payload FROM tool_calls WHERE page_id = ? ORDER BY position", pageID: pageID) {
            try decode(ToolCall.self, from: $0, column: 0, decoder: decoder)
        }
        let turns = try readRows(database, "SELECT payload FROM run_turns WHERE page_id = ? ORDER BY position", pageID: pageID) {
            try decode(RunTurn.self, from: $0, column: 0, decoder: decoder)
        }
        return HistoryPage(artifacts: artifacts, toolCalls: tools, turns: turns, start: bounds.start, end: bounds.end,
                           last: bounds.last, hasOlder: bounds.hasOlder, hasNewer: bounds.hasNewer, activity: bounds.activity)
    }

    func insertRows(_ database: OpaquePointer, _ sql: String, pageID: Int64, rows: [[Value]]) throws {
        guard !rows.isEmpty else { return }
        try statement(database, sql, keys: []) { query in
            try bind(.integer(pageID), to: query, parameter: 1)
            for (position, row) in rows.enumerated() {
                try bind(.integer(Int64(position)), to: query, parameter: 2)
                for (offset, value) in row.enumerated() {
                    try bind(value, to: query, parameter: Int32(offset + 3))
                }
                try check(sqlite3_step(query), expected: SQLITE_DONE)
                try check(sqlite3_reset(query))
            }
        }
    }

    func readRows<Row>(_ database: OpaquePointer, _ sql: String, pageID: Int64, _ decode: (OpaquePointer) throws -> Row) throws -> [Row] {
        try statement(database, sql, keys: []) { query in
            try bind(.integer(pageID), to: query, parameter: 1)
            var rows: [Row] = []
            while true {
                let result = sqlite3_step(query)
                if result == SQLITE_DONE { return rows }
                try check(result, expected: SQLITE_ROW)
                guard rows.count < Self.rowLimit else { throw DatabaseError.invalidHistory }
                rows.append(try decode(query))
            }
        }
    }

    func bind(_ value: Value, to query: OpaquePointer, parameter: Int32) throws {
        let result: Int32
        switch value {
        case .null: result = sqlite3_bind_null(query, parameter)
        case .integer(let integer): result = sqlite3_bind_int64(query, parameter, integer)
        case .real(let real): result = sqlite3_bind_double(query, parameter, real)
        case .text(let text):
            result = text.utf8CString.withUnsafeBufferPointer {
                sqlite3_bind_text(query, parameter, $0.baseAddress, Int32($0.count - 1), Self.transient)
            }
        case .blob(let data):
            result = data.withUnsafeBytes {
                sqlite3_bind_blob(query, parameter, $0.baseAddress, Int32($0.count), Self.transient)
            }
        }
        try check(result)
    }

    func blob(_ query: OpaquePointer, column: Int32, limit: Int) -> Data? {
        let count = Int(sqlite3_column_bytes(query, column))
        guard count > 0, count <= limit, let bytes = sqlite3_column_blob(query, column) else { return nil }
        return Data(bytes: bytes, count: count)
    }

    func decode<Row: Decodable>(_ type: Row.Type, from query: OpaquePointer, column: Int32, decoder: JSONDecoder) throws -> Row {
        guard let data = blob(query, column: column, limit: Self.pageLimit) else { throw DatabaseError.invalidHistory }
        return try decoder.decode(type, from: data)
    }

    func text(_ query: OpaquePointer, column: Int32) -> String? {
        guard let bytes = sqlite3_column_text(query, column) else { return nil }
        let count = Int(sqlite3_column_bytes(query, column))
        return String(decoding: UnsafeBufferPointer(start: bytes, count: count), as: UTF8.self)
    }
}
