import Foundation
import Testing
@testable import MainsCore

@Suite(.serialized)
struct DemoTests {
    @Test @MainActor func offlineDemoUsesNormalSessionCataloguesAndIsolatedStorage() async throws {
        let storage = MemoryStorage()
        storage.snapshot = CachedSnapshot(backendID: "keep-real-cache", conversations: [], spaces: [], workspaces: [], histories: [:])
        storage.grantConsent(backendID: "real-computer", providerID: "codex")
        let originalConsent = storage.consents
        let session = BackendSession(storage: storage)
        session.restore(); session.setOnline(false); session.setActive(true)
        try session.startDemo()
        defer { session.exitDemo() }
        try await eventually { session.isConnected }
        #expect(session.isDemo && storage.demoEnabled && storage.pairing == nil)
        #expect(session.spaces.count == 5 && session.selectedSpaceID == "codex")
        #expect(session.homeTargets["codex"]?.workspaceID != nil)
        #expect(session.conversations.contains { $0.id == DemoBackend.tourID })
        for provider in session.spaces.map(\.providerId) {
            await session.loadModels(provider)
            #expect(session.models[provider]?.isEmpty == false)
            #expect(session.modelErrors[provider] == nil)
        }
        let permissions = try await session.codexPermissions(workspaceID: session.homeTargets["codex"]?.workspaceID)
        #expect(permissions.choices(current: "workspace-write").count == 3)
        session.setOnline(true); session.setOnline(false)
        #expect(session.isConnected, "Network changes do not reconnect a local demo.")
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        #expect(session.hasConsent(providerID: "codex"))
        #expect(storage.consents == originalConsent)
        #expect(storage.snapshot?.backendID == "keep-real-cache")
        try await session.setSpaceMode("work", spaceID: "codex")
        #expect(session.selectedSpace?.mode == "work")
        try await session.setSpaceMode("developer", spaceID: "codex")
        session.exitDemo()
        #expect(!session.isDemo && session.pairing == nil && !storage.demoEnabled)
        #expect(storage.consents == originalConsent && storage.snapshot?.backendID == "keep-real-cache")
    }

