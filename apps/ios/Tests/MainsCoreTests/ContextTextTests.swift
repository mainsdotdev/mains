import Foundation
import Testing
@testable import MainsCore

@Test func inlineMentionsDeleteAtomicallyWithoutTouchingSurroundingUnicode() throws {
    let skill = ContextSkill(name: "mail:mail", displayName: "Gmail")
    let source = "👋 " + ContextMentions.mention(skill) + " şunu özetle"
    let text = ContextText(source, skills: [skill])
    #expect(text.readable == "👋 Gmail şunu özetle")
    #expect(text.display == "👋 \u{fffc} şunu özetle")
    let token = try #require(text.mentions.first)
    #expect(text.replacing(token.displayRange, with: "") == "👋  şunu özetle")
    #expect(text.replacing(NSRange(location: NSMaxRange(token.displayRange), length: 0), with: "!") == "👋 " + ContextMentions.mention(skill) + "! şunu özetle")
    for offset in 0...text.display.utf16.count { #expect(text.displayOffset(text.sourceOffset(offset)) == offset) }
    #expect(ContextMentions.goal(source, skills: [skill]) == "👋 $mail:mail şunu özetle")
}

@Test func promptMentionsUseOnlyAttachedMetadataAndLongestCanonicalNames() {
    let short = ContextSkill(name: "review", displayName: "Review")
    let long = ContextSkill(name: "review-pr", displayName: "PR review")
    let text = ContextText("$review-pr then $review, $review-extra and $unknown", skills: [short, long], canonical: true)
    #expect(text.mentions.map(\.skill.name) == ["review-pr", "review"])
    #expect(text.readable == "PR review then Review, $review-extra and $unknown")
    #expect(ContextText("Gmail is ordinary text", skills: [ContextSkill(name: "mail", displayName: "Gmail")]).mentions.isEmpty)
}

@Test func pickerReplacementAndRepeatedMentionsPreserveCaretPositions() {
    let skill = ContextSkill(name: "design", displayName: "Design tools")
    let before = ContextText("Hi @des", skills: [])
    let after = ContextText("Hi " + ContextMentions.mention(skill) + " ", skills: [skill])
    #expect(after.selection(after: before, range: NSRange(location: 7, length: 0)) == NSRange(location: 5, length: 0))
    #expect(after.selection(after: before, range: NSRange(location: 1, length: 0)) == NSRange(location: 1, length: 0))
    let repeated = ContextText(ContextMentions.mention(skill) + " " + ContextMentions.mention(skill), skills: [skill, skill])
    #expect(repeated.mentions.count == 2)
    #expect(repeated.replacing(NSRange(location: 2, length: 1), with: "") == ContextMentions.mention(skill) + " ")
}
