import Foundation

public struct MessageTable: Equatable, Sendable {
    public enum Alignment: Equatable, Sendable { case leading, center, trailing }
    public let header: [String]
    public let alignments: [Alignment]
    public let rows: [[String]]
}

/// Shared geometry for measured table cells; all rows use one set of columns.
public enum MessageTableSizing {
    public static func columnWidths(_ natural: [Double], proposedWidth: Double?, minimum: Double = 86, maximum: Double = 260) -> [Double] {
        guard !natural.isEmpty else { return [] }
        let lower = max(1, minimum), upper = max(lower, maximum)
        let widths = natural.map { min(upper, max(lower, $0.isFinite ? $0.rounded(.up) : lower)) }
        let total = widths.reduce(0, +)
        let available = proposedWidth.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? total
        let extra = max(0, available - total) / Double(widths.count)
        return widths.map { $0 + extra }
    }

    public static func rowHeights(_ fittedHeights: [Double], columns: Int) -> [Double] {
        guard columns > 0 else { return [] }
        return stride(from: 0, to: fittedHeights.count, by: columns).map { start in
            fittedHeights[start..<min(start + columns, fittedHeights.count)].filter(\.isFinite).max()?.rounded(.up) ?? 0
        }
    }
}

/// Streaming-safe CommonMark/GFM blocks. Inline emphasis, code and links are
/// interpreted separately; table delimiters never reach the prose renderer.
public enum MessageBlock: Equatable, Sendable {
    case paragraph(String), heading(Int, String), list(String, String, Int), task(Bool, String, Int)
    case quote(String), code(String, String), table(MessageTable), rule

