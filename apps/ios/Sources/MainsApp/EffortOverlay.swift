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
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
                        .id("\(session.ownership):\(context.providerId):\(context.spaceID ?? ""):\(context.runID ?? "")")
                        .ignoresSafeArea(.container)
                        .accessibilityElement(children: .contain)
                        .accessibilityAddTraits(.isModal)
                }
            }
    }
}

private struct EffortOverlayView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let context: ComposerContext
    let sourceFrame: CGRect
    let currentSourceFrame: () -> CGRect
    let close: () -> Void
    @State private var selectingModel = false
    @State private var pendingModel: ModelChoice?
    @State private var pendingSettings: ComposerSettings?
    @State private var showingModelSave = false
    @State private var preview: String?
    @State private var panelSize = CGSize.zero
    @State private var revealed = false
    @State private var appeared = false
    @State private var closing = false
    @State private var returnFrame = CGRect.zero
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .title2) private var modelRowHeight: CGFloat = 52
    @ScaledMetric(relativeTo: .subheadline) private var effortCaptionHeight: CGFloat = 24
    @ScaledMetric(relativeTo: .body) private var effortControlHeight: CGFloat = 76
    private var settings: ComposerSettings { context.settings(session) }
    private var backdropColor: Color { Color(white: colorScheme == .dark ? 0.025 : 0.965) }
    private var selected: ModelChoice? { context.model(session) }
    private var presentedModel: ModelChoice? { pendingModel ?? selected }
    private var presentedSettings: ComposerSettings { pendingSettings ?? settings }
    private var models: [ModelChoice] { session.models[context.providerId] ?? [] }
    private var modelSelectionBlocked: Bool { closing || selectingModel || context.saving(session) || !session.isConnected || session.sending }
    private var showsEffortCaption: Bool {
        guard let selected = presentedModel else { return false }
        switch EffortControlKind.resolve(provider: context.providerId, levels: selected.supportedEffortLevels ?? []) {
        case .slider, .list: return true
        default: return false
        }
    }
    private var effort: String {
        if EffortControlKind.resolve(provider: context.providerId, levels: presentedModel?.supportedEffortLevels ?? []) == .thinking {
            return presentedSettings.config["thinkingMode"]?.bool == true ? "On" : "Off"
        }
        let value = presentedSettings.effort(provider: context.providerId, model: presentedModel)
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
                    .background(alignment: .center) {
                        Group {
                            if reduceTransparency { RoundedRectangle(cornerRadius: 36).fill(backdropColor).padding(.horizontal, 16) }
                            else {
                                Rectangle().fill(.ultraThinMaterial)
                                    .overlay { backdropColor.opacity(0.85) }
                                    .mask { RoundedRectangle(cornerRadius: 44).padding(24).blur(radius: 24) }
                                    .padding(-44)
                            }
                        }.allowsHitTesting(false).accessibilityHidden(true)
                    }
                    .scaleEffect(reduceMotion || revealed ? 1 : initialScale)
                    .offset(x: reduceMotion || revealed ? 0 : origin.x - center.x,
                            y: reduceMotion || revealed ? 0 : origin.y - center.y)
                    .opacity(revealed ? 1 : 0)
                    .position(center)
                    .allowsHitTesting(revealed && !closing)
                    .accessibilityHidden(!revealed || closing)
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
        .task { await session.loadModels(context.providerId) }
        .task(id: pendingModel?.id) {
            showingModelSave = false
            guard let pendingID = pendingModel?.id, selectingModel else { return }
            do { try await Task.sleep(for: .milliseconds(180)) } catch { return }
            if pendingModel?.id == pendingID && selectingModel && !closing { showingModelSave = true }
        }
        .onChange(of: selected?.id) { _, _ in preview = nil }
    }
    private var controls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 4) {
                ComposerModelWheel(models: models, selectedID: pendingModel?.id ?? selected?.id ?? settings.model,
                                   pendingModel: pendingModel, providerID: context.providerId,
                                   loading: context.modelsLoading(session), enabled: !modelSelectionBlocked,
                                   rowHeight: modelRowHeight, reduceMotion: reduceMotion, onSelect: chooseModel)
                    .frame(maxWidth: .infinity).frame(height: modelRowHeight * (dynamicTypeSize.isAccessibilitySize ? 1.8 : 3))
                    .mask {
                        LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .white.opacity(0.55), location: 0.16),
                                               .init(color: .white, location: 0.4), .init(color: .white, location: 0.6),
                                               .init(color: .white.opacity(0.55), location: 0.84), .init(color: .clear, location: 1)],
                                       startPoint: .top, endPoint: .bottom)
                    }
                Button(action: requestClose) {
                    Image(systemName: "xmark").font(.body).foregroundStyle(.secondary)
                        .frame(width: 44, height: 44).contentShape(.circle)
                }.buttonStyle(ChatPressStyle()).accessibilityLabel("Close").accessibilityIdentifier("closeEffortOverlay")
            }.padding(.leading, 28).padding(.trailing, 16)
            if let error = session.modelErrors[context.providerId] {
                HStack {
                    Text(error).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    Button("Try again") { Task { await session.loadModels(context.providerId, force: true) } }
                        .font(.caption.weight(.semibold)).disabled(!session.isConnected)
                }.padding(.horizontal, 28)
            }
            VStack(spacing: 6) {
                HStack {
                    Text("Effort").foregroundStyle(.secondary)
                    Spacer()
                    if showingModelSave { ProgressView().controlSize(.mini).accessibilityLabel("Saving model") }
                    Text(preview ?? effort)
                }.font(.subheadline).padding(.horizontal, 28).frame(height: effortCaptionHeight)
                    .opacity(showsEffortCaption ? 1 : 0).accessibilityHidden(!showsEffortCaption)
                ZStack {
                    if let selected = presentedModel {
                        EffortControlPanel(session: session, context: context, model: selected, expanded: true,
                                           expandedControlHeight: effortControlHeight, settingsPreview: pendingSettings,
                                           interactionBlocked: selectingModel, onPreview: { preview = $0 })
                    } else if session.loadingModels.contains(context.providerId) { ProgressView() }
                }
                .frame(height: effortControlHeight + 16)
            }
            .frame(height: effortCaptionHeight + 6 + effortControlHeight + 16)
            SettingsRecoveryNotice(session: session, runID: context.runID)
        }
    }
    private func chooseModel(_ candidate: ModelChoice) {
        guard !modelSelectionBlocked, let model = models.first(where: { $0.id == candidate.id }) else { return }
        var next = settings; next.select(model, provider: context.providerId)
        guard next != settings else { return }
        let owner = session.ownership
        selectingModel = true; pendingModel = model; pendingSettings = next; preview = nil
        Task {
            guard owner == session.ownership else { return }
            defer { if owner == session.ownership { selectingModel = false; pendingModel = nil; pendingSettings = nil } }
            do { try await context.commit(next, session: session) }
            catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
        }
    }
}
