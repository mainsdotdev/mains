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
