import SwiftUI

enum ComposerPicker: Hashable {
    case model, runOptions, target
}

struct ComposerPickerSourceFrames: PreferenceKey {
    static let defaultValue: [ComposerPicker: CGRect] = [:]
    static func reduce(value: inout [ComposerPicker: CGRect], nextValue: () -> [ComposerPicker: CGRect]) {
        value.merge(nextValue()) { _, next in next }
    }
}

extension View {
    func composerPickerSource(_ picker: ComposerPicker) -> some View {
        background(alignment: .center) {
            GeometryReader { geometry in
                Color.clear.preference(key: ComposerPickerSourceFrames.self, value: [picker: geometry.frame(in: .global)])
            }
        }
    }

    func composerPickers(model: Binding<Bool>, options: Binding<Bool>, target: Binding<Bool> = .constant(false), session: BackendSession,
                         context: ComposerContext?, withinPane: Bool = false) -> some View {
        modifier(ComposerPickers(model: model, options: options, target: target, session: session, context: context, withinPane: withinPane))
    }
}

private struct ComposerPickers: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @Binding var model: Bool
    @Binding var options: Bool
    @Binding var target: Bool
    let session: BackendSession
    let context: ComposerContext?
    let withinPane: Bool
    @State private var sourceFrames: [ComposerPicker: CGRect] = [:]
    @Environment(\.conversationPaneVisible) private var paneVisible

    func body(content: Content) -> some View {
        let picker: ComposerPicker? = model ? .model : options ? .runOptions : target ? .target : nil
        content
            .onPreferenceChange(ComposerPickerSourceFrames.self) { sourceFrames = $0 }
            .onChange(of: paneVisible) { _, visible in
                if withinPane && !visible { model = false; options = false }
            }
            .overlay {
                if let picker, let context {
                    ComposerPickerPanel(sourceFrame: sourceFrames[picker] ?? .zero,
                                        currentSourceFrame: { sourceFrames[picker] ?? .zero },
                                        close: { dismiss(picker) }) { close, closing in
                        switch picker {
                        case .model: EffortOverlayView(session: session, context: context, closing: closing, close: close)
                        case .runOptions: RunOptionsSheet(session: session, context: context, closing: closing, close: close)
                        case .target: HomeTargetPicker(session: session, context: context, closing: closing, close: close)
                        }
                    }
                    .id("\(picker):\(session.ownership):\(context.providerId):\(context.spaceID ?? ""):\(context.runID ?? "")")
                    .ignoresSafeArea(withinPane ? [] : .container)
                    .accessibilityElement(children: .contain)
                    .accessibilityAddTraits(.isModal)
                }
            }
    }

    private func dismiss(_ picker: ComposerPicker) {
        switch picker {
        case .model: model = false
        case .runOptions: options = false
        case .target: target = false
        }
    }
}

