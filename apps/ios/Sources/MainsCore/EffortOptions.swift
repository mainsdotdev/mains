import Foundation

/// Mirrors mobile's lib/models.ts and the contract's effort-levels.ts.
public enum EffortControlKind: Equatable, Sendable {
    case hidden, thinking, toggle(String), slider([String]), list([String])

    public static let ranked = ["minimal", "low", "medium", "high", "xhigh", "max"]
    public static func ordered(_ levels: [String]) -> [String] {
        var result = ranked.filter { levels.contains($0) }
        for level in levels where !level.isEmpty && level != "ultracode" && !result.contains(level) { result.append(level) }
        return result
    }
    public static func resolve(provider: String, levels: [String]) -> Self {
        let ordered = ordered(levels)
        if ordered.isEmpty { return provider == "claude_code" ? .thinking : .hidden }
        if ordered.count == 1 { return provider == "codex" ? .hidden : .toggle(ordered[0]) }
        let stops = (provider == "codex" ? [] : [""]) + ordered
        return stops.count > 6 ? .list(stops) : .slider(stops)
    }
    public static func stopIndex(in stops: [String], value: String) -> Int {
        guard !stops.isEmpty else { return 0 }
        if value == "ultracode" { return stops.firstIndex(of: "xhigh") ?? stops.count - 1 }
        if let index = stops.firstIndex(of: value) { return index }
        let levels = stops.filter { !$0.isEmpty }
        guard let rank = ranked.firstIndex(of: value) else { return stops.firstIndex(of: levels.last ?? "") ?? 0 }
        let closest = levels.min { abs((ranked.firstIndex(of: $0) ?? -100) - rank) < abs((ranked.firstIndex(of: $1) ?? -100) - rank) }
        return closest.flatMap { stops.firstIndex(of: $0) } ?? 0
    }
}
