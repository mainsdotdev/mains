import Foundation

public struct ConversationCompanionState: Equatable, Sendable {
    public enum Focus: Equatable, Sendable { case conversation, output }
    public private(set) var isOpen = false
    public private(set) var focus = Focus.conversation
    private var explicitChoice = false
    public init() {}

    public mutating func adapt(expanded: Bool, hasOutputs: Bool) {
        if expanded && hasOutputs && !explicitChoice { isOpen = true }
    }
    public mutating func open() { isOpen = true; focus = .output; explicitChoice = true }
    public mutating func close() { isOpen = false; focus = .conversation; explicitChoice = true }
    public mutating func focusConversation() { focus = .conversation }
    public mutating func focusOutput() { if isOpen { focus = .output } }
}

/// Local view geometry, never a device name, orientation or global screen size.
/// Both readers stay mounted while this changes their frames and visibility.
public struct ConversationPanePlan: Equatable, Sendable {
    public enum Mode: Equatable, Sendable { case conversation, sideBySide, stacked, output }
    public let mode: Mode
    public let conversation: CGRect
    public let output: CGRect
    public var showsConversation: Bool { mode != .output }
    public var showsOutput: Bool { mode != .conversation }

    public static func make(size: CGSize, expanded: Bool, accessibilityText: Bool = false, rightToLeft: Bool = false,
                            state: ConversationCompanionState, divisions: [CGRect] = []) -> Self {
        let bounds = CGRect(origin: .zero, size: CGSize(width: max(0, size.width), height: max(0, size.height)))
        guard state.isOpen else { return Self(mode: .conversation, conversation: bounds, output: bounds) }
        let regions = divisions.map { $0.intersection(bounds) }.filter { !$0.isNull && !$0.isEmpty }
        // Reserved-region frames already use this view's coordinate space and safe areas.
        if expanded && !accessibilityText, let fold = regions.first {
            if fold.height >= bounds.height * 0.7, fold.width < bounds.width * 0.4 {
                let left = CGRect(x: 0, y: 0, width: fold.minX, height: bounds.height)
                let right = CGRect(x: fold.maxX, y: 0, width: bounds.width - fold.maxX, height: bounds.height)
                if min(left.width, right.width) >= 280 {
                    return Self(mode: .sideBySide, conversation: rightToLeft ? right : left, output: rightToLeft ? left : right)
                }
            } else if fold.width >= bounds.width * 0.7, fold.height < bounds.height * 0.4 {
                let top = CGRect(x: 0, y: 0, width: bounds.width, height: fold.minY)
                let bottom = CGRect(x: 0, y: fold.maxY, width: bounds.width, height: bounds.height - fold.maxY)
                if min(top.height, bottom.height) >= 120 {
                    return Self(mode: .stacked, conversation: bottom, output: top)
                }
            }
        }
        if expanded && !accessibilityText && regions.isEmpty {
            if bounds.width >= 720 {
                let half = bounds.width / 2
                let left = CGRect(x: 0, y: 0, width: half, height: bounds.height)
                let right = CGRect(x: half, y: 0, width: bounds.width - half, height: bounds.height)
                return Self(mode: .sideBySide, conversation: rightToLeft ? right : left, output: rightToLeft ? left : right)
            } else if bounds.width >= 500 {
                // Keep the same axis when a keyboard reduces the available height.
                let previewHeight = min(bounds.height * 0.45, max(0, bounds.height - 240))
                return Self(mode: .stacked,
                            conversation: CGRect(x: 0, y: previewHeight, width: bounds.width, height: bounds.height - previewHeight),
                            output: CGRect(x: 0, y: 0, width: bounds.width, height: previewHeight))
            }
        }
        // A very narrow region or large text falls back to the last focused reader.
        // If a fold is present, keep that reader entirely on one side of it.
        var focusedBounds = bounds
        if let fold = regions.first {
            if fold.height >= bounds.height * 0.7, fold.maxX < bounds.width {
                focusedBounds = CGRect(x: fold.maxX, y: 0, width: bounds.width - fold.maxX, height: bounds.height)
            } else if fold.width >= bounds.width * 0.7, fold.maxY < bounds.height {
                focusedBounds = state.focus == .output
                    ? CGRect(x: 0, y: 0, width: bounds.width, height: fold.minY)
                    : CGRect(x: 0, y: fold.maxY, width: bounds.width, height: bounds.height - fold.maxY)
            }
        }
        return Self(mode: state.focus == .output ? .output : .conversation, conversation: focusedBounds, output: focusedBounds)
    }
}
