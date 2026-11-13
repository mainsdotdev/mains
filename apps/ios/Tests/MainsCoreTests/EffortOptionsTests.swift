import Testing
@testable import MainsCore

@Test func effortControlsFollowEachModelsCapabilities() {
    #expect(EffortControlKind.resolve(provider: "claude_code", levels: []) == .thinking)
    #expect(EffortControlKind.resolve(provider: "copilot_cli", levels: []) == .hidden)
    #expect(EffortControlKind.resolve(provider: "copilot_cli", levels: ["high"]) == .toggle("high"))
    #expect(EffortControlKind.resolve(provider: "codex", levels: ["high"]) == .hidden)
    #expect(EffortControlKind.resolve(provider: "claude_code", levels: ["high", "low", "high", "ultracode"]) == .slider(["", "low", "high"]))
    #expect(EffortControlKind.resolve(provider: "codex", levels: ["high", "low"]) == .slider(["low", "high"]))
    #expect(EffortControlKind.resolve(provider: "claude_code", levels: EffortControlKind.ranked) == .slider([""] + EffortControlKind.ranked))
    #expect(EffortControlKind.ordered(["ultra", "high", "ultra", "", "xhigh"]) == ["high", "xhigh", "ultra"])
    #expect(EffortControlKind.ordered(["high", "default", "none", "low", "none"]) == ["none", "default", "low", "high"])
    #expect(EffortControlKind.resolve(provider: "opencode", levels: ["high", "none", "low"]) == .slider(["none", "", "low", "high"]))
    #expect(EffortControlKind.resolve(provider: "opencode", levels: ["high", "none", "default", "low"]) == .slider(["none", "default", "low", "high"]))
    #expect(EffortControlKind.resolve(provider: "opencode", levels: ["low", "medium", "high", "xhigh", "max", "none"]) == .slider(["none", "", "low", "medium", "high", "xhigh", "max"]))
}

@Test func effortThumbRetainsSpecialAndOlderSavedValues() {
    #expect(EffortControlKind.stopIndex(in: ["", "medium", "high", "xhigh"], value: "ultracode") == 3)
    #expect(EffortControlKind.stopIndex(in: ["low", "high"], value: "xhigh") == 1)
    #expect(EffortControlKind.stopIndex(in: ["low", "high"], value: "") == 1)
    #expect(EffortControlKind.stopIndex(in: ["", "low", "high"], value: "") == 0)
    #expect(EffortControlKind.stopIndex(in: ["none", "", "low", "high"], value: "none") == 0)
    #expect(EffortControlKind.stopIndex(in: ["none", "", "low", "high"], value: "") == 1)
    #expect(EffortControlKind.stopIndex(in: ["none", "default", "low", "high"], value: "") == 1)
}

@Test func sevenLunaStopsFitTheExpandedSliderAndAdaptWithoutLosingValues() {
    let stops = ["none", "", "low", "medium", "high", "xhigh", "max"]
    let luna = EffortControlKind.resolve(provider: "opencode", levels: ["low", "medium", "high", "xhigh", "max", "none"])
    // A 402-point host leaves 272 points between the expanded thumb endpoints.
    #expect(luna.fittingSlider(trackLength: 272) == .slider(stops))
    #expect(luna.fittingSlider(trackLength: 264) == .slider(stops))
    #expect(luna.fittingSlider(trackLength: 244) == .list(stops))
    #expect(luna.fittingSlider(trackLength: 272, minimumStopSpacing: 55) == .list(stops))
    #expect(luna.fittingSlider(trackLength: 600, prefersMenu: true) == .list(stops))
    #expect(luna.fittingSlider(trackLength: .nan) == .list(stops))
    #expect(EffortControlKind.resolve(provider: "opencode", levels: EffortControlKind.ranked + ["none"]) == .list(["none", ""] + EffortControlKind.ranked))
    #expect(EffortControlKind.thinking.fittingSlider(trackLength: 0) == .thinking)
    for (index, value) in stops.enumerated() { #expect(EffortControlKind.stopIndex(in: stops, value: value) == index) }
    #expect(ComposerSettings.effortLabel("", provider: "opencode") == "Default")
    #expect(ComposerSettings.effortLabel("none", provider: "opencode") == "None")
}
