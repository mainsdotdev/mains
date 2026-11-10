import SwiftUI

extension View {
    func effortOverlay(isPresented: Binding<Bool>, session: BackendSession, context: ComposerContext?) -> some View {
        modifier(EffortOverlayModifier(isPresented: isPresented, session: session, context: context))
    }
}

struct EffortSourceFrameKey: PreferenceKey {
    static let defaultValue = CGRect.zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let next = nextValue()
        if !next.isEmpty { value = next }
    }
}

private struct EffortOverlayModifier: ViewModifier {
    @Binding var isPresented: Bool
    let session: BackendSession
    let context: ComposerContext?
    @State private var sourceFrame = CGRect.zero
    func body(content: Content) -> some View {
        content
            .onPreferenceChange(EffortSourceFrameKey.self) { sourceFrame = $0 }
            .background(EffortOverlayPresenter(isPresented: $isPresented, session: session, context: context, sourceFrame: sourceFrame))
    }
}

/// A child overlay keeps the composer's first responder and keyboard in place.
private struct EffortOverlayPresenter: UIViewControllerRepresentable {
    @Binding var isPresented: Bool
    let session: BackendSession
    let context: ComposerContext?
    let sourceFrame: CGRect
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
        var parent: EffortOverlayPresenter
        var overlay: UIViewController?
        private var scheduled = false
        init(_ parent: EffortOverlayPresenter) { self.parent = parent }
        func removeOverlay() {
            guard let overlay else { return }
            self.overlay = nil
            overlay.presentedViewController?.dismiss(animated: false)
            overlay.willMove(toParent: nil)
            overlay.view.removeFromSuperview()
            overlay.removeFromParent()
        }
        func update(from controller: UIViewController) {
            guard parent.isPresented, let context = parent.context else {
                removeOverlay()
                return
            }
            guard overlay == nil, !scheduled else { return }
            scheduled = true
            let sourceFrame = parent.sourceFrame
            DispatchQueue.main.async { [weak self, weak controller] in
                guard let self, let controller else { return }
                self.scheduled = false
                guard self.parent.isPresented, let container = controller.view.window?.rootViewController,
                      self.overlay == nil else { return }
                let root = EffortOverlayView(session: self.parent.session, context: context,
                                             sourceFrame: sourceFrame, currentSourceFrame: { [weak self] in
                    self?.parent.sourceFrame ?? sourceFrame
                }) { [weak self] in
                    self?.parent.isPresented = false
                }
                let host = UIHostingController(rootView: root)
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
                    host.view.bottomAnchor.constraint(equalTo: container.view.bottomAnchor)
                ])
                host.didMove(toParent: container)
                container.view.layoutIfNeeded()
            }
        }
    }
}