    @Test @MainActor func replayAcknowledgesStreamsAndDeduplicatesCommands() async throws {
        let backend = try DemoBackend(stepDelay: .milliseconds(1), streamDelay: .milliseconds(1))
        let transport = DemoTransport(backend: backend)
        try transport.open(endpoint: DemoBackend.endpoint, token: "")
        defer { transport.close(); backend.shutdown() }
        var transcript = Transcript(), runID = "", errors: [String] = []
        transport.onEvent = { channel, payload in
            if channel == "runs:ephemeralEvent" { transcript.receive(payload) }
            if channel == "runs:eventPersisted", !runID.isEmpty {
                do {
                    let page = try backend.invoke("runs:getHistory", args: [self.historyRequest(runID)]).decode(HistoryPage.self)
                    transcript.replace(page)
                } catch { errors.append(error.localizedDescription) }
            }
        }
        let args = [try startPayload(backend, text: "Review this workspace")]
        let first = try await transport.invoke("runs:execute", args: args, commandId: "same-command")
        runID = try #require(first["runId"].string)
        let second = try await transport.invoke("runs:execute", args: args, commandId: "same-command")
        #expect(first == second)
        try await eventually {
            (try? backend.invoke("runs:getById", args: [.string(runID)]))?["status"].string == "succeeded"
        }
        let page = try backend.invoke("runs:getHistory", args: [historyRequest(runID)]).decode(HistoryPage.self)
        transcript.replace(page)
        #expect(errors.isEmpty)
        #expect(page.artifacts.filter { $0.kind == "user-prompt" }.count == 1)
        #expect(page.artifacts.filter { $0.kind == "report" }.allSatisfy { $0.metadata?["streamId"].string != nil })
        #expect(transcript.rows.filter { $0.kind == .response }.count == 2)
        #expect(Set(transcript.rows.map(\.id)).count == transcript.rows.count)
        #expect(transcript.rows.allSatisfy { !$0.live })
        #expect(page.toolCalls.count == 2)
        #expect(throws: MainsError.self) {
            try backend.invoke("runs:execute", args: [try startPayload(backend, text: "Different command")], commandID: "same-command")
        }
    }

    @Test @MainActor func demoFilesUseRealImageAndChunkedDocumentPaths() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true); session.setOnline(false); try session.startDemo()
        defer { session.exitDemo() }
        try await eventually { session.isConnected }
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        await session.selectConversation(DemoBackend.tourID)
        #expect(session.historyError == nil)
        let imageMedia = try #require(session.transcript.rows.flatMap(\.media).first { $0.image })
        let image = try await session.readImage(imageMedia)
        let imageBytes = try #require(image.data)
        #expect(imageBytes.count > 0)
        let pdfMedia = try #require(session.transcript.rows.flatMap(\.media).first { $0.name == "demo-report.pdf" && $0.source == .attachment(DemoBackend.pdfAttachmentID) })
        let pdf = try await session.describeAttachment(pdfMedia)
        let pdfBytes = try await session.downloadAttachment(pdf)
        #expect(pdfBytes == DemoFile.pdf.bytes && pdfBytes.starts(with: Data("%PDF-".utf8)))
        let outputs = try await session.listOutputs(DemoBackend.tourID)
        #expect(outputs.items.count == 2)
        #expect(try await session.hasOutputs(DemoBackend.tourID))
        let notes = try #require(outputs.items.first { $0.name == "demo-notes.md" })
        #expect(String(decoding: try await session.downloadOutput(notes), as: UTF8.self).hasPrefix("# Mains demo notes"))

        var largePDF = DemoFile.pdf.bytes
        largePDF.append(Data(repeating: 32, count: 160_000))
        let id = try await session.send("Look at these demo attachments", spaceID: "codex",
            workspaceID: session.homeTargets["codex"]?.workspaceID, attachments: [
                PromptAttachment(name: "sample.jpg", type: "image", mimeType: image.mime, bytes: imageBytes),
                PromptAttachment(name: "sample.pdf", type: "document", mimeType: "application/pdf", bytes: largePDF),
            ])
        await session.selectConversation(id)
        let media = session.transcript.rows.flatMap(\.media)
        #expect(try await !session.hasOutputs(id), "Prompt attachments are not generated outputs.")
        let importedImage = try #require(media.first { $0.name == "sample.jpg" })
        let importedPDF = try #require(media.first { $0.name == "sample.pdf" })
        #expect(try await session.readImage(importedImage).data == imageBytes)
        let importedFile = try await session.describeAttachment(importedPDF)
        #expect(try await session.downloadAttachment(importedFile) == largePDF)
        try await eventually { session.conversations.first { $0.id == id }?.isActive == true }
        try await session.stop(id)
        try await eventually { session.conversations.first { $0.id == id }?.status == "canceled" }
        #expect(try await !session.hasOutputs(id))
    }

    @Test @MainActor func backgroundPausesReplayAndOldConnectionsCannotDetachTheNewOne() async throws {
        let backend = try DemoBackend(stepDelay: .milliseconds(2), streamDelay: .milliseconds(3))
        let old = DemoTransport(backend: backend)
        try old.open(endpoint: DemoBackend.endpoint, token: "")
        var events = 0
        old.onEvent = { _, _ in events += 1 }
        let result = try await old.invoke("runs:execute", args: [try startPayload(backend, text: "Investigate the issue")], commandId: "pause-command")
        let id = try #require(result["runId"].string)
        try await eventually { events > 3 }
        old.close()
        let paused = events
        try await Task.sleep(for: .milliseconds(30))
        #expect(events == paused)
        #expect(try backend.invoke("runs:getById", args: [.string(id)])["status"].string == "running")
        let next = DemoTransport(backend: backend)
        next.onEvent = { _, _ in events += 1 }
        try next.open(endpoint: DemoBackend.endpoint, token: "")
        old.close()
        defer { next.close(); backend.shutdown() }
        try await eventually {
            (try? backend.invoke("runs:getById", args: [.string(id)]))?["status"].string == "succeeded"
        }
        #expect(events > paused)
        let page = try backend.invoke("runs:getHistory", args: [historyRequest(id)]).decode(HistoryPage.self)
        #expect(page.artifacts.filter { $0.kind == "user-prompt" }.count == 1)
    }

    @Test @MainActor func historyPagesRetainOverlapAndStayBoundedLikeDesktop() async throws {
        let backend = try DemoBackend(stepDelay: .milliseconds(1), streamDelay: .milliseconds(1))
        let transport = DemoTransport(backend: backend)
        try transport.open(endpoint: DemoBackend.endpoint, token: "")
        defer { transport.close(); backend.shutdown() }
        let result = try await transport.invoke("runs:execute", args: [try startPayload(backend, text: "Demo message 1")], commandId: "history-1")
        let id = try #require(result["runId"].string)
        for index in 1...13 {
            if index > 1 {
                _ = try await transport.invoke("runs:continue", args: [.object(["runId": .string(id), "message": .string("Demo message \(index)")])], commandId: "history-\(index)")
            }
            try await eventually {
                (try? backend.invoke("runs:getById", args: [.string(id)]))?["status"].string == "succeeded"
            }
        }
        let latest = try backend.invoke("runs:getHistory", args: [historyRequest(id)]).decode(HistoryPage.self)
        #expect(latest.hasOlder && !latest.hasNewer)
        #expect(latest.artifacts.filter { $0.kind == "user-prompt" }.count == 3)
        var olderRequest = historyRequest(id).objectValue
        olderRequest["direction"] = .string("older"); olderRequest["cursor"] = try .encode(#require(latest.start))
        var older = try backend.invoke("runs:getHistory", args: [.object(olderRequest)]).decode(HistoryPage.self)
        let latestIDs = Set(latest.artifacts.map(\.id))
        #expect(latestIDs.isSubset(of: Set(older.artifacts.map(\.id))))
        for _ in 0..<2 {
            olderRequest["cursor"] = try .encode(#require(older.start))
            older = try backend.invoke("runs:getHistory", args: [.object(olderRequest)]).decode(HistoryPage.self)
            #expect(older.artifacts.filter { $0.kind == "user-prompt" }.count <= 9)
        }
        #expect(older.hasOlder && older.hasNewer)
        var frozenRequest = historyRequest(id).objectValue
        frozenRequest["direction"] = .string("refresh")
        frozenRequest["cursor"] = try .encode(#require(older.start)); frozenRequest["end"] = try .encode(#require(older.end))
        #expect(try backend.invoke("runs:getHistory", args: [.object(frozenRequest)]).decode(HistoryPage.self) == older)
        var newerRequest = historyRequest(id).objectValue
        newerRequest["direction"] = .string("newer"); newerRequest["cursor"] = try .encode(#require(older.end))
        let newer = try backend.invoke("runs:getHistory", args: [.object(newerRequest)]).decode(HistoryPage.self)
        #expect(!newer.hasNewer)
        #expect(latestIDs.isSubset(of: Set(newer.artifacts.map(\.id))))
        #expect(newer.artifacts.filter { $0.kind == "user-prompt" }.count == 9)
    }

    @Test @MainActor func restoreStartsFreshDemoAndExitFencesItsPendingWork() async throws {
        let storage = MemoryStorage()
        let first = BackendSession(storage: storage)
        first.restore(); first.setActive(true); try first.startDemo()
        try await eventually { first.isConnected }
        first.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        let id = try await first.send("A temporary demo prompt", spaceID: "codex", workspaceID: first.homeTargets["codex"]?.workspaceID)
        first.setActive(false)
        #expect(first.connection == .suspended)
        #expect(storage.pairing == nil && storage.snapshot == nil)
        let restored = BackendSession(storage: storage)
        restored.setOnline(false); restored.restore(); restored.setActive(true)
        defer { first.exitDemo(); restored.exitDemo() }
        try await eventually { restored.isConnected }
        #expect(restored.isDemo && restored.conversations.allSatisfy { $0.id != id })
        #expect(!restored.hasConsent(providerID: "codex"))
        await restored.selectConversation(DemoBackend.tourID)
        let owner = restored.ownership
        restored.exitDemo()
        try await Task.sleep(for: .milliseconds(80))
        #expect(restored.ownership != owner && restored.conversations.isEmpty && restored.transcript.rows.isEmpty)
        #expect(restored.pairing == nil && !storage.demoEnabled && !restored.isDemo)
    }

    @Test @MainActor func demoCannotReplaceASavedRealComputer() throws {
        let storage = MemoryStorage()
        let real = PairedBackend(descriptor: BackendDescriptor(backendId: "real", name: "Real Mac", appVersion: "1",
            protocolVersion: Wire.protocolVersion, capabilities: [], serverTime: ""), endpoints: [URL(string: "https://example.invalid")!],
            deviceId: "real-device", deviceToken: "real-test-token")
        storage.pairing = real
        let session = BackendSession(storage: storage)
        #expect(throws: MainsError.self) { try session.startDemo() }
        #expect(storage.pairing == real && !storage.demoEnabled && !session.isDemo)
    }

    @MainActor private func startPayload(_ backend: DemoBackend, text: String) throws -> JSONValue {
        .object(["accountId": .string("demo-account"), "spaceId": .string("codex"), "providerId": .string("codex"),
                 "workspaceId": backend.defaultWorkspaceID.map(JSONValue.string) ?? .null, "goal": .string(text)])
    }
    @MainActor private func historyRequest(_ id: String) -> JSONValue {
        .object(["runId": .string(id), "direction": .string("latest"), "profile": .string("mobile"), "deferToolOutput": .bool(true)])
    }
}

// Serialized with the live fixture tests: a real pairing must commit before
// retiring the local demo, and a refused pairing must leave the demo usable.
extension SessionIntegrationTests {
    @Test @MainActor func realPairingReplacesDemoOnlyAfterCredentialsAreSaved() async throws {
        let storage = MemoryStorage()
        let session = BackendSession(storage: storage)
        session.restore(); session.setActive(true); try session.startDemo()
        defer { session.setActive(false) }
        try await eventually { session.isConnected }
        session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
        let oldRun = try await session.send("A demo message before pairing", spaceID: "codex", workspaceID: session.homeTargets["codex"]?.workspaceID)
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        do {
            try await session.pair(PairingLink("mains://pair#code=expired&endpoint=\(encoded)"), deviceName: "Test iPhone")
            Issue.record("An expired real pairing must be refused.")
        } catch {
            #expect(session.isDemo && storage.demoEnabled && storage.pairing == nil)
        }
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected && session.conversations.contains { $0.id == "fixture-run" } }
        #expect(!session.isDemo && !storage.demoEnabled && storage.pairing?.descriptor.backendId == "ios-fixture")
        #expect(!session.hasConsent(providerID: "codex"))
        try await Task.sleep(for: .milliseconds(500))
        #expect(session.conversations.allSatisfy { $0.id != oldRun && $0.id != DemoBackend.tourID })
        session.exitDemo() // A stale demo action must not affect a real computer.
        #expect(session.pairing?.descriptor.backendId == "ios-fixture")
    }
}
