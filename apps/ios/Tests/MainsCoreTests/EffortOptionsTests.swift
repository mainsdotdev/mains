import Testing
@testable import MainsCore

@Test func effortControlsFollowEachModelsCapabilities() {
    #expect(EffortControlKind.resolve(provider: "claude_code", levels: []) == .thinking)
    #expect(EffortControlKind.resolve(provider: "copilot_cli", levels: []) == .hidden)
    #expect(EffortControlKind.resolve(provider: "copilot_cli", levels: ["high"]) == .toggle("high"))
    #expect(EffortControlKind.resolve(provider: "codex", levels: ["high"]) == .hidden)
    #expect(EffortControlKind.resolve(provider: "claude_code", levels: ["high", "low", "high", "ultracode"]) == .slider(["", "low", "high"]))
    #expect(EffortControlKind.resolve(provider: "codex", levels: ["high", "low"]) == .slider(["low", "high"]))
    #expect(EffortControlKind.resolve(provider: "claude_code", levels: EffortControlKind.ranked) == .list([""] + EffortControlKind.ranked))
    #expect(EffortControlKind.ordered(["ultra", "high", "ultra", "", "xhigh"]) == ["high", "xhigh", "ultra"])
}

@Test func effortThumbRetainsSpecialAndOlderSavedValues() {
    #expect(EffortControlKind.stopIndex(in: ["", "medium", "high", "xhigh"], value: "ultracode") == 3)
    #expect(EffortControlKind.stopIndex(in: ["low", "high"], value: "xhigh") == 1)
    #expect(EffortControlKind.stopIndex(in: ["low", "high"], value: "") == 1)
    #expect(EffortControlKind.stopIndex(in: ["", "low", "high"], value: "") == 0)
}
