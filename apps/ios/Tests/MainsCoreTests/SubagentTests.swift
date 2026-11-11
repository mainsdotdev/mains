import Foundation
import Testing
@testable import MainsCore

private func agentCall(_ id: Int, name: String = "spawnAgent", status: String = "done", task: [String: JSONValue] = [:],
                       lifecycle: [String: JSONValue] = [:], parent: String? = nil, input: [String: JSONValue] = [:]) throws -> ToolCall {
    try JSONValue.object(["id": .number(Double(id)), "toolName": .string(name), "status": .string(status),
        "toolId": .string("call-\(id)"), "createdAt": .number(1000), "parentToolCallId": parent.map(JSONValue.string) ?? .null,
        "input": .object(input), "metadata": .object(["task": .object(task), "subagent": .object(lifecycle)])]).decode(ToolCall.self)
}
private func agentPage(_ snapshot: DemoSubagents.Snapshot, historical: Bool = false) throws -> HistoryPage {
    HistoryPage(artifacts: try snapshot.artifacts.map { try $0.decode(Artifact.self) },
                toolCalls: try snapshot.calls.map { try $0.decode(ToolCall.self) }, turns: [], start: nil,
                end: historical ? HistoryCursor(timestamp: 3000, source: "artifact", id: 9) : nil,
                last: nil, hasOlder: false, hasNewer: historical)
}
private func childEvent(_ id: String, text: String, ts: Double = 2000) -> JSONValue {
    .object(["ts": .number(ts), "event": .object(["type": .string("artifact"), "kind": .string("report"),
        "streamId": .string(id), "content": .string(text),
        "metadata": .object(["parentToolUseId": .string("demo-agent-100"), "isFromSubagent": .bool(true), "streaming": .bool(true)])])])
}

@Test func agentStateUsesProviderLifecycleRatherThanDetachedLaunchAcknowledgement() throws {
    let shell = try agentCall(1, name: "Task", task: ["taskType": .string("local_bash")])
    let mcp = try agentCall(2, name: "Task", task: ["taskType": .string("mcp_task")])
    #expect(SubagentProjection(calls: [shell, mcp]).agents.isEmpty)
    #expect(SubagentProjection.state(try agentCall(3)) == .running)
    #expect(SubagentProjection.state(try agentCall(4, name: "Agent")) == .done)
    #expect(SubagentProjection.state(try agentCall(5, task: ["status": .string("running"), "providerRunId": .string("002")],
        lifecycle: ["phase": .string("completed"), "providerRunId": .string("001")])) == .running)
    #expect(SubagentProjection.state(try agentCall(6, status: "error", lifecycle: ["phase": .string("stopped")])) == .stopped)
    #expect(SubagentProjection.state(try agentCall(7, task: ["isBackgrounded": .bool(true), "backgroundActive": .bool(false)])) == .idle)
}

@Test func continuationsRetainOriginalIdentityAndNewestExecutionWins() throws {
    let first = try agentCall(10, name: "Agent", task: ["taskId": .string("worker"), "providerRunId": .string("001"), "status": .string("completed")], input: ["description": .string("Security review")])
    let current = try agentCall(20, name: "SendMessage", task: ["taskId": .string("worker"), "providerRunId": .string("003"), "status": .string("running")], input: ["to": .string("worker"), "message": .string("Check once more")])
    let late = try agentCall(30, name: "SendMessage", task: ["taskId": .string("worker"), "providerRunId": .string("002"), "status": .string("failed")])
    let projection = SubagentProjection(calls: [late, current, first])
    let agent = try #require(projection.agents.first)
    #expect(projection.agents.count == 1 && agent.id == 10 && agent.title == "Security review")
    #expect(agent.state == .running && agent.latestCallID == 20 && agent.providerRunID == "003")
    #expect(Set(agent.anchors) == ["call-10", "call-20", "call-30"])
    #expect(projection.rootCallIDs == [10, 20, 30])
}

@Test func continuationIdentityDoesNotPromoteUnrelatedMessagesOrBackgroundTasks() throws {
    let continuation = try agentCall(1, name: "SendMessage", task: ["taskId": .string("worker"), "status": .string("running")])
    let ordinary = try agentCall(2, name: "SendMessage", input: ["to": .string("someone"), "message": .string("Hello")])
    let empty = try agentCall(3, name: "SendMessage", task: ["taskId": .string("")])
    let shell = try agentCall(4, name: "SendMessage", task: ["taskId": .string("shell"), "taskType": .string("local_bash")])
    let mcp = try agentCall(5, name: "SendMessage", task: ["taskId": .string("mcp"), "taskType": .string("mcp_task")])
    let projection = SubagentProjection(calls: [ordinary, shell, continuation, mcp, empty])
    #expect(projection.rootCallIDs == [1])
    #expect(projection.agents.count == 1 && projection.agents.first?.agentID == "worker")
}

