import Foundation
import Testing
@testable import MainsCore

@MainActor private final class VoiceMediaProbe: RealtimeVoiceMedia {
    var onConnected: (() -> Void)?
    var onFailure: ((String) -> Void)?
    var onChannelOpen: (() -> Void)?
    var onLevels: ((Double, Double) -> Void)?
    var answerSDPs: [String] = []
    var sent: [JSONValue] = []
    var muted = false
    var closes = 0
    var channelOpen = true
    var holdOffer = false
    var offerWaiter: CheckedContinuation<String, any Error>?
    func offer() async throws -> String {
        if holdOffer { return try await withCheckedThrowingContinuation { offerWaiter = $0 } }
        return "v=0\r\nphone-offer"
    }
    func answer(_ sdp: String) async throws { answerSDPs.append(sdp) }
    func send(_ event: JSONValue) throws -> Bool { if !channelOpen { return false }; sent.append(event); return true }
    func setMuted(_ muted: Bool) { self.muted = muted }
    func close() { closes += 1 }
}

@MainActor private final class VoiceSignalingProbe {
    var starts: [(String, String)] = []
    var stops: [String] = []
    var stopFailure: MainsError?
    var holdStart = false
    var startWaiter: CheckedContinuation<Void, Never>?
    func signaling(_ runID: String = "voice-run") -> RealtimeVoiceSignaling {
        RealtimeVoiceSignaling(runID: runID, start: { [self] sdp, id in
            starts.append((sdp, id))
            if holdStart { await withCheckedContinuation { startWaiter = $0 } }
        }, stop: { [self] id in
            stops.append(id)
            if let stopFailure { throw stopFailure }
        })
    }
    func event(_ type: String, runID: String = "voice-run", extra: [String: JSONValue] = [:]) -> JSONValue {
        .object(extra.merging(["runId": .string(runID), "connectionId": .string(starts.last!.1), "type": .string(type)]) { _, new in new })
    }
}

@Suite struct RealtimeVoiceTests {
    @Test @MainActor func connectsOnlyAfterNativeAndMediaReadinessAndUsesTheOriginalOffer() async throws {
        let voice = RealtimeVoiceController(), media = VoiceMediaProbe(), backend = VoiceSignalingProbe()
        voice.makeMedia = { media }
        await voice.start(label: "Project") { backend.signaling() }
        #expect(backend.starts.first?.0 == "v=0\r\nphone-offer" && voice.phase == .connecting)
        voice.receive(backend.event("sdp", extra: ["sdp": .string("v=0\r\nanswer")]))
        try await eventually { media.answerSDPs.count == 1 }
        voice.receive(backend.event("started"))
        #expect(voice.phase == .connecting)
        media.onConnected?()
        #expect(voice.phase == .connected)
        voice.toggleMute(); #expect(voice.muted && media.muted)
        await voice.stop()
        #expect(voice.phase == .idle && !voice.ownsCall && media.closes == 1)
        #expect(backend.stops == [backend.starts[0].1])
    }

    @Test @MainActor func cancelDuringMicrophonePermissionNeverCreatesAConversation() async throws {
        let voice = RealtimeVoiceController(), media = VoiceMediaProbe()
        media.holdOffer = true; voice.makeMedia = { media }
        var preparations = 0
        let start = Task { await voice.start(label: "New") { preparations += 1; return VoiceSignalingProbe().signaling() } }
        try await eventually { media.offerWaiter != nil }
        await voice.stop()
        #expect(!voice.ownsCall && media.closes == 1)
        media.offerWaiter?.resume(returning: "v=0"); await start.value
        #expect(preparations == 0 && voice.phase == .idle)
    }

    @Test @MainActor func stoppingWhileNativeStartIsPendingRetainsOwnershipAndClosesAgainAfterItSettles() async throws {
        let voice = RealtimeVoiceController(), media = VoiceMediaProbe(), backend = VoiceSignalingProbe()
        backend.holdStart = true; voice.makeMedia = { media }
        let start = Task { await voice.start(label: "Pending") { backend.signaling() } }
        try await eventually { backend.startWaiter != nil }
        await voice.stop()
        #expect(media.closes == 1 && voice.ownsCall && voice.phase == .ending)
        backend.startWaiter?.resume(); await start.value
        #expect(backend.stops.count == 2 && Set(backend.stops).count == 1 && !voice.ownsCall)
    }

    @Test @MainActor func failedClosureReleasesMicBlocksReplacementAndRetriesTheOriginalIdentity() async throws {
        let voice = RealtimeVoiceController(), media = VoiceMediaProbe(), backend = VoiceSignalingProbe()
        voice.makeMedia = { media }
        await voice.start(label: "First") { backend.signaling() }
        backend.stopFailure = .timeout
        await voice.stop()
        #expect(voice.phase == .stopFailed && voice.ownsCall && media.closes == 1)
        await voice.start(label: "Must not start") { backend.signaling("replacement") }
        #expect(backend.starts.count == 1)
        backend.stopFailure = nil
        await voice.stop()
        #expect(!voice.ownsCall && Set(backend.stops).count == 1)
    }

