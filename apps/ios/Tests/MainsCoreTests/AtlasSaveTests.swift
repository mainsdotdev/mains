import Foundation
import Testing
@testable import MainsCore

@Suite struct AtlasSaveTests {
    @Test @MainActor func atlasTagsCanBeCreatedReusedRemovedAndFilteredWithoutMovingTheConversation() async throws {
        let backend = try DemoBackend(), storage = MemoryStorage()
        let session = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let space = session.selectedSpaceID
        let research = try #require(try await session.atlasTags(query: "ｒｅｓｅａｒｃｈ").items.first)
        var query = AtlasQuery(); query.tagID = research.id
        #expect(Set(try await session.atlasLibrary(query).items.map(\.kind)) == ["page", "bookmark"])
        let original = try await session.readAtlasTags("demo-atlas-bookmark")
        _ = try await session.setAtlasTags(original, tags: original.tags + [AtlasTag(id: "İstanbul 🌍", name: "İstanbul 🌍")], owner: session.ownership)
        let created = try #require(try await session.atlasTags(query: "İstanbul").items.first)
        let doc = try await session.readAtlasTags("demo-atlas-doc")
        _ = try await session.setAtlasTags(doc, tags: [created], owner: session.ownership)
        query.tagID = created.id
        #expect(try await session.atlasLibrary(query).items.count == 2)
        let current = try await session.readAtlasTags(original.id)
        _ = try await session.setAtlasTags(current, tags: [], owner: session.ownership)
        #expect(try await session.atlasLibrary(query).items.map(\.id) == [doc.id])
        #expect(try await session.atlasTags(query: "İstanbul").items == [created])
        #expect(session.viewingRunID == nil && session.selectedSpaceID == space && storage.snapshot == nil)
    }

    @Test @MainActor func aStaleTagSelectionIsRefusedAndNeverCreatesItsUnsentNames() async throws {
        let backend = try DemoBackend()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in DemoTransport(backend: backend) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let original = try await session.readAtlasTags("demo-atlas-page")
        let account = try backend.invoke("account:get", args: [])["id"]
        _ = try backend.invoke("atlas:setMobileTags", args: [.object(["accountId": account, "id": .string(original.id), "expectedRevision": .string(original.revision), "tags": .array([.string("Newer tag")])])], commandID: UUID().uuidString)
        let draft = [AtlasTag(id: "Unsent tag", name: "Unsent tag")]
        await #expect(throws: MainsError.self) { try await session.setAtlasTags(original, tags: draft, owner: session.ownership) }
        #expect(draft.first?.name == "Unsent tag" && session.pendingAtlasSave == nil && session.canSaveToAtlas)
        #expect(try await session.atlasTags(query: "Unsent").items.isEmpty)
        #expect(try await session.readAtlasTags(original.id).tags.map(\.name) == ["Newer tag"])
    }

    @Test @MainActor func unconfirmedTagChangesRecoverTheirOriginalReceiptAndKeepNewerTags() async throws {
        let backend = try DemoBackend(), probe = AtlasSaveProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasSaveTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let original = try await session.readAtlasTags("demo-atlas-page")
        probe.loseACK = true
        await #expect(throws: MainsError.self) { try await session.setAtlasTags(original, tags: [AtlasTag(id: "Phone tag", name: "Phone tag")], owner: session.ownership) }
        #expect(session.pendingAtlasSave?.isTagsChange == true && !session.canSaveToAtlas)
        let applied = try await session.readAtlasTags(original.id)
        await #expect(throws: MainsError.self) { try await session.setAtlasTags(applied, tags: [], owner: session.ownership) }
        let account = try backend.invoke("account:get", args: [])["id"]
        _ = try backend.invoke("atlas:setMobileTags", args: [.object(["accountId": account, "id": .string(original.id), "expectedRevision": .string(applied.revision), "tags": .array([.string("Newer tag")])])], commandID: UUID().uuidString)
        session.setActive(false); session.setActive(true)
        try await eventually { session.isConnected }
        _ = try await session.checkAtlasSaveDelivery()
        let calls = probe.calls.filter { $0.0 == "atlas:setMobileTags" }
        #expect(calls.count == 2 && calls[0].1 == calls[1].1 && calls[0].2 == calls[1].2)
        #expect(try await session.readAtlasTags(original.id).tags.map(\.name) == ["Newer tag"])
        #expect(session.pendingAtlasSave == nil)
    }

