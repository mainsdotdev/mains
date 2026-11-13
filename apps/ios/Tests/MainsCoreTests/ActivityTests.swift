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

@Test func laterForegroundOutputRetiresStaleToolIndicatorsWithoutChangingWireStatus() throws {
    let search = try JSONValue.object([
        "id": .number(8), "toolName": .string("Glob"), "status": .string("running"),
        "input": .object(["pattern": .string("*")]), "createdAt": .number(2000),
    ]).decode(ToolCall.self)
    var transcript = Transcript()
    transcript.replace(activityPage(tools: [search]))
    #expect(transcript.rows.first?.live == true)
    #expect(transcript.activity?.label == "Searching *")

    // Some providers leave the persisted call running until the run-end sweep.
    // Desktop retires its spinner when later foreground output has arrived.
    let reply = activityArtifact(3, kind: "report", text: "I found the hero components.", second: 3)
    transcript.replace(activityPage([reply], tools: [search]))
    #expect(transcript.rows.first { $0.tool?.id == search.id }?.live == false)
    #expect(transcript.rows.first { $0.tool?.id == search.id }?.toolPresentation?.verb == "Searched")
    #expect(transcript.activity?.toolID == nil)
    #expect(transcript.page?.toolCalls.first?.status == "running")

    let next = try JSONValue.object([
        "id": .number(9), "toolName": .string("Bash"), "status": .string("running"),
        "input": .object(["command": .string("npm test")]), "createdAt": .number(4000),
    ]).decode(ToolCall.self)
    transcript.replace(activityPage([reply], tools: [search, next]))
    #expect(transcript.rows.filter(\.live).compactMap { $0.tool?.id } == [9])
    #expect(transcript.activity?.toolID == 9)
}

private func lifecycleTool(_ id: Int, _ name: String, status: String = "running", at second: Double,
                           output: JSONValue = .null, metadata: JSONValue = .null) throws -> ToolCall {
    try JSONValue.object(["id": .number(Double(id)), "toolName": .string(name), "status": .string(status),
                          "createdAt": .number(second * 1000), "output": output, "metadata": metadata]).decode(ToolCall.self)
}

@Test func trailingParallelToolsKeepRunningThroughPartialOutputThinkingAndChildActivity() throws {
    let calls = [try lifecycleTool(8, "Glob", at: 2, output: .string("Partial stdout")),
                 try lifecycleTool(9, "Read", status: "queued", at: 3)]
    let artifacts = [
        activityArtifact(2, kind: "thinking", text: "Inspecting the workspace", second: 4),
        activityArtifact(3, kind: "tool_progress", text: "Still working", second: 5),
        activityArtifact(4, kind: "report", text: "Child result", second: 6, metadata: .object(["isFromSubagent": .bool(true)])),
    ]
    var transcript = Transcript()
    transcript.replace(activityPage(artifacts, tools: calls))
    transcript.receive(thoughtEvent("Inspecting exports"))
    #expect(transcript.rows.filter(\.live).compactMap { $0.tool?.id } == [8, 9])
    #expect(transcript.rows.compactMap(\.toolPresentation).map(\.verb) == ["Searching…", "Reading…"])
    #expect(transcript.activity?.toolID == 9)
}

@Test func completedSiblingRetiresOnlyEarlierToolsAndPreservesRealFailures() throws {
    let calls = [try lifecycleTool(8, "Glob", at: 2), try lifecycleTool(9, "Read", status: "done", at: 3),
                 try lifecycleTool(10, "Bash", status: "queued", at: 4), try lifecycleTool(11, "Bash", at: 5)]
    var transcript = Transcript()
    transcript.replace(activityPage(tools: calls))
    #expect(transcript.rows.filter(\.live).compactMap { $0.tool?.id } == [10, 11])
    #expect(transcript.rows.first?.toolPresentation?.verb == "Searched")
    #expect(transcript.activity?.toolID == 11)

    let terminal = [try lifecycleTool(12, "Bash", status: "error", at: 6, output: .string("Exit code 1")),
                    try lifecycleTool(13, "Bash", status: "canceled", at: 7)]
    transcript.replace(activityPage(tools: calls + terminal))
    #expect(!transcript.rows.contains { $0.live })
    #expect(transcript.rows.first { $0.tool?.id == 12 }?.toolPresentation?.failed == true)
    #expect(transcript.rows.first { $0.tool?.id == 12 }?.toolPresentation?.body == "Exit code 1")
    #expect(transcript.rows.last?.tool?.status == "canceled")
    #expect(transcript.page?.toolCalls == calls + terminal)
}

