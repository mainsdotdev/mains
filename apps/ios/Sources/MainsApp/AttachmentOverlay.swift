import SwiftUI

enum AttachmentDestination: Sendable { case none, files, plugins }

struct AttachmentSourceFrameKey: PreferenceKey {
    static let defaultValue = CGRect.zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let next = nextValue()
        if !next.isEmpty { value = next }
    }
}

/// A composer describes its overlay; AppShell hosts it above navigation without
/// disabling or hiding the SwiftUI subtree containing the active text editor.
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
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @State private var presented: AttachmentOverlayRequest?
    @Environment(\.scenePhase) private var scenePhase
    func body(content: Content) -> some View {
        content
            .onPreferenceChange(AttachmentOverlayRequestKey.self) { presented = $0 }
            .overlay {
                if let presented {
                    AttachmentOverlayContent(request: presented, scenePhase: scenePhase)
                        .ignoresSafeArea()
                        .accessibilityElement(children: .contain)
                        .accessibilityAddTraits(.isModal)
                }
            }
    }
}

private struct AttachmentOverlayContent: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let request: AttachmentOverlayRequest
    let scenePhase: ScenePhase
    var body: some View {
        AttachmentPanel(sourceFrame: request.sourceFrame, accent: request.accent,
            maxCount: request.maxCount, maxBytes: request.maxBytes, add: request.add, close: request.close)
            .id(request.id)
            .environment(\.scenePhase, scenePhase)
    }
}
