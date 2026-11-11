import Foundation
import Testing
@testable import MainsCore

private func activityPage(_ artifacts: [Artifact] = [], tools: [ToolCall] = [], historical: Bool = false) -> HistoryPage {
    HistoryPage(artifacts: artifacts, toolCalls: tools, turns: [], start: nil,
                end: historical ? HistoryCursor(timestamp: 3000, source: "artifact", id: 9) : nil,
                last: nil, hasOlder: false, hasNewer: historical)
}
private func activityArtifact(_ id: Int, kind: String, text: String, second: Double, metadata: JSONValue? = nil) -> Artifact {
    Artifact(id: id, runId: "run", kind: kind, content: text, metadata: metadata, createdAt: Date(timeIntervalSince1970: second))
}
private func thoughtEvent(_ text: String, id: String = "thought", kind: String = "thinking", source: String = "agent_thinking_streaming", metadata: [String: JSONValue] = [:]) -> JSONValue {
    .object(["ts": .number(2000), "event": .object([
        "type": .string("artifact"), "kind": .string(kind), "content": .string(text), "streamId": .string(id),
        "metadata": .object(metadata.merging(["source": .string(source)]) { old, _ in old }),
    ])])
}
private func activityTool(_ id: Int, metadata: JSONValue = .null, status: String = "running") throws -> ToolCall {
    try JSONValue.object(["id": .number(Double(id)), "toolName": .string("Bash"), "status": .string(status),
        "input": .object(["command": .string("npm test")]), "metadata": metadata,
        "createdAt": .object(["$date": .string("1970-01-01T00:00:02Z")])]).decode(ToolCall.self)
}

@Test func providerThoughtFormatsStayBoundedAndNeverBecomeAssistantMessages() {
    for (kind, source) in [("report", "agent_thinking_streaming"), ("thinking", "agent_thinking_streaming"), ("thinking", "assistant.reasoning_delta")] {
        var transcript = Transcript()
        transcript.receive(thoughtEvent("## **Checking exports**", kind: kind, source: source))
        #expect(transcript.activity?.label == "Checking exports")
        #expect(transcript.rows.isEmpty && transcript.page == nil)
        transcript.receive(thoughtEvent(String(repeating: "x", count: 50_000), kind: kind, source: source))
        #expect(transcript.activity?.label.count == 241)
        #expect(AgentActivity.preview("Earlier thought\n\n`Latest step`") == "Latest step")
        transcript.receive(thoughtEvent("A live answer", id: "answer", kind: "report", source: "assistant.message_delta"))
        #expect(transcript.activity == nil && transcript.rows.first?.text == "A live answer")
    }
}

@Test func clearedAndSettledThoughtsCannotResurrectFromLateSnapshots() {
    var transcript = Transcript()
    transcript.receive(thoughtEvent("Checking exports"))
    transcript.receive(thoughtEvent(""))
    #expect(transcript.activity?.label == "Thinking")
    transcript.receive(thoughtEvent("Late old thought"))
    #expect(transcript.activity?.label == "Thinking")
    transcript.receive(thoughtEvent("New thought", id: "new"))
    #expect(transcript.activity?.label == "New thought")
    transcript.settleTurn()
    transcript.receive(thoughtEvent("Late settled thought", id: "new"))
    #expect(transcript.activity?.label == "Thinking")
    transcript.receive(thoughtEvent("Reconnect preview", id: "reconnect"))
    transcript.clearStreams()
    #expect(transcript.activity?.label == "Thinking")
}

@Test func activeToolTakesPriorityWhileAssistantStreamingNeedsNoExtraLoader() throws {
    var transcript = Transcript()
    transcript.receive(thoughtEvent("Checking the workspace"))
    transcript.receive(delta("Writing the response"))
    #expect(transcript.activity == nil)
    transcript.replace(activityPage(tools: [try activityTool(8)]))
    #expect(transcript.activity?.toolID == 8)
    #expect(transcript.activity?.label == "Running npm test")
    transcript.replace(activityPage(tools: [try activityTool(8, status: "done")]))
    #expect(transcript.activity == nil)
    transcript.settleTurn()
    #expect(transcript.activity?.label == "Thinking")
}

