import Foundation
import Testing
@testable import MainsCore

@Test func emailTableRendersAsATableWithInlineFormattingIntact() throws {
    let source = """
    You received **4 emails** today.

    | Time | From | Email |
    |---|---|---|
    | 08:22 | Google Play | [Terms of Service updates](https://example.com/terms) taking effect December 17. |
    | 08:03 | Reflect Studio | **Extra 11% discount** at checkout. |
    """
    let blocks = MessageBlock.parse(source)
    #expect(blocks.count == 2)
    guard case .table(let table) = blocks.last else { Issue.record("Table rendered as raw pipe-separated prose"); return }
    #expect(table.header == ["Time", "From", "Email"])
    #expect(table.rows.count == 2 && table.rows[0][0] == "08:22")
    #expect(table.rows[0][2].hasPrefix("[Terms of Service updates]"))
    let inline = try AttributedString(markdown: table.rows[0][2], options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
    #expect(inline.runs.contains { $0.link == URL(string: "https://example.com/terms") })
}

@Test func tablesRespectEscapedPipesCodeSpansAlignmentAndUnevenRows() throws {
    let blocks = MessageBlock.parse(#"""
    Left | Center | Right
    :--- | :---: | ---:
    a\|b | `x|y` | **three**
    one | two
    1 | 2 | 3 | ignored

    After the table.
    """#)
    guard case .table(let table) = blocks.first else { Issue.record("Expected table"); return }
    #expect(table.alignments == [.leading, .center, .trailing])
    #expect(table.rows == [[#"a\|b"#, "`x|y`", "**three**"], ["one", "two", ""], ["1", "2", "3"]])
    #expect(blocks.last == .paragraph("After the table."))
    #expect(MessageBlock.parse("| A | B |\n|--").first == .paragraph("| A | B | |--"))
    #expect(MessageBlock.parse("| A | B |\n|---|oops|").first == .paragraph("| A | B | |---|oops|"))
}

@Test func markdownKeepsCodeLiteralAndRequiresTheMatchingClosingFence() {
    let blocks = MessageBlock.parse("````md\n|A|B|\n|-|-|\n```\n~~~~\n````\n\n    indented code")
    #expect(blocks == [.code("md", "|A|B|\n|-|-|\n```\n~~~~"), .code("", "indented code")])
    #expect(MessageBlock.parse("~~~swift\nlet unfinished = true\n") == [.code("swift", "let unfinished = true\n")])
    #expect(MessageBlock.parse("An unfinished escape\\") == [.paragraph("An unfinished escape\\")])
}

@Test func markdownSupportsTasksQuotesHeadingsAndCommonMarkLineBreaks() {
    let blocks = MessageBlock.parse("Title\n===\n\nsoft\nwrap  \nhard\\\nbreak\n\n- [x] Done\n  continuation\n  - [ ] Nested\n\n> **Quote**\n> second line\n\n## Closing hashes ##\n\n* * *")
    #expect(blocks == [.heading(1, "Title"), .paragraph("soft wrap\nhard\nbreak"), .task(true, "Done continuation", 0), .task(false, "Nested", 1), .quote("**Quote**\nsecond line"), .heading(2, "Closing hashes"), .rule])
}

@Test func inlineMarkdownPreservesEmphasisStrikeCodeAndEscapes() throws {
    let text = try AttributedString(markdown: #"**bold** *italic* ~~removed~~ `code` \*literal\*"#, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
    #expect(String(text.characters) == "bold italic removed code *literal*")
    #expect(text.runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
    #expect(text.runs.contains { $0.inlinePresentationIntent?.contains(.emphasized) == true })
    #expect(text.runs.contains { $0.inlinePresentationIntent?.contains(.strikethrough) == true })
    #expect(text.runs.contains { $0.inlinePresentationIntent?.contains(.code) == true })
}
