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

    /// Match desktop's generated-image copy projection. Only hide the generated
    /// original once the same turn has a saved deliverable with identical bytes.
    /// The retained history and file identities remain unchanged.
    static func hiddenGeneratedImageCopies(in artifacts: [Artifact]) -> Set<Int> {
        struct Identity: Hashable { let runID: String; let hash: String }
        func identity(_ artifact: Artifact) -> (key: Identity, generated: Bool)? {
            let metadata = artifact.metadata ?? .null
            guard artifact.kind == "image", let hash = artifact.contentHash, !hash.isEmpty,
                  let path = metadata["path"].string ?? artifact.path else { return nil }
            return (Identity(runID: artifact.runId, hash: hash),
                    metadata["source"].string == "codex_image_generation" || path.contains("/.codex/generated_images/"))
        }
        // Output discovery appends artifacts to history; partition only after
        // restoring the same chronological order used by the transcript rows.
        let ordered = artifacts.filter { ($0.metadata ?? .null)["voice"].bool || AgentActivity.foreground($0.metadata ?? .null) }
            .sorted { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt }
        var hidden = Set<Int>()
        for turn in ordered.split(whereSeparator: { $0.kind == "user-prompt" }) {
            let saved = Set(turn.compactMap { artifact -> Identity? in
                let metadata = artifact.metadata ?? .null
                guard let image = identity(artifact), !image.generated,
                      !metadata["working"].bool, !metadata["viewed"].bool else { return nil }
                return image.key
            })
            for artifact in turn {
                if let image = identity(artifact), image.generated, saved.contains(image.key) { hidden.insert(artifact.id) }
            }
        }
        return hidden
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
