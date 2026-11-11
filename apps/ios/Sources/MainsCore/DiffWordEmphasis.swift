import Foundation

/// Mobile's bounded word comparison for adjacent removed/added lines.
public enum DiffWordEmphasis {
    public struct Segment: Equatable, Sendable {
        public var text: String
        public let changed: Bool
    }
    public static func build(_ lines: [FileDiffLine]) -> [Int: [Segment]] {
        guard let tokenizer = try? NSRegularExpression(pattern: #"\s+|[\w\u0080-\uFFFF]+|[^\s\w]"#) else { return [:] }
        var result: [Int: [Segment]] = [:], index = 0
        while index < lines.count {
            guard lines[index].kind == .remove else { index += 1; continue }
            let removed = index
            while index < lines.count, lines[index].kind == .remove, index == removed || !lines[index].hunkStart { index += 1 }
            let added = index
            while index < lines.count, lines[index].kind == .add, !lines[index].hunkStart { index += 1 }
            for pair in 0..<min(added - removed, index - added) {
                let before = lines[removed + pair], after = lines[added + pair]
                if let (a, b) = compare(before.text, after.text, tokenizer: tokenizer) {
                    result[before.id] = a; result[after.id] = b
                }
            }
        }
        return result
    }
    private static func compare(_ before: String, _ after: String, tokenizer: NSRegularExpression) -> ([Segment], [Segment])? {
        guard before != after else { return nil }
        func tokens(_ text: String) -> [String] {
            tokenizer.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap {
                Range($0.range, in: text).map { String(text[$0]) }
            }
        }
        let a = tokens(before), b = tokens(after)
        guard !a.isEmpty, !b.isEmpty, a.count <= 40_000 / b.count,
              a.joined().utf8.elementsEqual(before.utf8), b.joined().utf8.elementsEqual(after.utf8) else { return nil }
        let width = b.count + 1
        var table = [UInt16](repeating: 0, count: (a.count + 1) * width)
        for i in (0..<a.count).reversed() {
            for j in (0..<b.count).reversed() {
                table[i * width + j] = a[i] == b[j] ? table[(i + 1) * width + j + 1] + 1
                    : max(table[(i + 1) * width + j], table[i * width + j + 1])
            }
        }
        var aChanged = [Bool](repeating: true, count: a.count), bChanged = [Bool](repeating: true, count: b.count), i = 0, j = 0
        while i < a.count, j < b.count {
            if a[i] == b[j] { aChanged[i] = false; bChanged[j] = false; i += 1; j += 1 }
            else if table[(i + 1) * width + j] >= table[i * width + j + 1] { i += 1 }
            else { j += 1 }
        }
        guard a.indices.contains(where: { !aChanged[$0] && !a[$0].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else { return nil }
        return (segments(a, changed: aChanged), segments(b, changed: bChanged))
    }
    private static func segments(_ tokens: [String], changed: [Bool]) -> [Segment] {
        var result: [Segment] = []
        for index in tokens.indices {
            let bridge = !changed[index] && tokens[index].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && index > 0 && index + 1 < tokens.count && changed[index - 1] && changed[index + 1]
            let flag = changed[index] || bridge
            if result.last?.changed == flag { result[result.count - 1].text += tokens[index] }
            else { result.append(Segment(text: tokens[index], changed: flag)) }
        }
        return result
    }
}
