import Foundation
import Testing
@testable import MainsCore

extension SessionIntegrationTests {
    @Test @MainActor func conversationBlocksSurviveChildActivityAndDetailPagingDoesNotReplaceTheTranscript() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        var request = URLRequest(url: URL(string: endpoint + "/test/long-activity")!); request.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: request)
        await session.selectConversation("fixture-run")
        let main = try #require(session.transcript.page), range = try #require(main.activity)
        #expect(main.artifacts.filter { $0.kind == "user-prompt" }.count == 20)
        #expect(session.transcript.rows.contains { $0.text == "Visible prompt 44" })
        #expect(session.transcript.rows.contains { $0.text == "Visible answer 44" })
        #expect(main.artifacts.count + main.toolCalls.count <= 200)
        let following = session.transcript.isFollowing
        var page = try await session.readHistoryActivity(runID: "fixture-run", range: range)
        var seen = Set(page.toolCalls.map(\.id)), count = 0
        while page.hasOlder && count < 10 {
            page = try await session.readHistoryActivity(runID: "fixture-run", range: range, direction: "older", cursor: page.start)
            seen.formUnion(page.toolCalls.map(\.id)); count += 1
        }
        #expect(seen.count == 451)
        #expect(session.transcript.page == main && session.transcript.isFollowing == following)
        while page.hasNewer && count < 20 {
            page = try await session.readHistoryActivity(runID: "fixture-run", range: range, direction: "newer", cursor: page.end)
            count += 1
        }
        #expect(!page.hasNewer && page.toolCalls.last?.id == 30450)
        #expect(session.transcript.page == main)
    }
}

@Test func mobileConversationRequestsKeepHistoryBoundedAndExposeDeferredMessageReaders() throws {
    var transcript = Transcript()
    let page = try samplePage(artifacts: #"[{"id":7,"runId":"r","kind":"report","content":"A bounded preview","metadata":{"mobileContentDeferred":{"chars":20000}},"createdAt":{"$date":"2026-01-01T00:00:00Z"}}]"#)
    transcript.replace(page)
    #expect(transcript.rows.first?.deferredArtifactID == 7)
    #expect(TranscriptSection.build(transcript.rows).first?.responseIsPreview == true)
    let request = try transcript.request(runID: "r", direction: "latest")
    #expect(request["profile"] == .string("mobile") && request["conversationWindow"] == .bool(true))
}
