import Foundation

/// Prepared lifecycle snapshots, never an actual provider execution.
enum DemoSubagents {
    struct Snapshot {
        let calls: [JSONValue]
        let artifacts: [JSONValue]
    }
    static func snapshot(runID: String, baseID: Int, at: Double, stage: Int, turnID: Int) -> Snapshot {
        var calls: [JSONValue] = [], artifacts: [JSONValue] = []
        for index in 0..<2 {
            let name = index == 0 ? "Security" : "Tests"
            let prompt = index == 0 ? "Review the bundled sample for security risks. Return a short report." : "Review the bundled sample for test gaps. Return a short report."
            let report = index == 0 ? "## Security review\n\nThe sample keeps credentials in Keychain and live previews in memory. Verify backend ownership before applying asynchronous results.\n\nThis is a prepared demo report." : "## Test review\n\nCover reconnection, duplicate delivery receipts and bounded history paging. Add a case for child-agent status changes.\n\nThis is a prepared demo report."
            let done = stage > index
            let anchor = "demo-agent-\(baseID + index)"
            let agentID = "sample-\(baseID)-\(name.lowercased())"
            let started = at + Double(index) * 20
            let ended = at + Double(index + 1) * 1500
            let common: [String: JSONValue] = ["turnId": .number(Double(turnID))]
            calls.append(.object([
                "id": .number(Double(baseID + index)), "runId": .string(runID), "toolId": .string(anchor),
                "toolName": .string("spawnAgent"), "status": .string(done ? "done" : "running"),
                "createdAt": .number(started), "startedAt": .number(started), "endedAt": done ? .number(ended) : .null,
                "input": .object(["subagent_type": .string(name.lowercased()), "prompt": .string(prompt)]),
                "output": done ? .string(report) : .null,
                "metadata": .object(common.merging([
                    "subagent": .object(["agentId": .string(agentID), "agentType": .string(name.lowercased()),
                        "phase": .string(done ? "completed" : "running"), "prompt": .string(prompt), "result": done ? .string(report) : .null]),
                    "task": .object(["taskId": .string(agentID), "taskType": .string("local_agent"),
                        "status": .string(done ? "completed" : "running"), "usage": .object(["durationMs": .number(Double(index + 1) * 1500)])]),
                ]) { _, new in new }),
            ]))
            calls.append(.object([
                "id": .number(Double(baseID + 2 + index)), "runId": .string(runID), "toolId": .string(anchor + "-read"),
                "parentToolCallId": .string(anchor), "toolName": .string("Read"), "status": .string(done ? "done" : "running"),
                "createdAt": .number(started + 30), "startedAt": .number(started + 30), "endedAt": done ? .number(ended - 10) : .null,
                "input": .object(["file_path": .string(index == 0 ? "/Demo/mains/Sources/Session.swift" : "/Demo/mains/Tests/SessionTests.swift")]),
                "output": done ? .string(index == 0 ? "Keychain credentials and bounded live previews." : "Session reconnection and command-receipt tests.") : .null,
                "metadata": .object(["isFromSubagent": .bool(true), "agentId": .string(agentID)]),
            ]))
            if done {
                artifacts.append(.object([
                    "id": .number(Double(baseID + 4 + index)), "runId": .string(runID), "kind": .string("report"),
                    "content": .string(report), "createdAt": .number(ended),
                    "metadata": .object(["parentToolUseId": .string(anchor), "isFromSubagent": .bool(true),
                        "agentId": .string(agentID), "streamId": .string(anchor + "-report")]),
                ]))
            }
        }
        return Snapshot(calls: calls, artifacts: artifacts)
    }
}
