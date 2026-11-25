import Foundation
import Testing
@testable import MainsCore

@Test func localFileReferencesAreDataAndResolveRelativeMarkdownWithoutOpeningHostURLs() {
    #expect(RunFileReference("file:///Users/me/report%20one.pdf#L12")?.name == "report one.pdf")
    #expect(RunFileReference("C:\\work\\notes.md:12:3")?.path == "C:/work/notes.md")
    #expect(RunFileReference("../notes.md", relativeTo: "docs/report.md")?.path == "notes.md")
    #expect(RunFileReference("./café.MD")?.isMarkdown == true)
    for value in ["https://example.com/a.pdf", "javascript:alert(1)", "data:text/html,hello", "#heading", "//remote/a.pdf", "file://remote/a.pdf", "../../secrets.md", "a%00.pdf", "bad%ZZ.pdf"] {
        #expect(RunFileReference(value) == nil, "Rejected \(value)")
    }
}

private func chunk(offset: Int, size: Int, version: String = "v1") -> RunOutputChunk {
    let end = min(size, offset + RunFilePolicy.chunkBytes)
    return RunOutputChunk(base64: Data(repeating: 65, count: end - offset).base64EncodedString(), offset: offset,
                          nextOffset: end < size ? end : nil, byteSize: size, version: version)
}

@Test @MainActor func aHundredMegabyteDownloadStreamsToDiskAndRejectsAnythingLargerBeforeReading() async throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: url) }
    var largest = 0, reads = 0, progress = 0.0
    try await RunFileTransfer.save(to: url) { write in
        try await RunFileTransfer.receive(byteSize: RunFilePolicy.maxBytes, version: "v1", validate: {}, read: {
            reads += 1; return chunk(offset: $0, size: RunFilePolicy.maxBytes)
        }, write: { largest = max(largest, $0.count); try write($0) }, progress: { progress = $0 })
    }
    #expect(try url.resourceValues(forKeys: [.fileSizeKey]).fileSize == RunFilePolicy.maxBytes)
    #expect(largest == RunFilePolicy.chunkBytes && reads == 800 && progress == 1)
    await #expect(throws: MainsError.self) {
        try await RunFileTransfer.receive(byteSize: RunFilePolicy.maxBytes + 1, version: "v1", validate: {}, read: { _ in
            Issue.record("An oversized file must not issue a read"); return chunk(offset: 0, size: 0)
        }, write: { _ in }, progress: { _ in })
    }
}

@Test @MainActor func corruptOrRetiredDownloadsRemovePartialFilesAndDoNotOverwriteExistingFiles() async throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: url) }
    await #expect(throws: MainsError.invalidReply) {
        try await RunFileTransfer.save(to: url) { write in
            try await RunFileTransfer.receive(byteSize: RunFilePolicy.chunkBytes * 2, version: "v1", validate: {}, read: {
                chunk(offset: $0, size: RunFilePolicy.chunkBytes * 2, version: $0 == 0 ? "v1" : "changed")
            }, write: write, progress: { _ in })
        }
    }
    #expect(!FileManager.default.fileExists(atPath: url.path))
    var owned = true
    await #expect(throws: MainsError.changedBackend) {
        try await RunFileTransfer.save(to: url) { write in
            try await RunFileTransfer.receive(byteSize: RunFilePolicy.chunkBytes * 2, version: "v1", validate: {
                guard owned else { throw MainsError.changedBackend }
            }, read: { chunk(offset: $0, size: RunFilePolicy.chunkBytes * 2) }, write: { try write($0); owned = false }, progress: { _ in })
        }
    }
    #expect(!FileManager.default.fileExists(atPath: url.path))
    try Data("Keep".utf8).write(to: url)
    await #expect(throws: (any Error).self) { try await RunFileTransfer.save(to: url) { _ in Issue.record("Must not overwrite") } }
    #expect(try Data(contentsOf: url) == Data("Keep".utf8))
}

@Test func largeTextPagesPreserveUTF8BoundariesAndSupportBackNavigation() throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: url) }
    let source = String(repeating: "x", count: RunFilePolicy.textPageBytes - 1) + "👋 café é\n" + String(repeating: "y", count: RunFilePolicy.textPageBytes)
    try Data(source.utf8).write(to: url)
    var offset = 0, restored = "", starts: [Int] = []
    while true {
        starts.append(offset)
        let page = try LocalTextFilePage.read(url, offset: offset)
        restored += page.text
        guard let next = page.nextOffset else { break }
        #expect(next > offset && next - offset <= RunFilePolicy.textPageBytes)
        offset = next
    }
    #expect(restored == source && starts.count == 3)
    #expect(try LocalTextFilePage.read(url, offset: starts[0]).nextOffset == starts[1])
}