private struct EffortOverlayView: View {
    let session: BackendSession
    let context: ComposerContext
    let sourceFrame: CGRect
    let currentSourceFrame: () -> CGRect
    let close: () -> Void
    @State private var catalogueOpen = false
    @State private var preview: String?
    @State private var panelSize = CGSize.zero
    @State private var revealed = false
    @State private var appeared = false
    @State private var closing = false
    @State private var returnFrame = CGRect.zero
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var settings: ComposerSettings { context.settings(session) }
    private var selected: ModelChoice? { context.model(session) }
    private var effort: String {
        if EffortControlKind.resolve(provider: context.providerId, levels: selected?.supportedEffortLevels ?? []) == .thinking {
            return settings.config["thinkingMode"]?.bool == true ? "On" : "Off"
        }
        let value = settings.effort(provider: context.providerId)
        return value.isEmpty && context.providerId == "codex" ? "Default" : ComposerSettings.effortLabel(value)
    }
    private var transition: Animation {
        reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.36, dampingFraction: 0.94)
    }
    private func requestClose() {
        guard !closing else { return }
        returnFrame = currentSourceFrame()
        closing = true
        withAnimation(transition, completionCriteria: .logicallyComplete) {
            revealed = false
        } completion: {
            close()
        }
    }
    var body: some View {
        GeometryReader { geometry in
            let center = CGPoint(x: geometry.size.width / 2,
                                 y: max(panelSize.height / 2 + 24, geometry.size.height - 12 - panelSize.height / 2))
            let frame = geometry.frame(in: .global)
            let target = closing ? returnFrame : sourceFrame
            let origin = target.isEmpty ? CGPoint(x: center.x, y: center.y + 60)
                : CGPoint(x: target.midX - frame.minX, y: target.midY - frame.minY)
            let initialScale = target.isEmpty ? 0.3 : min(0.8, max(0.18, target.width / max(1, geometry.size.width)))
            ZStack {
                Color.clear.contentShape(.rect).ignoresSafeArea(.container)
                    .onTapGesture(perform: requestClose).accessibilityHidden(true)
                controls
                    .frame(width: geometry.size.width)
                    .onGeometryChange(for: CGSize.self) { $0.size } action: { panelSize = $0 }
                    .background {
                        Group {
                            if reduceTransparency { RoundedRectangle(cornerRadius: 36).fill(Color(.secondarySystemBackground)).padding(.horizontal, 16) }
                            else {
                                Rectangle().fill(.ultraThinMaterial)
                                    .mask { RoundedRectangle(cornerRadius: 44).padding(24).blur(radius: 24) }
                                    .padding(-44)
                            }
                        }.allowsHitTesting(false).accessibilityHidden(true)
                    }
                    .scaleEffect(reduceMotion || revealed ? 1 : initialScale)
                    .offset(x: reduceMotion || revealed ? 0 : origin.x - center.x,
                            y: reduceMotion || revealed ? 0 : origin.y - center.y)
                    .opacity(revealed && !catalogueOpen ? 1 : 0)
                    .position(center)
                    .allowsHitTesting(revealed && !closing && !catalogueOpen)
                    .accessibilityHidden(catalogueOpen || !revealed || closing)
            }
        }
        .onAppear {
            // Visibility must not depend on measuring an invisible background.
            guard !appeared else { return }
            appeared = true
            DispatchQueue.main.async {
                guard !closing else { return }
                withAnimation(transition) { revealed = true }
            }
        }
        .tint(.primary)
        .accessibilityAction(.escape, requestClose)
        .sheet(isPresented: $catalogueOpen) { ModelSheet(session: session, context: context) }
        .task { await session.loadModels(context.providerId) }
        .onChange(of: selected?.id) { _, _ in preview = nil }
    }
    private var controls: some View {
        VStack(spacing: 18) {
            HStack(spacing: 4) {
                Button { catalogueOpen = true } label: {
                    HStack(spacing: 7) {
                        ComposerModelLabel(model: selected, loading: context.modelsLoading(session))
                        if selected != nil { Text(preview ?? effort).foregroundStyle(.secondary) }
                        Image(systemName: "chevron.right").font(.body.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    .font(.title3).lineLimit(1).minimumScaleFactor(0.75)
                    .frame(maxWidth: .infinity, minHeight: 48).contentShape(.rect)
                }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("selectModel")
                Button(action: requestClose) {
                    Image(systemName: "xmark").font(.body).foregroundStyle(.secondary)
                        .frame(width: 44, height: 44).contentShape(.circle)
                }.buttonStyle(ChatPressStyle()).accessibilityLabel("Close").accessibilityIdentifier("closeEffortOverlay")
            }.padding(.leading, 28).padding(.trailing, 16)
            if let selected {
                EffortControlPanel(session: session, context: context, model: selected, expanded: true, onPreview: { preview = $0 })
                    .id(selected.id)
                if EffortControlKind.resolve(provider: context.providerId, levels: selected.supportedEffortLevels ?? []) == .hidden {
                    Text("This model has no effort options.").font(.subheadline).foregroundStyle(.secondary)
                }
            } else if session.loadingModels.contains(context.providerId) { ProgressView() }
            SettingsRecoveryNotice(session: session, runID: context.runID)
        }
    }
}
