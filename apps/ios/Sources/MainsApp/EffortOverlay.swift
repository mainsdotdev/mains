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
            .overlay {
                if isPresented, let context {
                    EffortOverlayView(session: session, context: context, sourceFrame: sourceFrame,
                        currentSourceFrame: { sourceFrame }, close: { isPresented = false })
                        .ignoresSafeArea(.container)
                        .accessibilityElement(children: .contain)
                        .accessibilityAddTraits(.isModal)
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
        return ComposerSettings.effortLabel(value, provider: context.providerId)
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
                        ComposerModelLabel(model: selected, loading: context.modelsLoading(session), providerID: context.providerId)
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
