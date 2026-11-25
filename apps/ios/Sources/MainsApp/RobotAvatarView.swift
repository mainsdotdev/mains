import SwiftUI
import UIKit.UIGestureRecognizerSubclass
import WebKit

enum MateRobotAssets {
    static let catalogue: MateRobotCatalogue? = {
        guard let url = Bundle.main.url(forResource: "presets", withExtension: "json", subdirectory: "RobotAvatars"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(MateRobotCatalogue.self, from: data)
    }()

    @MainActor private static let thumbnails = NSCache<NSString, UIImage>()

    static func chatTint(for avatar: MateAvatar) -> Color {
        let canonical = catalogue?.styles.lazy.flatMap(\.presets).first { $0.id == avatar.shape }?.color
        let rgb: UInt32 = switch canonical ?? avatar.color {
        case "coral": 0xEE7567
        case "amber": 0xDDA13B
        case "lime": 0x95BD51
        case "mint": 0x42AE95
        case "cyan": 0x36ABC5
        case "violet": 0x9274D3
        case "rose": 0xD96CA4
        default: 0x569ADB
        }
        return Color(.sRGB, red: Double((rgb >> 16) & 255) / 255,
                     green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }

    @MainActor static func image(for preset: MateRobotCatalogue.Preset) -> UIImage? {
        let key = preset.id as NSString
        if let image = thumbnails.object(forKey: key) { return image }
        guard let url = Bundle.main.url(forResource: preset.id, withExtension: "webp", subdirectory: "robots"),
              let image = UIImage(contentsOfFile: url.path) else { return nil }
        thumbnails.setObject(image, forKey: key)
        return image
    }
}

struct MateRobotThumbnail: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let preset: MateRobotCatalogue.Preset?

    var body: some View {
        Group {
            if let preset, let image = MateRobotAssets.image(for: preset) {
                Image(uiImage: image).resizable().interpolation(.high).scaledToFit()
            } else {
                RegistryIcon(token: "icon:assistant-steps")
            }
        }.accessibilityHidden(true)
    }
}

struct MateAvatarSelection: Equatable {
    enum Reaction: String, CaseIterable {
        case blink, doubleBlink, spin, sway, shiver, glance, nod
    }

    private(set) var turn = 1
    private(set) var reaction = Reaction.allCases.randomElement() ?? .blink

    mutating func advance() {
        turn += 1
        reaction = Reaction.allCases.filter { $0 != reaction }.randomElement() ?? .blink
    }
}

struct MateRobotPicker: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let catalogue: MateRobotCatalogue
    @Binding var avatar: MateAvatar
    @Binding var remembered: [String: String]
    let stageHeight: CGFloat
    let previewActive: Bool
    let isSelecting: Bool
    @State private var selection = MateAvatarSelection()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var style: MateRobotCatalogue.Style? {
        catalogue.styles.first { $0.presets.contains { $0.id == avatar.shape } } ?? catalogue.styles.first
    }

    var body: some View {
        VStack(spacing: 6) {
            if let style, !style.presets.isEmpty {
                MateAvatarCarousel(presets: style.presets, avatar: $avatar, selection: $selection,
                                   stageHeight: stageHeight, previewActive: previewActive, isSelecting: isSelecting)
                    .id(style.id)
            }

            if isSelecting {
                styleChoices.transition(.opacity)
            }
        }
        .onChange(of: avatar.shape) { _, id in
            if let style { remembered[style.id] = id }
        }
    }