    @Test @MainActor func aTagAcknowledgementForAnotherItemRetainsTheOriginalCommandUntilChecked() async throws {
        let backend = try DemoBackend(), probe = AtlasSaveProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasSaveTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let original = try await session.readAtlasTags("demo-atlas-doc")
        probe.malformedUpdate = true
        await #expect(throws: MainsError.self) { try await session.setAtlasTags(original, tags: [], owner: session.ownership) }
        #expect(session.pendingAtlasSave?.status == .uncertain)
        _ = try await session.checkAtlasSaveDelivery()
        let calls = probe.calls.filter { $0.0 == "atlas:setMobileTags" }
        #expect(calls.count == 2 && calls[0].1 == calls[1].1 && calls[0].2 == calls[1].2)
        #expect(try await session.readAtlasTags(original.id).tags.isEmpty)
    }

    @Test func tagNamesRespectUnicodeNormalizationAndTheDesktopLimits() {
        #expect(AtlasTagNames.normalized("  ＳｗｉｆｔＵＩ   notes  ") == "SwiftUI notes")
        #expect(AtlasTagNames.normalized(String(repeating: "😀", count: 32)) != nil)
        for name in ["", "   ", "a\nb", "x\0y", String(repeating: "😀", count: 33)] { #expect(AtlasTagNames.normalized(name) == nil) }
    }

    @Test @MainActor func trashAndRestoreKeepSavedKindsAndTheirOrganizationWithoutChangingTheConversation() async throws {
        let backend = try DemoBackend(), storage = MemoryStorage()
        let session = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let space = session.selectedSpaceID
        let initial = try await session.atlasLibrary(AtlasQuery())
        let bookmark = try #require(initial.items.first { $0.kind == "bookmark" })
        let project = try #require(session.collections.first { $0.id != bookmark.savedProjectID }?.id)
        _ = try await session.setAtlasFavorite(bookmark, to: true, owner: session.ownership)
        _ = try await session.moveAtlasItem(bookmark, to: project, owner: session.ownership)
        for item in initial.items where item.savedIdentity != nil { _ = try await session.trashAtlasItem(item, owner: session.ownership) }
        let trash = try await session.atlasTrash()
        #expect(Set(trash.items.map(\.kind)) == ["page", "file", "image", "bookmark"])
        #expect(try await session.atlasLibrary(AtlasQuery()).items.allSatisfy { $0.savedIdentity == nil })
        for item in trash.items { _ = try await session.restoreAtlasItem(item, owner: session.ownership) }
        #expect(try await session.atlasTrash().items.isEmpty)
        let current = try #require(try await session.atlasLibrary(AtlasQuery()).items.first { $0.id == bookmark.id })
        #expect(current.isFavorite && current.savedProjectID == project && current.url == bookmark.url)
        #expect(session.viewingRunID == nil && session.selectedSpaceID == space && storage.snapshot == nil)
    }

    @Test @MainActor func trashReceiptRecoveryDoesNotTrashAnItemThatWasRestoredByANewerCommand() async throws {
        let backend = try DemoBackend(), probe = AtlasSaveProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasSaveTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let entry = try #require(try await session.atlasLibrary(AtlasQuery()).items.first { $0.kind == "page" })
        probe.loseACK = true
        await #expect(throws: MainsError.self) { try await session.trashAtlasItem(entry, owner: session.ownership) }
        #expect(session.pendingAtlasSave?.isTrashChange == true && !session.canSaveToAtlas)
        let trashed = try #require(try await session.atlasTrash().items.first)
        await #expect(throws: MainsError.self) { try await session.restoreAtlasItem(trashed, owner: session.ownership) }
        let account = try backend.invoke("account:get", args: [])["id"]
        _ = try backend.invoke("atlas:setMobileTrash", args: [.object(["accountId": account, "id": .string(trashed.id), "trashed": .bool(false)])], commandID: UUID().uuidString)
        _ = try await session.checkAtlasSaveDelivery()
        #expect(try await session.atlasTrash().items.isEmpty)
        #expect(try await session.atlasLibrary(AtlasQuery()).items.contains { $0.id == entry.id })
        let calls = probe.calls.filter { $0.0 == "atlas:setMobileTrash" }
        #expect(calls.count == 2 && calls[0].1 == calls[1].1 && calls[0].2 == calls[1].2)
    }

    @Test @MainActor func anUnconfirmedRestoreRetainsItsFalseStateAndCommandIdentityAcrossReconnection() async throws {
        let backend = try DemoBackend(), probe = AtlasSaveProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasSaveTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let entry = try #require(try await session.atlasLibrary(AtlasQuery()).items.first { $0.kind == "bookmark" })
        _ = try await session.trashAtlasItem(entry, owner: session.ownership)
        let item = try #require(try await session.atlasTrash().items.first)
        probe.loseACK = true
        await #expect(throws: MainsError.self) { try await session.restoreAtlasItem(item, owner: session.ownership) }
        let id = try #require(session.pendingAtlasSave?.id)
        session.setActive(false); session.setActive(true)
        try await eventually { session.isConnected }
        _ = try await session.checkAtlasSaveDelivery()
        let restores = probe.calls.filter { $0.0 == "atlas:setMobileTrash" && $0.1.first?["trashed"] == .bool(false) }
        #expect(restores.count == 2 && restores.allSatisfy { $0.2 == id })
        #expect(session.pendingAtlasSave == nil)
        #expect(try await session.atlasTrash().items.isEmpty)
    }

    @Test @MainActor func bookmarkEditsKeepUnchangedFieldsAndAllowDescriptionAndNoteToBeCleared() async throws {
        let backend = try DemoBackend(), probe = AtlasSaveProbe(), storage = MemoryStorage()
        let session = BackendSession(storage: storage, makeTransport: { _ in AtlasSaveTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let original = try await session.readAtlasBookmark("demo-atlas-bookmark")
        var draft = original.draft; draft.title = "İstanbul 🌍"; draft.description = "New description"; draft.note = "First line\nSecond line"
        _ = try await session.editAtlasBookmark(original, draft: draft, owner: session.ownership)
        let edited = try await session.readAtlasBookmark(original.id)
        #expect(edited.title == draft.title && edited.description == draft.description && edited.note == draft.note && edited.url == original.url)
        #expect(edited.revision != original.revision)
        var cleared = edited.draft; cleared.description = ""; cleared.note = ""
        _ = try await session.editAtlasBookmark(edited, draft: cleared, owner: session.ownership)
        let current = try await session.readAtlasBookmark(original.id)
        #expect(current.title == draft.title && current.description.isEmpty && current.note.isEmpty)
        let edit = try #require(probe.calls.last(where: { $0.0 == "atlas:editMobileBookmark" })?.1.first)
        #expect(edit["title"] == .null && edit["url"] == .null && edit["description"] == .string("") && edit["note"] == .string(""))
        var boundary = current.draft; boundary.title = String(repeating: "😀", count: 120)
        #expect(boundary.validationError == nil)
        boundary.title += "😀"; #expect(boundary.validationError != nil)
        #expect(session.viewingRunID == nil && storage.snapshot == nil)
    }

    @Test @MainActor func aStaleBookmarkEditIsRefusedWithoutDiscardingTheLocalDraft() async throws {
        let backend = try DemoBackend()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in DemoTransport(backend: backend) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let original = try await session.readAtlasBookmark("demo-atlas-bookmark")
        var draft = original.draft; draft.title = "My unsent title"
        let account = try backend.invoke("account:get", args: [])["id"]
        _ = try backend.invoke("atlas:editMobileBookmark", args: [.object(["accountId": account, "id": .string(original.id), "expectedRevision": .string(original.revision), "title": .string("Newer title"), "note": .string("Keep newer note")])], commandID: UUID().uuidString)
        await #expect(throws: MainsError.self) { try await session.editAtlasBookmark(original, draft: draft, owner: session.ownership) }
        #expect(draft.title == "My unsent title" && session.pendingAtlasSave == nil && session.canSaveToAtlas)
        let latest = try await session.readAtlasBookmark(original.id)
        #expect(latest.title == "Newer title" && latest.note == "Keep newer note")
    }

    @Test @MainActor func bookmarkEditRecoveryKeepsTheOriginalReceiptAndReadsNewerEditsAfterReconnection() async throws {
        let backend = try DemoBackend(), probe = AtlasSaveProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasSaveTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let original = try await session.readAtlasBookmark("demo-atlas-bookmark")
        var draft = original.draft; draft.note = "Phone note"
        probe.loseACK = true
        await #expect(throws: MainsError.self) { try await session.editAtlasBookmark(original, draft: draft, owner: session.ownership) }
        #expect(session.pendingAtlasSave?.isBookmarkEdit == true && session.pendingAtlasSave?.isUpdate == true)
        let applied = try await session.readAtlasBookmark(original.id)
        let account = try backend.invoke("account:get", args: [])["id"]
        _ = try backend.invoke("atlas:editMobileBookmark", args: [.object(["accountId": account, "id": .string(original.id), "expectedRevision": .string(applied.revision), "note": .string("Newer computer note")])], commandID: UUID().uuidString)
        session.setActive(false); session.setActive(true)
        try await eventually { session.isConnected }
        _ = try await session.checkAtlasSaveDelivery()
        let edits = probe.calls.filter { $0.0 == "atlas:editMobileBookmark" }
        #expect(edits.count == 2 && edits[0].1 == edits[1].1 && edits[0].2 == edits[1].2)
        #expect(try await session.readAtlasBookmark(original.id).note == "Newer computer note")
        #expect(session.pendingAtlasSave == nil)
    }

    @Test @MainActor func favoritesAndProjectMovesUpdateTheFilteredLibraryWithoutMovingTheReader() async throws {
        let backend = try DemoBackend(), storage = MemoryStorage()
        let session = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let entry = try #require(try await session.atlasLibrary(AtlasQuery()).items.first { $0.id == "demo-atlas-bookmark" })
        let project = try #require(session.collections.first { $0.id != entry.savedProjectID }?.id)
        let space = session.selectedSpaceID
        _ = try await session.setAtlasFavorite(entry, to: true, owner: session.ownership)
        _ = try await session.moveAtlasItem(entry, to: project, owner: session.ownership)
        var query = AtlasQuery(); query.scope = "favorites"; query.collectionID = project
        let moved = try #require(try await session.atlasLibrary(query).items.first)
        #expect(moved.id == entry.id && moved.isFavorite && moved.savedProjectID == project)
        _ = try await session.setAtlasFavorite(moved, to: false, owner: session.ownership)
        #expect(try await session.atlasLibrary(query).items.isEmpty)
        _ = try await session.moveAtlasItem(moved, to: nil, owner: session.ownership)
        let current = try #require(try await session.atlasLibrary(AtlasQuery()).items.first { $0.id == entry.id })
        #expect(current.savedProjectID == nil && !current.isFavorite && current.url == entry.url)
        let generated = try #require(try await session.atlasLibrary(AtlasQuery()).items.first { $0.origin == "generated" })
        await #expect(throws: MainsError.self) { try await session.setAtlasFavorite(generated, to: true, owner: session.ownership) }
        #expect(session.selectedSpaceID == space && session.viewingRunID == nil && storage.snapshot == nil)
    }

    @Test @MainActor func anUnknownFavoriteChecksItsOriginalReceiptWithoutReapplyingOverANewerChange() async throws {
        let backend = try DemoBackend(), probe = AtlasSaveProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasSaveTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let entry = try #require(try await session.atlasLibrary(AtlasQuery()).items.first { $0.id == "demo-atlas-bookmark" })
        probe.loseACK = true
        await #expect(throws: MainsError.self) { try await session.setAtlasFavorite(entry, to: true, owner: session.ownership) }
        #expect(session.pendingAtlasSave?.isUpdate == true && !session.canSaveToAtlas)
        await #expect(throws: MainsError.self) { try await session.moveAtlasItem(entry, to: nil, owner: session.ownership) }
        let account = try backend.invoke("account:get", args: [])["id"]
        _ = try backend.invoke("atlas:updateMobileItem", args: [.object(["accountId": account, "id": .string(entry.id), "isFavorite": .bool(false)])], commandID: UUID().uuidString)
        _ = try await session.checkAtlasSaveDelivery()
        let current = try #require(try await session.atlasLibrary(AtlasQuery()).items.first { $0.id == entry.id })
        #expect(!current.isFavorite && session.pendingAtlasSave == nil)
        let updates = probe.calls.filter { $0.0 == "atlas:updateMobileItem" }
        #expect(updates.count == 2 && updates[0].1 == updates[1].1 && updates[0].2 == updates[1].2)
    }

    @Test @MainActor func malformedPageChangeAcknowledgementRecoversTheOriginalDestinationAfterReconnection() async throws {
        let backend = try DemoBackend(), probe = AtlasSaveProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasSaveTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let entry = try #require(try await session.atlasLibrary(AtlasQuery()).items.first { $0.kind == "page" })
        let project = try #require(session.collections.first { $0.id != entry.savedProjectID }?.id)
        probe.malformedUpdate = true
        await #expect(throws: MainsError.self) { try await session.moveAtlasItem(entry, to: project, owner: session.ownership) }
        let command = try #require(session.pendingAtlasSave?.id)
        session.setActive(false); session.setActive(true)
        try await eventually { session.isConnected }
        let result = try await session.checkAtlasSaveDelivery()
        #expect(result.kind == "page" && result.id == entry.id && session.pendingAtlasSave == nil)
        let updates = probe.calls.filter { $0.0 == "atlas:updateMobileItem" }
        #expect(updates.count == 2 && updates.allSatisfy { $0.2 == command && $0.1.first?["collectionId"].string == project })
        var query = AtlasQuery(); query.collectionID = project
        #expect(try await session.atlasLibrary(query).items.contains { $0.id == entry.id })
    }

    @Test @MainActor func demoSavesOutputsAndBookmarksOnceWithoutChangingChatsOrStorage() async throws {
        let backend = try DemoBackend(), storage = MemoryStorage()
        let session = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let owner = session.ownership, space = session.selectedSpaceID
        let output = try #require(try await session.listOutputs(DemoBackend.tourID).items.first)
        let saved = try await session.saveAtlasFile(.output(output), owner: owner)
        let same = try await session.saveAtlasFile(.output(output), owner: owner)
        #expect(saved.id == same.id && saved.kind == "file")
        let bookmark = try await session.saveAtlasBookmark("https://example.org/notes?utm_source=mail", collectionID: nil, owner: owner)
        let duplicate = try await session.saveAtlasBookmark("https://example.org/notes", collectionID: nil, owner: owner)
        #expect(bookmark.id == duplicate.id && duplicate.kind == "bookmark")
        var query = AtlasQuery(); query.scope = "saved"
        let library = try await session.atlasLibrary(query)
        #expect(library.items.filter { $0.id == saved.id || $0.id == bookmark.id }.count == 2)
        let file = try await session.describeAtlasFile(.saved(saved.id))
        #expect(file.byteSize == output.byteSize)
        #expect(session.pendingAtlasSave == nil && session.selectedSpaceID == space && session.viewingRunID == nil && session.transcript.rows.isEmpty)
        #expect(storage.snapshot == nil)
    }

    @Test @MainActor func lostAcknowledgementBlocksNewSavesAndChecksTheOriginalReceiptAfterNavigation() async throws {
        let backend = try DemoBackend(), probe = AtlasSaveProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasSaveTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.loseACK = true
        await #expect(throws: MainsError.self) { try await session.saveAtlasBookmark("https://example.org/recovery", collectionID: nil, owner: session.ownership) }
        let pending = try #require(session.pendingAtlasSave)
        #expect(pending.status == .uncertain && !session.canSaveToAtlas)
        await #expect(throws: MainsError.self) { try await session.saveAtlasBookmark("https://example.org/another", collectionID: nil, owner: session.ownership) }
        let run = try #require(session.conversations.first?.id)
        await session.selectConversation(run)
        let rows = session.transcript.rows.map(\.id)
        let result = try await session.checkAtlasSaveDelivery()
        #expect(result.kind == "bookmark" && session.pendingAtlasSave == nil)
        #expect(session.viewingRunID == run && session.transcript.rows.map(\.id) == rows)
        let saves = probe.calls.filter { $0.0 == "atlas:saveMobileBookmark" }
        #expect(saves.count == 2 && saves[0].1 == saves[1].1 && saves[0].2 == saves[1].2 && saves[0].2 == pending.id)
        var query = AtlasQuery(); query.text = "example.org"
        #expect(try await session.atlasLibrary(query).items.count == 1)
    }

    @Test @MainActor func definiteRefusalReleasesAdmissionAndLateSuccessCannotCrossPairingOwnership() async throws {
        let backend = try DemoBackend(), probe = AtlasSaveProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasSaveTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { probe.release(); session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.reject = true
        await #expect(throws: MainsError.self) { try await session.saveAtlasBookmark("https://example.org/refused", collectionID: nil, owner: session.ownership) }
        #expect(session.pendingAtlasSave == nil && session.canSaveToAtlas)
        probe.hold = true
        let owner = session.ownership
        let save = Task { try await session.saveAtlasBookmark("https://example.org/late", collectionID: nil, owner: owner) }
        try await eventually { probe.held != nil }
        session.exitDemo(); try session.startDemo()
        try await eventually { session.isConnected }
        probe.release()
        await #expect(throws: MainsError.self) { try await save.value }
        #expect(session.ownership != owner && session.pendingAtlasSave == nil)
    }

    @Test func bookmarkInputAcceptsOnlyExplicitWebLinks() {
        #expect(AtlasBookmarkURL.validate(" https://example.com/a?x=1 ") == "https://example.com/a?x=1")
        for value in ["example.com", "file:///private/file", "javascript:alert(1)", "https://user:password@example.com", "https://example.com/\nsecret"] { #expect(AtlasBookmarkURL.validate(value) == nil) }
    }
}

extension SessionIntegrationTests {
    @Test @MainActor func atlasTagsUseBoundedReadersAndTheirOwnReceiptCommandOnTheRealWire() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        let original = try await session.readAtlasTags("fixture-atlas-page")
        _ = try await session.setAtlasTags(original, tags: original.tags + [AtlasTag(id: "Phone research", name: "Phone research")], owner: session.ownership)
        let tag = try #require(try await session.atlasTags(query: "Phone").items.first)
        var query = AtlasQuery(); query.tagID = tag.id
        let library = try await session.atlasLibrary(query)
        #expect(library.items.map(\.id) == [original.id])
        #expect(library.items.first?.tags?.contains(tag) == true)
        let current = try await session.readAtlasTags(original.id)
        _ = try await session.setAtlasTags(current, tags: [], owner: session.ownership)
        #expect(try await session.atlasLibrary(query).items.isEmpty)
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data)
        let changes = calls.filter { $0["channel"].string == "atlas:setMobileTags" }
        #expect(changes.count == 2 && changes.allSatisfy { $0["commandId"].string?.isEmpty == false })
        #expect(!calls.contains { ["atlas:setTags", "atlas:listTags", "atlas:update"].contains($0["channel"].string ?? "") })
        #expect(session.viewingRunID == nil && session.transcript.rows.isEmpty)
    }

    @Test @MainActor func atlasTrashAndRestoreUseNarrowReceiptCommandsAndExcludeTrashedItemsFromTheLibrary() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        let entry = try #require(try await session.atlasLibrary(AtlasQuery()).items.first { $0.kind == "bookmark" })
        _ = try await session.trashAtlasItem(entry, owner: session.ownership)
        let item = try #require(try await session.atlasTrash().items.first)
        #expect(item.id == entry.id)
        var query = AtlasQuery(); query.text = entry.title
        #expect(try await session.atlasLibrary(query).items.isEmpty)
        _ = try await session.restoreAtlasItem(item, owner: session.ownership)
        #expect(try await session.atlasTrash().items.isEmpty)
        #expect(try await session.atlasLibrary(query).items.map(\.id) == [entry.id])
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data)
        let changes = calls.filter { $0["channel"].string == "atlas:setMobileTrash" }
        #expect(changes.count == 2 && changes.allSatisfy { $0["commandId"].string?.isEmpty == false })
        #expect(!calls.contains { $0["channel"].string == "atlas:remove" || $0["channel"].string == "atlas:update" })
        #expect(session.viewingRunID == nil && session.transcript.rows.isEmpty)
    }

    @Test @MainActor func bookmarkEditingUsesFreshBoundedReadsAndItsOwnReceiptBackedCommand() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        let original = try await session.readAtlasBookmark("fixture-atlas-bookmark")
        var draft = original.draft; draft.title = "Research link"; draft.description = "Updated description"; draft.note = "A useful note"
        _ = try await session.editAtlasBookmark(original, draft: draft, owner: session.ownership)
        let edited = try await session.readAtlasBookmark(original.id)
        #expect(edited.title == draft.title && edited.description == draft.description && edited.note == draft.note && edited.url == original.url)
        await #expect(throws: MainsError.self) { try await session.editAtlasBookmark(original, draft: draft, owner: session.ownership) }
        var query = AtlasQuery(); query.text = "Research link"
        #expect(try await session.atlasLibrary(query).items.map(\.id) == [original.id])
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data).filter { $0["channel"].string == "atlas:editMobileBookmark" }
        #expect(calls.allSatisfy { $0["commandId"].string?.isEmpty == false && $0["args"].array.first?["url"].string == nil })
        #expect(session.viewingRunID == nil && session.transcript.rows.isEmpty)
    }

    @Test @MainActor func atlasOrganizationUsesWhitelistedReceiptCommandsAndRefreshesProjectAndFavoriteFilters() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        let entry = try #require(try await session.atlasLibrary(AtlasQuery()).items.first { $0.kind == "bookmark" })
        let project = try #require(session.collections.first?.id)
        _ = try await session.setAtlasFavorite(entry, to: true, owner: session.ownership)
        _ = try await session.moveAtlasItem(entry, to: project, owner: session.ownership)
        var query = AtlasQuery(); query.scope = "favorites"; query.collectionID = project
        #expect(try await session.atlasLibrary(query).items.map(\.id) == [entry.id])
        _ = try await session.setAtlasFavorite(entry, to: false, owner: session.ownership)
        #expect(try await session.atlasLibrary(query).items.isEmpty)
        _ = try await session.moveAtlasItem(entry, to: nil, owner: session.ownership)
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data).filter { $0["channel"].string == "atlas:updateMobileItem" }
        #expect(calls.count == 4 && calls.allSatisfy { $0["commandId"].string?.isEmpty == false })
        #expect(calls.last?["args"].array.first?["collectionId"] == .null)
        #expect(session.viewingRunID == nil && session.transcript.rows.isEmpty)
    }

    @Test @MainActor func atlasSavesUseReceiptBackedCommandsAndAppearInTheLibrary() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        let file = try #require(try await session.listOutputs("fixture-run").items.first)
        let item = try await session.saveAtlasFile(.output(file), owner: session.ownership)
        let again = try await session.saveAtlasFile(.output(file), owner: session.ownership)
        #expect(item.id == again.id)
        let bookmark = try await session.saveAtlasBookmark("https://example.org/native?utm_source=ios", collectionID: nil, owner: session.ownership)
        let duplicate = try await session.saveAtlasBookmark("https://example.org/native", collectionID: nil, owner: session.ownership)
        #expect(bookmark.id == duplicate.id)
        var query = AtlasQuery(); query.scope = "saved"; query.text = "example.org"
        #expect(try await session.atlasLibrary(query).items.map(\.id) == [bookmark.id])
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data).filter { $0["channel"].string?.hasPrefix("atlas:save") == true }
        #expect(calls.count == 4 && calls.allSatisfy { $0["commandId"].string?.isEmpty == false })
        #expect(calls.allSatisfy { $0["args"].array.first?["path"].string == nil })
    }
}

