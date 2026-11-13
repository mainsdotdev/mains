import Testing
@testable import MainsCore

@Test func effortControlsFollowEachModelsCapabilities() {
    #expect(EffortControlKind.resolve(provider: "claude_code", levels: []) == .thinking)
    #expect(EffortControlKind.resolve(provider: "copilot_cli", levels: []) == .hidden)
    #expect(EffortControlKind.resolve(provider: "copilot_cli", levels: ["high"]) == .toggle("high"))
    #expect(EffortControlKind.resolve(provider: "codex", levels: ["high"]) == .hidden)
    #expect(EffortControlKind.resolve(provider: "claude_code", levels: ["high", "low", "high", "ultracode"]) == .slider(["", "low", "high"]))
    #expect(EffortControlKind.resolve(provider: "codex", levels: ["high", "low"]) == .slider(["low", "high"]))
    #expect(EffortControlKind.resolve(provider: "claude_code", levels: EffortControlKind.ranked) == .list([""] + EffortControlKind.ranked + ["ultracode"]))
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
    #expect(EffortControlKind.resolve(provider: "claude_code", levels: ["low", "medium", "high", "xhigh", "max"]) == .slider(["", "low", "medium", "high", "xhigh", "max", "ultracode"]))
    #expect(EffortControlKind.resolve(provider: "claude_code", levels: ["xhigh"]) == .slider(["", "xhigh", "ultracode"]))
    #expect(EffortControlKind.stopIndex(in: ["", "high", "xhigh", "ultracode"], value: "ultracode") == 3)
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

@Test func ultracodeDoesNotCarryIntoAnUnsupportedModel() throws {
    for (levels, expected) in [(["max", "low", "medium", "high"], "max"), (["high", "low", "medium"], "high"), (["high"], "high")] {
        let model = try JSONValue.object([
            "id": .string("sonnet-4.6"), "displayName": .string("Sonnet 4.6"),
            "supportedEffortLevels": .array(levels.map(JSONValue.string)),
        ]).decode(ModelChoice.self)
        var settings = ComposerSettings(model: "sonnet-5", config: [
            "ultracode": .bool(true), "effortLevel": .string("low"), "thinkingMode": .bool(true),
        ])
        settings.select(model, provider: "claude_code")
        #expect(settings.model == model.id)
        #expect(settings.config["ultracode"]?.bool == false)
        #expect(settings.effort(provider: "claude_code") == expected)
        #expect(settings.config["effortLevel"]?.string == expected)
        #expect(settings.config["thinkingMode"]?.bool == true)
    }
}

@Test func olderUltracodeSettingsDisplayTheSupportedTierWithoutMutatingTheSavedValue() throws {
    let model = try JSONValue.object([
        "id": .string("sonnet-4.6"), "displayName": .string("Sonnet 4.6"),
        "supportedEffortLevels": .array(["max", "low", "medium", "high"].map(JSONValue.string)),
    ]).decode(ModelChoice.self)
    let settings = ComposerSettings(model: model.id, config: ["ultracode": .bool(true), "effortLevel": .string("low")])
    let value = settings.effort(provider: "claude_code", model: model)
    #expect(value == "max")
    #expect(ComposerSettings.effortLabel(value) == "Max")
    let stops = ["", "low", "medium", "high", "max"]
    #expect(stops[EffortControlKind.stopIndex(in: stops, value: value)] == value)
    #expect(settings.effort(provider: "claude_code") == "ultracode")
    #expect(settings.config["effortLevel"]?.string == "low")
    #expect(settings.effort(provider: "claude_code", model: nil) == "ultracode")
}

@Test func modelChangesRetainSupportedUltracodeAndThinkingOnlyIntent() throws {
    let capable = try JSONValue.object([
        "id": .string("capable"), "displayName": .string("Capable"),
        "supportedEffortLevels": .array(["low", "high", "xhigh", "max"].map(JSONValue.string)),
    ]).decode(ModelChoice.self)
    var settings = ComposerSettings(model: "previous", config: [
        "ultracode": .bool(true), "effortLevel": .string("low"), "thinkingMode": .bool(true),
    ])
    settings.select(capable, provider: "claude_code")
    #expect(settings.effort(provider: "claude_code", model: capable) == "ultracode")
    #expect(settings.config["ultracode"]?.bool == true)

    let thinkingOnly = try JSONValue.object(["id": .string("thinking"), "displayName": .string("Thinking")]).decode(ModelChoice.self)
    settings.select(thinkingOnly, provider: "claude_code")
    #expect(settings.effort(provider: "claude_code", model: thinkingOnly) == "")
    #expect(settings.config["ultracode"]?.bool == false)
    #expect(settings.config["thinkingMode"]?.bool == true)
}
