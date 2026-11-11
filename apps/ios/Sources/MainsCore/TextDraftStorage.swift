import Foundation
import CryptoKit

public struct TextDraftKey: Codable, Hashable, Sendable {
    public enum Owner: String, Codable, Sendable { case conversation, home }
    public let backendID: String
    public let deviceID: String
    public let owner: Owner
    public let ownerID: String
    public init(backendID: String, deviceID: String, owner: Owner, ownerID: String) {
        self.backendID = backendID; self.deviceID = deviceID; self.owner = owner; self.ownerID = ownerID
    }
}

/// Durable user input lives in Application Support, separately from disposable
/// history and from in-memory files, queued inputs and delivery receipts.
public struct TextDraftFileStore: Sendable {
    private struct Record: Codable { let key: TextDraftKey; let text: String }
    public static let maxTextBytes = 512 * 1024
    private let root: URL
    public init(root: URL) { self.root = root }
    private func hash(_ values: [String]) -> String {
        SHA256.hash(data: try! JSONEncoder().encode(values)).map { String(format: "%02x", $0) }.joined()
    }
    private func directory(backendID: String, deviceID: String) -> URL {
        root.appendingPathComponent(hash([backendID, deviceID]), isDirectory: true)
    }
    private func file(_ key: TextDraftKey) -> URL {
        directory(backendID: key.backendID, deviceID: key.deviceID).appendingPathComponent(hash([key.owner.rawValue, key.ownerID]) + ".json")
    }
    public func load(_ key: TextDraftKey) throws -> String? {
        let url = file(key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let info = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        // JSON escaping can expand valid text (for example newlines or controls).
        guard info.isRegularFile == true, info.isSymbolicLink != true, (info.fileSize ?? Int.max) <= 4 * 1024 * 1024 else { throw MainsError.invalidReply }
        let record = try JSONDecoder().decode(Record.self, from: Data(contentsOf: url))
        guard record.key == key, record.text.utf8.count <= Self.maxTextBytes else { throw MainsError.invalidReply }
        return record.text
    }
    public func save(_ text: String, for key: TextDraftKey) throws {
        let url = file(key), directory = url.deletingLastPathComponent()
        if text.isEmpty { if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }; return }
        guard text.utf8.count <= Self.maxTextBytes else { throw MainsError.server("This draft is too large to save on the iPhone. Copy it before closing the app.") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var excluded = directory, values = URLResourceValues(); values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        var options: Data.WritingOptions = [.atomic]
        #if os(iOS)
        options.insert(.completeFileProtectionUntilFirstUserAuthentication)
        #endif
        try JSONEncoder().encode(Record(key: key, text: text)).write(to: url, options: options)
        // Bound abandoned drafts without discarding the input currently being typed.
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey])
            .filter { $0.pathExtension == "json" }
            .map { file -> (URL, Date, Int) in
                let values = try file.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                return (file, values.contentModificationDate ?? .distantPast, values.fileSize ?? 0)
            }.sorted { $0.1 < $1.1 }
        var count = files.count, total = files.reduce(0) { $0 + $1.2 }
        for (file, _, bytes) in files where file != url {
            guard count > 128 || total > 8 * 1024 * 1024 else { break }
            try FileManager.default.removeItem(at: file); count -= 1; total -= bytes
        }
    }
    public func remove(backendID: String, deviceID: String) throws {
        let directory = directory(backendID: backendID, deviceID: deviceID)
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }
}
