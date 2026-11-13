import Foundation

public struct AtlasBookmarkDocument: Decodable, Sendable {
    public let id: String
    public let requestedId: String
    public let kind: String
    public let title: String
    public let url: String
    public let description: String
    public let note: String
    public let revision: String
    public var draft: AtlasBookmarkDraft { AtlasBookmarkDraft(title: title, description: description, note: note) }
}

public struct AtlasBookmarkDraft: Equatable, Sendable {
    public var title: String
    public var description: String
    public var note: String
    public init(title: String = "", description: String = "", note: String = "") { self.title = title; self.description = description; self.note = note }
    public var validationError: String? {
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Enter a title." }
        if title.utf16.count > 240 { return "Use up to 240 characters for the title." }
        if description.utf16.count > 2000 { return "Use up to 2,000 characters for the description." }
        if note.utf16.count > 10000 { return "Use up to 10,000 characters for the note." }
        if [title, description, note].contains(where: { $0.contains("\0") }) { return "Remove unsupported characters before saving." }
        return nil
    }
    public func changes(from original: AtlasBookmarkDocument) -> [String: JSONValue] {
        var fields: [String: JSONValue] = [:]
        for (key, text, previous) in [("title", title, original.title), ("description", description, original.description), ("note", note, original.note)] {
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if value != previous { fields[key] = .string(value) }
        }
        return fields
    }
}
