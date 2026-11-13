import Foundation

public enum TranscriptPageDirection: String, Sendable { case older, newer }

public struct TranscriptGeometry: Equatable, Sendable {
    public var offset: Double
    public var content: Double
    public var frame: Double
    public var topInset: Double
    public var bottomInset: Double
    public init(offset: Double = 0, content: Double = 0, frame: Double = 0, topInset: Double = 0, bottomInset: Double = 0) {
        self.offset = offset; self.content = content; self.frame = frame
        self.topInset = topInset; self.bottomInset = bottomInset
    }
    /// SwiftUI's containerSize excludes its safe-area insets. The shared scroll
    /// rules use the full scroll frame, as UIKit/React Native do.
    public init(offset: Double, content: Double, visibleFrame: Double, topInset: Double, bottomInset: Double) {
        self.init(offset: offset, content: content, frame: visibleFrame + topInset + bottomInset,
                  topInset: topInset, bottomInset: bottomInset)
    }
    public var end: Double { max(-topInset, content - frame + bottomInset) }
    public var distanceFromEnd: Double { max(0, end - offset) }
}

/// Port of the intent rules in contracts/transcript-viewport.ts; layout is never a gesture.
public struct TranscriptViewport: Sendable {
    public private(set) var following = true
    public private(set) var interacting = false
    public private(set) var paging = false
    public private(set) var geometry = TranscriptGeometry()
    private var previousOffset: Double?
    private var direction = 0
    public init() {}
    public var chasing: Bool { following && !interacting && !paging }
    public func showsJump(hasNewer: Bool) -> Bool {
        !paging && (hasNewer || !following && geometry.distanceFromEnd > 220)
    }

    public mutating func beginInteraction() {
        interacting = true
        previousOffset = geometry.offset
        direction = 0
    }
    /// Hiding a retained pane ends its gesture without inventing follow intent.
    public mutating func interruptInteraction() {
        interacting = false; previousOffset = nil; direction = 0
    }
    @discardableResult public mutating func update(_ next: TranscriptGeometry, hasNewer: Bool, hasOlder: Bool = false) -> TranscriptPageDirection? {
        // Inset, keyboard and content-size corrections must not create scroll intent.
        let layoutChanged = geometry.content != next.content || geometry.frame != next.frame
            || geometry.topInset != next.topInset || geometry.bottomInset != next.bottomInset
        geometry = next
        defer { previousOffset = next.offset }
        guard interacting, !paging, !layoutChanged, let previousOffset else { return nil }
        let difference = next.offset - previousOffset
        guard abs(difference) >= 1 else { return nil }
        direction = difference < 0 ? -1 : 1
        updateFollowing(hasNewer: hasNewer)
        return page(hasNewer: hasNewer, hasOlder: hasOlder)
    }
    private func page(hasNewer: Bool, hasOlder: Bool) -> TranscriptPageDirection? {
        // A short page's boundaries coincide. Rubber banding must not replace it.
        guard geometry.frame > 0, geometry.end > -geometry.topInset else { return nil }
        if direction < 0 && geometry.offset < -geometry.topInset + 200 && hasOlder { return .older }
        if direction > 0 && geometry.distanceFromEnd < 100 && hasNewer { return .newer }
        return nil
    }
    @discardableResult public mutating func endInteraction(hasNewer: Bool, hasOlder: Bool = false) -> TranscriptPageDirection? {
        let navigation = interacting && !paging ? page(hasNewer: hasNewer, hasOlder: hasOlder) : nil
        if interacting && direction != 0 { updateFollowing(hasNewer: hasNewer) }
        interacting = false
        direction = 0
        return navigation
    }
    private mutating func updateFollowing(hasNewer: Bool) {
        if hasNewer { following = false }
        else if geometry.distanceFromEnd <= 80 { following = true }
        else if direction < 0 { following = false }
    }
    public mutating func beginPage() { paging = true; following = false; interacting = false; direction = 0 }
    public mutating func finishPage(latestConfirmed: Bool) {
        paging = false
        if latestConfirmed { following = true }
        previousOffset = geometry.offset
        direction = 0
    }
    public mutating func follow() { following = true; interacting = false; direction = 0 }
}
