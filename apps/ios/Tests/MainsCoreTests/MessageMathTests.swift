import Foundation
import Testing
@testable import MainsCore

@Test func mathRecognizesInlineDisplayAndEscapedDelimitersWithoutConsumingCodeOrCurrency() throws {
    let source = #"Inline $x_1^2$ and \(\frac{a}{b}\). Display: $$\sum_{i=1}^n i$$ and \[\begin{matrix}a&b\\c&d\end{matrix}\]. `code $x$` costs $5 and $10; \$20."#
    let document = try #require(MathMarkdown.prepare(source))
    #expect(document.formulas.count == 4)
    #expect(document.formulas.map(\.display) == [false, false, true, true])
    #expect(document.formulas[1].tex == #"\frac{a}{b}"#)
    #expect(document.html.contains("data-math=\"display\""))
    #expect(document.html.contains("<code>code $x$</code>"))
    #expect(MathMarkdown.prepare("```tex\n$x$\n```\n~~~\n$$y$$\n~~~") == nil)
    #expect(MathMarkdown.prepare(#"Unclosed $x and \(unfinished; prices $5 and $10."#) == nil)
}

@Test func mathHTMLRetainsMarkdownAndLinksWhileEscapingUntrustedTeXAndHTML() throws {
    let source = #"**Bold** [output](report.pdf) [unsafe](javascript:alert) $\text{</span><script>alert(1)</script>}$"# + "\n\n| Value | Math |\n| --- | --- |\n| a | $x^2$ |"
    let document = try #require(MathMarkdown.prepare(source))
    let html = document.html
    #expect(html.contains("<strong>Bold</strong>") && html.contains("href=\"report.pdf\""))
    #expect(!html.contains("href=\"javascript:") && !html.contains("<script>"))
    #expect(html.contains("&lt;script&gt;") && html.contains("<table>"))
    #expect(document.formulas.count == 2)
    #expect(MathMarkdown.prepare(String(repeating: "x", count: 128 * 1024 + 1) + "$y$") == nil)
}
