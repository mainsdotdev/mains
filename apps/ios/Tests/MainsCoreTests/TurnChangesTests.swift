import Foundation
import Testing
@testable import MainsCore

@Suite(.serialized) struct TurnChangesTests {
    @MainActor private func page(_ patch: String, path: String, oldPath: String? = nil, cursor: FileDiffCursor? = nil, chunk: Int = 43) async throws -> FileDiffPage {
        let scalars = Array(patch.unicodeScalars)
        return try await TurnFileDiff.read(path: path, oldPath: oldPath, cursor: cursor) { offset in
            let end = min(scalars.count, offset + chunk)
            return HistoryContentPage(text: String(String.UnicodeScalarView(scalars[offset..<end])), offset: offset,
                                      nextOffset: end < scalars.count ? end : nil, totalChars: scalars.count)
        }
    }

    @Test @MainActor func unicodeOffsetsHunksAndExactFileBoundaries() async throws {
        let patch = #"""
        diff --git a/other.swift b/other.swift
        @@ -1 +1 @@
        -skip
        +ignored 👋
        diff --git "a/caf\303\251 file.swift" "b/caf\303\251 file.swift"
        --- a/ignored-header
        +++ b/ignored-header
        @@ -2,2 +2,3 @@
         let café = "👩🏽‍💻"
        -old
        +new é
        +extra
        @@ -20 +21 @@
        -last
        +final
        diff --git a/later.swift b/later.swift
        @@ -1 +1 @@
        -must
        +not leak
        """#.replacingOccurrences(of: "\n", with: "\r\n")
        let result = try await page(patch, path: "café file.swift", chunk: 7)
        #expect(result.found && !result.binary && result.next == nil && result.lines.count == 6)
        #expect(result.lines.map(\.text) == ["let café = \"👩🏽‍💻\"", "old", "new é", "extra", "last", "final"])
        #expect(result.lines.map(\.newNo) == [2, nil, 3, 4, nil, 21])
        #expect(result.lines[4].oldNo == 20 && result.lines[4].hunkStart)
        let missing = try await page(patch, path: "not-found.swift")
        #expect(!missing.found && missing.lines.isEmpty)
    }

    @Test @MainActor func pagesRetainNumberingAndNoEarlierOrLaterFileContents() async throws {
        let first = try await page(DemoTurnChanges.patch, path: "Docs/Review.md", chunk: 8192)
        #expect(first.found && first.lines.count == 160 && first.lines.first?.newNo == 1 && first.lines.last?.newNo == 160)
        let cursor = try #require(first.next)
        let next = try await page(DemoTurnChanges.patch, path: "Docs/Review.md", cursor: cursor, chunk: 8192)
        #expect(next.lines.count == 45 && next.lines.first?.newNo == 161 && next.lines.last?.newNo == 205 && next.next == nil)
        let previous = try await page(DemoTurnChanges.patch, path: "Docs/Review.md", chunk: 8192)
        #expect(previous.lines == first.lines && previous.next == cursor)
        let rename = try await page(DemoTurnChanges.patch, path: "Docs/guide.md", oldPath: "Docs/notes.md")
        #expect(rename.found && rename.lines.isEmpty && !rename.binary)
        let binary = try await page(DemoTurnChanges.patch, path: "Assets/sample.png")
        #expect(binary.found && binary.binary && binary.lines.isEmpty)
    }

    @Test @MainActor func pathMatchingIsByteExactAndLeadingCombiningMarksAreNotDiffPrefixes() async throws {
        let composed = "café.swift", decomposed = "cafe\u{301}.swift"
        let patch = "diff --git a/\(decomposed) b/\(decomposed)\n@@ -1 +1 @@\n-wrong file\n+must not select\n" +
            "diff --git a/\(composed) b/\(composed)\n@@ -1 +1 @@\n-old\n+\u{301}keep the leading scalar\n"
        let result = try await page(patch, path: composed, chunk: 11)
        #expect(result.lines.count == 2)
        #expect(result.lines.last?.text.unicodeScalars.first == "\u{301}")
        #expect(result.lines.last?.text == "\u{301}keep the leading scalar")
        let deleted = try await page("diff --git a/a b/a\n@@ -1,2 +0,0 @@\n-old\n-lines", path: "a")
        #expect(deleted.lines.map(\.oldNo) == [1, 2] && deleted.lines.allSatisfy { $0.newNo == nil })
    }

    @Test @MainActor func veryLongLinesAndSkippedBinaryDataStayBounded() async throws {
        let huge = String(repeating: "👋", count: 90_000)
        let patch = "diff --git a/large.bin b/large.bin\nGIT binary patch\n" + huge + "\n" +
            "diff --git a/a.txt b/a.txt\n@@ -0,0 +1,3 @@\n+" + huge + "\n+" + huge + "\n+end\n"
        let first = try await page(patch, path: "a.txt", chunk: 8192)
        #expect(first.found && first.shortened && first.lines.count == 2)
        #expect(first.lines[0].text.unicodeScalars.count <= 16_385)
        let cursor = try #require(first.next)
        let second = try await page(patch, path: "a.txt", cursor: cursor, chunk: 8192)
        #expect(second.lines.first?.newNo == 3 && second.lines.first?.text == "end" && !second.shortened)
    }

    @Test @MainActor func malformedChunksAndCancellationCannotAdvanceTheReader() async throws {
        await #expect(throws: MainsError.self) {
            try await TurnFileDiff.read(path: "a") { offset in HistoryContentPage(text: "bad", offset: offset + 1, nextOffset: nil, totalChars: 3) }
        }
        await #expect(throws: MainsError.self) {
            try await TurnFileDiff.read(path: "a") { offset in HistoryContentPage(text: "", offset: offset, nextOffset: offset, totalChars: 3) }
        }
        let task = Task { try await TurnFileDiff.read(path: "a") { offset in
            try await Task.sleep(for: .seconds(1))
            return HistoryContentPage(text: "", offset: offset, nextOffset: nil, totalChars: offset)
        } }
        task.cancel()
        await #expect(throws: CancellationError.self) { try await task.value }
    }

    @Test func footersUseExplicitTurnsAndRespectHistoricalBoundariesAndAmbiguousTimes() throws {
        func turn(_ id: Int, started: Int, ended: Int? = nil, status: String = "completed") throws -> RunTurn {
            try JSONValue.object(["id": .number(Double(id)), "status": .string(status), "turnIndex": .number(Double(id)),
                "startedAt": .number(Double(started) * 1000), "endedAt": ended.map { .number(Double($0) * 1000) } ?? .null,
                "changes": DemoTurnChanges.summary(turnID: id)]).decode(RunTurn.self)
        }
        func row(_ id: String, _ date: Int, turnID: Int? = nil, kind: TranscriptRow.Kind = .response) -> TranscriptRow {
            TranscriptRow(id: id, kind: kind, text: "Sample", date: Date(timeIntervalSince1970: Double(date)), live: false, deferredArtifactID: nil, turnID: turnID)
        }
        let turns = try [turn(1, started: 1, ended: 8), turn(2, started: 10, ended: 20), turn(3, started: 25, status: "active")]
        let sections = TranscriptSection.build([row("p", 1, kind: .prompt), row("a", 8), row("p2", 10, kind: .prompt), row("b", 15)])
        let historical = TurnChangeFooters.build(sections: sections, turns: turns, atLatest: false)
        #expect(historical["a"]?.map(\.id) == [1] && historical["b"] == nil)
        let latest = TurnChangeFooters.build(sections: sections, turns: turns, atLatest: true)
        #expect(latest["a"]?.map(\.id) == [1] && latest["b"]?.map(\.id) == [2])
        let tied = try [turn(1, started: 1), turn(2, started: 1)]
        #expect(TurnChangeFooters.build(sections: TranscriptSection.build([row("r", 2)]), turns: tied, atLatest: true).isEmpty)
        #expect(TurnChangeFooters.build(sections: TranscriptSection.build([row("r", 2, turnID: 2)]), turns: tied, atLatest: true)["r"]?.map(\.id) == [2])
        #expect(TurnChangeFooters.build(sections: TranscriptSection.build([row("r", 2, turnID: 999)]), turns: tied, atLatest: true).isEmpty)
        let old = try JSONValue.object(["id": .number(1), "status": .string("completed"), "changes": .object(["$undefined": .bool(true)])]).decode(RunTurn.self)
        #expect(old.changes == nil)
    }

    @Test @MainActor func demoReplayAndScopedDiffReadsUseNormalChannelsWithoutSavingPatches() async throws {
        let storage = MemoryStorage(), backend = try DemoBackend(stepDelay: .milliseconds(1), streamDelay: .milliseconds(1))
        let session = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.exitDemo(); backend.shutdown() }
        try await eventually { session.isConnected }
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        let runID = try await session.send(DemoBackend.changesPrompt, spaceID: "codex", workspaceID: session.homeTargets["codex"]?.workspaceID)
        await session.selectConversation(runID)
        try await eventually { session.conversations.first { $0.id == runID }?.isActive == false }
        await session.loadHistory(direction: "refresh")
        let turn = try #require(session.transcript.page?.turns.last), changes = try #require(turn.changes)
        #expect(changes.files.count == 4 && changes.additions == 207 && turn.turnIndex == 0)
        let footers = TurnChangeFooters.build(sections: TranscriptSection.build(session.transcript.rows), turns: [turn], atLatest: true)
        #expect(footers.values.flatMap { $0 }.map(\.id) == [turn.id])
        let owner = session.ownership
        let first = try await session.readFileDiff(runID: runID, turnID: turn.id, file: changes.files[1], owner: owner)
        #expect(first.lines.count == 160)
        let cursor = try #require(first.next)
        let second = try await session.readFileDiff(runID: runID, turnID: turn.id, file: changes.files[1], owner: owner, cursor: cursor)
        #expect(second.lines.first?.newNo == 161 && second.lines.last?.newNo == 205)
        #expect(storage.snapshot == nil && storage.pairing == nil)
        await session.selectConversation(DemoBackend.tourID)
        await #expect(throws: MainsError.self) { try await session.readFileDiff(runID: runID, turnID: turn.id, file: changes.files[0], owner: owner) }
        session.exitDemo(); try session.startDemo(); try await eventually { session.isConnected }
        await session.selectConversation(DemoBackend.tourID)
        await #expect(throws: MainsError.self) { try await session.readFileDiff(runID: DemoBackend.tourID, turnID: 9_000_001, file: changes.files[0], owner: owner) }
        try await session.setSpaceMode("chat", spaceID: "codex")
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        let chat = try await session.send(DemoBackend.changesPrompt, spaceID: "codex")
        await session.selectConversation(chat)
        try await eventually { session.conversations.first { $0.id == chat }?.isActive == false }
        await session.loadHistory(direction: "refresh")
        #expect(session.transcript.page?.turns.allSatisfy { $0.changes == nil } == true, "Chat does not offer a changes card that its mode hides.")
    }

    @Test func wordEmphasisKeepsUnchangedTextAndBoundsExpensiveComparisons() {
        func lines(_ old: String, _ new: String) -> [FileDiffLine] {
            [.init(id: 1, kind: .remove, text: old, oldNo: 1, newNo: nil, hunkStart: true),
             .init(id: 2, kind: .add, text: new, oldNo: nil, newNo: 1, hunkStart: false)]
        }
        let before = "let title = \"Hello\"", after = "let title = \"Hello from Mains\""
        let result = DiffWordEmphasis.build(lines(before, after))
        #expect(result[1]?.map(\.text).joined() == before && result[2]?.map(\.text).joined() == after)
        #expect(result[2]?.filter(\.changed).map(\.text).joined().contains("from Mains") == true)
        #expect(DiffWordEmphasis.build(lines("old", "entirely different")).isEmpty)
        #expect(DiffWordEmphasis.build(lines(String(repeating: "a ", count: 6000), String(repeating: "b ", count: 6000))).isEmpty)
        let separateHunks: [FileDiffLine] = [
            .init(id: 1, kind: .remove, text: "same old", oldNo: 1, newNo: nil, hunkStart: true),
            .init(id: 2, kind: .add, text: "same new", oldNo: nil, newNo: 20, hunkStart: true),
        ]
        #expect(DiffWordEmphasis.build(separateHunks).isEmpty)
    }
}

extension SessionIntegrationTests {
    @Test @MainActor func turnChangesUseTaggedDatesDiffEventsAndRunScopedUnicodeContent() async throws {
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }; await session.selectConversation("fixture-run")
        var request = URLRequest(url: URL(string: endpoint + "/test/turn-changes")!)
        request.httpMethod = "POST"; request.httpBody = Data("{}".utf8)
        _ = try await URLSession.shared.data(for: request)
        try await eventually { session.transcript.page?.turns.first?.changes != nil }
        let turn = try #require(session.transcript.page?.turns.first), changes = try #require(turn.changes)
        #expect(changes.undoneAt != nil && changes.fileCount == 5 && changes.truncated)
        #expect(changes.files[0].oldPath == nil)
        let result = try await session.readFileDiff(runID: "fixture-run", turnID: turn.id, file: changes.files[0], owner: session.ownership)
        #expect(result.found && result.lines.map(\.text) == ["old", "café 👋", "new é"])
        await #expect(throws: MainsError.self) {
            try await session.readFileDiff(runID: "fixture-run", turnID: 999, file: changes.files[0], owner: session.ownership)
        }
    }
}
