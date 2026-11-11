import SwiftUI

enum AttachmentDestination: Sendable { case none, files, plugins }

struct AttachmentSourceFrameKey: PreferenceKey {
    static let defaultValue = CGRect.zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let next = nextValue()
        if !next.isEmpty { value = next }
    }
}

/// A composer describes its overlay; AppShell renders it above the navigation content.
/// Both surfaces remain in one SwiftUI hierarchy and share the same global coordinates.
struct AttachmentOverlayRequest: Equatable, Sendable {
    let id: UUID
    let sourceFrame: CGRect
    let accent: Color
    let maxCount: Int
    let maxBytes: Int
    let add: @MainActor @Sendable ([PromptAttachment]) throws -> Void
    let close: @MainActor @Sendable (AttachmentDestination) -> Void
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.sourceFrame == rhs.sourceFrame && lhs.accent == rhs.accent
            && lhs.maxCount == rhs.maxCount && lhs.maxBytes == rhs.maxBytes
    }
}

private struct AttachmentOverlayRequestKey: PreferenceKey {
    static let defaultValue: AttachmentOverlayRequest? = nil
    static func reduce(value: inout AttachmentOverlayRequest?, nextValue: () -> AttachmentOverlayRequest?) {
        if let next = nextValue() { value = next }
    }
}

extension View {
    func attachmentOverlay(isPresented: Bool, id: UUID, accent: Color, maxCount: Int, maxBytes: Int,
                           add: @escaping @MainActor @Sendable ([PromptAttachment]) throws -> Void,
                           close: @escaping @MainActor @Sendable (UUID, AttachmentDestination) -> Void) -> some View {
        modifier(AttachmentOverlayModifier(isPresented: isPresented, id: id, accent: accent,
            maxCount: maxCount, maxBytes: maxBytes, add: add, close: close))
    }
    func attachmentOverlayHost() -> some View { modifier(AttachmentOverlayHost()) }
}

private struct AttachmentOverlayModifier: ViewModifier {
    let isPresented: Bool
    let id: UUID
    let accent: Color
    let maxCount: Int
    let maxBytes: Int
    let add: @MainActor @Sendable ([PromptAttachment]) throws -> Void
    let close: @MainActor @Sendable (UUID, AttachmentDestination) -> Void
    @State private var sourceFrame = CGRect.zero
    func body(content: Content) -> some View {
        content
            .onPreferenceChange(AttachmentSourceFrameKey.self) { sourceFrame = $0 }
            .preference(key: AttachmentOverlayRequestKey.self, value: isPresented ? AttachmentOverlayRequest(
                id: id, sourceFrame: sourceFrame, accent: accent, maxCount: maxCount, maxBytes: maxBytes,
                add: add, close: { destination in close(id, destination) }) : nil)
    }
}

private struct AttachmentOverlayHost: ViewModifier {
    @State private var presented: AttachmentOverlayRequest?
    func body(content: Content) -> some View {
        content
            .allowsHitTesting(presented == nil)
            .accessibilityHidden(presented != nil)
            .onPreferenceChange(AttachmentOverlayRequestKey.self) { presented = $0 }
            .overlay {
                if let request = presented {
                    AttachmentPanel(sourceFrame: request.sourceFrame, accent: request.accent,
                        maxCount: request.maxCount, maxBytes: request.maxBytes, add: request.add, close: request.close)
                        .id(request.id).transition(.identity)
                }
            }
    }
}