    public static func parse(_ source: String) -> [Self] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n")
        var blocks: [Self] = [], paragraph: [String] = [], index = 0
        var listContinues = false
        func flush() {
            if !paragraph.isEmpty { blocks.append(.paragraph(prose(paragraph))); paragraph = [] }
        }
        while index < lines.count {
            let line = lines[index], trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { flush(); listContinues = false; index += 1; continue }
            if let mark = trimmed.first, mark == "`" || mark == "~", trimmed.prefix(while: { $0 == mark }).count >= 3 {
                flush(); listContinues = false
                let count = trimmed.prefix(while: { $0 == mark }).count
                let language = String(trimmed.dropFirst(count)).trimmingCharacters(in: .whitespaces)
                var code: [String] = []; index += 1
                while index < lines.count {
                    let closing = lines[index].trimmingCharacters(in: .whitespaces)
                    let length = closing.prefix(while: { $0 == mark }).count
                    if length >= count, closing.dropFirst(length).allSatisfy(\.isWhitespace) { index += 1; break }
                    code.append(lines[index]); index += 1
                }
                blocks.append(.code(language, code.joined(separator: "\n"))); continue
            }
            if index + 1 < lines.count, let header = cells(line), header.count <= 32,
               let delimiter = cells(lines[index + 1]), delimiter.count == header.count,
               delimiter.allSatisfy({ $0.range(of: #"^:?-+:?$"#, options: .regularExpression) != nil }) {
                flush(); listContinues = false
                let alignments: [MessageTable.Alignment] = delimiter.map {
                    $0.hasPrefix(":") && $0.hasSuffix(":") ? .center : $0.hasSuffix(":") ? .trailing : .leading
                }
                var rows: [[String]] = []; index += 2
                while index < lines.count, let row = cells(lines[index]), !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
                    rows.append(Array((row + Array(repeating: "", count: header.count)).prefix(header.count)))
                    index += 1
                }
                blocks.append(.table(MessageTable(header: header, alignments: alignments, rows: rows))); continue
            }
            if !paragraph.isEmpty, trimmed.allSatisfy({ $0 == "=" }) || trimmed.allSatisfy({ $0 == "-" }) {
                blocks.append(.heading(trimmed.first == "=" ? 1 : 2, prose(paragraph)))
                paragraph = []; listContinues = false; index += 1; continue
            }
            let compact = trimmed.filter { !$0.isWhitespace }
            if compact.count >= 3, let first = compact.first, ["-", "*", "_"].contains(first), compact.allSatisfy({ $0 == first }) {
                flush(); blocks.append(.rule); listContinues = false; index += 1; continue
            }
            if trimmed.first == ">" {
                flush(); listContinues = false
                var quoted: [String] = []
                while index < lines.count {
                    let value = lines[index].trimmingCharacters(in: .whitespaces)
                    guard value.first == ">" else { break }
                    let rest = value.dropFirst(); quoted.append(String(rest.first == " " ? rest.dropFirst() : rest))
                    index += 1
                }
                blocks.append(.quote(quoted.joined(separator: "\n"))); continue
            }
            let hashes = trimmed.prefix(while: { $0 == "#" }).count
            if (1...6).contains(hashes), trimmed.dropFirst(hashes).first?.isWhitespace == true {
                flush(); listContinues = false
                let value = String(trimmed.dropFirst(hashes)).trimmingCharacters(in: .whitespaces)
                    .replacingOccurrences(of: #"\s+#+\s*$"#, with: "", options: .regularExpression)
                blocks.append(.heading(hashes, value)); index += 1; continue
            }
            if let space = trimmed.firstIndex(where: \.isWhitespace) {
                let marker = String(trimmed[..<space]), digits = marker.dropLast()
                let ordered = [".", ")"].contains(String(marker.suffix(1))) && (1...9).contains(digits.count) && digits.allSatisfy(\.isNumber)
                if ["-", "+", "*"].contains(marker) || ordered {
                    flush()
                    let indent = min(6, indentation(line) / 2)
                    let value = String(trimmed[space...]).trimmingCharacters(in: .whitespaces)
                    if value.range(of: #"^\[[ xX]\]\s+"#, options: .regularExpression) != nil {
                        blocks.append(.task(value.dropFirst().first?.lowercased() == "x", String(value.dropFirst(3)).trimmingCharacters(in: .whitespaces), indent))
                    } else { blocks.append(.list(ordered ? marker : "•", value, indent)) }
                    listContinues = true; index += 1; continue
                }
            }
            if listContinues, indentation(line) >= 2, let last = blocks.last {
                switch last {
                case .list(let marker, let value, let depth): blocks[blocks.count - 1] = .list(marker, value + " " + trimmed, depth)
                case .task(let checked, let value, let depth): blocks[blocks.count - 1] = .task(checked, value + " " + trimmed, depth)
                default: paragraph.append(line)
                }
                index += 1; continue
            }
            if indentation(line) >= 4 {
                flush(); var code: [String] = []
                while index < lines.count, indentation(lines[index]) >= 4 {
                    code.append(String(lines[index].dropFirst(lines[index].first == "\t" ? 1 : 4))); index += 1
                }
                blocks.append(.code("", code.joined(separator: "\n"))); continue
            }
            listContinues = false; paragraph.append(line); index += 1
        }
        flush(); return blocks
    }
    private static func indentation(_ line: String) -> Int { line.prefix(while: \.isWhitespace).reduce(0) { $0 + ($1 == "\t" ? 4 : 1) } }
    private static func prose(_ lines: [String]) -> String {
        var result = ""
        for (index, line) in lines.enumerated() {
            var text = line.trimmingCharacters(in: .whitespaces)
            let slashCount = line.reversed().prefix(while: { $0 == "\\" }).count
            let hardBreak = line.hasSuffix("  ") || slashCount % 2 == 1
            if slashCount % 2 == 1, index < lines.count - 1 { text.removeLast() }
            result += text
            if index < lines.count - 1 { result += hardBreak ? "\n" : " " }
        }
        return result
    }
    /// Split only real delimiters, preserving escaped pipes and code-span pipes.
    private static func cells(_ line: String) -> [String]? {
        let chars = Array(line.trimmingCharacters(in: .whitespaces))
        var result: [String] = [], cell = "", codeLength = 0, index = 0, separators = 0
        while index < chars.count {
            let char = chars[index]
            if char == "\\", index + 1 < chars.count {
                cell.append(char); cell.append(chars[index + 1]); index += 2; continue
            }
            if char == "`" {
                let count = chars[index...].prefix(while: { $0 == "`" }).count
                if codeLength == 0 { codeLength = count } else if codeLength == count { codeLength = 0 }
                cell += String(repeating: "`", count: count); index += count; continue
            }
            if char == "|", codeLength == 0 {
                result.append(cell.trimmingCharacters(in: .whitespaces)); cell = ""; separators += 1
            } else { cell.append(char) }
            index += 1
        }
        guard separators > 0 else { return nil }
        result.append(cell.trimmingCharacters(in: .whitespaces))
        if chars.first == "|", result.first == "" { result.removeFirst() }
        if chars.last == "|", result.last == "" { result.removeLast() }
        return result.isEmpty ? nil : result
    }
}
