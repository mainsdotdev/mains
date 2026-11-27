import Foundation
import Testing
@testable import MainsCore

extension SessionIntegrationTests {
    @Test @MainActor func conversationBlocksSurviveChildActivityAndDetailPagingDoesNotReplaceTheTranscript() async throws {
        let session = BackendSession(storage: MemoryStorage())
        await session.restore(); session.setActive(true)
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
        #expect(main.artifacts.count + main.toolCalls.count == 400)
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
    let request = try transcript.request(runID: "r", direction: "latest")
    #expect(request["profile"] == .string("mobile") && request["conversationWindow"] == .bool(true))
}

@Test func mateHistoryKeepsMessagesQuestionsAndSelectedOutputsWithoutExecutionDetails() throws {
    let date = #"{"$date":"2026-01-01T00:00:00Z"}"#
    let page = try Wire.decoder().decode(HistoryPage.self, from: Data("""
        {"artifacts":[
          {"id":1,"runId":"r","kind":"report","content":"First reply","createdAt":\(date)},
          {"id":2,"runId":"r","kind":"report","content":"Scratch","metadata":{"working":true},"createdAt":\(date)},
          {"id":3,"runId":"r","kind":"report","content":"Selected result","metadata":{"viewed":true,"outputSelected":true},"createdAt":\(date)},
          {"id":4,"runId":"r","kind":"log","content":"Warning","metadata":{"level":"warn"},"createdAt":\(date)},
          {"id":5,"runId":"r","kind":"log","content":"Compacted","metadata":{"level":"warn","source":"context_compaction"},"createdAt":\(date)}
        ],"toolCalls":[
          {"id":1,"toolName":"Edit","status":"done","createdAt":\(date)},
          {"id":2,"toolName":"mcp__mains__AskAssistantQuestion","status":"done","createdAt":\(date)}
        ],"turns":[],"hasOlder":false,"hasNewer":false}
        """.utf8))
    var transcript = Transcript()
    transcript.replace(page)
    let rows = transcript.rows(pending: nil, runID: "r", forMate: true)
    #expect(rows.map(\.id) == ["artifact:1", "artifact:3", "artifact:4", "tool:2"])
    #expect(TranscriptSection.build(rows, foldsResponses: false).allSatisfy { !$0.folded })
    #expect(transcript.rows.contains { $0.id == "tool:1" })
    #expect(transcript.page == page)
}

@Test func mateQuestionCardsReadWrappedAnswersAndKeepUnansweredOptions() throws {
    let date = #"{"$date":"2026-01-01T00:00:00Z"}"#
    let page = try Wire.decoder().decode(HistoryPage.self, from: Data("""
        {"artifacts":[],"toolCalls":[
          {"id":1,"toolName":"mcp__mains__AskAssistantQuestion","status":"done","createdAt":\(date),
           "input":{"question":"When?","options":[{"label":"Today","description":"Quickly"},{"label":"Tomorrow"}]},
           "output":{"contentItems":[{"type":"inputText","text":"{\\"status\\":\\"answered\\",\\"answer\\":\\"Tomorrow\\"}"}]}},
          {"id":2,"toolName":"AskUserQuestion","status":"done","createdAt":\(date),
           "input":{"questions":[{"question":"Where?","options":[{"label":"Tokyo"},{"label":"Paris"}],
           "multiSelect":true},{"question":"Notes?"}]},
           "output":{"structuredContent":{"answers":{"Where?":"Tokyo, Paris","1":"Window seat"}}}},
          {"id":3,"toolName":"AskAssistantQuestion","status":"canceled","createdAt":\(date),
           "input":{"question":"Ready?","options":[{"label":"Yes"},{"label":"No"}]},"output":{"status":"canceled"}},
          {"id":4,"toolName":"AskUserQuestion","status":"done","createdAt":\(date),
           "input":{"question":"Secret?","isSecret":true},"output":{"answer":"private"}}
        ],"turns":[],"hasOlder":false,"hasNewer":false}
        """.utf8))
    let entries = page.toolCalls.flatMap(MateQuestion.read)
    #expect(entries.map(\.text) == ["When?", "Where?", "Notes?", "Ready?", "Secret?"])
    #expect(entries[0].selectedOptions == [1])
    #expect(entries[0].options[0].description == "Quickly")
    #expect(entries[1].selectedOptions == [0, 1])
    #expect(entries[2].answer == ["Window seat"] && entries[2].selectedOptions.isEmpty)
    #expect(entries[3].unanswered == "Unanswered" && entries[3].answer.isEmpty && entries[3].options.count == 2)
    #expect(entries[4].answer.isEmpty)
}

@Test func mateAsyncQuestionUsesThePersistedReplyOnceAndKeepsRepliesAcrossPages() throws {
    let question = #"{"id":5,"runId":"r","kind":"report","content":"","metadata":{"source":"codex_async_questions","questions":[{"title":"When?","options":["Today","Tomorrow"]}]},"createdAt":{"$date":"2026-01-01T00:00:00Z"}}"#
    let reply = #"{"id":6,"runId":"r","kind":"user-prompt","content":"Tomorrow","metadata":{"clientUserMessageId":"codex-async-answer-5","asyncQuestionReply":{"artifactId":5,"answers":["Tomorrow"]}},"createdAt":{"$date":"2026-01-01T00:00:01Z"}}"#
    var transcript = Transcript()
    transcript.replace(try samplePage(artifacts: "[\(question),\(reply)]"))
    let rows = transcript.rows(pending: nil, runID: "r", forMate: true)
    #expect(rows.map(\.id) == ["artifact:5"])
    #expect(rows.first?.mateQuestions.first?.selectedOptions == [1])
    #expect(transcript.rows.map(\.id) == ["artifact:6"])
    transcript.replace(try samplePage(artifacts: "[\(reply)]"))
    #expect(transcript.rows(pending: nil, runID: "r", forMate: true).map(\.id) == ["artifact:6"])
}

@Test func mateWelcomeRestoresTheSavedSetupExchangeInTheFirstConversation() throws {
    let welcome = #"{"id":12,"runId":"r","kind":"report","content":"Ready for your first task.","metadata":{"source":"assistant_welcome","question":{"profileSetup":{"saved":true,"turns":[{"question":"What should I help with?","answer":"Meal planning"}]}}},"createdAt":{"$date":"2026-01-01T00:00:00Z"}}"#
    var transcript = Transcript()
    transcript.replace(try samplePage(artifacts: "[\(welcome)]"))
    let row = try #require(transcript.rows(pending: nil, runID: "r", forMate: true).first)
    #expect(row.text == "Ready for your first task.")
    #expect(row.mateSetupTurns == [.init(question: "What should I help with?", answer: "Meal planning")])
    #expect(transcript.rows.first?.mateSetupTurns.isEmpty == true)

    let pending = PendingMessage(runID: "r", text: "First task", date: .distantPast, status: .sending,
                                 commandID: "first", channel: "assistants:send", payload: .null,
                                 backendID: "backend", owner: 0, previousArtifactID: 0)
    #expect(transcript.rows(pending: pending, runID: "r", forMate: true).map(\.id) == ["artifact:12", "pending:first"])

    let prompt = #"{"id":13,"runId":"r","kind":"user-prompt","content":"First task","createdAt":{"$date":"2026-01-01T00:00:01Z"}}"#
    transcript.replace(try samplePage(artifacts: "[\(welcome),\(prompt)]"), pending: pending)
    #expect(transcript.rows(pending: pending, runID: "r", forMate: true).map(\.id) == ["artifact:12", "pending:first"])
}
