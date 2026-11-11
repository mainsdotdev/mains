import Foundation
import Testing
@testable import MainsCore

// Uses the contract-backed fixture, including real command envelopes and receipts.
// Run sequentially with the other integration tests, which reset the same computer.
extension SessionIntegrationTests {
    @Test @MainActor func attachmentOnlyMessagesUseExecuteAndContinueWirePayloads() async throws {
        let session = BackendSession(storage: MemoryStorage())
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        session.grantConsent(providerID: "codex", backendID: "ios-fixture")
        let photo = PromptAttachment(name: "photo.png", type: "image", mimeType: "image/png", bytes: Data([1, 2, 3]))
        let pdf = PromptAttachment(name: "document.pdf", type: "document", mimeType: "application/pdf", bytes: Data("%PDF-fixture".utf8))
        let id = try await session.send("", spaceID: "fixture-space", attachments: [photo])
        await session.selectConversation(id)
        try await eventually { session.pendingMessage == nil && session.conversations.first { $0.id == id }?.isActive == false }
        _ = try await session.send(" \n\t", runID: id, attachments: [pdf])
        try await eventually { session.pendingMessage == nil && session.conversations.first { $0.id == id }?.isActive == false }
        await #expect(throws: MainsError.self) { try await session.send(" \n\t", runID: id) }
        await #expect(throws: MainsError.self) { try await session.send("", spaceID: "fixture-space") }

        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data)
        let sends = calls.filter { ["runs:execute", "runs:continue"].contains($0["channel"].string ?? "") }
        #expect(sends.count == 2)
        for (channel, key, file) in [("runs:execute", "goal", photo), ("runs:continue", "message", pdf)] {
            let call = try #require(sends.first { $0["channel"].string == channel })
            #expect(call["commandId"].string?.isEmpty == false)
            #expect(call["args"].array[0][key] == .string(""))
            #expect(call["args"].array[0]["attachments"].array == [try .encode(file)])
        }
    }

    @Test @MainActor func homeSelectionsPersistAndExecuteTheDisplayedSettings() async throws {
        let storage = MemoryStorage()
        let session = BackendSession(storage: storage)
        session.restore(); session.setActive(true)
        defer { session.setActive(false) }
        let endpoint = ProcessInfo.processInfo.environment["MAINS_TEST_BACKEND"]!
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        try await session.pair(PairingLink("mains://pair#code=ios-test-home&endpoint=\(encoded)"), deviceName: "Test iPhone")
        try await eventually { session.isConnected }
        #expect(session.collections.count == 3)
        #expect(session.gitStates.first?.branch == "main")
        session.selectSpace("fixture-claude")
        let draft = session.homeDraft(for: "fixture-claude")
        draft.text = "Keep this draft"
        await session.loadModels("claude_code")
        let space = try #require(session.selectedSpace)
        let model = try #require(session.models["claude_code"]?.last)
        var settings = session.settings(for: space)
        settings.select(model, provider: space.providerId)
        settings.setEffort("high", provider: space.providerId)
        settings.setPermission("plan", provider: space.providerId)
        session.setSettings(settings, spaceID: space.id)
        session.selectTarget(HomeTarget(workspaceID: "fixture-workspace", collectionID: "fixture-kitchen"), spaceID: space.id)
        session.selectSpace("fixture-space")
        session.selectSpace(space.id)
        #expect(session.homeDraft(for: space.id) === draft)
        #expect(draft.text == "Keep this draft")
        session.grantConsent(providerID: space.providerId, backendID: "ios-fixture")
        let attachment = PromptAttachment(name: "notes.txt", type: "document", mimeType: "text/plain", bytes: Data("Context".utf8))
        let codeID = try await session.send("Start in Code", spaceID: space.id, workspaceID: "fixture-workspace", collectionID: "fixture-kitchen", settings: settings, attachments: [attachment])
        await session.selectConversation(codeID)
        try await eventually { session.conversations.first(where: { $0.id == codeID })?.isActive == false }
        try await session.setSpaceMode("work", spaceID: space.id)
        #expect(session.selectedSpace?.mode == "work")
        let chatID = try await session.send("Start in Work", spaceID: space.id, workspaceID: "fixture-workspace", collectionID: "fixture-kitchen", settings: settings)
        await session.selectConversation(chatID)
        try await eventually { session.conversations.first(where: { $0.id == chatID })?.isActive == false }
        #expect(session.conversations.first(where: { $0.id == codeID })?.mode == "developer")
        #expect(session.conversations.first(where: { $0.id == chatID })?.collectionId == "fixture-kitchen")
        await #expect(throws: MainsError.self) { try await session.setSpaceMode("chat", spaceID: "fixture-copilot") }

        let (data, _) = try await URLSession.shared.data(from: URL(string: endpoint + "/observations")!)
        let calls = try JSONDecoder().decode([JSONValue].self, from: data)
        let requests = calls.filter { $0["channel"].string == "runs:execute" }
        let code = try #require(requests.first?["args"].array.first)
        #expect(code["workspaceId"].string == "fixture-workspace")
        #expect(code["collectionId"] == .null)
        #expect(code["model"].string == "fixture-deep")
        #expect(code["conversationSettings"]["config"]["effortLevel"].string == "high")
        #expect(code["conversationSettings"]["config"]["permissionMode"].string == "plan")
        #expect(code["attachments"].array.first?["data"].string == Data("Context".utf8).base64EncodedString())
        let work = try #require(requests.last?["args"].array.first)
        #expect(work["workspaceId"] == .null)
        #expect(work["collectionId"].string == "fixture-kitchen")
        let mode = try #require(calls.first { $0["channel"].string == "space:update" })
        #expect(mode["commandId"].string?.isEmpty == false)
        #expect(mode["args"].array.last?["mode"].string == "work")
        #expect(!calls.contains { $0["channel"].string == "providers:updateRunSettings" })

        let restored = BackendSession(storage: storage)
        restored.restore()
        #expect(restored.selectedSpaceID == space.id)
        #expect(restored.homeTargets[space.id]?.workspaceID == "fixture-workspace")
        #expect(restored.settings(for: try #require(restored.selectedSpace)) == settings)
        try session.forget()
        #expect(session.selectedSpaceID == nil && session.homeTargets.isEmpty && session.composerSettings.isEmpty)
    }
}