@Test func activityIsScopedToTheForegroundPromptAndNeverInvadesHistoricalPages() throws {
    let prompt = activityArtifact(1, kind: "user-prompt", text: "Hi", second: 1, metadata: .object(["turnId": .number(2)]))
    let old = activityArtifact(0, kind: "thinking", text: "Old thought", second: 0)
    let hidden = activityArtifact(2, kind: "report", text: "Child thought", second: 2, metadata: .object(["kind": .string("thinking"), "isFromSubagent": .bool(true)]))
    let legacy = activityArtifact(3, kind: "log", text: "[reasoning] Inspecting the project", second: 2)
    var transcript = Transcript()
    transcript.replace(activityPage([old, prompt, hidden, legacy], tools: [try activityTool(1, metadata: .object(["turnId": .number(1)]))]))
    #expect(transcript.activity?.label == "Inspecting the project")
    #expect(transcript.rows.filter { $0.kind != .tool }.map(\.text) == ["Hi"])
    transcript.receive(thoughtEvent("Child reasoning", metadata: ["parentToolCallId": .number(8)]))
    transcript.receive(thoughtEvent("Voice reasoning", metadata: ["voice": .bool(true)]))
    #expect(transcript.activity?.label == "Inspecting the project")
    let nextPrompt = activityArtifact(4, kind: "user-prompt", text: "Next", second: 3)
    transcript.replace(activityPage([old, prompt, hidden, legacy, nextPrompt]))
    #expect(transcript.activity?.label == "Thinking")
    transcript.replace(activityPage([prompt], tools: [try activityTool(8)], historical: true), direction: "older")
    transcript.receive(thoughtEvent("Live thinking"))
    #expect(transcript.activity == nil && !transcript.rows.contains { $0.text == "Live thinking" })
}

@Test func storedThinkingMetadataAndLegacyLogsStayOutsideProse() {
    var transcript = Transcript()
    let artifact = activityArtifact(1, kind: "report", text: "**Inspecting dependencies**", second: 2,
                                    metadata: .object(["source": .string("agent_thinking_streaming")]))
    transcript.replace(activityPage([artifact]))
    #expect(transcript.activity?.label == "Inspecting dependencies")
    #expect(transcript.rows.isEmpty)
}

@Test @MainActor func demoDrivesRealThinkingAndToolLifecyclesWithoutCachingThoughts() async throws {
    let backend = try DemoBackend(stepDelay: .milliseconds(250), streamDelay: .milliseconds(1))
    let storage = MemoryStorage()
    let session = BackendSession(storage: storage, makeTransport: { _ in DemoTransport(backend: backend) })
    session.restore(); session.setActive(true); try session.startDemo()
    defer { session.exitDemo() }
    try await eventually { session.isConnected }
    session.grantConsent(providerID: "codex", backendID: DemoBackend.backendID)
    let id = try await session.send("Review the sample workspace", spaceID: "codex", workspaceID: session.homeTargets["codex"]?.workspaceID)
    await session.selectConversation(id)
    try await eventually { session.transcript.activity?.label == "Reviewing the sample workspace" }
    #expect(!session.transcript.rows.contains { $0.text == "Reviewing the sample workspace" })
    try await eventually { session.transcript.activity?.toolID != nil }
    #expect(session.transcript.activity?.title == "Searching" || session.transcript.activity?.title == "Reading")
    try await eventually { session.conversations.first { $0.id == id }?.status == "succeeded" }
    #expect(session.transcript.page?.toolCalls.allSatisfy { $0.status == "done" } == true)
    #expect(storage.snapshot == nil, "Demo activity must not write to the real computer’s cache.")
    let artifacts = try #require(session.transcript.page).artifacts
    #expect(!artifacts.contains { ["Reviewing the sample workspace", "Preparing the sample result"].contains($0.content ?? "") })
}
