import Foundation
import Testing
@testable import MainsCore

@Test func tableColumnsFillTheViewportWithoutClippingMeasuredHeaderText() {
    // The semibold header's width is larger than a regular-font estimate.
    let measured = [90.25, 120.1, 70.0]
    let widths = MessageTableSizing.columnWidths(measured, proposedWidth: 340)
    #expect(abs(widths.reduce(0, +) - 340) < 0.001)
    #expect(zip(widths, measured).allSatisfy { $0 >= $1 })
    #expect(widths.allSatisfy { $0 >= 86 })
}

@Test func wideTablesRetainReadableColumnsAndScaledTextCanScrollHorizontally() {
    let measured = [205.2, 100.0, 130.8]
    let widths = MessageTableSizing.columnWidths(measured, proposedWidth: 280)
    #expect(widths.reduce(0, +) > 280)
    #expect(zip(widths, measured).allSatisfy { $0 >= $1 })
    let scaled = MessageTableSizing.columnWidths([300, 190, 210], proposedWidth: 340, minimum: 172, maximum: 520)
    #expect(scaled.reduce(0, +) >= 700 && scaled[0] >= 300)
    #expect(MessageTableSizing.columnWidths([10000], proposedWidth: nil) == [260])
    #expect(MessageTableSizing.columnWidths([], proposedWidth: 340).isEmpty)
}

@Test func tableRowsGiveEveryColumnTheSameHeightEvenWithEmptyOrWrappedCells() {
    let heights = MessageTableSizing.rowHeights([44, 68.2, 44, 44, 44, 44, 68.1, 44, 44], columns: 3)
    #expect(heights == [69, 44, 69])
    #expect(MessageTableSizing.rowHeights([], columns: 3).isEmpty)
    #expect(MessageTableSizing.rowHeights([44], columns: 0).isEmpty)
}

@Test func atlasImagesRemainInPlaceBetweenUnmodifiedMarkdownSections() {
    let before = "## Scope\n\nText with **bold**, $x^2$ and İstanbul 🌍.\n\n"
    let after = "\n\n| Name | Value |\n|---|---|\n| A | B |"
    let sections = AtlasPageSection.parse(before + "![Screenshot.png](atlas-file://image-123)" + after)
    #expect(sections == [.markdown(before), .image(.init(fileId: "image-123", caption: "Screenshot.png")), .markdown(after)])
    #expect(AtlasPageSection.parse("![](<atlas-file://second-image> \"Title\")") == [.image(.init(fileId: "second-image", caption: ""))])
}

@Test func atlasImageExamplesInCodeAndMathAndExternalPathsDoNotBecomeAutomaticReads() {
    for source in ["```md\n![Example](atlas-file://not-a-file)\n```", "~~~\n![Example](atlas-file://not-a-file)\n~~~",
                   "    ![Example](atlas-file://not-a-file)", "`![Example](atlas-file://not-a-file)`",
                   "\\![Escaped](atlas-file://not-a-file)", "![Remote](https://example.com/photo.png)",
                   "![Local](file:///private/photo.png)", "$$\n![Example](atlas-file://not-a-file)\n$$",
                   "\\[\n![Example](atlas-file://not-a-file)\n\\]", "![Bad](atlas-file://../private)"] {
        #expect(AtlasPageSection.parse(source) == [.markdown(source)])
    }
}

@Test func atlasInlineImagesAndCaptionsAreBoundedWithoutChangingTablesOrOrdinaryProse() {
    let source = "# Notes\n\n|A|B|\n|-|-|\n|1|2|\n\n$$x^2$$\n\n> quote"
    #expect(AtlasPageSection.parse(source) == [.markdown(source)])
    let images = (0..<25).map { "![\(String(repeating: "🌍", count: 300))](atlas-file://image-\($0))" }.joined(separator: "\n")
    let selected = AtlasPageSection.parse(images).compactMap { section -> AtlasPageImageReference? in
        if case .image(let reference) = section { return reference }; return nil
    }
    #expect(selected.count == 20 && selected.allSatisfy { $0.caption.count == 240 })
}

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
