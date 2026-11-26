import Foundation
import Testing
#if canImport(ImageIO)
import ImageIO
#endif
@testable import MainsCore

@Suite struct AtlasTests {
    @Test func libraryDaysUseTheLocalCalendarAndPreserveRowsWithUnknownDates() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "Europe/Istanbul"))
        let library = try datedLibrary([
            "2026-11-20T21:30:00.000Z", "2026-11-20T20:59:59Z",
            "2026-11-21T04:00:00+03:00", "invalid", "2025-11-21T12:00:00Z",
        ])
        let sections = library.daySections(calendar: calendar)
        #expect(sections.map { $0.items.map(\.key) } == [["0", "2"], ["1"], ["4"], ["3"]])
        let newest = try #require(sections.first?.day)
        #expect(calendar.component(.day, from: newest) == 21 && calendar.component(.hour, from: newest) == 0)
        #expect(sections.last?.day == nil)
        #expect(try datedLibrary([]).daySections(calendar: calendar).isEmpty)
    }

    @Test func libraryDaysKeepBothRepeatedHoursInTheSameDayAtTheDaylightSavingBoundary() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/New_York"))
        let library = try datedLibrary([
            "2026-11-01T05:30:00Z", "2026-11-01T06:30:00.000Z", "2026-11-01T03:59:59Z",
            "2026-11-02T04:59:59Z", "2026-11-02T05:00:00Z",
        ])
        let sections = library.daySections(calendar: calendar)
        #expect(sections.map { $0.items.map(\.key) } == [["4"], ["0", "1", "3"], ["2"]])
        let dates = sections.compactMap(\.day)
        #expect(dates.count == 3 && dates[0].timeIntervalSince(dates[1]) == 25 * 3600)
    }

    private func datedLibrary(_ dates: [String]) throws -> AtlasLibraryPage {
        try JSONValue.object(["items": .array(dates.enumerated().map { index, date in
            .object(["key": .string(String(index)), "kind": .string("page"), "title": .string("Item \(index)"),
                     "date": .string(date), "isFavorite": .bool(false), "origin": .string("saved")])
        }), "page": .number(1), "hasNext": .bool(false)]).decode(AtlasLibraryPage.self)
    }

    @Test(arguments: ["atlas:mobileTags", "atlas:readMobileTags", "atlas:readMobileImage", "atlas:readMobilePageCover", "atlas:readMobilePageImage"]) @MainActor func atlasReadsRetiredByReconnectionCannotReturnToTheNewConnection(channel: String) async throws {
        let backend = try DemoBackend(), probe = AtlasProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasTransport(backend, probe) })
        await session.restore(); session.setActive(true); try session.startDemo()
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
        await session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let space = session.selectedSpaceID
        let page = try await session.atlasPage("demo-atlas-page")
        let coverID = try #require(page.coverFileId)
        let cover = try await session.readAtlasPageCover(page.id, coverFileID: coverID)
        let coverData = try #require(cover.data)
        #expect(cover.width == 768 && cover.height == 512 && coverData.count <= 64 * 1024)
        let inline = try await session.readAtlasPageImage(page.id, fileID: "demo-atlas-image", version: page.version)
        #expect(inline.data == coverData && inline.width == 768 && inline.height == 512
                && inline.pageVersion == page.version && page.inlineImageIDs == ["demo-atlas-image"])
        let file = try await session.describeAtlasFile(.saved(coverID))
        #expect(file.name == "clouds.jpg" && file.byteSize <= 256 * 1024 && file.version == cover.version)
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("demo-atlas-clouds-" + UUID().uuidString + ".jpg")
        defer { try? FileManager.default.removeItem(at: temporary) }
        try await session.downloadAtlasFile(file, owner: session.ownership, to: temporary)
        #if canImport(ImageIO)
        let originalSource = try #require(CGImageSourceCreateWithURL(temporary as CFURL, nil))
        let original = try #require(CGImageSourceCopyPropertiesAtIndex(originalSource, 0, nil) as? [CFString: Any])
        #expect(original[kCGImagePropertyPixelWidth] as? Int == 1536 && original[kCGImagePropertyPixelHeight] as? Int == 1024)
        let coverSource = try #require(CGImageSourceCreateWithData(coverData as CFData, nil))
        let coverProperties = try #require(CGImageSourceCopyPropertiesAtIndex(coverSource, 0, nil) as? [CFString: Any])
        #expect(coverProperties[kCGImagePropertyPixelWidth] as? Int == cover.width && coverProperties[kCGImagePropertyPixelHeight] as? Int == cover.height)
        #endif
        await #expect(throws: MainsError.self) { try await session.readAtlasPageImage(page.id, fileID: "wrong-image", version: page.version) }
        await #expect(throws: MainsError.self) { try await session.readAtlasPageCover(page.id, coverFileID: "wrong-cover") }
        #expect(session.viewingRunID == nil && session.transcript.rows.isEmpty && session.selectedSpaceID == space && storage.snapshot == nil)
    }

    @Test func pagesFromOlderComputersRemainReadableWithoutCoverMetadata() throws {
        let value: JSONValue = .object(["id": .string("old-page"), "title": .string("Notes"), "version": .number(1),
            "icon": .null, "markdown": .string("Content"), "offset": .number(0), "nextOffset": .null, "sourceRunId": .null])
        let page = try value.decode(AtlasPageContent.self)
        #expect(page.coverFileId == nil && page.icon == nil && page.title == "Notes" && page.organization == nil)
    }

    @Test @MainActor func pageActionsExportTheFullMarkdownAndOrganizeTheSameSavedPage() async throws {
        let storage = MemoryStorage(), backend = try DemoBackend()
        let session = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
        await session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let page = try await session.atlasPage("demo-atlas-page")
        let project = try #require(session.collections.first?.id)
        #expect(page.organization != nil && page.organizationEntry.savedIdentity == page.id)
        _ = try await session.moveAtlasItem(page.organizationEntry, to: nil, owner: session.ownership)
        #expect(try await session.atlasPage(page.id).organization?.collectionId == nil)
        _ = try await session.moveAtlasItem(page.organizationEntry, to: project, owner: session.ownership)
        let moved = try await session.atlasPage(page.id)
        #expect(moved.organizationEntry.savedProjectID == project)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".md")
        defer { try? FileManager.default.removeItem(at: url) }
        try await session.exportAtlasPageMarkdown(moved, owner: session.ownership, to: url)
        #expect(try String(contentsOf: url, encoding: .utf8) == moved.markdown)
        #expect(page.exportFileName == "Explore Atlas.md" && session.viewingRunID == nil && storage.snapshot == nil)
        _ = try await session.trashAtlasItem(moved.organizationEntry, owner: session.ownership)
        await #expect(throws: MainsError.self) { try await session.atlasPage(page.id) }
        #expect(try await session.atlasTrash().items.contains { $0.id == page.id })
    }

    @Test @MainActor func markdownExportJoinsScalarSafePartsWithoutAddingOrDroppingContent() async throws {
        let first = String(repeating: "x", count: 16_383) + "😀", last = "İstanbul 🌍\n\n[File](atlas-file://sample)"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        var offsets: [Int] = []
        try await AtlasPageMarkdownExport.save(id: "page", version: 3, to: url, validate: {}) { offset in
            offsets.append(offset)
            return AtlasPageContent(id: "page", title: "Notes", icon: nil, version: 3, coverFileId: nil,
                markdown: offset == 0 ? first : last, offset: offset, nextOffset: offset == 0 ? 16_384 : nil, sourceRunId: nil)
        }
        let exported = try String(contentsOf: url, encoding: .utf8)
        #expect(offsets == [0, 16_384] && exported == first + last)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    }

    @Test(arguments: ["version", "identity", "offset", "cursor", "owner", "cancel"]) @MainActor
    func invalidOrRetiredMarkdownExportsRemovePartialFiles(fault: String) async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        var current = true
        let task = Task {
            try await AtlasPageMarkdownExport.save(id: "page", version: 1, to: url, validate: {
                if !current { throw MainsError.changedBackend }
            }) { offset in
                if offset > 0, fault == "owner" { current = false }
                if offset > 0, fault == "cancel" { withUnsafeCurrentTask { $0?.cancel() } }
                return AtlasPageContent(id: offset > 0 && fault == "identity" ? "foreign" : "page", title: "Notes", icon: nil,
                    version: offset > 0 && fault == "version" ? 2 : 1, coverFileId: nil, markdown: "x",
                    offset: offset > 0 && fault == "offset" ? 0 : offset,
                    nextOffset: offset == 0 ? 1 : fault == "cursor" ? offset : nil, sourceRunId: nil)
            }
        }
        await #expect(throws: (any Error).self) { try await task.value }
        #expect(!FileManager.default.fileExists(atPath: url.path))
    }

    @Test(arguments: ["bytes", "parts", "partLength"]) @MainActor func markdownExportsEnforceReadAndByteBounds(fault: String) async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        var reads = 0
        await #expect(throws: MainsError.self) {
            try await AtlasPageMarkdownExport.save(id: "page", version: 1, to: url, validate: {}) { offset in
                reads += 1
                let text = fault == "parts" ? "x" : String(repeating: fault == "bytes" ? "😀" : "x", count: fault == "bytes" ? 16_384 : 16_385)
                return AtlasPageContent(id: "page", title: "Notes", icon: nil, version: 1, coverFileId: nil,
                    markdown: text, offset: offset, nextOffset: offset + text.unicodeScalars.count, sourceRunId: nil)
            }
        }
        #expect(reads <= 128 && !FileManager.default.fileExists(atPath: url.path))
    }

    @Test @MainActor func markdownExportNeverOverwritesAnExistingFile() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("Keep me".utf8).write(to: url)
        var reads = 0
        await #expect(throws: (any Error).self) {
            try await AtlasPageMarkdownExport.save(id: "page", version: 1, to: url, validate: {}) { offset in
                reads += 1
                return AtlasPageContent(id: "page", title: "Notes", icon: nil, version: 1, coverFileId: nil,
                    markdown: "New content", offset: offset, nextOffset: nil, sourceRunId: nil)
            }
        }
        let original = try String(contentsOf: url, encoding: .utf8)
        #expect(reads == 0 && original == "Keep me")
    }

    @Test(arguments: ["page", "cover", "size", "bytes", "mime", "version"]) @MainActor func malformedPageCoversAreRejected(field: String) async throws {
        let backend = try DemoBackend(), probe = AtlasProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasTransport(backend, probe) })
        await session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.corruptCover = field
        await #expect(throws: MainsError.self) { try await session.readAtlasPageCover("demo-atlas-page", coverFileID: "demo-atlas-image") }
    }

    @Test(arguments: ["page", "file", "pageVersion", "size", "bytes", "mime", "version"]) @MainActor func malformedEmbeddedPageImagesAreRejected(field: String) async throws {
        let backend = try DemoBackend(), probe = AtlasProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasTransport(backend, probe) })
        await session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.corruptPageImage = field
        await #expect(throws: MainsError.self) { try await session.readAtlasPageImage("demo-atlas-page", fileID: "demo-atlas-image", version: 1) }
    }

    @Test @MainActor func atlasThumbnailsStayBoundedAndUsePreparedDemoBytesWithoutChangingTheTranscript() async throws {
        let storage = MemoryStorage(), backend = try DemoBackend()
        let session = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
        await session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        let rows = try await session.atlasLibrary(AtlasQuery()).items
        #expect(rows.first { $0.kind == "page" }?.preview?.contains("Pages") == true)
        #expect(rows.first { $0.key == "demo-atlas-doc" }?.mimeType == "application/pdf")
        let reference = try #require(rows.first { $0.kind == "image" }?.file)
        let thumbnail = try await session.readAtlasImage(reference)
        #expect(thumbnail.width == 128 && thumbnail.height == 86)
        #expect(try #require(thumbnail.data).count <= 131_072)
        await #expect(throws: MainsError.self) { try await session.readAtlasImage(.saved("demo-atlas-doc")) }
        #expect(session.viewingRunID == nil && session.transcript.rows.isEmpty && storage.snapshot == nil)
    }

    @Test(arguments: ["identity", "size", "bytes", "mime"]) @MainActor func malformedThumbnailsAreRejected(field: String) async throws {
        let backend = try DemoBackend(), probe = AtlasProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasTransport(backend, probe) })
        await session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        probe.corruptImage = field
        await #expect(throws: MainsError.self) { try await session.readAtlasImage(.saved("demo-atlas-image")) }
    }

    @Test @MainActor func demoLibraryFiltersAndReadsWithoutChangingTheConversationOrDiskSnapshot() async throws {
        let storage = MemoryStorage()
        let backend = try DemoBackend()
        let isolated = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
        await isolated.restore(); isolated.setActive(true); try isolated.startDemo()
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
        for value in ["/atlas/page-123", "#/atlas/page-123", "http://localhost:5173/#/atlas/page-123",
                      "http://127.0.0.1:5173/index.html#/atlas/page-123", "http://[::1]:5173/#/atlas/page-123"] {
            #expect(AtlasLink(URL(string: value)!) == .page("page-123"))
        }
        for value in ["file:///private/notes.md", "file:///tmp/index.html#/atlas/page-123",
                      "https://example.com/atlas/page-123", "https://example.com/#/atlas/page-123",
                      "http://localhost:5173/docs#/atlas/page-123", "http://user@localhost:5173/#/atlas/page-123",
                      "atlas-file://image/other", "/atlas/../secret", "/atlas/page%2F123", "atlas-file://../private"] {
            #expect(AtlasLink(URL(string: value)!) == nil)
        }
    }

    @Test @MainActor func aReadRetiredByReconnectionCannotReturnOrTouchTheNewSession() async throws {
        let backend = try DemoBackend(), probe = AtlasProbe()
        let session = BackendSession(storage: MemoryStorage(), makeTransport: { _ in AtlasTransport(backend, probe) })
        await session.restore(); session.setActive(true); try session.startDemo()
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
        await session.restore(); session.setActive(true); try session.startDemo()
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
        await session.restore(); session.setActive(true)
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
