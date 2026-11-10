import Foundation

/// Structural blocks for native text. Inline emphasis and links use AttributedString.
public enum MessageBlock: Equatable, Sendable {
    case paragraph(String), heading(Int, String), list(String, String, Int), quote(String), code(String, String), rule
    public static func parse(_ source: String) -> [Self] {
        var blocks: [Self] = [], paragraph: [String] = [], code: [String] = []
        var fence: String?, language = ""
        func flush() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))); paragraph = [] }
        }
        for line in source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if let open = fence {
                if trimmed.hasPrefix(open), trimmed.dropFirst(open.count).allSatisfy({ $0 == "`" || $0 == "~" || $0.isWhitespace }) {
                    blocks.append(.code(language, code.joined(separator: "\n"))); fence = nil; code = []
                } else { code.append(line) }
                continue
            }
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flush(); let mark = trimmed.first!
                let count = trimmed.prefix(while: { $0 == mark }).count
                fence = String(repeating: String(mark), count: count)
                language = String(trimmed.dropFirst(count)).trimmingCharacters(in: .whitespaces)
            } else if trimmed.isEmpty { flush() }
            else if ["---", "***", "___"].contains(trimmed) { flush(); blocks.append(.rule) }
            else if trimmed.first == ">" {
                flush(); blocks.append(.quote(String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces)))
            } else {
                let hashes = trimmed.prefix(while: { $0 == "#" }).count
                if (1...6).contains(hashes), trimmed.dropFirst(hashes).first == " " {
                    flush(); blocks.append(.heading(hashes, String(trimmed.dropFirst(hashes + 1))))
                } else if let space = trimmed.firstIndex(of: " ") {
                    let marker = String(trimmed[..<space])
                    let ordered = [".", ")"].contains(String(marker.suffix(1))) && !marker.dropLast().isEmpty && marker.dropLast().allSatisfy(\.isNumber)
                    if ["-", "+", "*"].contains(marker) || ordered {
                        flush(); let indent = min(6, (line.count - line.drop(while: { $0 == " " }).count) / 2)
                        blocks.append(.list(ordered ? marker : "•", String(trimmed[trimmed.index(after: space)...]), indent))
                    } else { paragraph.append(line) }
                } else { paragraph.append(line) }
            }
        }
        flush()
        if fence != nil { blocks.append(.code(language, code.joined(separator: "\n"))) }
        return blocks
    }
}
