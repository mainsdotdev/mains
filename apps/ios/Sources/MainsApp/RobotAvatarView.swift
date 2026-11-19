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
                Image(systemName: "squareshape.split.2x2").font(.title3.weight(.semibold)).foregroundStyle(.secondary)
            }
        }.accessibilityHidden(true)
    }
}

struct MateRobotPicker: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let catalogue: MateRobotCatalogue
    @Binding var avatar: MateAvatar
    @State private var previous: [String: String] = [:]
    @Environment(\.dynamicTypeSize) private var typeSize

    private var style: MateRobotCatalogue.Style? {
        catalogue.styles.first { $0.presets.contains { $0.id == avatar.shape } } ?? catalogue.styles.first
    }
    private var selection: Binding<String> { Binding(get: { style?.id ?? "" }, set: selectStyle) }

    var body: some View {
        VStack(spacing: 12) {
            if let preset = style?.presets.first(where: { $0.id == avatar.shape }) ?? catalogue.defaultPreset {
                MateRobotPreview(preset: preset).frame(width: 136, height: 136)
            }
            if typeSize.isAccessibilitySize { stylePicker.pickerStyle(.menu) }
            else { stylePicker.pickerStyle(.segmented) }

            if let style {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(style.presets) { preset in
                            let selected = avatar.shape == preset.id
                            Button {
                                previous[style.id] = preset.id
                                avatar = preset.avatar
                            } label: {
                                MateRobotThumbnail(preset: preset)
                                    .frame(width: 38, height: 38)
                                    .frame(width: 48, height: 48)
                                    .background(selected ? Color.primary.opacity(0.08) : .clear, in: .rect(cornerRadius: 12))
                                    .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? Color.primary.opacity(0.24) : .clear) }
                                    .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(preset.label)
                            .accessibilityAddTraits(selected ? .isSelected : [])
                            .accessibilityIdentifier("mate-avatar-\(preset.id)")
                            .id(preset.id)
                        }
                    }.scrollTargetLayout()
                }
                .scrollIndicators(.hidden)
                .scrollPosition(id: Binding<String?>(get: { avatar.shape }, set: { _ in }), anchor: .center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private var stylePicker: some View {
        Picker("Robot style", selection: selection) {
            ForEach(catalogue.styles) { Text($0.label).tag($0.id) }
        }.accessibilityIdentifier("mate-avatar-style")
    }

    private func selectStyle(_ id: String) {
        guard let next = catalogue.styles.first(where: { $0.id == id }),
              let preset = next.presets.first(where: { $0.id == previous[id] }) ?? next.presets.first else { return }
        avatar = preset.avatar
    }
}

struct MateRobotPreview: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let preset: MateRobotCatalogue.Preset
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var renderedShape: String?
    @State private var rotationStep = 0

    var body: some View {
        let active = visible && scenePhase == .active
        let showingPreview = active && renderedShape == preset.id
        ZStack {
            MateRobotThumbnail(preset: preset).opacity(showingPreview ? 0 : 1)
            RobotWebPreview(shape: preset.id, active: active, reducedMotion: reduceMotion,
                            showingPreview: showingPreview, rotationStep: rotationStep, onRendered: { renderedShape = $0 })
                .allowsHitTesting(active)
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
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
    }
}

private struct RobotWebPreview: UIViewRepresentable {
    let shape: String
    let active: Bool
    let reducedMotion: Bool
    let showingPreview: Bool
    let rotationStep: Int
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
        surface.addGestureRecognizer(RobotTouchGesture(target: context.coordinator, action: #selector(Coordinator.dragChanged(_:))))
        return surface
    }

    func updateUIView(_ surface: RobotPreviewSurface, context: Context) {
        context.coordinator.parent = self
        surface.webView.alpha = showingPreview ? 1 : 0
        context.coordinator.render(surface.webView)
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
        private var dragging = false
        private var sendingDrag = false

        struct Request: Equatable {
            let shape: String
            let active: Bool
            let reducedMotion: Bool
            let step: Int
        }

        init(parent: RobotWebPreview) { self.parent = parent }

        @objc func dragChanged(_ gesture: RobotTouchGesture) {
            guard !retired, parent.active, let surface = gesture.view as? RobotPreviewSurface else { return }
            let accumulated = pendingDrag ?? .zero
            pendingDrag = CGPoint(x: accumulated.x + gesture.delta.x, y: accumulated.y + gesture.delta.y)
            dragging = gesture.state == .began || gesture.state == .changed
            sendDrag(to: surface.webView)
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
            let request = Request(shape: parent.shape, active: parent.active, reducedMotion: parent.reducedMotion, step: parent.rotationStep)
            guard request != lastRequest else { return }
            let delta = lastRequest.map { request.step - $0.step } ?? 0
            lastRequest = request
            webView.callAsyncJavaScript(
                "const ready = window.showRobot(shape, active, reduced); if (ready && step) window.rotateRobot(step); return ready;",
                arguments: ["shape": request.shape, "active": request.active, "reduced": request.reducedMotion, "step": delta],
                in: nil, in: .page
            ) { [weak self, weak webView] result in
                guard let self, let webView, !self.retired, self.lastRequest == request else { return }
                self.setRenderedShape((try? result.get()) as? Bool == true ? request.shape : nil, in: webView)
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