@Test func knownChildrenFollowParentsAndCyclesDoNotLoseAgents() throws {
    let parent = try agentCall(1, task: ["taskId": .string("parent")])
    let child = try agentCall(2, task: ["taskId": .string("child"), "parentTaskId": .string("parent")])
    let cycleA = try agentCall(3, task: ["taskId": .string("a"), "parentTaskId": .string("b")])
    let cycleB = try agentCall(4, task: ["taskId": .string("b"), "parentTaskId": .string("a")])
    let agents = SubagentProjection(calls: [child, cycleB, parent, cycleA]).agents
    #expect(Set(agents.map(\.id)) == [1, 2, 3, 4])
    let childIndex = agents.firstIndex { $0.id == 2 }, parentIndex = agents.firstIndex { $0.id == 1 }
    #expect(childIndex == parentIndex.map { $0 + 1 })
    #expect(agents.first { $0.id == 2 }?.depth == 1)
}

@Test func mainTranscriptExcludesChildFlowAndKeepsSummaryOutsideFoldedWork() throws {
    let page = try agentPage(DemoSubagents.snapshot(runID: "run", baseID: 100, at: 1000, stage: 2, turnID: 1))
    var transcript = Transcript(); transcript.replace(page)
    #expect(transcript.subagents.count == 2 && transcript.subagents.allSatisfy { $0.state == .done })
    #expect(transcript.rows.count == 1 && transcript.rows[0].kind == .subagents)
    let agent = try #require(transcript.subagents.first { $0.title == "Security" })
    let flow = try #require(transcript.subagentFlow(for: agent))
    #expect(flow.prompt?.contains("security") == true)
    #expect(flow.rows.filter { $0.kind == .tool }.count == 1)
    #expect(flow.rows.filter { $0.kind == .response }.count == 1)
    #expect(flow.rows.allSatisfy { !$0.text.contains("Test review") })
    #expect(flow.report == nil, "The final child message already contains the report.")
    let response = TranscriptRow(id: "intro", kind: .response, text: "Intro", date: Date(), live: false, deferredArtifactID: nil)
    let final = TranscriptRow(id: "final", kind: .response, text: "Final", date: Date(), live: false, deferredArtifactID: nil)
    let section = try #require(TranscriptSection.build([response] + transcript.rows + [final]).first)
    #expect(section.displayedRows(expanded: false).contains { $0.kind == .subagents })
}

@Test func childPreviewsAreBoundedIsolatedAndRetainDateWhenPersisted() throws {
    let initial = try agentPage(DemoSubagents.snapshot(runID: "run", baseID: 100, at: 1000, stage: 0, turnID: 1))
    var transcript = Transcript(); transcript.replace(initial)
    let agent = try #require(transcript.subagents.first { $0.title == "Security" })
    for index in 0..<6 { transcript.receive(childEvent("extra-\(index)", text: "preview", ts: Double(index))) }
    transcript.receive(childEvent("demo-agent-100-report", text: String(repeating: "x", count: 20_000), ts: 2000))
    let previews = try #require(transcript.subagentFlow(for: agent))
    #expect(previews.rows.filter { $0.kind == .response }.count == 4)
    #expect(previews.rows.map(\.text.count).max() == 8192)
    #expect(transcript.rows.allSatisfy { $0.kind != .response })
    #expect(transcript.page == initial, "Live child text never mutates the cacheable page.")
    let before = try #require(previews.rows.first { $0.id == "stream:demo-agent-100-report" })
    let completed = try agentPage(DemoSubagents.snapshot(runID: "run", baseID: 100, at: 1000, stage: 1, turnID: 1))
    transcript.replace(completed)
    let persisted = try #require(transcript.subagentFlow(for: agent)?.rows.first { $0.id == before.id })
    #expect(persisted.date == before.date && !persisted.live)
    transcript.receive(childEvent("demo-agent-100-report", text: "late stale snapshot"))
    #expect(transcript.subagentFlow(for: agent)?.rows.first { $0.id == before.id }?.text == persisted.text)
    transcript.clearStreams()
    #expect(transcript.subagentFlow(for: agent)?.rows.filter { $0.kind == .response }.count == 1)
    transcript.replace(try agentPage(DemoSubagents.snapshot(runID: "run", baseID: 100, at: 1000, stage: 0, turnID: 1), historical: true), direction: "older")
    transcript.receive(childEvent("historical-hidden", text: "Do not inject this into history"))
    #expect(transcript.subagentFlow(for: agent)?.rows.allSatisfy { $0.kind != .response } == true)
}

@Test func agentIdentityAnchorsChildMessagesWithoutParentToolIDAndPreservesDeferredReads() throws {
    let root = try agentCall(1, lifecycle: ["agentId": .string("worker"), "agentType": .string("security")])
    let artifact = Artifact(id: 2, runId: "run", kind: "report", content: "A bounded child preview", metadata: .object([
        "agentId": .string("worker"), "mobileContentDeferred": .object(["chars": .number(50_000)])]), createdAt: Date())
    let page = HistoryPage(artifacts: [artifact], toolCalls: [root], turns: [], start: nil, end: nil, last: nil, hasOlder: false, hasNewer: false)
    var transcript = Transcript(); transcript.replace(page)
    let agent = try #require(transcript.subagents.first)
    #expect(transcript.rows.allSatisfy { $0.kind != .response })
    #expect(transcript.subagentFlow(for: agent)?.rows.first?.deferredArtifactID == 2)
    #expect(transcript.page == page)
}
