import Foundation
import Testing
#if canImport(PDFKit)
import PDFKit
#endif
#if canImport(ImageIO)
import ImageIO
#endif
@testable import MainsCore

@Test @MainActor func outputPresenceFollowsEmptyPagesAndRejectsStuckCursors() async throws {
    let file = RunOutput(artifactId: 3, runId: "run", name: "report.pdf", mimeType: "application/pdf", byteSize: 20, version: "v1", previewType: "native")
    var offsets: [Int] = []
    let present = try await RunOutputsPage.containsOutput { offset in
        offsets.append(offset)
        return offset == 0 ? RunOutputsPage(items: [], nextOffset: 100) : RunOutputsPage(items: [file], nextOffset: nil)
    }
    #expect(present && offsets == [0, 100])
    #expect(try await !RunOutputsPage.containsOutput { _ in RunOutputsPage(items: [], nextOffset: nil) })
    await #expect(throws: MainsError.self) {
        try await RunOutputsPage.containsOutput { offset in RunOutputsPage(items: [], nextOffset: offset) }
    }
}

@Test func transcriptKeepsAttachmentReferencesAndBreaksMediaOutOfCollapsedWork() throws {
    let at = Date(timeIntervalSince1970: 100)
    let attachments: JSONValue = .object(["attachments": .array([
        .object(["type": .string("image"), "name": .string("screen.png"), "attachmentId": .string(String(repeating: "b", count: 64))]),
        .object(["type": .string("document"), "name": .string("/old/path/report.pdf"), "attachmentId": .string("/host/file.pdf")]),
    ])])
    let artifacts = [
        Artifact(id: 1, runId: "run", kind: "user-prompt", content: "Look at these", metadata: attachments, createdAt: at),
        Artifact(id: 2, runId: "run", kind: "report", content: "Working", metadata: nil, createdAt: at.addingTimeInterval(1)),
        Artifact(id: 3, runId: "run", kind: "image", content: nil, metadata: .object(["fileName": .string("result.png")]), createdAt: at.addingTimeInterval(2)),
        Artifact(id: 4, runId: "run", kind: "document", content: nil, metadata: .object(["fileName": .string("report.pdf"), "outputSelected": .bool(true)]), createdAt: at.addingTimeInterval(3)),
        Artifact(id: 5, runId: "run", kind: "file", content: nil, metadata: .object(["fileName": .string("working-copy.pdf")]), createdAt: at.addingTimeInterval(4)),
        Artifact(id: 6, runId: "run", kind: "report", content: "Finished", metadata: nil, createdAt: at.addingTimeInterval(5)),
    ]
    var transcript = Transcript()
    transcript.replace(HistoryPage(artifacts: artifacts, toolCalls: [], turns: [], start: nil, end: nil, last: nil, hasOlder: false, hasNewer: false))
    let rows = transcript.rows
    #expect(rows.first?.text == "Look at these")
    #expect(rows.first?.media.count == 2)
    #expect(rows.first?.media.last?.name == "report.pdf")
    #expect(rows.first?.media.last?.available == false) // Host paths never become download requests.
    #expect(!rows.contains { $0.id == "artifact:5" })
    let section = try #require(TranscriptSection.build(rows).last)
    #expect(section.previous.map(\.text) == ["Working"])
    #expect(section.breakout.flatMap(\.media).map(\.name) == ["result.png", "report.pdf"])
}

@Test func toolRowsPreserveWireDetailsDeferredContentAndRealErrors() throws {
    let raw = #"{"id":42,"toolName":"Bash","status":"error","input":{"command":"npm test"},"output":{"type":"mains/deferred-tool-output","preview":"Failure details","chars":40000},"error":"Command failed with exit code 1","createdAt":{"$date":"2026-11-10T12:00:00Z"},"startedAt":{"$undefined":true},"endedAt":null,"parentToolCallId":null}"#
    let call = try Wire.decoder().decode(ToolCall.self, from: Data(raw.utf8))
    let view = ToolPresentation(call)
    #expect(view.verb == "Ran")
    #expect(view.detail == "npm test")
    #expect(view.failed && view.deferredOutput)
    #expect(view.body == "Failure details")
    #expect(call.error == "Command failed with exit code 1")
    #expect(call.startedAt == nil)
    let roundTrip = try Wire.decoder().decode(ToolCall.self, from: Wire.encoder().encode(call))
    #expect(roundTrip == call)
}

