import Foundation
import Testing
@testable import MainsCore

extension SessionIntegrationTests {
    @Test @MainActor func conversationSettingsAreDurableScopedAndUseOriginalReceipts() async throws {
        let storage = MemoryStorage(), session: BackendSession
        session = BackendSession(storage: storage)
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test-design&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        await session.selectConversation("fixture-run")
        let beforeHome = session.composerSettings
        #expect(session.settings(forRunID: "fixture-run")?.effort(provider: "codex") == "high")
        #expect(!String(data: try Wire.encoder().encode(storage.snapshot), encoding: .utf8)!.contains("fixture-must-not-cache"))
        var settings = try #require(session.settings(forRunID: "fixture-run"))
        settings.model = "fixture-deep"; settings.setEffort("xhigh", provider: "codex")
        settings.setPermission("read-only", provider: "codex")
        func observations() async throws -> [JSONValue] {
            let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
            return try JSONDecoder().decode([JSONValue].self, from: data)
        }
        let snapshots = try await observations().filter { $0["channel"].string == "runs:getAll" }.count
        var request = URLRequest(url: URL(string: endpoint + "/test/hold-snapshot")!)
        request.httpMethod = "POST"; _ = try await URLSession.shared.data(for: request)
        let staleRefresh = Task { await session.refresh() }
        let deadline = ContinuousClock.now + .seconds(3)
        while try await observations().filter({ $0["channel"].string == "runs:getAll" }).count == snapshots && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        try await session.updateConversationSettings(settings, runID: "fixture-run")
        await staleRefresh.value
        #expect(session.settings(forRunID: "fixture-run") == settings)
        await session.refresh()
        #expect(session.settings(forRunID: "fixture-run") == settings)
        #expect(session.composerSettings == beforeHome)
        session.grantConsent(providerID: "codex", backendID: "ios-fixture")
        _ = try await session.send("Continue with saved settings", runID: "fixture-run", attachments: [PromptAttachment(name: "context.txt", type: "document", mimeType: "text/plain", bytes: Data("Context".utf8))])
        try await eventually { session.transcript.rows.contains { $0.text == "Native reply delivered." } }

        var refused = settings; refused.model = "fixture-save-refused"
        await #expect(throws: MainsError.self) { try await session.updateConversationSettings(refused, runID: "fixture-run") }
        #expect(session.settings(forRunID: "fixture-run") == settings)
        #expect(session.uncertainConversationSettings.isEmpty)
        var unknown = settings; unknown.model = "fixture-save-unknown"
        await #expect(throws: MainsError.self) { try await session.updateConversationSettings(unknown, runID: "fixture-run") }
        #expect(session.uncertainConversationSettings.contains("fixture-run"))
        await #expect(throws: MainsError.self) { try await session.send("Must not send", runID: "fixture-run") }
        await #expect(throws: MainsError.self) { try await session.updateConversationSettings(settings, runID: "fixture-run") }
        try await session.checkConversationSettings("fixture-run")
        #expect(session.uncertainConversationSettings.isEmpty)
        #expect(session.settings(forRunID: "fixture-run") == unknown)

        let outputs = try await session.listOutputs("fixture-run")
        let output = try #require(outputs.items.first)
        let first = try await session.readOutput(output, offset: 0)
        #expect(Data(base64Encoded: first.base64)?.count == 128 * 1024)
        let next = try #require(first.nextOffset)
        let last = try await session.readOutput(output, offset: next)
        #expect(last.nextOffset == nil && last.version == output.version)
        #expect(next + (Data(base64Encoded: last.base64)?.count ?? 0) == output.byteSize)
        let downloaded = try await session.downloadOutput(output)
        #expect(downloaded.count == output.byteSize)
        #expect(String(decoding: downloaded.prefix(18), as: UTF8.self).hasPrefix("# Article summary"))

        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data)
        let message = try #require(calls.first { $0["channel"].string == "runs:continue" }?["args"].array.first)
        #expect(message["conversationSettings"] == (try .encode(settings)))
        #expect(message["attachments"].array.first?["name"].string == "context.txt")
        let checks = calls.filter { $0["channel"].string == "runs:updateConversationSettings" && $0["args"].array.last?["model"].string == "fixture-save-unknown" }
        #expect(checks.count == 2 && Set(checks.compactMap { $0["commandId"].string }).count == 1)
        try session.forget()
    }
}

@Test func nativeMarkdownKeepsListsLinksAndPartialCodeDistinct() {
    let blocks = MessageBlock.parse("## Summary\n\nA **bold** [source](https://example.com).\n\n- First item\n12. Ordered item\n\n```swift\nlet value = 12\n")
    #expect(blocks == [.heading(2, "Summary"), .paragraph("A **bold** [source](https://example.com)."), .list("•", "First item", 0), .list("12.", "Ordered item", 0), .code("swift", "let value = 12\n")])
}

@Test func turnDetailsFoldIntermediateWorkAndKeepErrorsVisible() {
    let at = Date()
    func row(_ id: String, _ kind: TranscriptRow.Kind) -> TranscriptRow {
        TranscriptRow(id: id, kind: kind, text: id, date: at, live: false, deferredArtifactID: nil)
    }
    let sections = TranscriptSection.build([row("prompt", .prompt), row("first", .response), row("tool", .tool), row("error", .notice), row("answer", .response)])
    #expect(sections.count == 2)
    #expect(sections.last?.label == "1 message · 1 tool call")
    #expect(sections.last?.breakout.map(\.id) == ["error"])
    #expect(sections.last?.last.map(\.id) == ["answer"])
    #expect(sections.last?.displayedRows(expanded: true).map(\.id) == ["first", "tool", "error", "answer"])
    #expect(sections.last?.displayedRows(expanded: false).map(\.id) == ["error", "answer"])
}