    private var styleChoices: some View {
        HStack(spacing: 8) {
            ForEach(catalogue.styles) { candidate in
                let selected = candidate.id == style?.id
                Button {
                    selectStyle(candidate)
                } label: {
                    VStack(spacing: 2) {
                        MateRobotThumbnail(preset: candidate.presets.first)
                            .frame(width: 30, height: 24)
                        Text(candidate.label)
                            .font(.caption.weight(.semibold))
                            .multilineTextAlignment(.center)
                            .foregroundStyle(selected ? .primary : .secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 7)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(alignment: .center) {
                        if selected { Color.clear.modifier(GlassSurface(radius: 20)) }
                        else { RoundedRectangle(cornerRadius: 20).fill(Color.primary.opacity(0.06)) }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(ChatPressStyle())
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("mate-avatar-style-\(candidate.id)")
            }
        }
        .frame(maxWidth: 432)
        .padding(.horizontal, 24)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Robot style")
        .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: style?.id)
    }

    private func selectStyle(_ next: MateRobotCatalogue.Style) {
        guard next.id != style?.id,
              let preset = next.presets.first(where: { $0.id == remembered[next.id] }) ?? next.presets.first else { return }
        if let style { remembered[style.id] = avatar.shape }
        selection.advance()
        avatar = preset.avatar
    }
}

private struct MateAvatarCarousel: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let presets: [MateRobotCatalogue.Preset]
    @Binding var avatar: MateAvatar
    @Binding var selection: MateAvatarSelection
    let stageHeight: CGFloat
    let previewActive: Bool
    let isSelecting: Bool
    @State private var index: Int
    @State private var dragOffset: CGFloat = 0
    @State private var visible = false
    @State private var renderedSlots: Set<Int> = []
    @State private var canRenderNeighbors = false
    @State private var turn: (slot: Int, step: Int)?
    @State private var rotation: (slot: Int, drag: RobotPreviewDrag)?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(presets: [MateRobotCatalogue.Preset], avatar: Binding<MateAvatar>, selection: Binding<MateAvatarSelection>,
         stageHeight: CGFloat, previewActive: Bool, isSelecting: Bool) {
        self.presets = presets
        self.stageHeight = stageHeight
        self.previewActive = previewActive
        self.isSelecting = isSelecting
        _avatar = avatar
        _selection = selection
        _index = State(initialValue: presets.firstIndex { $0.id == avatar.wrappedValue.shape } ?? 0)
    }

    private var snap: Animation? {
        reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.88)
    }

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let size = min(320, width * 0.69, stageHeight - 16)
            let spacing = size * 0.86 + 8
            let neighbors = max(2, Int(ceil(width / (2 * spacing))) + 1)
            let slots = isSelecting ? ((index - neighbors)...(index + neighbors)) : (index...index)

