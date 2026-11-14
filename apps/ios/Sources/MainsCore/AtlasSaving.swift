import Foundation

public struct AtlasSaveSource: Codable, Hashable, Sendable {
    public static func supports(_ name: String) -> Bool {
        ["png", "jpg", "jpeg", "webp", "gif", "avif", "svg", "pdf", "md", "markdown", "txt", "csv", "docx", "pptx", "xlsx"].contains((name as NSString).pathExtension.lowercased())
    }
    public var runId: String? = nil
    public let version: String
    public var artifactId: Int?
    public var attachmentId: String?
    public var sourceKey: String?
    public var itemId: String?
    public static func output(_ file: RunOutput) -> Self { Self(runId: file.runId, version: file.version, artifactId: file.artifactId) }
    public static func attachment(_ file: RunAttachmentFile) -> Self { Self(runId: file.runId, version: file.version, attachmentId: file.attachmentId) }
    public static func file(_ file: AtlasFile) -> Self? {
        if file.canSaveToLibrary == true, let itemId = file.reference.itemId {
            return Self(version: file.version, itemId: itemId)
        }
        guard let runId = file.reference.runId, let sourceKey = file.reference.sourceKey else { return nil }
        return Self(runId: runId, version: file.version, sourceKey: sourceKey)
    }
}
public struct AtlasSavedItem: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let kind: String
}
public struct PendingAtlasSave: Sendable {
    public enum Status: Equatable, Sendable { case sending, uncertain }
    public var status: Status
    public let label: String
    let commandID: String
    let channel: String
    let payload: JSONValue
    let owner: Int
    let createdAt: Date
    public var id: String { commandID }
    public var isBookmarkEdit: Bool { channel == "atlas:editMobileBookmark" }
    public var isTrashChange: Bool { channel == "atlas:setMobileTrash" }
    public var isTagsChange: Bool { channel == "atlas:setMobileTags" }
    public var isUpdate: Bool { channel == "atlas:updateMobileItem" || isBookmarkEdit || isTrashChange || isTagsChange }
}

public enum AtlasBookmarkURL {
    /// Only explicit web links. The computer applies the canonical normalization.
    public static func validate(_ text: String) -> String? {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.utf8.count <= 4096, let url = URL(string: text),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil,
              !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        return text
    }
}
