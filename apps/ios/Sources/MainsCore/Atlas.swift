import Foundation

public struct AtlasQuery: Equatable, Hashable, Sendable {
    public var type = "all"
    public var scope = "all"
    public var collectionID: String?
    public var tagID: String?
    public var text = ""
    public var page = 1
    public init() {}
    var payload: [String: JSONValue] {
        var value: [String: JSONValue] = ["type": .string(type), "scope": .string(scope), "query": .string(String(text.prefix(512))), "page": .number(Double(page))]
        if let collectionID { value["collectionId"] = .string(collectionID) }
        if let tagID { value["tagId"] = .string(tagID) }
        return value
    }
}

public struct AtlasFileReference: Codable, Hashable, Sendable {
    public var itemId: String?
    public var runId: String?
    public var sourceKey: String?
    public static func saved(_ id: String) -> Self { Self(itemId: id) }
}

public struct AtlasEntry: Decodable, Identifiable, Sendable {
    public var id: String { key }
    public let key: String
    public let kind: String
    public let title: String
    public let date: String
    public let collectionId: String?
    public let isFavorite: Bool
    public let savedItemId: String?
    public let savedCollectionId: String?
    public let origin: String
    public let sourceRunId: String?
    public let file: AtlasFileReference?
    public let pageId: String?
    public let icon: String?
    public let url: String?
    public let description: String?
    public let note: String?
    public let tags: [AtlasTag]?
    public let fileName: String?
    public let mimeType: String?
    public let byteSize: Int?
    public let preview: String?
    public var savedIdentity: String? {
        savedItemId ?? pageId ?? file?.itemId ?? (kind == "bookmark" && origin == "saved" ? key : nil)
    }
    public var savedProjectID: String? { savedItemId == nil ? collectionId : savedCollectionId }
    public var webURL: URL? {
        guard let url, let value = URL(string: url), ["http", "https"].contains(value.scheme?.lowercased() ?? ""), value.host != nil else { return nil }
        return value
    }
}
public struct AtlasTag: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public init(id: String, name: String) { self.id = id; self.name = name }
}
public struct AtlasTagPage: Decodable, Sendable {
    public let items: [AtlasTag]
    public let page: Int
    public let hasNext: Bool
}
public struct AtlasItemTags: Decodable, Sendable {
    public let id: String
    public let requestedId: String
    public let title: String
    public let kind: String
    public let tags: [AtlasTag]
    public let revision: String
}
public enum AtlasTagNames {
    public static func normalized(_ text: String) -> String? {
        guard text.utf16.count <= 64, !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        let value = text.precomposedStringWithCompatibilityMapping.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        return !value.isEmpty && value.utf16.count <= 64 ? value : nil
    }
}
public struct AtlasLibraryPage: Decodable, Sendable {
    public let items: [AtlasEntry]
    public let page: Int
    public let hasNext: Bool
}
public struct AtlasTrashItem: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let kind: String
    public let collectionId: String?
    public let trashedAt: String
}
public struct AtlasTrashPage: Decodable, Sendable {
    public let items: [AtlasTrashItem]
    public let page: Int
    public let hasNext: Bool
}
public struct AtlasPageContent: Decodable, Sendable {
    public let id: String
    public let title: String
    public let icon: String?
    public let version: Int
    public let coverFileId: String?
    public let markdown: String
    public let offset: Int
    public let nextOffset: Int?
    public let sourceRunId: String?
    public var sections: [AtlasPageSection] { AtlasPageSection.parse(markdown) }
    public var inlineImageIDs: Set<String> {
        Set(sections.compactMap { if case .image(let reference) = $0 { reference.fileId } else { nil } })
    }
    public var embeddedFiles: [String] {
        guard let pattern = try? NSRegularExpression(pattern: "atlas-file://([A-Za-z0-9_-]{1,128})(?=[\\s)>\\\"'?#]|$)") else { return [] }
        let source = markdown as NSString
        var seen = Set<String>()
        return Array(pattern.matches(in: markdown, range: NSRange(location: 0, length: source.length)).compactMap { match in
            let id = source.substring(with: match.range(at: 1))
            return seen.insert(id).inserted ? id : nil
        }.prefix(20))
    }
}
public struct AtlasPageImageReference: Equatable, Hashable, Sendable {
    public let fileId: String
    public let caption: String
}

