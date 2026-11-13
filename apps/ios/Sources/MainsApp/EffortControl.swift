import SwiftUI

struct EffortControlPanel: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let context: ComposerContext
    let model: ModelChoice
    var expanded = false
    var expandedControlHeight: CGFloat = 76
    var settingsPreview: ComposerSettings?
    var interactionBlocked = false
    var onPreview: (String?) -> Void = { _ in }
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var minimumStopSpacing: CGFloat = 44
    @State private var controlWidth: CGFloat?
    private var settings: ComposerSettings { settingsPreview ?? context.settings(session) }
    private var value: String { settings.effort(provider: context.providerId, model: model) }
    private var canInteract: Bool { !interactionBlocked && !context.saving(session) && session.isConnected && !session.sending }
    private var rangeMotion: Animation? { reduceMotion ? nil : .spring(response: 0.26, dampingFraction: 1) }
    private var kind: EffortControlKind {
        let base = EffortControlKind.resolve(provider: context.providerId, levels: model.supportedEffortLevels ?? [])
        guard case .slider(let stops) = base else { return base }
        guard let controlWidth else { return dynamicTypeSize.isAccessibilitySize ? .list(stops) : base }
        let metrics = EffortSliderMetrics(expanded: expanded, controlHeight: expandedControlHeight)
        return base.fittingSlider(trackLength: Double(metrics.trackLength(in: controlWidth)),
                                  minimumStopSpacing: Double(minimumStopSpacing), prefersMenu: dynamicTypeSize.isAccessibilitySize)
    }
    private func label(_ level: String) -> String { ComposerSettings.effortLabel(level, provider: context.providerId) }
    var body: some View {
        if expanded || kind != .hidden {
            ZStack {
                switch kind {
                case .slider(let stops):
                    SteppedEffortSlider(stops: stops, value: value, emptyLabel: label(""), saving: context.saving(session),
                                        modelID: model.id, interactionEnabled: canInteract, expanded: expanded,
                                        expandedControlHeight: expandedControlHeight, onPreview: { onPreview($0) }, onCommit: save)
                        .transition(.opacity)
                case .thinking:
                    thinkingRow(Binding(get: { settings.config["thinkingMode"]?.bool == true }, set: { on in
                        guard canInteract else { return }
                        var next = settings
                        if on { next.config["thinkingMode"] = .bool(true) }
                        else { next.setEffort("", provider: context.providerId) }
                        context.save(next, session: session)
                    })).transition(.opacity)
                case .toggle(let level):
                    thinkingRow(Binding(get: { value == level || value == "ultracode" }, set: { save($0 ? level : "") }), detail: label(level))
                        .transition(.opacity)
                case .list(let stops):
                    Menu {
                        ForEach(stops, id: \.self) { level in
                            Button { save(level) } label: {
                                if value == level { Label(label(level), systemImage: "checkmark") }
                                else { Text(label(level)) }
                            }.accessibilityIdentifier("effort-\(level.isEmpty ? "off" : level)")
                        }
                    } label: {
                        HStack { Text("Effort"); Spacer(); Text(label(value)).foregroundStyle(.secondary); Image(systemName: "chevron.up.chevron.down").font(.caption) }
                            .frame(height: expanded ? expandedControlHeight : 44).contentShape(.rect)
                    }.menuOrder(.fixed).buttonStyle(.plain).accessibilityIdentifier("chooseEffort").transition(.opacity)
                case .hidden:
                    Text("This model has no effort options.").font(.subheadline).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center).lineLimit(2).padding(.horizontal, 20).transition(.opacity)
                }
            }
            .frame(height: expanded ? expandedControlHeight : nil)
            .font(expanded ? .title3 : .subheadline).tint(Provider.accent(context.providerId))
            .padding(.horizontal, expanded ? 0 : 14).padding(.vertical, expanded ? 0 : 10)
            .frame(maxWidth: .infinity)
            .background {
                if !expanded { RoundedRectangle(cornerRadius: 22).fill(Color(.tertiarySystemFill)) }
                else {
                    // One material survives slider/menu/toggle and model changes.
                    Color.clear.modifier(GlassSurface(radius: expandedControlHeight / 2))
                        .opacity(kind == .hidden ? 0 : 1)
                }
            }
            // Keep the viewport fixed; only stops and the thumb move as the
            // model's effort range changes.
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { controlWidth = $0 }
            .padding(.horizontal, expanded ? 28 : 16).padding(.vertical, 8)
            .allowsHitTesting(canInteract)
            .disabled(!canInteract)
            .animation(rangeMotion, value: kind)
        }
    }
    private func thinkingRow(_ binding: Binding<Bool>, detail: String? = nil) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Thinking")
                if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            Toggle("Thinking", isOn: binding).labelsHidden().toggleStyle(.switch).accessibilityIdentifier("thinkingToggle")
        }.frame(minHeight: expanded ? expandedControlHeight : 44).padding(.horizontal, expanded ? 20 : 0)
    }
    private func save(_ value: String) {
        guard canInteract, value != self.value else { return }
        var next = settings; next.setEffort(value, provider: context.providerId); context.save(next, session: session)
    }
}