            ZStack {
                // Absolute slots keep their identity across the two ends of the preset list.
                ForEach(slots, id: \.self) { slot in
                    let x = CGFloat(slot - index) * spacing + (isSelecting ? dragOffset : 0)
                    let exitDistance = (slot < index ? -1 : 1) * (width + size) / 2
                    let nearViewport = abs(x) < (width + size) / 2 + spacing * 0.3
                    let renders = previewActive && visible && nearViewport && (slot == index || canRenderNeighbors)
                    MateRobotPreview(preset: preset(at: slot), acceptsDrag: false,
                                     renders: renders, animates: slot == index && dragOffset == 0,
                                     turn: turn?.slot == slot ? turn?.step ?? 0 : 0,
                                     selection: slot == index ? selection : nil,
                                     externalDrag: rotation?.slot == slot ? rotation?.drag : nil) { rendered in
                        if rendered {
                            renderedSlots.insert(slot)
                            if slot == index { canRenderNeighbors = true }
                        } else {
                            renderedSlots.remove(slot)
                        }
                    }
                        .frame(width: size, height: size)
                        .modifier(MateAvatarArc(x: x, radius: max(1, width * 0.58), reduceMotion: reduceMotion))
                        .transition(reduceMotion || slot == index ? .identity : .offset(x: exitDistance))
                }
            }
            .frame(width: width, height: geometry.size.height)
            .clipped()
            .overlay {
                if isSelecting {
                    MateAvatarGestures(
                        rotationSize: renderedSlots.contains(index) ? size : 0,
                        onDrag: { dragOffset = min(spacing, max(-spacing, $0)) },
                        onEnd: { distance in
                            let step = abs(distance) >= spacing / 3 ? (distance < 0 ? 1 : -1) : 0
                            select(index + step)
                        },
                        onTap: { x in
                            let step = Int((x / spacing).rounded())
                            if step == 0 { rotateSelection() }
                            else { select(index + step) }
                        },
                        onRotate: { drag in rotation = (index, drag) }
                    )
                    .transition(.identity)
                }
            }
        }
        .frame(height: stageHeight)
        .onScrollVisibilityChange(threshold: 0.05) { visible = $0 }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Avatar")
        .accessibilityValue(preset(at: index).label)
        .accessibilityHint(isSelecting ? "Choose an avatar for this Mate. Hold and drag to rotate it." : "")
        .accessibilityIdentifier(renderedSlots.contains(index) ? "mate-avatar-carousel-3d" : "mate-avatar-carousel")
        .accessibilityAdjustableAction { direction in
            guard isSelecting else { return }
            switch direction {
            case .increment: select(index + 1)
            case .decrement: select(index - 1)
            @unknown default: break
            }
        }
        .accessibilityActions {
            if isSelecting { Button("Rotate avatar", action: rotateSelection) }
        }
        .sensoryFeedback(.selection, trigger: avatar)
    }

    private func preset(at slot: Int) -> MateRobotCatalogue.Preset {
        presets[(slot % presets.count + presets.count) % presets.count]
    }

    private func select(_ slot: Int) {
        guard isSelecting else { return }
        if slot != index {
            selection.advance()
            rotation = nil
        }
        withAnimation(snap) {
            index = slot
            dragOffset = 0
        }
        avatar = preset(at: slot).avatar
    }

    private func rotateSelection() {
        guard isSelecting, renderedSlots.contains(index) else { return }
        turn = (index, turn?.slot == index ? (turn?.step ?? 0) + 1 : 1)
    }
}

struct RobotPreviewDrag: Equatable {
    let offset: CGPoint
    let held: Bool
}

/// A hold on the center model owns rotation. Quick swipes keep their horizontal and vertical roles.
private struct MateAvatarGestures: UIViewRepresentable {
    let rotationSize: CGFloat
    var onDrag: (CGFloat) -> Void
    var onEnd: (CGFloat) -> Void
    var onTap: (CGFloat) -> Void
    var onRotate: (RobotPreviewDrag) -> Void
    @Environment(\.isEnabled) private var isEnabled

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        let coordinator = context.coordinator
        let pan = UIPanGestureRecognizer(target: coordinator, action: #selector(Coordinator.panChanged(_:)))
        pan.maximumNumberOfTouches = 1
        pan.delegate = coordinator
        let hold = UILongPressGestureRecognizer(target: coordinator, action: #selector(Coordinator.rotated(_:)))
        hold.minimumPressDuration = 0.25
        hold.allowableMovement = 12
        hold.delegate = coordinator
        pan.require(toFail: hold)
        let tap = UITapGestureRecognizer(target: coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.require(toFail: pan)
        view.addGestureRecognizer(pan)
        view.addGestureRecognizer(hold)
        view.addGestureRecognizer(tap)
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        context.coordinator.parent = self
        view.isUserInteractionEnabled = isEnabled
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: MateAvatarGestures
        private var rotationStart: CGPoint?
        init(_ parent: MateAvatarGestures) { self.parent = parent }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
            let speed = pan.velocity(in: pan.view)
            return abs(speed.x) > abs(speed.y)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard gestureRecognizer is UILongPressGestureRecognizer, let stage = gestureRecognizer.view else { return true }
            guard parent.rotationSize > 0 else { return false }
            let point = touch.location(in: stage)
            let radius = parent.rotationSize / 2
            return abs(point.x - stage.bounds.midX) <= radius && abs(point.y - stage.bounds.midY) <= radius
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            guard let stage = gestureRecognizer.view, let scroll = other.view as? UIScrollView else { return false }
            return other === scroll.panGestureRecognizer && stage.isDescendant(of: scroll)
        }

        @objc func panChanged(_ pan: UIPanGestureRecognizer) {
            let distance = pan.translation(in: pan.view).x
            switch pan.state {
            case .changed: parent.onDrag(distance)
            case .ended: parent.onEnd(distance + 0.12 * pan.velocity(in: pan.view).x)
            case .cancelled, .failed: parent.onEnd(0)
            default: break
            }
        }

        @objc func tapped(_ tap: UITapGestureRecognizer) {
            guard let view = tap.view else { return }
            parent.onTap(tap.location(in: view).x - view.bounds.midX)
        }

        @objc func rotated(_ hold: UILongPressGestureRecognizer) {
            let point = hold.location(in: hold.view)
            if hold.state == .began { rotationStart = point }
            guard let origin = rotationStart else { return }
            let held = hold.state == .began || hold.state == .changed
            parent.onRotate(RobotPreviewDrag(offset: CGPoint(x: point.x - origin.x, y: point.y - origin.y), held: held))
            if !held { rotationStart = nil }
        }
    }
}

private struct MateAvatarArc: ViewModifier, Animatable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    nonisolated var x: CGFloat
    let radius: CGFloat
    let reduceMotion: Bool
    nonisolated var animatableData: CGFloat {
        get { x }
        set { x = newValue }
    }

