import Foundation

/// A mention occupies one editable character. Its readable label and wire metadata
/// stay in the draft; UIKit selection offsets never leak into a submitted prompt.
public struct ContextText: Sendable {
    public struct Mention: Sendable {
        public let sourceRange: NSRange
        public let displayRange: NSRange
        public let skill: ContextSkill
    }
    public let source: String
    public let display: String
    public let mentions: [Mention]

    public init(_ source: String, skills: [ContextSkill], canonical: Bool = false) {
        self.source = source
        let string = source as NSString
        var candidates: [(NSRange, ContextSkill)] = []
        for skill in skills {
            let pattern = canonical
                ? #"\$"# + NSRegularExpression.escapedPattern(for: skill.name) + #"(?::[\w-]+)?(?![\w/-])"#
                : NSRegularExpression.escapedPattern(for: ContextMentions.mention(skill))
            guard let expression = try? NSRegularExpression(pattern: pattern) else { continue }
            candidates += expression.matches(in: source, range: NSRange(location: 0, length: string.length)).map { ($0.range, skill) }
        }
        candidates.sort { $0.0.location == $1.0.location ? $0.0.length > $1.0.length : $0.0.location < $1.0.location }
        var cursor = 0, rendered = "", spans: [Mention] = []
        for (range, skill) in candidates where range.location >= cursor {
            rendered += string.substring(with: NSRange(location: cursor, length: range.location - cursor))
            spans.append(Mention(sourceRange: range, displayRange: NSRange(location: rendered.utf16.count, length: 1), skill: skill))
            rendered += "\u{fffc}"
            cursor = NSMaxRange(range)
        }
        rendered += string.substring(from: cursor)
        display = rendered; mentions = spans
    }

    public var readable: String {
        var result = display as NSString
        for mention in mentions.reversed() { result = result.replacingCharacters(in: mention.displayRange, with: mention.skill.title) as NSString }
        return (result as String).replacingOccurrences(of: ContextMentions.marker, with: "")
    }
    public func sourceOffset(_ displayOffset: Int) -> Int {
        let offset = max(0, min(display.utf16.count, displayOffset))
        return offset + mentions.filter { NSMaxRange($0.displayRange) <= offset }.reduce(0) { $0 + $1.sourceRange.length - 1 }
    }
    public func displayOffset(_ sourceOffset: Int) -> Int {
        let offset = max(0, min(source.utf16.count, sourceOffset))
        var delta = 0
        for mention in mentions {
            if offset <= mention.sourceRange.location { break }
            if offset < NSMaxRange(mention.sourceRange) { return mention.displayRange.location + 1 }
            delta += mention.sourceRange.length - 1
        }
        return offset - delta
    }
    public func replacing(_ displayRange: NSRange, with value: String) -> String {
        let start = sourceOffset(displayRange.location), end = sourceOffset(NSMaxRange(displayRange))
        return (source as NSString).replacingCharacters(in: NSRange(location: start, length: end - start), with: value)
    }

    /// Preserve a caret when a picker replaces its trigger or an external send clears the draft.
    public func selection(after old: ContextText, range: NSRange) -> NSRange {
        let before = Array(old.source.utf16), after = Array(source.utf16)
        let prefix = zip(before, after).prefix { $0 == $1 }.count
        let suffix = zip(before.dropFirst(prefix).reversed(), after.dropFirst(prefix).reversed()).prefix { $0 == $1 }.count
        func move(_ offset: Int) -> Int {
            let source = old.sourceOffset(offset)
            if source < prefix { return displayOffset(source) }
            if source >= before.count - suffix { return displayOffset(source + after.count - before.count) }
            return displayOffset(after.count - suffix)
        }
        let start = move(range.location), end = move(NSMaxRange(range))
        return NSRange(location: start, length: max(0, end - start))
    }
}
