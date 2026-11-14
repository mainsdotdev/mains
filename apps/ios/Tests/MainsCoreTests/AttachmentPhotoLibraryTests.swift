import Photos
import Testing
@testable import MainsCore

@Test @MainActor func deniedPhotoAccessFinishesWithTheSystemPickerFallback() async {
    let library = AttachmentPhotoLibrary(authorization: { .denied })
    await library.load()
    #expect(!library.loading && library.assets.isEmpty)
    #expect(library.message?.contains("All Photos") == true)
}

@Test @MainActor func anOlderPhotoLoadCannotClearTheNewerLoadsSpinner() async throws {
    var permissions: [CheckedContinuation<PHAuthorizationStatus, Never>] = []
    let library = AttachmentPhotoLibrary(authorization: { .notDetermined }, requestAuthorization: {
        await withCheckedContinuation { permissions.append($0) }
    })
    let first = Task { await library.load() }
    try await eventually { permissions.count == 1 }
    let second = Task { await library.load() }
    try await eventually { permissions.count == 2 }
    first.cancel(); permissions[0].resume(returning: .denied)
    await first.value
    #expect(library.loading)
    permissions[1].resume(returning: .denied)
    await second.value
    #expect(!library.loading && library.message != nil)
}

@Test @MainActor func cancelingPhotoPermissionLoadingNeverLeavesTheSpinnerRunning() async throws {
    var permission: CheckedContinuation<PHAuthorizationStatus, Never>?
    let library = AttachmentPhotoLibrary(authorization: { .notDetermined }, requestAuthorization: {
        await withCheckedContinuation { permission = $0 }
    })
    let load = Task { await library.load() }
    try await eventually { permission != nil }
    #expect(library.loading)
    load.cancel(); permission?.resume(returning: .denied)
    await load.value
    #expect(!library.loading)
}

@Test @MainActor func savingPhotosRequestsPermissionOnlyWhenTappedAndDoesNotDuplicateASuccess() async throws {
    let original = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")
    try Data("prepared image".utf8).write(to: original)
    defer { try? FileManager.default.removeItem(at: original) }
    var requests = 0, writes = 0
    var writtenURL: URL?
    let saver = PreviewPhotoSaver(authorization: { .notDetermined }, requestAuthorization: { requests += 1; return .authorized }, write: { url in
        writes += 1; writtenURL = url
        #expect(url != original && FileManager.default.fileExists(atPath: url.path))
        let bytes = try Data(contentsOf: url)
        #expect(bytes == Data("prepared image".utf8))
    })
    #expect(requests == 0 && writes == 0)
    try await saver.save(original) { true }
    #expect(requests == 1 && writes == 1 && saver.savedURL == original && !saver.saving)
    #expect(writtenURL.map { !FileManager.default.fileExists(atPath: $0.path) } == true)
    try await saver.save(original) { true }
    #expect(requests == 1 && writes == 1)
}

@Test @MainActor func deniedOrRestrictedPhotoSavesNeverWriteOrRequestAgain() async throws {
    for permission in [PHAuthorizationStatus.denied, .restricted] {
        var requests = 0, writes = 0
        let saver = PreviewPhotoSaver(authorization: { permission }, requestAuthorization: { requests += 1; return .authorized }, write: { _ in writes += 1 })
        await #expect(throws: PhotoLibrarySaveError.self) { try await saver.save(URL(fileURLWithPath: "/unused.png")) { true } }
        #expect(requests == 0 && writes == 0 && !saver.saving && saver.savedURL == nil)
    }
}

@Test @MainActor func retiringAPreviewWhilePhotoPermissionIsOpenCannotSaveItsImage() async throws {
    var permission: CheckedContinuation<PHAuthorizationStatus, Never>?
    var current = true, writes = 0
    let saver = PreviewPhotoSaver(authorization: { .notDetermined }, requestAuthorization: {
        await withCheckedContinuation { permission = $0 }
    }, write: { _ in writes += 1 })
    let task = Task { try await saver.save(URL(fileURLWithPath: "/unused.png")) { current } }
    try await eventually { permission != nil }
    current = false; permission?.resume(returning: .authorized)
    await #expect(throws: CancellationError.self) { try await task.value }
    #expect(!saver.saving && saver.savedURL == nil && writes == 0)
}

@Test @MainActor func anExportCopyOutlivesItsPreviewAndIsRemovedWhenThePickerReleasesIt() throws {
    let original = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
    try Data("prepared document".utf8).write(to: original)
    var file: PreviewExportFile? = try PreviewExportFile(copying: original)
    let copied = try #require(file?.url)
    try FileManager.default.removeItem(at: original)
    #expect(try Data(contentsOf: copied) == Data("prepared document".utf8))
    file = nil
    #expect(!FileManager.default.fileExists(atPath: copied.path))
}