@Test func tiedTimestampsUseDesktopNumericOrderingBeforeProjectingToolStatus() throws {
    let calls = [try lifecycleTool(10, "Read", status: "done", at: 2),
                 try lifecycleTool(100, "Bash", at: 2), try lifecycleTool(9, "Glob", at: 2)]
    let reply = activityArtifact(99, kind: "report", text: "Checking files", second: 2)
    var transcript = Transcript()
    for _ in 0..<2 {
        transcript.replace(activityPage([reply], tools: calls))
        #expect(transcript.rows.map(\.id) == ["artifact:99", "tool:9", "tool:10", "tool:100"])
        #expect(transcript.rows.filter(\.live).compactMap { $0.tool?.id } == [100])
        #expect(transcript.activity?.toolID == 100)
    }
}

@Test func backgroundMCPTaskKeepsItsOwnLifecycleAfterLaunchAcknowledgement() throws {
    let task: JSONValue = .object(["taskType": .string("mcp_task"), "status": .string("running"),
                                   "isBackgrounded": .bool(true), "backgroundActive": .bool(true)])
    let call = try lifecycleTool(8, "mcp__example__research", status: "done", at: 2, metadata: .object(["task": task]))
    let reply = activityArtifact(3, kind: "report", text: "Continuing while the research runs", second: 3)
    var transcript = Transcript()
    transcript.replace(activityPage([reply], tools: [call]))
    #expect(transcript.rows.first?.toolPresentation?.running == true)
    #expect(transcript.activity?.toolID == 8)
    let finished = try lifecycleTool(8, call.toolName, status: "done", at: 2,
                                    metadata: .object(["task": .object(["taskType": .string("mcp_task"), "phase": .string("completed")])]))
    transcript.replace(activityPage([reply], tools: [finished]))
    #expect(transcript.rows.first?.toolPresentation?.running == false)
    #expect(transcript.activity?.toolID == nil)
}

@Test func toolGroupSummariesUseDesktopPhrasesInsteadOfClaimingEverythingIsSearching() throws {
    let calls = [try lifecycleTool(1, "Glob", at: 1), try lifecycleTool(2, "Glob", status: "done", at: 2),
                 try lifecycleTool(3, "Read", status: "done", at: 3), try lifecycleTool(4, "Read", status: "done", at: 4)]
    #expect(ToolGroupPresentation(calls).summary == "Read files, looked for files")
    let edit = try lifecycleTool(5, "Edit", at: 5), command = try lifecycleTool(6, "Bash", at: 6)
    #expect(ToolGroupPresentation([command, calls[2], edit]).summary == "Edited a file, read a file, ran a command")
    #expect(ToolGroupPresentation([edit, calls[2], command]).summary == "Edited a file, read a file, ran a command")
    #expect(ToolGroupPresentation([command, command]).summary == "Ran commands")
    #expect(ToolGroupPresentation([]).summary.isEmpty)
    let vendors = [try lifecycleTool(7, "mcp__linear__list_issues", at: 7),
                   try lifecycleTool(8, "mcp__codex_apps__gmail.search_emails", at: 8)]
    #expect(ToolGroupPresentation(vendors).summary == "Used the Linear and Gmail integrations")
    let atlas = try lifecycleTool(9, "mcp__mains__AtlasUpdatePage", status: "done", at: 9,
                                  output: .string("{\"isError\":true}"))
    #expect(ToolGroupPresentation([atlas]).summary == "Tried to update an Atlas page")
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
