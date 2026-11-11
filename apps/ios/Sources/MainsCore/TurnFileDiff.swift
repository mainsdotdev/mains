import Foundation

public struct HistoryContentPage: Decodable, Sendable {
    public let text: String
    public let offset: Int
    public let nextOffset: Int?
    public let totalChars: Int
}

public struct FileDiffCursor: Equatable, Sendable {
    var offset = 0
    var selected = false
    var oldNo = 0
    var newNo = 0
    var oldLeft = 0
    var newLeft = 0
}

public struct FileDiffLine: Identifiable, Equatable, Sendable {
    public enum Kind: Sendable { case context, add, remove }
    public let id: Int // Unicode offset in the stored patch, stable across pages.
    public let kind: Kind
    public let text: String
    public let oldNo: Int?
    public let newNo: Int?
    public let hunkStart: Bool
}

public struct FileDiffPage: Sendable {
    public var lines: [FileDiffLine] = []
    public var found = false
    public var binary = false
    public var shortened = false
    public var next: FileDiffCursor?
}

/// A streaming, bounded port of mobile/lib/turn-file-diff. Offsets count Unicode
/// scalars, as SQLite does, rather than Swift graphemes or UTF-16 code units.
public enum TurnFileDiff {
    @MainActor public static func read(path: String, oldPath: String? = nil, cursor: FileDiffCursor? = nil,
        read: (Int) async throws -> HistoryContentPage) async throws -> FileDiffPage {
        guard !path.isEmpty else { throw MainsError.invalidReply }
        var state = cursor ?? FileDiffCursor(), source = PatchLines(offset: cursor?.offset ?? 0)
        var result = FileDiffPage(found: state.selected), chars = 0, newHunk = false
        let regex = try NSRegularExpression(pattern: #"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@"#)
        while let line = try await source.next(read: read) {
            try Task.checkCancellation()
            if line.text.hasPrefix("diff --git ") {
                if state.selected { return result }
                state.selected = !line.shortened && matches(line.text, path: path, oldPath: oldPath ?? path)
                result.found = state.selected
                continue
            }
            guard state.selected else { continue }
            if line.text == "GIT binary patch" || line.text.hasPrefix("Binary files ") && line.text.hasSuffix(" differ") {
                result.binary = true; return result
            }
            if let hunk = regex.firstMatch(in: line.text, range: NSRange(line.text.startIndex..., in: line.text)) {
                func value(_ index: Int, fallback: Int = 1) throws -> Int {
                    guard let range = Range(hunk.range(at: index), in: line.text) else { return fallback }
                    guard let number = Int(line.text[range]), number <= 9_007_199_254_740_991 else { throw MainsError.invalidReply }
                    return number
                }
                state.oldNo = try value(1); state.oldLeft = try value(2)
                state.newNo = try value(3); state.newLeft = try value(4)
                newHunk = true; continue
            }
            guard state.oldLeft > 0 || state.newLeft > 0 else { continue }
            let kind: FileDiffLine.Kind
            switch line.text.unicodeScalars.first {
            case "+": kind = .add
            case "-": kind = .remove
            case " ": kind = .context
            default: continue // Includes Git's "No newline at end of file" marker.
            }
            let count = line.text.unicodeScalars.count
            if result.lines.count >= 160 || (!result.lines.isEmpty && chars + count > 32_768) {
                state.offset = line.offset; result.next = state; return result
            }
            guard (kind == .add || state.oldLeft > 0), (kind == .remove || state.newLeft > 0) else { throw MainsError.invalidReply }
            result.lines.append(FileDiffLine(id: line.offset, kind: kind,
                text: String(String.UnicodeScalarView(line.text.unicodeScalars.dropFirst())) + (line.shortened ? "…" : ""),
                oldNo: kind == .add ? nil : state.oldNo, newNo: kind == .remove ? nil : state.newNo,
                hunkStart: newHunk))
            newHunk = false
            if kind != .add { state.oldNo += 1; state.oldLeft -= 1 }
            if kind != .remove { state.newNo += 1; state.newLeft -= 1 }
            result.shortened = result.shortened || line.shortened; chars += count
        }
        return result
    }

    private static func matches(_ header: String, path: String, oldPath: String) -> Bool {
        let raw = String(header.dropFirst("diff --git ".count))
        let left: String
        if raw.hasPrefix("\"") {
            guard let range = raw.range(of: #"^"(?:\\.|[^"\\])*""#, options: .regularExpression) else { return false }
            left = String(raw[range])
        } else { left = "a/" + oldPath }
        guard raw.utf8.starts(with: (left + " ").utf8), let a = unquote(left), let b = unquote(String(raw.dropFirst(left.count + 1))) else { return false }
        return a.utf8.elementsEqual(("a/" + oldPath).utf8) && b.utf8.elementsEqual(("b/" + path).utf8)
    }

    private static func unquote(_ raw: String) -> String? {
        guard raw.hasPrefix("\"") else { return raw }
        guard raw.hasSuffix("\""), raw.count >= 2 else { return nil }
        let bytes = Array(raw.utf8.dropFirst().dropLast())
        let escapes: [UInt8: UInt8] = [97: 7, 98: 8, 102: 12, 110: 10, 114: 13, 116: 9, 118: 11, 34: 34, 92: 92]
        var result: [UInt8] = [], i = 0
        while i < bytes.count {
            let byte = bytes[i]; i += 1
            if byte != 92 { result.append(byte); continue }
            guard i < bytes.count else { return nil }
            if (48...55).contains(bytes[i]) {
                var number = 0, digits = 0
                while i < bytes.count, digits < 3, (48...55).contains(bytes[i]) {
                    number = number * 8 + Int(bytes[i] - 48); i += 1; digits += 1
                }
                guard number <= 255 else { return nil }; result.append(UInt8(number))
            } else {
                guard let value = escapes[bytes[i]] else { return nil }; result.append(value); i += 1
            }
        }
        return String(decoding: result, as: UTF8.self)
    }
}

@MainActor private struct PatchLines {
    struct Line { let text: String; let offset: Int; let shortened: Bool }
    var position: Int
    var remoteOffset: Int?
    var chunk: [Unicode.Scalar] = []
    var index = 0
    init(offset: Int) { position = offset; remoteOffset = offset }

    mutating func next(read: (Int) async throws -> HistoryContentPage) async throws -> Line? {
        let offset = position
        var text = String.UnicodeScalarView(), shortened = false, consumed = false
        while true {
            try Task.checkCancellation()
            if index == chunk.count {
                guard let requested = remoteOffset else { break }
                guard requested >= 0, requested <= 9_007_199_254_740_991 else { throw MainsError.invalidReply }
                let page = try await read(requested)
                try Task.checkCancellation()
                chunk = Array(page.text.unicodeScalars); index = 0
                let end = requested + chunk.count
                guard chunk.count <= 32_768, page.offset == requested, page.totalChars >= end,
                      page.nextOffset.map({ $0 == end && $0 > requested && $0 < page.totalChars }) ?? (end == page.totalChars) else { throw MainsError.invalidReply }
                remoteOffset = page.nextOffset
                if chunk.isEmpty { break }
            }
            let end = chunk[index...].firstIndex(of: "\n").map { $0 + 1 } ?? chunk.count
            let take = end - index, keep = min(take, max(0, 16_384 - text.count))
            text.append(contentsOf: chunk[index..<(index + keep)])
            shortened = shortened || keep < take
            position += take; consumed = true
            let newline = chunk[end - 1] == "\n"; index = end
            if newline { break }
        }
        guard consumed else { return nil }
        if text.last == "\n" { text.removeLast(); if text.last == "\r" { text.removeLast() } }
        return Line(text: String(text), offset: offset, shortened: shortened)
    }
}
