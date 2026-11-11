import Foundation

public struct MathMarkdown: Sendable {
    public struct Formula: Sendable { public let token: String; public let tex: String; public let display: Bool }
    public let markdown: String
    public let formulas: [Formula]

    /// Extract TeX before Markdown interprets backslashes, pipes or underscores.
    /// Code spans/fences, escaped dollars and ordinary currency remain literal.
    public static func prepare(_ source: String) -> Self? {
        guard source.utf8.count <= 128 * 1024 else { return nil }
        let chars = Array(source), prefix = "MAINSFORMULA" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        var output = "", formulas: [Formula] = [], i = 0, budget = 2_000_000
        func has(_ value: String, at index: Int) -> Bool {
            let value = Array(value)
            return index + value.count <= chars.count && Array(chars[index..<(index + value.count)]) == value
        }
        func escaped(_ index: Int) -> Bool {
            var n = index, count = 0
            while n > 0, chars[n - 1] == "\\" { count += 1; n -= 1 }
            return count % 2 == 1
        }
        while i < chars.count {
            if budget <= 0 || formulas.count >= 128 { output += String(chars[i...]); break }
            budget -= 1
            if chars[i] == "`" || chars[i] == "~" && has("~~~", at: i) {
                let mark = chars[i]
                var end = i
                while end < chars.count, chars[end] == mark { end += 1 }
                let delimiter = String(repeating: String(mark), count: end - i)
                var close = end
                while close < chars.count, !has(delimiter, at: close), budget > 0 { close += 1; budget -= 1 }
                if close < chars.count, has(delimiter, at: close) { close += delimiter.count }
                else { close = chars.count }
                output += String(chars[i..<close]); i = close; continue
            }
            let opening: String?, closing: String?, display: Bool
            if !escaped(i), has("$$", at: i) { opening = "$$"; closing = "$$"; display = true }
            else if !escaped(i), has("\\[", at: i) { opening = "\\["; closing = "\\]"; display = true }
            else if !escaped(i), has("\\(", at: i) { opening = "\\("; closing = "\\)"; display = false }
            else if !escaped(i), chars[i] == "$", i + 1 < chars.count, !chars[i + 1].isWhitespace { opening = "$"; closing = "$"; display = false }
            else { opening = nil; closing = nil; display = false }
            if let opening, let closing {
                let start = i + opening.count
                var end = start
                while end < chars.count, end - start <= 32768, budget > 0 {
                    budget -= 1
                    if opening == "$", chars[end] == "\n" { break }
                    let currency = opening == "$" && (end == start || chars[end - 1].isWhitespace || end + 1 < chars.count && chars[end + 1].isNumber)
                    if has(closing, at: end), !escaped(end), !currency, end > start {
                        let token = prefix + "N" + String(formulas.count) + "END"
                        formulas.append(Formula(token: token, tex: String(chars[start..<end]), display: display))
                        output += display ? "\n\n" + token + "\n\n" : token
                        i = end + closing.count
                        break
                    }
                    end += 1
                }
                if i > start { continue }
            }
            output.append(chars[i]); i += 1
        }
        return formulas.isEmpty ? nil : Self(markdown: output, formulas: formulas)
    }

    public var html: String {
        func inline(_ source: String) -> String {
            guard let attributed = try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else { return Self.escape(source) }
            return attributed.runs.map { run in
                var text = Self.escape(String(attributed[run.range].characters)).replacingOccurrences(of: "\n", with: "<br>")
                if let intent = run.inlinePresentationIntent {
                    if intent.contains(.code) { text = "<code>" + text + "</code>" }
                    if intent.contains(.stronglyEmphasized) { text = "<strong>" + text + "</strong>" }
                    if intent.contains(.emphasized) { text = "<em>" + text + "</em>" }
                    if intent.contains(.strikethrough) { text = "<s>" + text + "</s>" }
                }
                if let url = run.link, ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") || RunFileReference(url.relativeString) != nil {
                    text = "<a href=\"" + Self.escape(url.relativeString) + "\">" + text + "</a>"
                }
                return text
            }.joined()
        }
        func render(_ blocks: [MessageBlock]) -> String {
            blocks.map { block in
                switch block {
                case .paragraph(let value): return "<p>" + inline(value) + "</p>"
                case .heading(let level, let value): return "<h\(level)>" + inline(value) + "</h\(level)>"
                case .list(let marker, let value, let depth): return "<div class=\"list\" style=\"margin-left:\(depth * 16)px\"><span>" + Self.escape(marker) + "</span><div>" + inline(value) + "</div></div>"
                case .task(let checked, let value, let depth): return "<div class=\"list\" style=\"margin-left:\(depth * 16)px\"><span>" + (checked ? "☑" : "☐") + "</span><div>" + inline(value) + "</div></div>"
                case .quote(let value): return "<blockquote>" + render(MessageBlock.parse(value)) + "</blockquote>"
                case .code(_, let value): return "<pre><code>" + Self.escape(value) + "</code></pre>"
                case .rule: return "<hr>"
                case .table(let table):
                    func row(_ cells: [String], header: Bool) -> String {
                        "<tr>" + cells.enumerated().map { index, cell in
                            let tag = header ? "th" : "td", alignment = table.alignments[index] == .center ? "center" : table.alignments[index] == .trailing ? "right" : "left"
                            return "<\(tag) style=\"text-align:\(alignment)\">" + inline(cell) + "</\(tag)>"
                        }.joined() + "</tr>"
                    }
                    return "<div class=\"table\"><table>" + row(table.header, header: true) + table.rows.map { row($0, header: false) }.joined() + "</table></div>"
                }
            }.joined()
        }
        var result = render(MessageBlock.parse(markdown))
        for formula in formulas {
            result = result.replacingOccurrences(of: formula.token, with: "<span data-math=\"\(formula.display ? "display" : "inline")\">" + Self.escape(formula.tex) + "</span>")
        }
        return result
    }

    public static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "'", with: "&#39;")
    }
}