@Test func toolDiffAndSearchSummariesUseActualPayloads() throws {
    func call(_ name: String, _ input: JSONValue, _ output: JSONValue) throws -> ToolCall {
        try JSONValue.object(["id": .number(1), "toolName": .string(name), "status": .string("done"), "createdAt": .number(1000), "input": input, "output": output]).decode(ToolCall.self)
    }
    let edit = ToolPresentation(try call("apply_patch", .string("*** Begin Patch\n*** Update File: /app/page.tsx\n@@\n-old\n+new\n+extra\n*** End Patch"), .null))
    #expect(edit.detail == "page.tsx")
    #expect(edit.added == 2 && edit.removed == 1)
    let replace = ToolPresentation(try call("Edit", .object(["file_path": .string("page.tsx"), "old_string": .string("old"), "new_string": .string("new")]), .null))
    #expect(replace.added == 1 && replace.removed == 1)
    let search = ToolPresentation(try call("Glob", .object(["pattern": .string("*.swift")]), .object(["filenames": .array([.string("a.swift"), .string("b.swift")])])) )
    #expect(search.detail == "*.swift" && search.stat == "2 files")
    let unknown = ToolPresentation(try call("mcp__linear__list_issues", .object(["query": .string("native")]), .string("{\"content\":[{\"text\":\"Issue details\"}]}")))
    #expect(unknown.name.contains("Linear"))
    #expect(unknown.body == "Issue details")
}

extension SessionIntegrationTests {
    @Test @MainActor func conversationMediaUsesScopedImageAndChunkedDocumentReaders() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test-media&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        await session.selectConversation("fixture-run")
        let prompt = try #require(session.transcript.rows.first { $0.kind == .prompt })
        #expect(prompt.media.count == 2)
        let photo = try #require(prompt.media.first { $0.image })
        let image = try await session.readImage(photo)
        #expect(image.mime == "image/png" && image.data?.isEmpty == false)
        #if canImport(ImageIO)
        let imageData = try #require(image.data)
        let imageSource = try #require(CGImageSourceCreateWithData(imageData as CFData, nil))
        #expect(CGImageSourceCreateImageAtIndex(imageSource, 0, nil) != nil)
        #endif
        let pdf = try #require(prompt.media.first { !$0.image })
        let file = try await session.describeAttachment(pdf)
        let bytes = try await session.downloadAttachment(file)
        #expect(String(data: bytes.prefix(8), encoding: .utf8)?.hasPrefix("%PDF-") == true)
        #expect(bytes.count == file.byteSize && bytes.count > 128 * 1024)
        #if canImport(PDFKit)
        #expect(PDFDocument(data: bytes)?.pageCount == 1)
        #endif
        let agentImage = try #require(session.transcript.rows.flatMap(\.media).first { $0.source == .artifact(504) })
        #expect(try await session.readImage(agentImage).data?.isEmpty == false)
        let output = try #require(try await session.listOutputs("fixture-run", artifactID: 505).items.first)
        #expect(try await session.downloadOutput(output) == bytes)
        let toolText = try await session.readContent(artifactID: 7, source: "tool-output")
        #expect(toolText["text"].string == "Full tool output")
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data)
        let chunks = calls.filter { $0["channel"].string == "runArtifacts:readAttachmentChunk" }
        #expect(chunks.count > 1)
        #expect(chunks.allSatisfy { $0["args"].array.first?["runId"].string == "fixture-run" })
        #expect(chunks.allSatisfy { $0["args"].array.first?["path"] == .null })
    }
}
