import SwiftUI

extension EnvironmentValues {
    @Entry var effortSliderLocksAncestorScroll = false
}

struct EffortControlPanel: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let providerID: String
    let model: ModelChoice
    let settings: ComposerSettings
    let baseKind: EffortControlKind
    let canInteract: Bool
    let saving: Bool
    var expanded = false
    var expandedControlHeight: CGFloat = 76
    var onPreview: (String?) -> Void = { _ in }
    let onChange: (ComposerSettings) -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var minimumStopSpacing: CGFloat = 44
    @State private var controlWidth: CGFloat?
    private var value: String { settings.effort(provider: providerID, model: model) }
    private var rangeMotion: Animation? { reduceMotion ? nil : .spring(response: 0.26, dampingFraction: 1) }
    private var kind: EffortControlKind {
        guard case .slider(let stops) = baseKind else { return baseKind }
        guard let controlWidth else { return dynamicTypeSize.isAccessibilitySize ? .list(stops) : baseKind }
        let metrics = EffortSliderMetrics(expanded: expanded, controlHeight: expandedControlHeight)
        return baseKind.fittingSlider(trackLength: Double(metrics.trackLength(in: controlWidth)),
                                  minimumStopSpacing: Double(minimumStopSpacing), prefersMenu: dynamicTypeSize.isAccessibilitySize)
    }
    private func label(_ level: String) -> String { ComposerSettings.effortLabel(level, provider: providerID) }
    var body: some View {
        if expanded || kind != .hidden {
            ZStack {
                switch kind {
                case .slider(let stops):
                    SteppedEffortSlider(stops: stops, value: value, emptyLabel: label(""), saving: saving,
                                        modelID: model.id, interactionEnabled: canInteract, expanded: expanded,
                                        expandedControlHeight: expandedControlHeight, onPreview: { onPreview($0) }, onCommit: save)
                        .transition(.opacity)
                case .thinking:
                    thinkingRow(Binding(get: { settings.config["thinkingMode"]?.bool == true }, set: { on in
                        guard canInteract else { return }
                        var next = settings
                        if on { next.config["thinkingMode"] = .bool(true) }
                        else { next.setEffort("", provider: providerID) }
                        onChange(next)
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
            .font(expanded ? .title3 : .subheadline).tint(Provider.accent(providerID))
            .padding(.horizontal, expanded ? 0 : 14).padding(.vertical, expanded ? 0 : 10)
            .frame(maxWidth: .infinity)
            .background(alignment: .center) {
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
        var next = settings; next.setEffort(value, provider: providerID); onChange(next)
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
    private struct Scope: Hashable {
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
    @Environment(\.effortSliderLocksAncestorScroll) private var locksAncestorScroll
    @State private var dragPosition: CGFloat?
    @State private var pending: String?
    @State private var nearest: Int?
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
                let gestureWidth = locksAncestorScroll ? geometry.size.width.rounded() : geometry.size.width
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
                }.frame(width: width, height: hit).padding(.horizontal, inset)
                    .animation(rangeMotion, value: stops)
                    .animation(dragPosition == nil ? rangeMotion : nil, value: value)
                    .overlay {
                        EffortSliderGestures(thumbCenter: x + inset, thumbRadius: thumb / 2,
                            enabled: enabled && interactionEnabled, locksAncestorScroll: locksAncestorScroll,
                            onDrag: { preview(at: $0 - inset, width: width) },
                            onSelect: { select(at: $0 - inset, width: width) },
                            onCancel: { reset(keepingPending: true) })
                            .id(scope)
                            .id(gestureWidth)
                            .accessibilityHidden(true)
                    }
                    .onChange(of: gestureWidth) { _, _ in
                        reset(keepingPending: true)
                    }
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
        .onChange(of: value) { _, _ in pending = nil }
        .onChange(of: scope) { _, _ in reset(); localScope = scope }
        .onChange(of: enabled && interactionEnabled) { _, active in
            if !active { reset(keepingPending: true) }
        }
        .onChange(of: saving) { _, busy in if !busy { pending = nil } }
    }

    private func preview(at x: CGFloat, width: CGFloat) {
        guard enabled, interactionEnabled, ownsState else { return }
        let position = clamp(x, width: width)
        dragPosition = position
        nearest = stop(at: position, width: width)
    }

    private func select(at x: CGFloat, width: CGFloat) {
        guard enabled, interactionEnabled, ownsState else { return }
        let level = stops[stop(at: x, width: width)]
        withAnimation(reduceMotion ? nil : .spring(response: 0.22, dampingFraction: 1)) {
            reset()
            pending = level == value ? nil : level
        }
        if level != value { onCommit(level) }
    }

    private func center(_ index: Int, width: CGFloat) -> CGFloat {
        endInset + CGFloat(index) / CGFloat(max(1, stops.count - 1)) * max(0, width - endInset * 2)
    }
    private func clamp(_ x: CGFloat, width: CGFloat) -> CGFloat { min(max(endInset, width - endInset), max(endInset, x)) }
    private func stop(at x: CGFloat, width: CGFloat) -> Int {
        Int((min(1, max(0, (x - endInset) / max(1, width - endInset * 2))) * CGFloat(stops.count - 1)).rounded())
    }
    private func reset(keepingPending: Bool = false) {
        dragPosition = nil; nearest = nil
        if !keepingPending { pending = nil }
    }
}

private struct EffortSliderGestures: UIViewRepresentable {
    let thumbCenter: CGFloat
    let thumbRadius: CGFloat
    let enabled: Bool
    let locksAncestorScroll: Bool
    let onDrag: (CGFloat) -> Void
    let onSelect: (CGFloat) -> Void
    let onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        let coordinator = context.coordinator
        let pan = UIPanGestureRecognizer(target: coordinator, action: #selector(Coordinator.panChanged(_:)))
        pan.maximumNumberOfTouches = 1
        pan.delegate = coordinator
        let tap = UITapGestureRecognizer(target: coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.require(toFail: pan)
        view.addGestureRecognizer(pan)
        view.addGestureRecognizer(tap)
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        context.coordinator.parent = self
        view.isUserInteractionEnabled = enabled
        if !enabled { context.coordinator.releaseScroll() }
    }

    static func dismantleUIView(_ view: UIView, coordinator: Coordinator) {
        coordinator.releaseScroll()
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: EffortSliderGestures
        private var grabOffset: CGFloat = 0
        private weak var lockedScrollView: UIScrollView?
        init(_ parent: EffortSliderGestures) { self.parent = parent }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            let offset = touch.location(in: gestureRecognizer.view).x - parent.thumbCenter
            grabOffset = abs(offset) <= parent.thumbRadius ? offset : 0
            return parent.enabled
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
            let translation = pan.translation(in: pan.view)
            return abs(translation.x) >= abs(translation.y)
        }

        // Let vertical gestures scroll, and keep a recognized slider drag even outside the track.
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            guard let surface = gestureRecognizer.view, let scroll = other.view as? UIScrollView else { return false }
            return other === scroll.panGestureRecognizer && surface.isDescendant(of: scroll)
        }

        @objc func panChanged(_ pan: UIPanGestureRecognizer) {
            let position = pan.location(in: pan.view).x - grabOffset
            switch pan.state {
            case .began:
                if parent.locksAncestorScroll { lockScroll(containing: pan.view) }
                parent.onDrag(position)
            case .changed:
                parent.onDrag(position)
            case .ended:
                releaseScroll()
                parent.onSelect(position)
            case .cancelled, .failed:
                releaseScroll()
                parent.onCancel()
            default: break
            }
        }

        private func lockScroll(containing view: UIView?) {
            var ancestor = view?.superview
            while let host = ancestor {
                if let scroll = host as? UIScrollView, scroll.panGestureRecognizer.isEnabled {
                    lockedScrollView = scroll
                    scroll.panGestureRecognizer.isEnabled = false
                    return
                }
                ancestor = host.superview
            }
        }

        func releaseScroll() {
            guard let scroll = lockedScrollView else { return }
            lockedScrollView = nil
            scroll.panGestureRecognizer.isEnabled = scroll.isScrollEnabled
        }

        @objc func tapped(_ tap: UITapGestureRecognizer) {
            parent.onSelect(tap.location(in: tap.view).x)
        }
    }
}
