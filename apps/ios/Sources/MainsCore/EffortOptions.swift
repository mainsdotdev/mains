import Foundation

/// Mirrors mobile's lib/models.ts and the contract's effort-levels.ts.
public enum EffortControlKind: Equatable, Sendable {
    case hidden, thinking, toggle(String), slider([String]), list([String])

    public static let ranked = ["minimal", "low", "medium", "high", "xhigh", "max"]
    public static func supportsUltracode(provider: String, levels: [String]) -> Bool {
        provider == "claude_code" && levels.contains("xhigh")
    }
    public static func ordered(_ levels: [String]) -> [String] {
        var result = (["none", "default"] + ranked).filter { levels.contains($0) }
        for level in levels where !level.isEmpty && level != "ultracode" && !result.contains(level) { result.append(level) }
        return result
    }
    public static func resolve(provider: String, levels: [String]) -> Self {
        var ordered = ordered(levels)
        if supportsUltracode(provider: provider, levels: ordered) { ordered.append("ultracode") }
        if ordered.isEmpty { return provider == "claude_code" ? .thinking : .hidden }
        if ordered.count == 1 { return provider == "codex" ? .hidden : .toggle(ordered[0]) }
        var stops = ordered
        // OpenCode's empty preference is Default. Keep native None first and
        // avoid offering Default twice when the model advertises it explicitly.
        if provider != "codex", !(provider == "opencode" && stops.contains("default")) {
            let neutralCount = stops.prefix { $0 == "none" || $0 == "default" }.count
            stops.insert("", at: neutralCount)
        }
        return stops.count > 7 ? .list(stops) : .slider(stops)
    }
    /// The view supplies the distance between the first and last thumb centers,
    /// after its own padding/end caps. Fitting never changes the option values.
    public func fittingSlider(trackLength: Double, minimumStopSpacing: Double = 44, prefersMenu: Bool = false) -> Self {
        guard case .slider(let stops) = self else { return self }
        guard !prefersMenu, trackLength.isFinite, trackLength >= 0,
              minimumStopSpacing.isFinite, minimumStopSpacing > 0,
              trackLength >= Double(max(0, stops.count - 1)) * minimumStopSpacing else { return .list(stops) }
        return self
    }
    public static func stopIndex(in stops: [String], value: String) -> Int {
        guard !stops.isEmpty else { return 0 }
        if let index = stops.firstIndex(of: value) { return index }
        if value == "ultracode" { return stops.firstIndex(of: "xhigh") ?? stops.count - 1 }
        if value.isEmpty, let index = stops.firstIndex(of: "default") { return index }
        let levels = stops.filter { !$0.isEmpty }
        guard let rank = ranked.firstIndex(of: value) else { return stops.firstIndex(of: levels.last ?? "") ?? 0 }
        let closest = levels.min { abs((ranked.firstIndex(of: $0) ?? -100) - rank) < abs((ranked.firstIndex(of: $1) ?? -100) - rank) }
        return closest.flatMap { stops.firstIndex(of: $0) } ?? 0
    }
}