    @Test @MainActor func oldEventsAndCallbacksCannotRetireAReplacementCall() async throws {
        let voice = RealtimeVoiceController(), first = VoiceMediaProbe(), second = VoiceMediaProbe(), backend = VoiceSignalingProbe()
        voice.makeMedia = { first }; await voice.start(label: "First") { backend.signaling() }
        let oldEvent = backend.event("closed"), oldFailure = first.onFailure
        await voice.stop()
        voice.makeMedia = { second }; await voice.start(label: "Second") { backend.signaling("second-run") }
        voice.receive(oldEvent); oldFailure?("Old microphone")
        #expect(voice.ownsCall && voice.runID == "second-run" && second.closes == 0)
        voice.connectionLost()
        #expect(second.closes == 1)
        try await eventually { !voice.ownsCall }
    }

    @Test @MainActor func nativeContextChunksPreserveUnicodeAndWaitForTheDataChannelWithoutRepeatingUpdates() async throws {
        let voice = RealtimeVoiceController(), media = VoiceMediaProbe(), backend = VoiceSignalingProbe()
        voice.makeMedia = { media }; media.channelOpen = false
        await voice.start(label: "Context") { backend.signaling() }
        let text = String(repeating: "İşlem 👨‍👩‍👧‍👦 tamamlandı. ", count: 60)
        let event = backend.event("context", extra: ["eventId": .string("update-1"), "content": .string(text), "announce": .bool(true)])
        voice.receive(event); voice.receive(event)
        #expect(media.sent.isEmpty)
        media.channelOpen = true; media.onChannelOpen?()
        try await eventually { media.sent.count == RealtimeVoiceController.contextEvents(text, announce: true).count }
        #expect(media.sent.map { $0["content"].array[0]["text"].string! }.joined() == text)
        #expect(media.sent.allSatisfy { $0["content"].array[0]["text"].string!.utf8.count <= 500 && $0["channel"].string == "commentary" })
        #expect(RealtimeVoiceController.contextEvents("Quiet", announce: false)[0]["channel"] == .null)
        await voice.stop()
    }
}

private func speech(_ id: String, kind: String = "report", text: String, final: Bool = false, at: Double = 1000) -> JSONValue {
    .object(["ts": .number(at), "event": .object(["type": .string("artifact"), "kind": .string(kind), "streamId": .string(id),
        "content": .string(text), "metadata": .object(["source": .string(kind == "report" ? "agent_message" : "user"),
        "voice": .bool(true), "streamId": .string(id), "voiceStartedAt": .number(at), "realtimeSessionId": .string("call"), "streaming": .bool(!final)])])])
}

@Test func voiceTranscriptsKeepBothSpeakersIdentityDatesAndFinalSpeechAcrossWorkCompletionAndClosure() throws {
    var transcript = Transcript()
    transcript.receive(speech("user", kind: "user-prompt", text: "Merhaba", at: 1000))
    transcript.receive(speech("assistant", text: "Mer", at: 2000))
    transcript.settleTurn()
    transcript.receive(speech("assistant", text: "Merhaba!", final: true, at: 3000))
    #expect(transcript.rows.map(\.text) == ["Merhaba", "Merhaba!"])
    #expect(transcript.rows.last?.date == Date(timeIntervalSince1970: 2))
    transcript.closeVoice("call")
    #expect(transcript.rows.map(\.text) == ["Merhaba!"])
    let artifact = Artifact(id: 1, runId: "r", kind: "report", content: "Merhaba!", metadata: .object([
        "voice": .bool(true), "streamId": .string("assistant"), "voiceStartedAt": .number(2000),
    ]), createdAt: Date(timeIntervalSince1970: 10))
    transcript.replace(HistoryPage(artifacts: [artifact], toolCalls: [], turns: [], start: nil, end: nil, last: nil, hasOlder: false, hasNewer: false))
    #expect(transcript.rows.count == 1 && transcript.rows[0].id == "stream:assistant" && transcript.rows[0].date == Date(timeIntervalSince1970: 2))
}

@Test func voiceWorkNarrationIsHiddenByProvenanceWhileWrittenRepliesAndTaskLinksRemain() throws {
    let at = Date()
    var transcript = Transcript()
    let artifacts = [
        Artifact(id: 1, runId: "r", kind: "report", content: "Duplicate", metadata: .object(["inputSource": .string("voice")]), createdAt: at),
        Artifact(id: 2, runId: "r", kind: "report", content: "Written reply", metadata: .object(["inputSource": .string("text")]), createdAt: at),
        Artifact(id: 3, runId: "r", kind: "report", content: "Task", metadata: .object(["voiceTask": .object(["id": .string("worker"), "title": .string("Fix the bug")])]), createdAt: at),
    ]
    transcript.replace(HistoryPage(artifacts: artifacts, toolCalls: [], turns: [], start: nil, end: nil, last: nil, hasOlder: false, hasNewer: false))
    #expect(transcript.rows.map(\.text) == ["Written reply", "Task"])
    #expect(transcript.rows.last?.voiceTask?.id == "worker")
    transcript.receive(speech("last-spoken", text: "The working chat is ready.", final: true, at: at.timeIntervalSince1970 * 1000 + 1000))
    let section = try #require(TranscriptSection.build(transcript.rows).last)
    #expect(section.displayedRows(expanded: false).contains { $0.voiceTask?.id == "worker" })
    #expect(section.displayedRows(expanded: false).contains { $0.voice && $0.text == "The working chat is ready." })
}
