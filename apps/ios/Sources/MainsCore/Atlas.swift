import Foundation

public struct AtlasQuery: Equatable, Hashable, Sendable {
    public var type = "all"
    public var scope = "all"
    public var collectionID: String?
    public var text = ""
    public var page = 1
    public init() {}
    var payload: [String: JSONValue] {
        var value: [String: JSONValue] = ["type": .string(type), "scope": .string(scope), "query": .string(String(text.prefix(512))), "page": .number(Double(page))]
        if let collectionID { value["collectionId"] = .string(collectionID) }
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
    public let origin: String
    public let sourceRunId: String?
    public let file: AtlasFileReference?
    public let pageId: String?
    public let icon: String?
    public let url: String?
    public let description: String?
    public let note: String?
    public var webURL: URL? {
        guard let url, let value = URL(string: url), ["http", "https"].contains(value.scheme?.lowercased() ?? ""), value.host != nil else { return nil }
        return value
    }
}
public struct AtlasLibraryPage: Decodable, Sendable {
    public let items: [AtlasEntry]
    public let page: Int
    public let hasNext: Bool
}
public struct AtlasPageContent: Decodable, Sendable {
    public let id: String
    public let title: String
    public let icon: String?
    public let version: Int
    public let markdown: String
    public let offset: Int
    public let nextOffset: Int?
    public let sourceRunId: String?
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
public struct AtlasFile: Decodable, Sendable {
    public let reference: AtlasFileReference
    public let name: String
    public let mimeType: String
    public let byteSize: Int
    public let modifiedAt: Double
    public let version: String
    public let previewType: String
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