    func body(content: Content) -> some View {
        let position = min(1, abs(x) / radius)
        let arc = 1 - sqrt(1 - position * position)
        return content
            .scaleEffect(reduceMotion ? 1 : 1 - 0.35 * position)
            .rotationEffect(.degrees(reduceMotion ? 0 : Double(x.sign == .minus ? -position : position) * 13))
            .opacity(1 - 0.6 * position)
            .offset(x: x, y: reduceMotion ? 0 : 30 * arc)
    }
}

struct MateRobotPreview: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    enum Motion: String { case idle, greeting, creating, thinking }

    let preset: MateRobotCatalogue.Preset
    var acceptsDrag = true
    var renders = true
    var animates = true
    var motion: Motion = .idle
    var turn = 0
    var selection: MateAvatarSelection?
    var externalDrag: RobotPreviewDrag?
    var onRendered: (Bool) -> Void = { _ in }
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var renderedShape: String?
    @State private var rotationStep = 0

    var body: some View {
        let active = renders && visible && scenePhase == .active
        let showingPreview = renderedShape == preset.id
        ZStack {
            MateRobotThumbnail(preset: preset).opacity(showingPreview ? 0 : 1)
            if active || showingPreview {
                RobotWebPreview(shape: preset.id, active: active, reducedMotion: reduceMotion, ambientMotion: animates, motion: motion,
                                acceptsDrag: acceptsDrag, showingPreview: showingPreview,
                                rotationStep: acceptsDrag ? rotationStep : turn, selection: selection,
                                externalDrag: externalDrag, onRendered: { renderedShape = $0 })
                    .allowsHitTesting(active && acceptsDrag)
            }
        }
        .onAppear {
            visible = true
            if showingPreview { onRendered(true) }
        }
        .onDisappear { visible = false; onRendered(false) }
        .onChange(of: showingPreview) { _, rendered in onRendered(rendered) }
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier(showingPreview ? "mate-robot-preview" : "mate-robot-thumbnail")
        .accessibilityLabel("\(preset.label) robot")
        .accessibilityHint(showingPreview ? "Drag to rotate" : "")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: rotationStep += 1
            case .decrement: rotationStep -= 1
            @unknown default: break
            }
        }
        .accessibilityHidden(!acceptsDrag)
    }
}