/// Shared by fitting and drawing, so a change to the thumb or track padding
/// cannot make the layout policy overestimate space for the stops.
private struct EffortSliderMetrics {
    let expanded: Bool
    var controlHeight: CGFloat = 76
    var thumb: CGFloat { expanded ? 44 : 30 }
    var track: CGFloat { expanded ? 50 : 26 }
    var hit: CGFloat { expanded ? controlHeight : 44 }
    var inset: CGFloat { expanded ? 12 : 0 }
    var dot: CGFloat { expanded ? 10 : 5 }
    var endInset: CGFloat { max(track, thumb) / 2 }
    func trackLength(in width: CGFloat) -> CGFloat { max(0, width - inset * 2 - endInset * 2) }
}

private struct SteppedEffortSlider: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    private struct Scope: Equatable {
        let modelID: String
        let stops: [String]
    }
    let stops: [String]
    let value: String
    let emptyLabel: String
    let saving: Bool
    let modelID: String
    var interactionEnabled = true
    var expanded = false
    var expandedControlHeight: CGFloat = 76
    var onPreview: (String?) -> Void = { _ in }
    let onCommit: (String) -> Void
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var touching = false
    @State private var origin: CGFloat?
    @State private var dragPosition: CGFloat?
    @State private var moved = false
    @State private var pending: String?
    @State private var nearest: Int?
    @State private var interrupted = false
    @State private var gestureActive = false
    @State private var localScope: Scope?
    private var scope: Scope { Scope(modelID: modelID, stops: stops) }
    private var ownsState: Bool { localScope == scope }
    private var index: Int {
        if ownsState, let nearest, stops.indices.contains(nearest) { return nearest }
        return EffortControlKind.stopIndex(in: stops, value: ownsState ? pending ?? value : value)
    }
    private var metrics: EffortSliderMetrics { .init(expanded: expanded, controlHeight: expandedControlHeight) }
    private var thumb: CGFloat { metrics.thumb }
    private var track: CGFloat { metrics.track }
    private var hit: CGFloat { metrics.hit }
    private var inset: CGFloat { metrics.inset }
    private var dot: CGFloat { metrics.dot }
    private var endInset: CGFloat { metrics.endInset }
    private var selection: String {
        if ownsState, let nearest, stops.indices.contains(nearest) { return stops[nearest] }
        return ownsState ? pending ?? value : value
    }
    private var rangeMotion: Animation? { reduceMotion ? nil : .spring(response: 0.26, dampingFraction: 1) }
    private var label: String {
        selection.isEmpty ? emptyLabel : ComposerSettings.effortLabel(selection)
    }
    private func neutral(_ level: String) -> Bool { level.isEmpty || level == "none" || level == "default" }
    // Keep the yellow → violet ramp, starting at the first explicit effort so
    // adding None/Default never changes Low into a higher-effort colour.
    private func ramp(width: CGFloat) -> LinearGradient {
        let first = stops.firstIndex { !neutral($0) } ?? 0
        let start = width > 0 ? center(first, width: width) / width : 0
        let end = width > 0 ? center(stops.count - 1, width: width) / width : 1
        let span = max(0, end - start)
        return LinearGradient(stops: [
            .init(color: Color(red: 245/255, green: 215/255, blue: 110/255), location: start),
            .init(color: Color(red: 125/255, green: 222/255, blue: 106/255), location: start + span * 0.22),
            .init(color: Color(red: 61/255, green: 220/255, blue: 180/255), location: start + span * 0.42),
            .init(color: Color(red: 59/255, green: 130/255, blue: 246/255), location: start + span * 0.64),
            .init(color: Color(red: 109/255, green: 94/255, blue: 245/255), location: start + span * 0.82),
            .init(color: Color(red: 192/255, green: 132/255, blue: 252/255), location: end)
        ], startPoint: .leading, endPoint: .trailing)
    }
    var body: some View {
        VStack(spacing: 4) {
            if !expanded { HStack { Text("Effort"); Spacer(); Text(label).foregroundStyle(.secondary).contentTransition(.opacity) } }
            GeometryReader { geometry in
                let width = max(0, geometry.size.width - inset * 2)
                let x = (ownsState ? dragPosition : nil) ?? center(index, width: width)
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(.separator)).frame(height: track)
                    if !neutral(selection) {
                        ramp(width: width).frame(height: track)
                            .mask(alignment: .leading) {
                                Capsule().frame(width: min(width, max(track, x + track / 2)), height: track)
                            }
                            .clipShape(.capsule)
                    }
                    ForEach(stops, id: \.self) { level in
                        let tick = stops.firstIndex(of: level) ?? 0
                        Circle().fill(tick < index ? Color.white.opacity(0.92) : Color(.tertiaryLabel))
                            .frame(width: dot, height: dot).offset(x: center(tick, width: width) - dot / 2)
                            .opacity(tick == index ? 0 : 1)
                            .transition(.opacity.combined(with: .scale(scale: 0.7)))
                    }
                    Circle().fill(.white).overlay { Circle().strokeBorder(Color(.separator), lineWidth: 0.5) }
                        .shadow(color: .black.opacity(0.16), radius: 3, y: 2)
                        .frame(width: thumb, height: thumb).offset(x: x - thumb / 2)
                }.frame(width: width, height: hit).contentShape(.rect)
                    .animation(rangeMotion, value: stops)
                    .animation(rangeMotion, value: value)
                    .gesture(DragGesture(minimumDistance: 0)
                        .updating($touching) { _, state, _ in state = true }
                        .onChanged { gesture in
                            guard enabled, interactionEnabled else { return }
                            if !ownsState { reset(); localScope = scope }
                            if !gestureActive { gestureActive = true; interrupted = false }
                            guard !interrupted else { return }
                            if origin == nil { origin = center(index, width: width) }
                            if abs(gesture.translation.width) > 8 { moved = true }
                            if moved {
                                let position = clamp((origin ?? x) + gesture.translation.width, width: width)
                                dragPosition = position; nearest = stop(at: position, width: width)
                            }
                        }
                        .onEnded { gesture in
                            defer { gestureActive = false }
                            guard enabled, interactionEnabled, ownsState, !interrupted else { reset(); return }
                            let position = moved ? (origin ?? x) + gesture.translation.width : gesture.location.x
                            let selected = stop(at: position, width: width)
                            let level = stops[selected]
                            withAnimation(reduceMotion ? nil : .spring(response: 0.22, dampingFraction: 1)) {
                                dragPosition = nil; nearest = nil; pending = level == value ? nil : level
                                origin = nil; moved = false
                            }
                            if level != value { onCommit(level) }
                        })
                    .onChange(of: geometry.size.width) { _, _ in
                        let wasTouching = touching
                        reset(keepingPending: true); interrupted = wasTouching
                    }
                    .padding(.horizontal, inset)
            }.frame(height: hit)
                .allowsHitTesting(enabled && interactionEnabled)
                .accessibilityElement(children: .ignore).accessibilityLabel("Effort").accessibilityValue(label)
                .accessibilityIdentifier("effortSlider")
                .accessibilityAdjustableAction { direction in
                    guard enabled, interactionEnabled else { return }
                    if !ownsState { reset(); localScope = scope }
                    let next = min(stops.count - 1, max(0, index + (direction == .increment ? 1 : -1)))
                    if pending == "ultracode" || value == "ultracode", direction == .increment { return }
                    if stops[next] != value { pending = stops[next]; onCommit(stops[next]) }
                }
        }
        .sensoryFeedback(.selection, trigger: index)
        .onAppear { localScope = scope; onPreview(label) }
        .onDisappear { onPreview(nil) }
        .onChange(of: label) { _, text in onPreview(text) }
        .onChange(of: value) { _, _ in reset() }
        .onChange(of: scope) { _, _ in
            let wasTouching = touching
            reset(); localScope = scope; interrupted = wasTouching
        }
        .onChange(of: interactionEnabled) { _, active in
            if !active { let wasTouching = touching; reset(keepingPending: true); interrupted = wasTouching }
        }
        .onChange(of: saving) { _, busy in if !busy { reset() } }
        .onChange(of: touching) { _, active in
            if !active { if origin != nil { reset() }; gestureActive = false }
        }
    }
    private func center(_ index: Int, width: CGFloat) -> CGFloat {
        endInset + CGFloat(index) / CGFloat(max(1, stops.count - 1)) * max(0, width - endInset * 2)
    }
    private func clamp(_ x: CGFloat, width: CGFloat) -> CGFloat { min(max(endInset, width - endInset), max(endInset, x)) }
    private func stop(at x: CGFloat, width: CGFloat) -> Int {
        Int((min(1, max(0, (x - endInset) / max(1, width - endInset * 2))) * CGFloat(stops.count - 1)).rounded())
    }
    private func reset(keepingPending: Bool = false) {
        origin = nil; dragPosition = nil; nearest = nil; moved = false
        if !keepingPending { pending = nil }
    }
}
