import SwiftUI

struct EffortControlPanel: View {
    let session: BackendSession
    let context: ComposerContext
    let model: ModelChoice
    var expanded = false
    var onPreview: (String?) -> Void = { _ in }
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var minimumStopSpacing: CGFloat = 44
    @State private var controlWidth: CGFloat?
    private var settings: ComposerSettings { context.settings(session) }
    private var value: String { settings.effort(provider: context.providerId) }
    private var kind: EffortControlKind {
        let base = EffortControlKind.resolve(provider: context.providerId, levels: model.supportedEffortLevels ?? [])
        guard case .slider(let stops) = base else { return base }
        guard let controlWidth else { return dynamicTypeSize.isAccessibilitySize ? .list(stops) : base }
        let metrics = EffortSliderMetrics(expanded: expanded)
        return base.fittingSlider(trackLength: Double(metrics.trackLength(in: controlWidth)),
                                  minimumStopSpacing: Double(minimumStopSpacing), prefersMenu: dynamicTypeSize.isAccessibilitySize)
    }
    private func label(_ level: String) -> String { ComposerSettings.effortLabel(level, provider: context.providerId) }
    var body: some View {
        if kind != .hidden {
            VStack(spacing: expanded ? 12 : 0) {
                switch kind {
                case .slider(let stops):
                    SteppedEffortSlider(stops: stops, value: value, emptyLabel: label(""), saving: context.saving(session), expanded: expanded, onPreview: { onPreview($0) }, onCommit: save)
                case .thinking:
                    thinkingRow(Binding(get: { settings.config["thinkingMode"]?.bool == true }, set: { on in
                        var next = settings
                        if on { next.config["thinkingMode"] = .bool(true) }
                        else { next.setEffort("", provider: context.providerId) }
                        context.save(next, session: session)
                    }))
                case .toggle(let level):
                    thinkingRow(Binding(get: { value == level || value == "ultracode" }, set: { save($0 ? level : "") }), detail: label(level))
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
                            .frame(minHeight: 44).contentShape(.rect)
                    }.menuOrder(.fixed).buttonStyle(.plain).accessibilityIdentifier("chooseEffort")
                case .hidden: EmptyView()
                }
                if context.providerId == "claude_code", model.supportedEffortLevels?.contains("xhigh") == true {
                    if !expanded { Divider().padding(.top, 4) }
                    Button { if value != "ultracode" { save("ultracode") } } label: {
                        HStack {
                            Text("Ultracode"); Spacer()
                            if value == "ultracode" { Image(systemName: "checkmark").foregroundStyle(.blue) }
                        }.frame(minHeight: 44).contentShape(.rect)
                    }.buttonStyle(.plain).accessibilityAddTraits(value == "ultracode" ? .isSelected : [])
                        .accessibilityIdentifier("effort-ultracode")
                }
            }
            .font(expanded ? .title3 : .subheadline).tint(Provider.accent(context.providerId))
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { controlWidth = $0 }
            .padding(.horizontal, expanded ? 0 : 14).padding(.vertical, expanded ? 0 : 10)
            .background {
                if !expanded { RoundedRectangle(cornerRadius: 22).fill(Color(.tertiarySystemFill)) }
                else if case .slider = kind { Color.clear }
                else { Color.clear.modifier(GlassSurface(radius: 30)) }
            }
            .padding(.horizontal, expanded ? 28 : 16).padding(.vertical, 8)
            .disabled(context.saving(session) || !session.isConnected || session.sending)
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
        }.frame(minHeight: expanded ? 76 : 44).padding(.horizontal, expanded ? 20 : 0)
    }
    private func save(_ value: String) {
        guard value != self.value else { return }
        var next = settings; next.setEffort(value, provider: context.providerId); context.save(next, session: session)
    }
}

/// Shared by fitting and drawing, so a change to the thumb or track padding
/// cannot make the layout policy overestimate space for the stops.
private struct EffortSliderMetrics {
    let expanded: Bool
    var thumb: CGFloat { expanded ? 44 : 30 }
    var track: CGFloat { expanded ? 50 : 26 }
    var hit: CGFloat { expanded ? 76 : 44 }
    var inset: CGFloat { expanded ? 12 : 0 }
    var dot: CGFloat { expanded ? 10 : 5 }
    var endInset: CGFloat { max(track, thumb) / 2 }
    func trackLength(in width: CGFloat) -> CGFloat { max(0, width - inset * 2 - endInset * 2) }
}