/// Keep stored image blocks out of the prose renderer, preserving all remaining
/// Markdown verbatim so math, tables and code retain their existing readers.
public enum AtlasPageSection: Equatable, Sendable {
    case markdown(String), image(AtlasPageImageReference)
    public static func parse(_ source: String) -> [Self] {
        guard let pattern = try? NSRegularExpression(pattern: #"^ {0,3}!\[(.*)\]\(\s*<?atlas-file://([A-Za-z0-9_-]{1,128})>?(?:\s+["'][^"']*["'])?\s*\)\s*$"#) else { return [.markdown(source)] }
        var sections: [Self] = [], lines: [String] = [], fence: (Character, Int)?, mathEnd: String?, imageCount = 0
        func flush() {
            let text = lines.joined()
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { sections.append(.markdown(text)) }
            lines = []
        }
        let sourceLines = source.components(separatedBy: "\n")
        for (index, line) in sourceLines.enumerated() {
            let separator = index < sourceLines.count - 1 ? "\n" : ""
            let original = line + separator
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            let indented = line.prefix(while: { $0 == " " || $0 == "\t" }).reduce(0) { $0 + ($1 == "\t" ? 4 : 1) } >= 4
            if let (mark, count) = fence {
                lines.append(original)
                let length = trimmed.prefix(while: { $0 == mark }).count
                if !indented && length >= count && trimmed.dropFirst(length).allSatisfy(\.isWhitespace) { fence = nil }
                continue
            }
            if let end = mathEnd {
                lines.append(original)
                if trimmed.hasSuffix(end) { mathEnd = nil }
                continue
            }
            if !indented, let mark = trimmed.first, mark == "`" || mark == "~", trimmed.prefix(while: { $0 == mark }).count >= 3 {
                fence = (mark, trimmed.prefix(while: { $0 == mark }).count); lines.append(original); continue
            }
            if !indented, trimmed == "\\[" || trimmed.hasPrefix("$$") && !trimmed.dropFirst(2).contains("$$") {
                mathEnd = trimmed == "\\[" ? "\\]" : "$$"; lines.append(original); continue
            }
            let value = line as NSString
            if imageCount < 20, let match = pattern.firstMatch(in: line, range: NSRange(location: 0, length: value.length)) {
                flush(); imageCount += 1
                sections.append(.image(AtlasPageImageReference(fileId: value.substring(with: match.range(at: 2)),
                    caption: String(value.substring(with: match.range(at: 1)).prefix(240)))))
                lines.append(separator)
            } else { lines.append(original) }
        }
        flush(); return sections
    }
}

public struct AtlasPageEmbeddedImage: Decodable, Sendable {
    public let pageId: String
    public let fileId: String
    public let pageVersion: Int
    public let version: String
    public let mime: String
    public let base64: String
    public let width: Int
    public let height: Int
    public var data: Data? {
        guard ["image/jpeg", "image/png"].contains(mime), (1...768).contains(width), (1...768).contains(height),
              version.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              base64.utf8.count <= 699_052, let data = Data(base64Encoded: base64), (1...524_288).contains(data.count) else { return nil }
        return data
    }
}
public struct AtlasPageCoverImage: Decodable, Sendable {
    public let pageId: String
    public let coverFileId: String
    public let version: String
    public let mime: String
    public let base64: String
    public let width: Int
    public let height: Int
    public var data: Data? {
        guard ["image/jpeg", "image/png"].contains(mime), (1...768).contains(width), (1...768).contains(height),
              version.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              base64.utf8.count <= 699_052, let data = Data(base64Encoded: base64), (1...524_288).contains(data.count) else { return nil }
        return data
    }
}
public struct AtlasFile: Decodable, Sendable {
    public let reference: AtlasFileReference
    public let name: String
    public let mimeType: String
    public let byteSize: Int
    public let modifiedAt: Double
    public let version: String
    public let previewType: String
    public var canSaveToLibrary: Bool? = nil
}

public struct AtlasImage: Decodable, Sendable {
    public let reference: AtlasFileReference
    public let version: String
    public let mime: String
    public let base64: String
    public let width: Int
    public let height: Int
    public var data: Data? {
        guard ["image/jpeg", "image/png"].contains(mime), (1...128).contains(width), (1...128).contains(height),
              version.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              base64.utf8.count <= 174_764, let data = Data(base64Encoded: base64), (1...131_072).contains(data.count) else { return nil }
        return data
    }
}

/// Links inside a Page may name another Page or an explicitly stored Atlas file.
public enum AtlasLink: Equatable, Sendable {
    case page(String), file(String)
    public init?(_ url: URL) {
        if url.scheme == "atlas-file", let host = url.host, Self.validID(host), url.path.isEmpty || url.path == "/" { self = .file(host); return }
        guard url.scheme == nil, url.host == nil else { return nil }
        let parts = url.path.split(separator: "/")
        guard parts.count == 2, parts[0] == "atlas", Self.validID(String(parts[1])) else { return nil }
        self = .page(String(parts[1]))
    }
    private static func validID(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128 && value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    }
}