private struct RobotWebPreview: UIViewRepresentable {
    let shape: String
    let active: Bool
    let reducedMotion: Bool
    let ambientMotion: Bool
    let motion: MateRobotPreview.Motion
    let acceptsDrag: Bool
    let showingPreview: Bool
    let rotationStep: Int
    let selection: MateAvatarSelection?
    let externalDrag: RobotPreviewDrag?
    let onRendered: (String?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> RobotPreviewSurface {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "robot")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.underPageBackgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.isUserInteractionEnabled = false
        webView.navigationDelegate = context.coordinator
        webView.accessibilityElementsHidden = true
        if let shell = context.coordinator.shell {
            webView.loadFileURL(shell, allowingReadAccessTo: shell.deletingLastPathComponent())
        }
        let surface = RobotPreviewSurface(webView: webView)
        if acceptsDrag {
            surface.addGestureRecognizer(RobotTouchGesture(target: context.coordinator, action: #selector(Coordinator.dragChanged(_:))))
        }
        return surface
    }

    func updateUIView(_ surface: RobotPreviewSurface, context: Context) {
        context.coordinator.parent = self
        surface.webView.alpha = showingPreview ? 1 : 0
        context.coordinator.render(surface.webView)
        context.coordinator.updateExternalDrag(in: surface.webView)
    }

    static func dismantleUIView(_ surface: RobotPreviewSurface, coordinator: Coordinator) {
        let webView = surface.webView
        coordinator.retired = true
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "robot")
    }

    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: RobotWebPreview {
            didSet {
                if parent.shape != oldValue.shape {
                    renderedShape = nil
                }
                if parent.shape != oldValue.shape || !parent.active {
                    pendingDrag = nil
                    lastExternalDrag = nil
                    dragging = false
                }
            }
        }
        let shell = Bundle.main.url(forResource: "preview", withExtension: "html", subdirectory: "RobotAvatars")
        var retired = false
        private var ready = false
        private var lastRequest: Request?
        private var renderedShape: String?
        private var pendingDrag: CGPoint?
        private var lastExternalDrag: RobotPreviewDrag?
        private var dragging = false
        private var sendingDrag = false

        struct Request: Equatable {
            let shape: String
            let active: Bool
            let reducedMotion: Bool
            let ambientMotion: Bool
            let motion: MateRobotPreview.Motion
            let step: Int
            let selection: MateAvatarSelection?
        }

        init(parent: RobotWebPreview) { self.parent = parent }

        @objc func dragChanged(_ gesture: RobotTouchGesture) {
            guard !retired, parent.active, let surface = gesture.view as? RobotPreviewSurface else { return }
            enqueueDrag(gesture.delta, held: gesture.state == .began || gesture.state == .changed, in: surface.webView)
        }

        func updateExternalDrag(in webView: WKWebView) {
            guard parent.active, parent.externalDrag != lastExternalDrag else { return }
            let previous = lastExternalDrag
            lastExternalDrag = parent.externalDrag
            if let drag = parent.externalDrag {
                guard drag.held || previous?.held == true else { return }
                let origin = previous?.held == true ? previous?.offset ?? .zero : .zero
                enqueueDrag(CGPoint(x: drag.offset.x - origin.x, y: drag.offset.y - origin.y), held: drag.held, in: webView)
            } else if previous?.held == true {
                enqueueDrag(.zero, held: false, in: webView)
            }
        }

        private func enqueueDrag(_ delta: CGPoint, held: Bool, in webView: WKWebView) {
            let accumulated = pendingDrag ?? .zero
            pendingDrag = CGPoint(x: accumulated.x + delta.x, y: accumulated.y + delta.y)
            dragging = held
            sendDrag(to: webView)
        }

        private func sendDrag(to webView: WKWebView) {
            guard !retired, parent.active, renderedShape == parent.shape, !sendingDrag, let delta = pendingDrag else { return }
            pendingDrag = nil
            sendingDrag = true
            webView.callAsyncJavaScript(
                "window.dragRobot(shape, dx, dy, dragging);",
                arguments: ["shape": parent.shape, "dx": delta.x, "dy": delta.y, "dragging": dragging],
                in: nil, in: .page
            ) { [weak self, weak webView] _ in
                guard let self, let webView else { return }
                self.sendingDrag = false
                self.sendDrag(to: webView)
            }
        }

        func render(_ webView: WKWebView) {
            guard ready, !retired else { return }
            let request = Request(shape: parent.shape, active: parent.active, reducedMotion: parent.reducedMotion,
                                  ambientMotion: parent.ambientMotion, motion: parent.motion,
                                  step: parent.rotationStep, selection: parent.selection)
            guard request != lastRequest else { return }
            let delta = lastRequest.map { request.step - $0.step } ?? 0
            lastRequest = request
            webView.callAsyncJavaScript(
                "const status = window.showRobot(shape, active, reduced, ambient, turn, reaction, motion); if (status !== 'unavailable' && step) window.rotateRobot(step); return status;",
                arguments: ["shape": request.shape, "active": request.active, "reduced": request.reducedMotion,
                            "ambient": request.ambientMotion, "motion": request.motion.rawValue,
                            "step": delta, "turn": request.selection?.turn ?? 0,
                            "reaction": request.selection?.reaction.rawValue ?? ""],
                in: nil, in: .page
            ) { [weak self, weak webView] result in
                guard let self, let webView, !self.retired, self.lastRequest == request else { return }
                switch (try? result.get()) as? String {
                case "ready": self.setRenderedShape(request.shape, in: webView)
                case "pending": break
                default: self.setRenderedShape(nil, in: webView)
                }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            ready = true
            lastRequest = nil
            render(webView)
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            action.navigationType == .other && action.request.url == shell && action.targetFrame?.isMainFrame == true ? .allow : .cancel
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard !retired, message.frameInfo.isMainFrame, message.frameInfo.request.url == shell,
                  let update = message.body as? [String: Any], let shape = update["shape"] as? String,
                  shape == lastRequest?.shape, let rendered = update["rendered"] as? Bool,
                  let webView = message.webView else { return }
            setRenderedShape(rendered ? shape : nil, in: webView)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            ready = false
            lastRequest = nil
            setRenderedShape(nil, in: webView)
        }

        private func setRenderedShape(_ shape: String?, in webView: WKWebView) {
            renderedShape = shape
            parent.onRendered(shape)
            sendDrag(to: webView)
        }
    }
}

private final class RobotPreviewSurface: UIView {
    let webView: WKWebView

