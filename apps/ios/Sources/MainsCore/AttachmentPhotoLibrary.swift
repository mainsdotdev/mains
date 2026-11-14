import Foundation
import Photos
import Observation

@MainActor @Observable
final class AttachmentPhotoLibrary {
    var assets: [PHAsset] = []
    var loading = true
    var message: String?
    private var result: PHFetchResult<PHAsset>?
    private let authorization: () -> PHAuthorizationStatus
    private let requestAuthorization: () async -> PHAuthorizationStatus
    private var loadID = UUID()
    init(authorization: @escaping () -> PHAuthorizationStatus = { PHPhotoLibrary.authorizationStatus(for: .readWrite) },
         requestAuthorization: @escaping () async -> PHAuthorizationStatus = { await PHPhotoLibrary.requestAuthorization(for: .readWrite) }) {
        self.authorization = authorization; self.requestAuthorization = requestAuthorization
    }
    func load() async {
        let id = UUID(); loadID = id
        loading = true
        defer { if loadID == id { loading = false } }
        var authorization = authorization()
        if authorization == .notDetermined { authorization = await requestAuthorization() }
        guard !Task.isCancelled, loadID == id else { return }
        guard authorization == .authorized || authorization == .limited else {
            result = nil; assets = []; message = "Open All Photos to choose photos, or allow photo access in Settings to see your recents."; return
        }
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        result = PHAsset.fetchAssets(with: .image, options: options)
        assets = []; message = nil; loadMore()
        if assets.isEmpty { message = "No photos here yet. Open All Photos to browse your whole library." }
    }
    func loadMore() {
        guard let result, assets.count < result.count else { return }
        let end = min(result.count, assets.count + 60)
        assets.append(contentsOf: (assets.count..<end).map { result.object(at: $0) })
    }
}

/// Owns a protected export copy independently of the preview's download lifetime.
final class PreviewExportFile: Identifiable, @unchecked Sendable {
    let id = UUID()
    let url: URL
    private let directory: URL
    init(copying source: URL) throws {
        let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard source.isFileURL, values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, (0...100 * 1024 * 1024).contains(size) else {
            throw MainsError.server("This file is unavailable or exceeds the 100 MB export limit.")
        }
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("mains-export-" + UUID().uuidString, isDirectory: true)
        url = directory.appendingPathComponent(TranscriptMedia.fileName(source.lastPathComponent))
        do {
            var attributes: [FileAttributeKey: Any] = [.posixPermissions: 0o700]
            #if os(iOS)
            attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
            #endif
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: attributes)
            try FileManager.default.copyItem(at: source, to: url)
            #if os(iOS)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
            #endif
        } catch { try? FileManager.default.removeItem(at: directory); throw error }
    }
    deinit { try? FileManager.default.removeItem(at: directory) }
}

enum PhotoLibrarySaveError: LocalizedError, Equatable {
    case denied, restricted
    var errorDescription: String? {
        switch self {
        case .denied: "Allow Mains to add photos in Settings, or save this image to Files instead."
        case .restricted: "Adding photos is restricted on this iPhone. You can save this image to Files instead."
        }
    }
}

/// Requests add-only access only after an explicit save, never while previewing.
@MainActor @Observable final class PreviewPhotoSaver {
    private(set) var saving = false
    private(set) var savedURL: URL?
    private let authorization: () -> PHAuthorizationStatus
    private let requestAuthorization: () async -> PHAuthorizationStatus
    private let write: (URL) async throws -> Void
    init(authorization: @escaping () -> PHAuthorizationStatus = { PHPhotoLibrary.authorizationStatus(for: .addOnly) },
         requestAuthorization: @escaping () async -> PHAuthorizationStatus = { await PHPhotoLibrary.requestAuthorization(for: .addOnly) },
         write: @escaping (URL) async throws -> Void = { url in
             try await PHPhotoLibrary.shared().performChanges {
                 PHAssetCreationRequest.forAsset().addResource(with: .photo, fileURL: url, options: nil)
             }
         }) {
        self.authorization = authorization; self.requestAuthorization = requestAuthorization; self.write = write
    }
    func save(_ url: URL, isCurrent: () -> Bool) async throws {
        guard !saving, savedURL != url, isCurrent() else { return }
        saving = true
        defer { saving = false }
        var status = authorization()
        if status == .notDetermined { status = await requestAuthorization() }
        try Task.checkCancellation()
        guard isCurrent() else { throw CancellationError() }
        guard status == .authorized || status == .limited else {
            throw status == .restricted ? PhotoLibrarySaveError.restricted : PhotoLibrarySaveError.denied
        }
        let export = try await Task.detached(priority: .userInitiated) { try PreviewExportFile(copying: url) }.value
        try Task.checkCancellation()
        guard isCurrent() else { throw CancellationError() }
        try await write(export.url)
        withExtendedLifetime(export) {}
        guard isCurrent() else { return }
        savedURL = url
    }
}
