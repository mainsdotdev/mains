import Foundation

public enum RunFilePolicy {
    public static let maxBytes = 100 * 1024 * 1024
    public static let chunkBytes = 128 * 1024
    public static let textPageBytes = 64 * 1024
}

/// A host reference is data sent to run-scoped readers, never an iPhone URL.
public struct RunFileReference: Equatable, Sendable {
    public let path: String
    public var name: String { path.replacingOccurrences(of: "\\", with: "/").components(separatedBy: "/").last ?? path }
    public var isMarkdown: Bool { ["md", "markdown"].contains((name as NSString).pathExtension.lowercased()) }
    public init?(_ href: String, relativeTo base: String? = nil) {
        guard !href.isEmpty, href.utf8.count <= 4096, let decoded = href.removingPercentEncoding,
              !decoded.contains("\0"), !decoded.hasPrefix("#"), !decoded.hasPrefix("//") else { return nil }
        var value = decoded
        if value.lowercased().hasPrefix("file:") {
            guard let url = URL(string: href), url.isFileURL, url.host == nil || url.host == "" || url.host == "localhost" else { return nil }
            value = url.path
        } else if value.range(of: #"^[a-zA-Z][a-zA-Z0-9+.-]*:"#, options: .regularExpression) != nil,
                  value.range(of: #"^[a-zA-Z]:[\\/]"#, options: .regularExpression) == nil { return nil }
        value = value.components(separatedBy: CharacterSet(charactersIn: "?#")).first ?? ""
        value = value.replacingOccurrences(of: #":\d+(?::\d+)?$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\", with: "/")
        let absolute = value.hasPrefix("/") || value.range(of: #"^[a-zA-Z]:/"#, options: .regularExpression) != nil
        if !absolute, let base { value = (base as NSString).deletingLastPathComponent + "/" + value }
        // Keep relative references inside their run directory. The computer
        // independently validates real paths and symlinks before reading.
        var parts: [String] = []
        for part in value.split(separator: "/") {
            if part == "." { continue }
            if part == ".." { guard !parts.isEmpty else { return nil }; parts.removeLast() }
            else { parts.append(String(part)) }
        }
        guard let last = parts.last, last.contains("."), last != ".", last != ".." else { return nil }
        path = (absolute && value.hasPrefix("/") ? "/" : "") + parts.joined(separator: "/")
    }
}

public struct RunLinkedMarkdown: Decodable, Sendable {
    public let fileName: String
    public let relativePath: String
    public let content: String
}
public enum ResolvedRunFile: Sendable { case output(RunOutput), markdown(RunLinkedMarkdown) }

enum RunFileTransfer {
    @MainActor static func receive(byteSize: Int, version: String, validate: () throws -> Void,
                                   read: (Int) async throws -> RunOutputChunk, write: (Data) throws -> Void,
                                   progress: (Double) -> Void) async throws {
        guard (0...RunFilePolicy.maxBytes).contains(byteSize) else { throw MainsError.server("Files up to 100 MB can be downloaded.") }
        var offset = 0
        while true {
            try Task.checkCancellation(); try validate()
            let chunk = try await read(offset)
            try Task.checkCancellation(); try validate()
            guard chunk.version == version, chunk.offset == offset, chunk.byteSize == byteSize,
                  chunk.base64.utf8.count <= 174_764, let part = Data(base64Encoded: chunk.base64),
                  part.count <= RunFilePolicy.chunkBytes, offset + part.count <= byteSize else { throw MainsError.invalidReply }
            let end = offset + part.count
            if let next = chunk.nextOffset { guard next == end, next > offset, next < byteSize else { throw MainsError.invalidReply } }
            else { guard end == byteSize else { throw MainsError.invalidReply } }
            try write(part); progress(byteSize == 0 ? 1 : Double(end) / Double(byteSize))
            guard chunk.nextOffset != nil else { return }
            offset = end
        }
    }

    @MainActor static func save(to url: URL, transfer: @MainActor ((Data) throws -> Void) async throws -> Void) async throws {
        try Data().write(to: url, options: .withoutOverwriting)
        let handle: FileHandle
        do { handle = try FileHandle(forWritingTo: url) }
        catch { try? FileManager.default.removeItem(at: url); throw error }
        var complete = false
        defer { try? handle.close(); if !complete { try? FileManager.default.removeItem(at: url) } }
        try await transfer { try handle.write(contentsOf: $0) }
        try Task.checkCancellation()
        complete = true
    }
}

public struct LocalTextFilePage: Sendable {
    public let text: String
    public let offset: Int
    public let nextOffset: Int?
    public static func read(_ url: URL, offset: Int) throws -> Self {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let size = try handle.seekToEnd()
        guard offset >= 0, offset <= size, size <= RunFilePolicy.maxBytes else { throw MainsError.invalidReply }
        try handle.seek(toOffset: UInt64(offset))
        let bytes = try handle.read(upToCount: RunFilePolicy.textPageBytes) ?? Data()
        for trimmed in 0...min(3, bytes.count) {
            let part = bytes.prefix(bytes.count - trimmed)
            if let text = String(data: part, encoding: .utf8), !part.isEmpty || size == 0 {
                let next = offset + part.count
                guard next == size || next > offset else { throw MainsError.invalidReply }
                return Self(text: text, offset: offset, nextOffset: next < size ? next : nil)
            }
        }
        throw MainsError.server("This text encoding cannot be previewed. Share or save the file instead.")
    }
}