private struct ComposerPickerPanel<PanelContent: View>: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let sourceFrame: CGRect
    let currentSourceFrame: () -> CGRect
    let close: () -> Void
    @ViewBuilder let panelContent: (@escaping () -> Void, Bool) -> PanelContent
    @State private var panelSize = CGSize.zero
    @State private var revealed = false
    @State private var appeared = false
    @State private var closing = false
    @State private var returnFrame = CGRect.zero
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    private var backdropColor: Color { Color(white: colorScheme == .dark ? 0.015 : 0.88) }
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
            let panelWidth = min(520, geometry.size.width)
            let availableHeight = max(1, geometry.size.height - 36)
            let panelHeight = min(panelSize.height, availableHeight)
            let center = CGPoint(x: geometry.size.width / 2,
                                 y: max(panelHeight / 2 + 24, geometry.size.height - 12 - panelHeight / 2))
            let frame = geometry.frame(in: .global)
            let target = closing ? returnFrame : sourceFrame
            let origin = target.isEmpty ? CGPoint(x: center.x, y: center.y + 60)
                : CGPoint(x: target.midX - frame.minX, y: target.midY - frame.minY)
            let initialScale = target.isEmpty ? 0.3 : min(0.8, max(0.18, target.width / max(1, panelWidth)))
            ZStack {
                Color.clear.contentShape(.rect)
                    .onTapGesture(perform: requestClose).accessibilityHidden(true)
                ScrollView(.vertical) {
                    panelContent(requestClose, closing)
                        .frame(width: panelWidth)
                        .onGeometryChange(for: CGSize.self) { $0.size } action: { panelSize = $0 }
                }
                    .scrollIndicators(.hidden)
                    .scrollBounceBehavior(.basedOnSize)
                    .scrollDismissesKeyboard(.never)
                    .frame(width: panelWidth, height: panelSize.height > 0 ? panelHeight : availableHeight)
                    .background(alignment: .center) {
                        Group {
                            if reduceTransparency { RoundedRectangle(cornerRadius: 36).fill(backdropColor).padding(.horizontal, 16) }
                            else {
                                Rectangle().fill(.ultraThinMaterial)
                                    .overlay { backdropColor.opacity(0.93) }
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
    }
}

private struct EffortOverlayView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let context: ComposerContext
    let closing: Bool
    let close: () -> Void
    @State private var selectingModel = false
    @State private var pendingModel: ModelChoice?
    @State private var pendingSettings: ComposerSettings?
    @State private var showingModelSave = false
    private var settings: ComposerSettings { context.settings(session) }
    private var selected: ModelChoice? { context.model(session) }
    private var presentedModel: ModelChoice? { pendingModel ?? selected }
    private var presentedSettings: ComposerSettings { pendingSettings ?? settings }
    private var models: [ModelChoice] { session.models[context.providerId] ?? [] }
    private var modelSelectionBlocked: Bool { closing || selectingModel || context.saving(session) || !session.isConnected || session.sending }
    var body: some View {
        controls
        .task { await session.loadModels(context.providerId) }
        .task(id: pendingModel?.id) {
            showingModelSave = false
            guard let pendingID = pendingModel?.id, selectingModel else { return }
            do { try await Task.sleep(for: .milliseconds(180)) } catch { return }
            if pendingModel?.id == pendingID && selectingModel && !closing { showingModelSave = true }
        }
    }
    private var controls: some View {
        VStack(spacing: 10) {
            ModelEffortPicker(providerID: context.providerId, models: models, model: presentedModel,
                              settings: presentedSettings, loading: context.modelsLoading(session),
                              enabled: !modelSelectionBlocked, saving: context.saving(session),
                              showingModelSave: showingModelSave, error: session.modelErrors[context.providerId],
                              canRetry: session.isConnected, retry: { Task { await session.loadModels(context.providerId, force: true) } },
                              close: close, selectModel: chooseModel,
                              updateEffort: { context.save($0, session: session) })
            SettingsRecoveryNotice(session: session, runID: context.runID)
        }
    }
    private func chooseModel(_ candidate: ModelChoice) {
        guard !modelSelectionBlocked, let model = models.first(where: { $0.id == candidate.id }) else { return }
        var next = settings; next.select(model, provider: context.providerId)
        guard next != settings else { return }
        let owner = session.ownership
        selectingModel = true; pendingModel = model; pendingSettings = next
        Task {
            guard owner == session.ownership else { return }
            defer { if owner == session.ownership { selectingModel = false; pendingModel = nil; pendingSettings = nil } }
            do { try await context.commit(next, session: session) }
            catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
        }
    }
}

struct ModelEffortPicker: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let providerID: String
    let models: [ModelChoice]
    let model: ModelChoice?
    let settings: ComposerSettings
    let loading: Bool
    let enabled: Bool
    var saving = false
    var showingModelSave = false
    var storedEffortOnly = false
    var compactWheel = false
    var error: String?
    let canRetry: Bool
    let retry: () -> Void
    var close: (() -> Void)? = nil
    let selectModel: (ModelChoice) -> Void
    let updateEffort: (ComposerSettings) -> Void
    @State private var preview: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .title2) private var modelRowHeight: CGFloat = 52
    @ScaledMetric(relativeTo: .subheadline) private var effortCaptionHeight: CGFloat = 24
    @ScaledMetric(relativeTo: .body) private var effortControlHeight: CGFloat = 76

    private var kind: EffortControlKind {
        .resolve(provider: providerID, levels: model?.supportedEffortLevels ?? [], storedEffortOnly: storedEffortOnly)
    }
    private var showsCaption: Bool {
        switch kind {
        case .slider, .list: model != nil
        default: false
        }
    }
    private var effort: String {
        ComposerSettings.effortLabel(settings.effort(provider: providerID, model: model), provider: providerID)
    }

    var body: some View {
        let rowHeight = compactWheel ? modelRowHeight * 0.75 : modelRowHeight
        VStack(spacing: 10) {
            HStack(spacing: 4) {
                ComposerModelWheel(models: models, selectedID: model?.id ?? settings.model,
                                   pendingModel: model, providerID: providerID, loading: loading, enabled: enabled,
                                   rowHeight: rowHeight, reduceMotion: reduceMotion, onSelect: selectModel)
                    .frame(maxWidth: .infinity).frame(height: rowHeight * (dynamicTypeSize.isAccessibilitySize ? 1.8 : 3))
                    .composerWheelFade()
                if let close {
                    Button(action: close) {
                        Image(systemName: "xmark").font(.body).foregroundStyle(.secondary)
                            .frame(width: 44, height: 44).contentShape(.circle)
                    }.buttonStyle(ChatPressStyle()).accessibilityLabel("Close").accessibilityIdentifier("closeEffortOverlay")
                }
            }.padding(.leading, close == nil ? 16 : 28).padding(.trailing, 16)
            if let error {
                HStack {
                    Text(error).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    Button("Try again", action: retry).font(.caption.weight(.semibold)).disabled(!canRetry)
                }.padding(.horizontal, 28)
            }
            VStack(spacing: 6) {
                HStack {
                    Text("Effort").foregroundStyle(.secondary)
                    Spacer()
                    Text(preview ?? effort).opacity(showingModelSave ? 0.5 : 1)
                        .accessibilityValue(showingModelSave ? "Saving model" : "")
                }.font(.subheadline).padding(.horizontal, 28).frame(height: effortCaptionHeight)
                    .opacity(showsCaption ? 1 : 0).accessibilityHidden(!showsCaption)
                ZStack {
                    if let model {
                        EffortControlPanel(providerID: providerID, model: model, settings: settings, baseKind: kind,
                                           canInteract: enabled, saving: saving, expanded: true,
                                           expandedControlHeight: effortControlHeight, onPreview: { preview = $0 }, onChange: updateEffort)
                    } else if loading {
                        SkeletonLine(width: 224, height: 34).accessibilityLabel("Loading effort options…")
                    }
                }
                .frame(height: effortControlHeight + 16)
            }
            .frame(height: effortCaptionHeight + 6 + effortControlHeight + 16)
        }
        .onChange(of: model?.id) { _, _ in preview = nil }
    }
}
