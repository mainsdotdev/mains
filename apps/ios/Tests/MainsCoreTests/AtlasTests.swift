import Foundation
import Testing
@testable import MainsCore

@Suite struct AtlasTests {
    @Test(arguments: ["atlas:mobileTags", "atlas:readMobileTags", "atlas:readMobileImage", "atlas:readMobilePageCover", "atlas:readMobilePageImage"]) @MainActor func atlasReadsRetiredByReconnectionCannotReturnToTheNewConnection(channel: String) async throws {
        let backend = try DemoBackend(), probe = AtlasProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { probe.release(); session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.hold = channel
        let read = Task {
            if channel == "atlas:mobileTags" { _ = try await session.atlasTags() }
            else if channel == "atlas:readMobileTags" { _ = try await session.readAtlasTags("demo-atlas-page") }
            else if channel == "atlas:readMobilePageCover" { _ = try await session.readAtlasPageCover("demo-atlas-page", coverFileID: "demo-atlas-image") }
            else if channel == "atlas:readMobilePageImage" { _ = try await session.readAtlasPageImage("demo-atlas-page", fileID: "demo-atlas-image", version: 1) }
            else { _ = try await session.readAtlasImage(.saved("demo-atlas-image")) }
        }
        try await eventually { probe.held != nil }
        session.setActive(false); session.setActive(true)
        try await eventually { session.isConnected }
        probe.release()
        await #expect(throws: MainsError.self) { try await read.value }
        #expect(try await session.readAtlasTags("demo-atlas-page").tags.count == 1)
    }

    @Test @MainActor func pageCoversUsePreparedBytesAndDoNotChangeTheSelectedChatOrDiskSnapshot() async throws {
        let storage = MemoryStorage(), backend = try DemoBackend()
        let session = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let space = session.selectedSpaceID
        let page = try await session.atlasPage("demo-atlas-page")
        let coverID = try #require(page.coverFileId)
        let cover = try await session.readAtlasPageCover(page.id, coverFileID: coverID)
        #expect(cover.data != nil && cover.width <= 768 && cover.height <= 768)
        let inline = try await session.readAtlasPageImage(page.id, fileID: "demo-atlas-image", version: page.version)
        #expect(inline.data != nil && inline.pageVersion == page.version && page.inlineImageIDs == ["demo-atlas-image"])
        await #expect(throws: MainsError.self) { try await session.readAtlasPageImage(page.id, fileID: "wrong-image", version: page.version) }
        await #expect(throws: MainsError.self) { try await session.readAtlasPageCover(page.id, coverFileID: "wrong-cover") }
        #expect(session.viewingRunID == nil && session.transcript.rows.isEmpty && session.selectedSpaceID == space && storage.snapshot == nil)
    }

    @Test func pagesFromOlderComputersRemainReadableWithoutCoverMetadata() throws {
        let value: JSONValue = .object(["id": .string("old-page"), "title": .string("Notes"), "version": .number(1),
            "icon": .null, "markdown": .string("Content"), "offset": .number(0), "nextOffset": .null, "sourceRunId": .null])
        let page = try value.decode(AtlasPageContent.self)
        #expect(page.coverFileId == nil && page.icon == nil && page.title == "Notes")
    }

    @Test(arguments: ["page", "cover", "size", "bytes", "mime", "version"]) @MainActor func malformedPageCoversAreRejected(field: String) async throws {
        let backend = try DemoBackend(), probe = AtlasProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.corruptCover = field
        await #expect(throws: MainsError.self) { try await session.readAtlasPageCover("demo-atlas-page", coverFileID: "demo-atlas-image") }
    }

    @Test(arguments: ["page", "file", "pageVersion", "size", "bytes", "mime", "version"]) @MainActor func malformedEmbeddedPageImagesAreRejected(field: String) async throws {
        let backend = try DemoBackend(), probe = AtlasProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.corruptPageImage = field
        await #expect(throws: MainsError.self) { try await session.readAtlasPageImage("demo-atlas-page", fileID: "demo-atlas-image", version: 1) }
    }

    @Test @MainActor func atlasThumbnailsStayBoundedAndUsePreparedDemoBytesWithoutChangingTheTranscript() async throws {
        let storage = MemoryStorage(), backend = try DemoBackend()
        let session = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let rows = try await session.atlasLibrary(AtlasQuery()).items
        #expect(rows.first { $0.kind == "page" }?.preview?.contains("Pages") == true)
        #expect(rows.first { $0.key == "demo-atlas-doc" }?.mimeType == "application/pdf")
        let reference = try #require(rows.first { $0.kind == "image" }?.file)
        let thumbnail = try await session.readAtlasImage(reference)
        #expect(thumbnail.width == 128 && thumbnail.height == 85)
        #expect(try #require(thumbnail.data).count <= 131_072)
        await #expect(throws: MainsError.self) { try await session.readAtlasImage(.saved("demo-atlas-doc")) }
        #expect(session.viewingRunID == nil && session.transcript.rows.isEmpty && storage.snapshot == nil)
    }

    @Test(arguments: ["identity", "size", "bytes", "mime"]) @MainActor func malformedThumbnailsAreRejected(field: String) async throws {
        let backend = try DemoBackend(), probe = AtlasProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.corruptImage = field
        await #expect(throws: MainsError.self) { try await session.readAtlasImage(.saved("demo-atlas-image")) }
    }

    @Test @MainActor func demoLibraryFiltersAndReadsWithoutChangingTheConversationOrDiskSnapshot() async throws {
        let storage = MemoryStorage()
        let backend = try DemoBackend()
        let isolated = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
        isolated.restore(); isolated.setActive(true); try isolated.startDemo()
        defer { isolated.exitDemo(); backend.shutdown() }
        try await eventually { isolated.isConnected }
        let space = isolated.selectedSpaceID
        let all = try await isolated.atlasLibrary(AtlasQuery())
        #expect(Set(all.items.map(\.kind)) == ["page", "file", "image", "bookmark"])
        var query = AtlasQuery(); query.scope = "favorites"
        #expect(try await isolated.atlasLibrary(query).items.count == 2)
        query.scope = "all"; query.type = "page"; query.text = "explore"
        let entry = try #require(try await isolated.atlasLibrary(query).items.first)
        let page = try await isolated.atlasPage(try #require(entry.pageId))
        #expect(page.markdown.contains("Atlas") && page.nextOffset == nil)
        #expect(page.embeddedFiles == ["demo-atlas-image", "demo-atlas-doc", "demo-atlas-page-file"])
        #expect(isolated.selectedSpaceID == space && isolated.viewingRunID == nil && isolated.transcript.rows.isEmpty)
        #expect(storage.snapshot == nil)
        let pdf = try #require(all.items.first { $0.key == "demo-atlas-doc" }?.file)
        let descriptor = try await isolated.describeAtlasFile(pdf)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try await isolated.downloadAtlasFile(descriptor, owner: isolated.ownership, to: url)
        #expect(try Data(contentsOf: url) == DemoFile.pdf.bytes)
    }

    @Test func pageLinksAdmitOnlyAtlasIdentitiesAndNeverComputerPaths() {
        #expect(AtlasLink(URL(string: "atlas-file://photo-123")!) == .file("photo-123"))
        #expect(AtlasLink(URL(string: "/atlas/page-123")!) == .page("page-123"))
        for value in ["file:///private/notes.md", "https://example.com/atlas/page-123", "atlas-file://image/other", "/atlas/../secret", "atlas-file://../private"] {
            #expect(AtlasLink(URL(string: value)!) == nil)
        }
    }

    @Test @MainActor func aReadRetiredByReconnectionCannotReturnOrTouchTheNewSession() async throws {
        let backend = try DemoBackend(), probe = AtlasProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { probe.release(); session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.hold = "atlas:mobileLibrary"
        let read = Task { try await session.atlasLibrary(AtlasQuery()) }
        try await eventually { probe.held != nil }
        session.setActive(false); session.setActive(true)
        try await eventually { session.isConnected }
        probe.release()
        await #expect(throws: MainsError.self) { try await read.value }
        #expect(try await session.atlasLibrary(AtlasQuery()).items.count == 5)
    }

    @Test @MainActor func aBadChunkRemovesItsPartialFileAndUnsupportedComputersGetAnUpdateMessage() async throws {
        let backend = try DemoBackend(), probe = AtlasProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasTransport(backend, probe) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let file = try await session.describeAtlasFile(.saved("demo-atlas-doc"))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        probe.corruptChunk = true
        await #expect(throws: MainsError.self) { try await session.downloadAtlasFile(file, owner: session.ownership, to: url) }
        #expect(!FileManager.default.fileExists(atPath: url.path))
        probe.unsupported = true
        do { _ = try await session.atlasLibrary(AtlasQuery()); Issue.record("Expected unsupported Atlas") }
        catch { #expect(error.localizedDescription == "Update Mains on your computer to use Atlas on iPhone.") }
    }
}

@MainActor private final class AtlasProbe {
    var hold: String?
    var held: CheckedContinuation<Void, Never>?
    var corruptChunk = false
    var corruptImage: String?
    var corruptCover: String?
    var corruptPageImage: String?
    var unsupported = false
    func release() { let continuation = held; held = nil; continuation?.resume() }
}
@MainActor private final class AtlasTransport: BackendTransport {
    let base: DemoTransport
    let probe: AtlasProbe
    init(_ backend: DemoBackend, _ probe: AtlasProbe) { base = DemoTransport(backend: backend); self.probe = probe }
    var onEvent: ((String, JSONValue) -> Void)? { get { base.onEvent } set { base.onEvent = newValue } }
    var onDisconnect: ((MainsError) -> Void)? { get { base.onDisconnect } set { base.onDisconnect = newValue } }
    func open(endpoint: URL, token: String) throws { try base.open(endpoint: endpoint, token: token) }
    func close() { base.close() }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        if channel.hasPrefix("atlas:"), probe.unsupported { throw MainsError.server("Channel is not available to paired devices") }
        var value = try await base.perform(channel, args: args, commandId: commandId, timeout: timeout)
        if probe.hold == channel { probe.hold = nil; await withCheckedContinuation { probe.held = $0 } }
        if channel == "atlas:readMobileFile", probe.corruptChunk { var row = value.objectValue; row["version"] = .string("different-file"); value = .object(row) }
        if channel == "atlas:readMobileImage", let field = probe.corruptImage {
            var row = value.objectValue
            if field == "identity" { row["reference"] = .object(["itemId": .string("other-item")]) }
            if field == "size" { row["width"] = .number(129) }
            if field == "bytes" { row["base64"] = .string(String(repeating: "A", count: 174_768)) }
            if field == "mime" { row["mime"] = .string("text/html") }
            value = .object(row)
        }
        if channel == "atlas:readMobilePageCover", let field = probe.corruptCover {
            var row = value.objectValue
            if field == "page" { row["pageId"] = .string("another-page") }
            if field == "cover" { row["coverFileId"] = .string("another-cover") }
            if field == "size" { row["width"] = .number(769) }
            if field == "bytes" { row["base64"] = .string(String(repeating: "A", count: 699_056)) }
            if field == "mime" { row["mime"] = .string("text/html") }
            if field == "version" { row["version"] = .string("not-a-version") }
            value = .object(row)
        }
        if channel == "atlas:readMobilePageImage", let field = probe.corruptPageImage {
            var row = value.objectValue
            if field == "page" { row["pageId"] = .string("another-page") }
            if field == "file" { row["fileId"] = .string("another-file") }
            if field == "pageVersion" { row["pageVersion"] = .number(2) }
            if field == "size" { row["height"] = .number(769) }
            if field == "bytes" { row["base64"] = .string(String(repeating: "A", count: 699_056)) }
            if field == "mime" { row["mime"] = .string("text/html") }
            if field == "version" { row["version"] = .string("not-a-version") }
            value = .object(row)
        }
        return value
    }
}

extension SessionIntegrationTests {
    @Test @MainActor func atlasPagesAndFilesUseTheRealWireWithoutLoadingTranscripts() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        var query = AtlasQuery()
        let first = try await session.atlasLibrary(query)
        #expect(first.items.count == 50 && first.hasNext)
        query.page = 2
        let second = try await session.atlasLibrary(query)
        #expect(second.items.count == 5 && !second.hasNext)
        #expect(Set((first.items + second.items).map(\.id)).count == 55)
        let imageReference = try #require((first.items + second.items).first { $0.kind == "image" }?.file)
        #expect(try await session.readAtlasImage(imageReference).data != nil)
        query.page = 1; query.scope = "favorites"
        #expect(try await session.atlasLibrary(query).items.count == 2)
        let page = try await session.atlasPage("fixture-atlas-page")
        let next = try await session.atlasPage(page.id, offset: try #require(page.nextOffset), version: page.version)
        #expect(page.markdown.hasSuffix("😀") && next.markdown == "İstanbul 🌍")
        let descriptor = try await session.describeAtlasFile(.saved("fixture-atlas-doc"))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try await session.downloadAtlasFile(descriptor, owner: session.ownership, to: url)
        #expect(try Data(contentsOf: url).count == descriptor.byteSize)
        #expect(session.viewingRunID == nil && session.transcript.rows.isEmpty)
    }
}
