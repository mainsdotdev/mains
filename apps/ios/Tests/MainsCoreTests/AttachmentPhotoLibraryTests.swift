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
