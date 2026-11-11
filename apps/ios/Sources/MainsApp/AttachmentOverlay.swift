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
    @Environment(\.scenePhase) private var scenePhase
    func body(content: Content) -> some View {
        content
            .onPreferenceChange(AttachmentOverlayRequestKey.self) { presented = $0 }
            .background(AttachmentOverlayPresenter(request: presented, scenePhase: scenePhase))
    }
}

/// Like the effort overlay, this is a child controller in the current window,
/// not a modal presentation or another key window. The composer keeps its first
/// responder; the panel's backdrop intercepts touches and is modal to VoiceOver.
private struct AttachmentOverlayPresenter: UIViewControllerRepresentable {
    let request: AttachmentOverlayRequest?
    let scenePhase: ScenePhase
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIViewController(context: Context) -> UIViewController {
        let controller = UIViewController()
        controller.view.backgroundColor = .clear
        controller.view.isUserInteractionEnabled = false
        return controller
    }
    func updateUIViewController(_ controller: UIViewController, context: Context) {
        context.coordinator.parent = self
        context.coordinator.update(from: controller)
    }
    static func dismantleUIViewController(_ controller: UIViewController, coordinator: Coordinator) {
        coordinator.removeOverlay()
    }
    @MainActor final class Coordinator {
        var parent: AttachmentOverlayPresenter
        private var overlay: UIHostingController<AttachmentOverlayContent>?
        private var scheduled = false
        init(_ parent: AttachmentOverlayPresenter) { self.parent = parent }
        func removeOverlay() {
            guard let overlay else { return }
            self.overlay = nil
            overlay.presentedViewController?.dismiss(animated: false)
            overlay.willMove(toParent: nil)
            overlay.view.removeFromSuperview()
            overlay.removeFromParent()
        }
        func update(from controller: UIViewController) {
            guard let request = parent.request else { removeOverlay(); return }
            if let overlay {
                // Keep the presentation identity while keyboard/source geometry
                // changes, preserving the menu's reversible animation state.
                overlay.rootView = AttachmentOverlayContent(request: request, scenePhase: parent.scenePhase)
                return
            }
            guard !scheduled else { return }
            scheduled = true
            DispatchQueue.main.async { [weak self, weak controller] in
                guard let self, let controller else { return }
                self.scheduled = false
                guard let request = self.parent.request, self.overlay == nil,
                      let container = controller.view.window?.rootViewController else { return }
                let host = UIHostingController(rootView: AttachmentOverlayContent(request: request, scenePhase: self.parent.scenePhase))
                host.view.backgroundColor = .clear
                host.view.accessibilityViewIsModal = true
                self.overlay = host
                container.addChild(host)
                host.view.frame = container.view.bounds
                host.view.translatesAutoresizingMaskIntoConstraints = false
                container.view.addSubview(host.view)
                NSLayoutConstraint.activate([
                    host.view.leadingAnchor.constraint(equalTo: container.view.leadingAnchor),
                    host.view.trailingAnchor.constraint(equalTo: container.view.trailingAnchor),
                    host.view.topAnchor.constraint(equalTo: container.view.topAnchor),
                    host.view.bottomAnchor.constraint(equalTo: container.view.bottomAnchor),
                ])
                host.didMove(toParent: container)
                container.view.layoutIfNeeded()
            }
        }
    }
}

private struct AttachmentOverlayContent: View {
    let request: AttachmentOverlayRequest
    let scenePhase: ScenePhase
    var body: some View {
        AttachmentPanel(sourceFrame: request.sourceFrame, accent: request.accent,
            maxCount: request.maxCount, maxBytes: request.maxBytes, add: request.add, close: request.close)
            .id(request.id)
            .environment(\.scenePhase, scenePhase)
    }
}