@MainActor private final class AtlasSaveProbe {
    var loseACK = false, hold = false, reject = false
    var malformedUpdate = false
    var held: CheckedContinuation<Void, Never>?
    var calls: [(String, [JSONValue], String?)] = []
    func release() { let continuation = held; held = nil; continuation?.resume() }
}
@MainActor private final class AtlasSaveTransport: BackendTransport {
    let base: DemoTransport
    let probe: AtlasSaveProbe
    init(_ backend: DemoBackend, _ probe: AtlasSaveProbe) { base = DemoTransport(backend: backend); self.probe = probe }
    var onEvent: ((String, JSONValue) -> Void)? { get { base.onEvent } set { base.onEvent = newValue } }
    var onDisconnect: ((MainsError) -> Void)? { get { base.onDisconnect } set { base.onDisconnect = newValue } }
    func open(endpoint: URL, token: String) throws { try base.open(endpoint: endpoint, token: token) }
    func close() { base.close() }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        probe.calls.append((channel, args, commandId))
        let mutation = channel.hasPrefix("atlas:save") || channel == "atlas:updateMobileItem" || channel == "atlas:editMobileBookmark" || channel == "atlas:setMobileTrash" || channel == "atlas:setMobileTags"
        if mutation, probe.reject { probe.reject = false; throw MainsError.server("Invalid bookmark URL") }
        let value = try await base.perform(channel, args: args, commandId: commandId, timeout: timeout)
        if mutation, probe.loseACK { probe.loseACK = false; throw MainsError.timeout }
        if mutation, probe.hold { probe.hold = false; await withCheckedContinuation { probe.held = $0 } }
        if ["atlas:updateMobileItem", "atlas:setMobileTags"].contains(channel), probe.malformedUpdate {
            probe.malformedUpdate = false
            var changed = value.objectValue; changed["requestedId"] = .string("another-item"); return .object(changed)
        }
        return value
    }
}