    init(webView: WKWebView) {
        self.webView = webView
        super.init(frame: .zero)
        webView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
}

/// Own a touch on the preview before any of the enclosing scrolling or navigation gestures can begin.
private final class RobotTouchGesture: UIGestureRecognizer, UIGestureRecognizerDelegate {
    private var touch: UITouch?
    private var lastPoint = CGPoint.zero
    private(set) var delta = CGPoint.zero

    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        delegate = self
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard touch == nil, let first = touches.first else { return }
        touch = first
        lastPoint = first.location(in: view)
        state = .began
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let touch, touches.contains(touch) else { return }
        let point = touch.location(in: view)
        delta = CGPoint(x: point.x - lastPoint.x, y: point.y - lastPoint.y)
        lastPoint = point
        state = .changed
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        if let touch, touches.contains(touch) { delta = .zero; state = .ended }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        if let touch, touches.contains(touch) { delta = .zero; state = .cancelled }
    }

    override func reset() {
        super.reset()
        touch = nil
        delta = .zero
    }

    func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        isAncestorGesture(other)
    }

    override func canBePrevented(by other: UIGestureRecognizer) -> Bool {
        !isAncestorGesture(other) && super.canBePrevented(by: other)
    }

    private func isAncestorGesture(_ other: UIGestureRecognizer) -> Bool {
        guard let preview = view, let ancestor = other.view else { return false }
        return ancestor !== preview && preview.isDescendant(of: ancestor)
    }
}
