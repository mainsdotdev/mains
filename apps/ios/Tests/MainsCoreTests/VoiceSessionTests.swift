import Foundation
import Testing
@testable import MainsCore

@MainActor private final class SessionVoiceMedia: RealtimeVoiceMedia {
    var onConnected: (() -> Void)?
    var onFailure: ((String) -> Void)?
    var onChannelOpen: (() -> Void)?
    var onLevels: ((Double, Double) -> Void)?
    var closed = false
    func offer() async throws -> String { "v=0\r\nfixture-offer" }
    func answer(_ sdp: String) async throws { onConnected?() }
    func send(_ event: JSONValue) throws -> Bool { true }
    func setMuted(_ muted: Bool) {}
    func close() { closed = true }
}

@MainActor private final class SessionVoiceProbe {
    var runID = ""
    var calls: [(channel: String, args: [JSONValue], commandID: String?)] = []
    var unknownCreate = false
    var unknownStop = false
    var creations = 0
    var receipts: [String: JSONValue] = [:]
    var transports: [SessionVoiceTransport] = []
}

@MainActor private final class SessionVoiceTransport: BackendTransport {
    let base: DemoTransport
    let probe: SessionVoiceProbe
    var onEvent: ((String, JSONValue) -> Void)? { get { base.onEvent } set { base.onEvent = newValue } }
    var onDisconnect: ((MainsError) -> Void)? { get { base.onDisconnect } set { base.onDisconnect = newValue } }
    init(_ backend: DemoBackend, _ probe: SessionVoiceProbe) { base = DemoTransport(backend: backend); self.probe = probe }
    func open(endpoint: URL, token: String) throws { try base.open(endpoint: endpoint, token: token) }
    func close() { base.close() }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        probe.calls.append((channel, args, commandId))
        if let commandId, let result = probe.receipts[commandId] { return result }
        if channel == "runs:createRealtimeConversation" {
            probe.creations += 1
            let result: JSONValue = .object(["runId": .string(probe.runID)])
            if let commandId { probe.receipts[commandId] = result }
            if probe.unknownCreate { probe.unknownCreate = false; throw MainsError.timeout }
            return result
        }
        if channel == "runs:startRealtime" {
            let payload = args[0]
            for type in ["started", "sdp"] {
                onEvent?("runs:realtimeEvent", .object(["runId": payload["runId"], "connectionId": payload["connectionId"],
                    "type": .string(type), "sdp": .string("v=0\r\nfixture-answer")]))
            }
            return .null
        }
        if channel == "runs:stopRealtime" {
            if probe.unknownStop { probe.unknownStop = false; throw MainsError.timeout }
            return .null
        }
        return try await base.perform(channel, args: args, commandId: commandId, timeout: timeout)
    }
}

@Suite(.serialized) struct VoiceSessionTests {
    @MainActor private func setup() async throws -> (BackendSession, DemoBackend, SessionVoiceProbe, SessionVoiceMedia) {
        let backend = try DemoBackend(), storage = MemoryStorage(), probe = SessionVoiceProbe(), media = SessionVoiceMedia()
        // A saved pairing uses the real session path, with an in-memory fixture
        // transport. No microphone, socket, provider or real credentials exist.
        storage.pairing = backend.pairing
        let session = BackendSession(storage: storage, makeTransport: { _ in
            let transport = SessionVoiceTransport(backend, probe); probe.transports.append(transport); return transport
        })
        session.voice.makeMedia = { media }
        session.restore(); session.setActive(true)
        try await eventually { session.isConnected }
        probe.runID = try #require(session.conversations.first { $0.providerId == "codex" && !$0.isActive && !$0.isArchived && $0.isReplica != true }?.id)
        return (session, backend, probe, media)
    }

    @Test @MainActor func consentIsRequiredAndNavigationOrTemporaryInactivityKeepsTheSameCallAlive() async throws {
        let (session, backend, probe, media) = try await setup()
        defer { try? session.forget(); backend.shutdown() }
        await session.startVoice(runID: probe.runID)
        #expect(!probe.calls.contains { $0.channel == "runs:startRealtime" })
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        await session.selectConversation(probe.runID)
        await session.startVoice(runID: probe.runID)
        try await eventually { session.voice.phase == .connected }
        let transports = probe.transports.count
        session.leaveConversation(probe.runID); session.setActive(false)
        #expect(session.isConnected && session.voice.ownsCall && !media.closed && probe.transports.count == transports)
        session.setActive(true)
        #expect(probe.transports.count == transports)
        await session.voice.stop()
        #expect(!session.voice.ownsCall && media.closed)
        #expect(!probe.calls.contains { $0.channel == "runs:execute" })
    }

    @Test @MainActor func unknownCreationRetainsItsReceiptBlocksFreshSendsAndNeverRestartsVoiceOnRecovery() async throws {
        let (session, backend, probe, media) = try await setup()
        defer { try? session.forget(); backend.shutdown() }
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        let space = try #require(session.spaces.first { $0.providerId == "codex" })
        session.selectSpace(space.id)
        session.selectTarget(HomeTarget(workspaceID: backend.defaultWorkspaceID), spaceID: space.id)
        let draft = session.homeDraft(for: space.id); draft.text = "Keep my draft"
        probe.unknownCreate = true
        await session.startVoice(spaceID: space.id)
        #expect(session.pendingVoiceConversation?.uncertain == true && media.closed && probe.creations == 1)
        await #expect(throws: MainsError.self) { try await session.send("Must not send", spaceID: space.id) }
        let recovered = try await session.checkVoiceConversation()
        #expect(recovered == probe.runID && session.pendingVoiceConversation == nil && probe.creations == 1)
        #expect(!session.voice.ownsCall && !probe.calls.contains { $0.channel == "runs:startRealtime" } && draft.text == "Keep my draft")
        let calls = probe.calls.filter { $0.channel == "runs:createRealtimeConversation" }
        #expect(calls.count == 2 && calls[0].commandID == calls[1].commandID && calls[0].args == calls[1].args)
    }

    @Test @MainActor func stopRecoveryKeepsTheOriginalCommandAndPairingRetirementReleasesAllMedia() async throws {
        let (session, backend, probe, media) = try await setup()
        defer { backend.shutdown() }
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        await session.startVoice(runID: probe.runID)
        try await eventually { session.voice.phase == .connected }
        probe.unknownStop = true
        await session.voice.stop()
        #expect(media.closed && session.voice.phase == .stopFailed && !session.canStartVoice(runID: probe.runID))
        await session.voice.stop()
        let stops = probe.calls.filter { $0.channel == "runs:stopRealtime" }
        #expect(stops.count == 2 && stops[0].commandID == stops[1].commandID && stops[0].args == stops[1].args)
        try session.forget()
        #expect(!session.voice.ownsCall && session.voice.phase == .idle && session.pendingVoiceConversation == nil)
    }
}