@Test func codexManagedPolicyAndModelChangesKeepSettingsCompatible() throws {
    let catalog = try JSONValue.object([
        "profilesSupported": .bool(true), "profiles": .array([.object(["id": .string(":workspace"), "description": .string("Managed workspace"), "allowed": .bool(true)])]),
        "allowedSandboxModes": .array([]), "requiresNamedProfile": .bool(true),
    ]).decode(CodexPermissions.self)
    let choices = catalog.choices(current: "workspace-write")
    #expect(choices.first(where: { $0.title == "Auto" })?.id == "profile::workspace")
    #expect(choices.first(where: { $0.id == "danger-full-access" })?.disabledReason != nil)
    var settings = ComposerSettings.defaults(provider: "codex", model: "previous", config: ["modelReasoningEffort": .string("xhigh"), "serviceTier": .string("fast"), "apiKey": .string("must-not-copy")])
    #expect(settings.config["thinkingMode"]?.bool == true)
    let model = try JSONValue.object(["id": .string("narrow"), "displayName": .string("Narrow"), "supportedEffortLevels": .array([.string("low"), .string("high")])]).decode(ModelChoice.self)
    settings.select(model, provider: "codex")
    #expect(settings.effort(provider: "codex") == "high")
    #expect(settings.config["serviceTier"]?.string == "default")
    #expect(settings.config["apiKey"] == nil)
    settings.setPermission("profile::workspace", provider: "codex")
    #expect(settings.permission(provider: "codex") == "profile::workspace")
    settings.setPermission("read-only", provider: "codex")
    #expect(settings.config["permissionProfile"]?.string == "")
}
