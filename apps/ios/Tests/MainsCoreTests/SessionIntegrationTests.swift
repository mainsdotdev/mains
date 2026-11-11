import Foundation
import Testing
@testable import MainsCore

@MainActor
final class MemoryStorage: SessionStorage {
    var demoEnabled = false
    func setDemoEnabled(_ enabled: Bool) { demoEnabled = enabled }
    var pairing: PairedBackend?
    var snapshot: CachedSnapshot?
    var consents: Set<String> = []
    func loadPairing() throws -> PairedBackend? { pairing }
    func savePairing(_ pairing: PairedBackend) throws { self.pairing = pairing }
    func removePairing() throws { pairing = nil; consents = [] }
    func loadSnapshot() -> CachedSnapshot? { snapshot }
    func saveSnapshot(_ snapshot: CachedSnapshot) { self.snapshot = snapshot }
    func removeSnapshot() { snapshot = nil }
    private func consentKey(_ backendID: String, _ providerID: String) -> String {
        (try! JSONEncoder().encode([backendID, providerID])).base64EncodedString()
    }
    func hasConsent(backendID: String, providerID: String) -> Bool { consents.contains(consentKey(backendID, providerID)) }
    func grantConsent(backendID: String, providerID: String) { consents.insert(consentKey(backendID, providerID)) }
    func revokeConsent(backendID: String, providerID: String) { consents.remove(consentKey(backendID, providerID)) }
    func revokeAllConsents(backendID: String) {
        consents = consents.filter { key in
            let tuple = try! JSONDecoder().decode([String].self, from: Data(base64Encoded: key)!)
            return tuple.first != backendID
        }
    }
}

@MainActor
func eventually(_ condition: () -> Bool, seconds: Int = 10) async throws {
    let deadline = ContinuousClock.now + .seconds(seconds)
    while !condition() && ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(25)) }
    #expect(condition())
    if !condition() { throw MainsError.timeout }
}

@Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"] != nil))
struct SessionIntegrationTests {
    @Test @MainActor func draftOwnershipAndStopFollowTheConversation() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        session.grantConsent(providerID: "codex", backendID: "ios-fixture")
        await session.selectConversation("fixture-run")
        let draft = session.draft(for: "fixture-run")
        draft.text = "A thought to keep"
        session.leaveConversation("fixture-run")
        await session.selectConversation("fixture-run")
        #expect(session.draft(for: "fixture-run") === draft)
        #expect(draft.text == "A thought to keep")
        _ = try await session.send("Take your time", runID: "fixture-run")
        try await eventually { session.conversations.first?.isActive == true && session.transcript.rows.contains(where: \.live) }
        session.setHistoryFollowing(false)
        let stop = Task { try await session.stop("fixture-run") }
        try await eventually { session.stoppingRunID == "fixture-run" }
        try await session.stop("fixture-run") // A second tap must not send a second abort.
        try await stop.value
        #expect(session.stoppingRunID == nil)
        #expect(session.conversations.first?.status == "canceled")
        #expect(draft.text == "A thought to keep")
        #expect(session.transcript.page?.hasNewer == true)
        await session.loadHistory(direction: "latest")
        #expect(!session.transcript.rows.contains { $0.live })
        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let requests = try JSONDecoder().decode([JSONValue].self, from: data)
        #expect(requests.filter { $0["channel"].string == "runs:abort" }.count == 1)
        #expect(requests.contains { $0["channel"].string == "runs:getHistory" && $0["args"].array.first?["end"] != .null })
        try session.forget()
        #expect(session.draft(for: "fixture-run") !== draft)
    }

    @Test @MainActor func pairStreamReconnectAndRestore() async throws {
        let storage = MemoryStorage()
        let session = BackendSession(storage: storage)
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        #expect(session.conversations.count == 1)
        #expect(session.spaces.count == 2)
        #expect(storage.pairing?.deviceToken == "fixture-device-token")
        #expect(storage.pairing?.pairedAt != nil)
        #expect(session.activeEndpoint?.absoluteString == endpoint)
        #expect(session.connectedDescriptor?.backendId == "ios-fixture")
        #expect(session.lastSyncedAt != nil)
        let syncedAt = try #require(session.lastSyncedAt)
        await session.refresh()
        #expect(try #require(session.lastSyncedAt) > syncedAt)
        #expect(storage.snapshot?.lastSyncedAt == session.lastSyncedAt)
        await session.selectConversation("fixture-run")
        #expect(session.transcript.rows.last?.text == "Hello from the computer.")
        await #expect(throws: MainsError.self) { try await session.send("No consent", runID: "fixture-run") }
        session.grantConsent(providerID: "codex", backendID: "ios-fixture")
        #expect(try await session.send("Hello from native iOS", runID: "fixture-run") == "fixture-run")
        try await eventually { session.transcript.rows.contains { $0.text == "Streaming a native reply…" && $0.live } }
        try await eventually { session.transcript.rows.contains { $0.text == "Native reply delivered." && !$0.live } }
        try await Task.sleep(for: .milliseconds(600))
        #expect(!session.transcript.rows.contains { $0.text == "STALE DELTA" })
        #expect(session.transcript.rows.filter { $0.text == "Native reply delivered." }.count == 1)
        #expect(session.pendingMessage == nil)

        session.revokeConsent(providerID: "codex", backendID: "ios-fixture")
        await #expect(throws: MainsError.server("Allow data sharing with OpenAI before sending.")) {
            try await session.send("Revoked permission must block sends", runID: "fixture-run")
        }
        session.grantConsent(providerID: "codex", backendID: "ios-fixture")

        let id = try await session.send("Reconnect once", runID: "fixture-run")
        #expect(id == "fixture-run")
        try await eventually { session.conversations.first?.isActive == false }
        let (observations, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let requests = try JSONDecoder().decode([JSONValue].self, from: observations)
        let attempts = requests.filter { $0["args"].array.first?["message"].string == "Reconnect once" }
        #expect(attempts.count == 2)
        #expect(Set(attempts.compactMap { $0["commandId"].string }).count == 1)

        session.setActive(false)
        #expect(session.connection == .suspended)
        session.setActive(true)
        try await eventually { session.isConnected }
        session.setOnline(false)
        #expect(session.connection == .offline)
        session.setOnline(true)
        try await eventually { session.isConnected }

        await #expect(throws: MainsError.self) { try await session.send("Code needs a workspace", spaceID: "fixture-code") }
        let createdID = try await session.send("Start a native conversation", spaceID: "fixture-space")
        #expect(createdID != "fixture-run")
        await session.selectConversation(createdID)
        try await eventually { session.transcript.rows.contains { $0.text == "Native reply delivered." } }
        #expect(session.conversations.count == 2)
        await session.selectConversation("fixture-run")

        await #expect(throws: MainsError.self) { try await session.send("Unknown outcome", runID: "fixture-run") }
        #expect(session.pendingMessage?.status == .uncertain)
        await #expect(throws: MainsError.server("Check the unconfirmed message before sending another.")) {
            try await session.send("Must not create a new identity", runID: "fixture-run")
        }
        await #expect(throws: MainsError.self) { try await session.checkDelivery() }
        #expect(session.pendingMessage?.status == .uncertain)

        let restored = BackendSession(storage: storage)
        restored.restore()
        #expect(restored.conversations.count == 2)
        #expect(restored.connection == .suspended)
        #expect(restored.lastSyncedAt == session.lastSyncedAt)
        #expect(restored.pairing?.pairedAt == session.pairing?.pairedAt)
        try session.forget()
        #expect(storage.pairing == nil)
        #expect(storage.snapshot == nil)
        #expect(session.conversations.isEmpty)
        #expect(session.connection == .idle)
        #expect(session.lastSyncedAt == nil && session.activeEndpoint == nil && session.connectedDescriptor == nil)
    }

    @Test @MainActor func transportTimeoutCancellationAndRefusal() async throws {
        let transport = WebSocketTransport()
        let endpoint = URL(string: ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!)!
        try transport.open(endpoint: endpoint, token: "fixture-device-token")
        defer { transport.close() }
        _ = try await transport.invoke("backend:describe")
        await #expect(throws: MainsError.timeout) { try await transport.invoke("test:never", timeout: 0.05) }
        await #expect(throws: MainsError.server("Explicit refusal")) { try await transport.invoke("test:refuse") }
        let job = Task { try await transport.invoke("test:never") }
        job.cancel()
        await #expect(throws: CancellationError.self) { try await job.value }
        // Cancelled and timed-out requests do not poison the next request.
        let response = try await transport.invoke("backend:describe")
        #expect(response["backendId"].string == "ios-fixture")
        transport.close()
        try transport.open(endpoint: endpoint, token: "revoked-token")
        await #expect(throws: MainsError.unauthorized) { try await transport.invoke("backend:describe") }
    }

    @Test @MainActor func authorizationRefusalSurvivesForegroundAndNetworkChanges() async throws {
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        let original = try await PairingClient().pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        let storage = MemoryStorage()
        storage.pairing = PairedBackend(descriptor: original.descriptor, endpoints: original.endpoints,
                                       deviceId: original.deviceId, deviceToken: "revoked-token")
        let session = BackendSession(storage: storage)
        session.restore(); session.setActive(true)
        try await eventually { session.connection == .unauthorized }
        session.setActive(false); session.setActive(true)
        session.setOnline(false); session.setOnline(true); session.retry()
        #expect(session.connection == .unauthorized)
        session.setActive(false)
    }
}
