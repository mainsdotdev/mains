import Foundation

/// History holds references only. Host paths are labels, never download URLs.
public struct TranscriptMedia: Identifiable, Equatable, Sendable {
    public enum Source: Equatable, Sendable { case artifact(Int), attachment(String), unavailable }
    public let id: String
    public let runID: String
    public let name: String
    public let image: Bool
    public let source: Source
    public var byteSize: Int? = nil
    public var mimeType: String? = nil
    public var available: Bool { source != .unavailable }
    public static func validAttachmentID(_ value: String) -> Bool {
        value.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    public static func prompt(_ metadata: JSONValue, runID: String) -> [Self] {
        metadata["attachments"].array.prefix(5).enumerated().compactMap { index, item in
            guard ["image", "document"].contains(item["type"].string ?? "") else { return nil }
            let token = item["attachmentId"].string ?? ""
            let source: Source = validAttachmentID(token) ? .attachment(token) : .unavailable
            return Self(id: "attachment:\(index):\(token)", runID: runID,
                        name: fileName(item["name"].string ?? "Attachment"), image: item["type"].string == "image", source: source,
                        byteSize: item["byteSize"].number.flatMap { $0.isFinite && $0 >= 0 && $0 <= 100 * 1024 * 1024 ? Int($0) : nil },
                        mimeType: item["mimeType"].string)
        }
    }
    public static func artifact(_ artifact: Artifact) -> Self? {
        let metadata = artifact.metadata ?? .null
        guard artifact.kind == "image" || ["document", "file", "visualization"].contains(artifact.kind) && metadata["outputSelected"].bool else { return nil }
        return Self(id: "output:\(artifact.id)", runID: artifact.runId,
                    name: fileName(metadata["fileName"].string ?? artifact.path ?? metadata["path"].string ?? (artifact.kind == "image" ? "Image" : "Document")),
                    image: artifact.kind == "image", source: .artifact(artifact.id),
                    byteSize: metadata["byteSize"].number.flatMap { $0.isFinite && $0 >= 0 && $0 <= 100 * 1024 * 1024 ? Int($0) : nil },
                    mimeType: metadata["mimeType"].string)
    }
    public static func fileName(_ path: String) -> String {
        let name = path.replacingOccurrences(of: "\\", with: "/").components(separatedBy: "/").last ?? "Attachment"
        return name.isEmpty || [".", ".."].contains(name) ? "Attachment" : String(name.prefix(240))
    }
}

public struct ArtifactImage: Decodable, Sendable {
    public let mime: String
    public let base64: String
    public var data: Data? {
        guard mime.hasPrefix("image/"), base64.utf8.count <= 3_800_000,
              let data = Data(base64Encoded: base64), data.count <= 2_800_000 else { return nil }
        return data
    }
}

public struct RunAttachmentFile: Decodable, Sendable {
    public let runId: String
    public let attachmentId: String
    public let name: String
    public let mimeType: String
    public let byteSize: Int
    public let version: String
    public let previewType: String
    public var downloadLimit: Int { RunFilePolicy.maxBytes }
}