private struct SteppedEffortSlider: View {
    let stops: [String]
    let value: String
    let emptyLabel: String
    let saving: Bool
    var expanded = false
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
    private var index: Int { nearest ?? EffortControlKind.stopIndex(in: stops, value: pending ?? value) }
    private var metrics: EffortSliderMetrics { .init(expanded: expanded) }
    private var thumb: CGFloat { metrics.thumb }
    private var track: CGFloat { metrics.track }
    private var hit: CGFloat { metrics.hit }
    private var inset: CGFloat { metrics.inset }
    private var dot: CGFloat { metrics.dot }
    private var endInset: CGFloat { metrics.endInset }
    private var selection: String { nearest.map { stops[$0] } ?? pending ?? value }
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
                let x = dragPosition ?? center(index, width: width)
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(.separator)).frame(height: track)
                    if !neutral(selection) {
                        ramp(width: width).frame(height: track)
                            .mask(alignment: .leading) {
                                Capsule().frame(width: min(width, max(track, x + track / 2)), height: track)
                            }
                            .clipShape(.capsule)
                    }
                    ForEach(stops.indices, id: \.self) { tick in
                        if tick != index {
                            Circle().fill(tick < index ? Color.white.opacity(0.92) : Color(.tertiaryLabel))
                                .frame(width: dot, height: dot).offset(x: center(tick, width: width) - dot / 2)
                        }
                    }
                    Circle().fill(.white).overlay { Circle().strokeBorder(Color(.separator), lineWidth: 0.5) }
                        .shadow(color: .black.opacity(0.16), radius: 3, y: 2)
                        .frame(width: thumb, height: thumb).offset(x: x - thumb / 2)
                }.frame(width: width, height: hit).contentShape(.rect)
                    .gesture(DragGesture(minimumDistance: 0)
                        .updating($touching) { _, state, _ in state = true }
                        .onChanged { gesture in
                            guard enabled else { return }
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
                            guard enabled, !interrupted else { reset(); return }
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
                        reset(); interrupted = wasTouching
                    }
                    .padding(.horizontal, inset)
            }.frame(height: hit)
                .background { if expanded { Color.clear.modifier(GlassSurface(radius: hit / 2)) } }
                .allowsHitTesting(enabled)
                .accessibilityElement(children: .ignore).accessibilityLabel("Effort").accessibilityValue(label)
                .accessibilityIdentifier("effortSlider")
                .accessibilityAdjustableAction { direction in
                    guard enabled else { return }
                    let next = min(stops.count - 1, max(0, index + (direction == .increment ? 1 : -1)))
                    if pending == "ultracode" || value == "ultracode", direction == .increment { return }
                    if stops[next] != value { pending = stops[next]; onCommit(stops[next]) }
                }
        }
        .sensoryFeedback(.selection, trigger: index)
        .onAppear { onPreview(label) }
        .onDisappear { onPreview(nil) }
        .onChange(of: label) { _, text in onPreview(text) }
        .onChange(of: value) { _, _ in reset() }
        .onChange(of: saving) { _, busy in if !busy { reset() } }
        .onChange(of: touching) { _, active in
            if !active { if origin != nil { reset() }; gestureActive = false }
        }
        .opacity(enabled ? 1 : 0.5)
    }
    private func center(_ index: Int, width: CGFloat) -> CGFloat {
        endInset + CGFloat(index) / CGFloat(max(1, stops.count - 1)) * max(0, width - endInset * 2)
    }
    private func clamp(_ x: CGFloat, width: CGFloat) -> CGFloat { min(max(endInset, width - endInset), max(endInset, x)) }
    private func stop(at x: CGFloat, width: CGFloat) -> Int {
        Int((min(1, max(0, (x - endInset) / max(1, width - endInset * 2))) * CGFloat(stops.count - 1)).rounded())
    }
    private func reset() { origin = nil; dragPosition = nil; nearest = nil; pending = nil; moved = false }
}