@Test @MainActor func cancellingADownloadWhileItsChunkIsInFlightRemovesThePartialFile() async throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: url) }
    var release: CheckedContinuation<Void, Never>?
    let task = Task {
        try await RunFileTransfer.save(to: url) { write in
            try await RunFileTransfer.receive(byteSize: RunFilePolicy.chunkBytes * 2, version: "v1", validate: {}, read: { offset in
                if offset > 0 { await withCheckedContinuation { release = $0 } }
                return chunk(offset: offset, size: RunFilePolicy.chunkBytes * 2)
            }, write: write, progress: { _ in })
        }
    }
    try await eventually { release != nil }
    #expect(try url.resourceValues(forKeys: [.fileSizeKey]).fileSize == RunFilePolicy.chunkBytes)
    task.cancel(); release?.resume()
    await #expect(throws: CancellationError.self) { try await task.value }
    #expect(!FileManager.default.fileExists(atPath: url.path))
}

extension SessionIntegrationTests {
    @Test @MainActor func fileLinksLargeDownloadsAndUnknownFormatsUseOnlyRunScopedReaders() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        func fixture(_ mode: String) async throws {
            var request = URLRequest(url: URL(string: endpoint + "/test/files")!)
            request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: ["mode": mode])
            _ = try await URLSession.shared.data(for: request)
            await session.refresh()
        }
        try await fixture("chat")
        await session.selectConversation("fixture-run")
        guard case .output(let pdf) = try await session.resolveFileReference("file:///computer/report.pdf#L20", runID: "fixture-run") else { Issue.record("Expected a selected output"); return }
        #expect(pdf.artifactId == 703)
        guard case .markdown(let notes) = try await session.resolveFileReference("notes.md", runID: "fixture-run", relativeTo: "docs/start.md") else { Issue.record("Expected scoped Markdown fallback"); return }
        #expect(notes.relativePath == "docs/notes.md" && MathMarkdown.prepare(notes.content) != nil)
        guard case .output(let zip) = try await session.resolveFileReference("archive.zip", runID: "fixture-run") else { Issue.record("Expected an exportable ZIP"); return }
        #expect(zip.previewType == "unsupported" && zip.byteSize == RunFilePolicy.maxBytes)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let zipURL = directory.appendingPathComponent("archive.zip")
        try await session.downloadOutput(zip, to: zipURL)
        #expect(try zipURL.resourceValues(forKeys: [.fileSizeKey]).fileSize == RunFilePolicy.maxBytes)
        let handle = try FileHandle(forReadingFrom: zipURL)
        #expect(try handle.read(upToCount: 4) == Data([80, 75, 3, 4])); try handle.close()
        guard case .output(let largeText) = try await session.resolveFileReference("large.txt", runID: "fixture-run") else { Issue.record("Expected large text"); return }
        let textURL = directory.appendingPathComponent("large.txt")
        try await session.downloadOutput(largeText, to: textURL)
        let text = try LocalTextFilePage.read(textURL, offset: 0)
        #expect(text.text.utf8.count == RunFilePolicy.textPageBytes && text.nextOffset != nil)
        let attachment = TranscriptMedia(id: "pdf", runID: "fixture-run", name: "report.pdf", image: false, source: .attachment(String(repeating: "c", count: 64)))
        let descriptor = try await session.describeAttachment(attachment)
        try await session.downloadAttachment(descriptor, to: directory.appendingPathComponent("report.pdf"))
        try await fixture("developer")
        await #expect(throws: MainsError.self) { try await session.resolveFileReference("docs/notes.md", runID: "fixture-run") }
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data)
        #expect(calls.filter { $0["channel"].string == "runs:readTextFile" }.count == 1)
        #expect(!calls.contains { $0["channel"].string?.hasPrefix("fileExplorer:") == true })
        #expect(calls.filter { $0["channel"].string == "runs:readOutputFile" }.allSatisfy { $0["args"].array.first?["runId"].string == "fixture-run" && $0["args"].array.first?["path"] == .null })
    }
}
