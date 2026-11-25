import Foundation
import Testing
@testable import MainsCore

private func pairing(_ backend: String = "computer", device: String = "phone") -> PairedBackend {
    PairedBackend(descriptor: BackendDescriptor(backendId: backend, name: "Mac", appVersion: "1", protocolVersion: Wire.protocolVersion, capabilities: ["runs"], serverTime: ""),
                  endpoints: [URL(string: "http://127.0.0.1:1")!], deviceId: device, deviceToken: "token-never-a-draft")
}

@Test func textDraftFilesSurviveNewStoreInstancesAndAreSeparatedByComputerDeviceAndOwner() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = TextDraftFileStore(root: root)
    let chat = TextDraftKey(backendID: "a", deviceID: "phone", owner: .conversation, ownerID: "../same")
    let home = TextDraftKey(backendID: "a", deviceID: "phone", owner: .home, ownerID: "../same")
    let other = TextDraftKey(backendID: "b", deviceID: "phone", owner: .conversation, ownerID: "../same")
    let text = "İstanbul 👋 é\n**An unfinished message**"
    try store.save(text, for: chat); try store.save("Home draft", for: home); try store.save("Other computer", for: other)
    let reopened = TextDraftFileStore(root: root)
    #expect(try reopened.load(chat) == text && reopened.load(home) == "Home draft" && reopened.load(other) == "Other computer")
    let differentDevice = TextDraftKey(backendID: "a", deviceID: "new-phone", owner: .conversation, ownerID: "../same")
    #expect(try reopened.load(differentDevice) == nil)
    try reopened.save("", for: chat)
    #expect(try reopened.load(chat) == nil)
    try reopened.remove(backendID: "a", deviceID: "phone")
    #expect(try reopened.load(home) == nil && reopened.load(other) == "Other computer")
}

@Test func overlargeDraftsDoNotTruncateAnExistingSavedTextAndClearingRemovesIt() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = TextDraftFileStore(root: root), key = TextDraftKey(backendID: "b", deviceID: "d", owner: .home, ownerID: "s")
    try store.save("Keep", for: key)
    #expect(throws: MainsError.self) { try store.save(String(repeating: "x", count: TextDraftFileStore.maxTextBytes + 1), for: key) }
    #expect(try store.load(key) == "Keep")
    let escapedText = String(repeating: "\n", count: TextDraftFileStore.maxTextBytes)
    try store.save(escapedText, for: key)
    #expect(try store.load(key) == escapedText)
    try store.save("", for: key); #expect(try store.load(key) == nil)
}

@Test @MainActor func sessionsRestoreOnlyUnsentTextAndForgetRetiresOldDraftWriters() throws {
    let storage = MemoryStorage(); storage.pairing = pairing()
    let first = BackendSession(storage: storage); first.restore()
    let draft = first.draft(for: "old-chat")
    draft.text = "Unsent 👋"; draft.attachments = [PromptAttachment(name: "secret.pdf", type: "document", mimeType: "application/pdf", bytes: Data([1]))]
    first.homeDraft(for: "space").text = "A separate home draft"
    let reopened = BackendSession(storage: storage); reopened.restore()
    let restored = reopened.draft(for: "old-chat")
    #expect(restored.text == "Unsent 👋" && restored.attachments.isEmpty && restored.contextSkills.isEmpty)
    #expect(reopened.homeDraft(for: "space").text == "A separate home draft")
    let sent = try #require(restored.begin())
    let duringSend = BackendSession(storage: storage); duringSend.restore()
    #expect(duringSend.draft(for: "old-chat").text.isEmpty)
    restored.text = "Newer input"; restored.accept(sent)
    let afterACK = BackendSession(storage: storage); afterACK.restore()
    #expect(afterACK.draft(for: "old-chat").text == "Newer input")
    try first.forget()
    draft.text = "A stale view callback"
    #expect(storage.draftTexts.isEmpty)
}

@Test @MainActor func retainedSendingTextAndUnconfirmedMessagesNeverReturnAsFreshDrafts() throws {
    let storage = MemoryStorage(); storage.pairing = pairing()
    let session = BackendSession(storage: storage); session.restore()
    let draft = session.draft(for: "chat")
    draft.text = "Already being delivered"
    let sent = try #require(draft.begin(retainingContent: true))
    #expect(storage.draftTexts.isEmpty)
    draft.reject(sent, message: "Not accepted", uncertain: false)
    #expect(storage.draftTexts.values.contains("Already being delivered"))
    let unknown = try #require(draft.begin(retainingContent: true))
    draft.reject(unknown, message: "Unknown outcome", uncertain: true)
    #expect(storage.draftTexts.isEmpty && draft.text.isEmpty)
}

@Test @MainActor func demoTextNeverWritesPersistentDrafts() throws {
    let storage = MemoryStorage()
    let demo = BackendSession(storage: storage)
    try demo.startDemo(); defer { demo.exitDemo() }
    demo.homeDraft(for: "codex").text = "Demo text"
    demo.draft(for: DemoBackend.tourID).text = "Demo conversation"
    #expect(storage.draftTexts.isEmpty)
}

@Test @MainActor func editingAQueuedMessagePreservesTheDurableNormalDraftAcrossRelaunch() async throws {
    let backend = try DemoBackend(stepDelay: .seconds(30)), storage = MemoryStorage()
    storage.pairing = backend.pairing
    let session = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
    session.restore(); session.setActive(true)
    defer { session.setActive(false); backend.shutdown() }
    try await eventually { session.isConnected }
    session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
    let id = try await session.send("Initial", spaceID: "codex", workspaceID: backend.defaultWorkspaceID)
    await session.selectConversation(id)
    try await eventually { session.pendingMessage == nil }
    let draft = session.draft(for: id), queue = session.messageQueue(for: id)
    queue.pause("Hold")
    draft.text = "Queue-owned text"; try session.submitQueuedDraft(id)
    draft.text = "Normal unsent text"
    let queuedID = try #require(queue.messages.first?.id)
    session.editQueuedMessage(id, id: queuedID); draft.text = "Editing the queued text"
    let reopened = BackendSession(storage: storage); reopened.restore()
    #expect(reopened.draft(for: id).text == "Normal unsent text")
    session.cancelQueuedEdit(id)
    #expect(draft.text == "Normal unsent text" && queue.messages.first?.input.text == "Queue-owned text")
}
