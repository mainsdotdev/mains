import SwiftUI
import Photos
import Observation

struct LibraryPhotoThumbnail: UIViewRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let asset: PHAsset
    let pixels: CGFloat
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView(); view.contentMode = .scaleAspectFill; view.clipsToBounds = true
        view.isUserInteractionEnabled = false
        view.backgroundColor = .tertiarySystemFill
        return view
    }
    func updateUIView(_ view: UIImageView, context: Context) {
        let coordinator = context.coordinator
        guard coordinator.assetID != asset.localIdentifier else { return }
        coordinator.cancel(); coordinator.assetID = asset.localIdentifier; view.image = nil
        let id = asset.localIdentifier
        let options = PHImageRequestOptions(); options.deliveryMode = .opportunistic; options.resizeMode = .fast
        options.isNetworkAccessAllowed = false
        coordinator.requestID = PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: pixels, height: pixels), contentMode: .aspectFill, options: options) { [weak view, weak coordinator] image, _ in
            Task { @MainActor in
                guard coordinator?.assetID == id else { return }
                view?.image = image
            }
        }
    }
    static func dismantleUIView(_ view: UIImageView, coordinator: Coordinator) { coordinator.cancel() }
    @MainActor final class Coordinator {
        var assetID: String?
        var requestID: PHImageRequestID?
        func cancel() {
            if let requestID { PHImageManager.default().cancelImageRequest(requestID) }
            requestID = nil; assetID = nil
        }
    }
}

/// Resolves only selected assets, supports iCloud downloads, and always resumes on cancellation.
final class SelectedPhotoRequest: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<UIImage, any Error>?
    private var requestID: PHImageRequestID?
    private var finished = false
    @MainActor func image(for asset: PHAsset) async throws -> UIImage {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                let start = lock.withLock {
                    guard !finished else { return false }
                    self.continuation = continuation; return true
                }
                guard start else { continuation.resume(throwing: CancellationError()); return }
                let options = PHImageRequestOptions()
                options.deliveryMode = .highQualityFormat; options.resizeMode = .exact; options.isNetworkAccessAllowed = true
                let id = PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: 2048, height: 2048), contentMode: .aspectFit, options: options) { [self] image, info in
                    if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
                    if let error = info?[PHImageErrorKey] as? any Error { finish(.failure(error)) }
                    else if (info?[PHImageCancelledKey] as? Bool) == true { finish(.failure(CancellationError())) }
                    else if let image { finish(.success(image)) }
                    else { finish(.failure(MainsError.server("This photo couldn’t be downloaded. Try again when you’re online."))) }
                }
                let cancel = lock.withLock { if finished { return true }; requestID = id; return false }
                if cancel { PHImageManager.default().cancelImageRequest(id) }
            }
        } onCancel: { cancel() }
    }
    private func finish(_ result: Result<UIImage, any Error>) {
        let continuation = lock.withLock {
            guard !finished else { return nil as CheckedContinuation<UIImage, any Error>? }
            finished = true
            let value = self.continuation; self.continuation = nil; requestID = nil
            return value
        }
        continuation?.resume(with: result)
    }
    private func cancel() {
        let state = lock.withLock {
            finished = true
            let value = (continuation, requestID); continuation = nil; requestID = nil
            return value
        }
        if let id = state.1 { PHImageManager.default().cancelImageRequest(id) }
        state.0?.resume(throwing: CancellationError())
    }
}
