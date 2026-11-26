import SwiftUI

enum AppListStyle {
    static let rowInsets = EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
    static let minimumContentHeight: CGFloat = 48
}

enum AppNavigationStyle {
    // Keep toolbar spacing inside the safe area so destinations can draw edge to edge.
    static let topInset: CGFloat = 1
    static let inlineToolbarHeight: CGFloat = 44
}

extension View {
    func actionToastHost() -> some View {
        modifier(ActionToastHost())
    }

    func navigationHeaderFade(background: Color = Color(.systemBackground), coversSafeAreaAtRest: Bool = true,
                              height: CGFloat = HeaderFade.defaultHeight) -> some View {
        modifier(NavigationHeaderFade(background: background, coversSafeAreaAtRest: coversSafeAreaAtRest, height: height))
    }

    func scrollingNavigationTitle(_ title: LocalizedStringKey) -> some View {
        modifier(ScrollingNavigationTitle(title: title))
    }

    func expandedNavigationTitle(_ title: String) -> some View {
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !title.isEmpty {
                    ToolbarItem(placement: .principal) {
                        Text(title).font(.headline.weight(.medium).width(.expanded)).lineLimit(1)
                            .accessibilityAddTraits(.isHeader)
                    }.sharedBackgroundVisibility(.hidden)
                }
            }
    }

    func pullToRefresh(_ refresh: @escaping @MainActor () async -> Void) -> some View {
        modifier(PullToRefresh(refresh: refresh))
    }
}

private struct PullToRefresh: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    private static let threshold: CGFloat = 72
    let refresh: @MainActor () async -> Void
    @State private var dragging = false
    @State private var armed = false
    @State private var refreshTask: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .scrollBounceBehavior(.always, axes: .vertical)
            .onScrollGeometryChange(for: Bool.self) { Self.pulledFarEnough($0) } action: { _, pastThreshold in
                if dragging && pastThreshold { armed = true }
            }
            .onScrollPhaseChange { old, phase, context in
                dragging = phase == .interacting
                if old == .interacting && !dragging {
                    if armed || Self.pulledFarEnough(context.geometry) { startRefresh() }
                    armed = false
                }
            }
            .accessibilityAction(named: Text("Refresh")) { startRefresh() }
            .onDisappear {
                refreshTask?.cancel()
                dragging = false; armed = false
            }
    }

    private static func pulledFarEnough(_ geometry: ScrollGeometry) -> Bool {
        geometry.contentOffset.y + geometry.contentInsets.top < -threshold
    }

    private func startRefresh() {
        guard refreshTask == nil else { return }
        refreshTask = Task {
            defer { refreshTask = nil }
            await refresh()
        }
    }
}

struct DisconnectedState: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    var title: LocalizedStringKey = "Computer disconnected"
    let message: LocalizedStringKey
    var openSettings: (() -> Void)? = nil

    var body: some View {
        EmptyStateView(artwork: .offline, title: title, description: Text(message)) {
            if let openSettings {
                Button(action: openSettings) {
                    Text("Connection settings")
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .controlSize(.large)
            }
        }
    }

    var listRow: some View {
        listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }

    var centered: some View {
        ScrollView { self }
            .scrollBounceBehavior(.basedOnSize)
            .defaultScrollAnchor(.center, for: .alignment)
    }
}

struct ContentSkeleton: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    enum Layout { case rows, text, fields }
    let label: LocalizedStringKey
    var layout: Layout = .rows
    var count = 3

    var body: some View {
        VStack(alignment: .leading, spacing: layout == .rows ? 16 : 10) {
            ForEach(0..<count, id: \.self) { index in
                switch layout {
                case .rows:
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 8).fill(SkeletonLine.fill).frame(width: 32, height: 32)
                        VStack(alignment: .leading, spacing: 6) {
                            SkeletonLine(width: index.isMultiple(of: 2) ? 156 : 126, height: 12)
                            SkeletonLine(width: 86, height: 8)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.frame(minHeight: AppListStyle.minimumContentHeight)
                case .text:
                    SkeletonLine(width: index % 3 == 2 ? 190 : 560, height: 11)
                case .fields:
                    SkeletonLine(width: index.isMultiple(of: 2) ? 110 : 192, height: 14)
                        .frame(height: AppListStyle.minimumContentHeight, alignment: .leading)
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier("contentSkeleton")
    }

    var listRow: some View {
        self.listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}

struct MediaSkeleton: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    var symbol = "photo"

    var body: some View {
        RoundedRectangle(cornerRadius: 16).fill(SkeletonLine.fill)
            .aspectRatio(1.5, contentMode: .fit)
            .overlay { Image(systemName: symbol).font(.title2).foregroundStyle(.secondary) }
            .frame(maxWidth: 156)
            .allowsHitTesting(false)
            .accessibilityElement(children: .ignore)
    }
}

struct SkeletonLine: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    static let fill = Color.primary.opacity(0.12)
    let width: CGFloat
    let height: CGFloat
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        RoundedRectangle(cornerRadius: 4).fill(Self.fill)
            .frame(maxWidth: width)
            .frame(height: height * scale)
    }
}

private extension EnvironmentValues {
    @Entry var pageTitleVisible: Binding<Bool> = .constant(true)
}

struct FilterChipSelectionBounds: PreferenceKey {
    static var defaultValue: Anchor<CGRect>? { nil }

    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        if value == nil { value = nextValue() }
    }
}

struct FilterChip<Label: View>: View {
    let selected: Bool
    var usesSharedHighlight = false
    let action: () -> Void
    @ViewBuilder let label: (Color) -> Label

    var body: some View {
        let foreground = selected ? Color(.systemBackground) : .primary
        Button(action: action) {
            label(foreground)
                .font(.subheadline.weight(.medium)).foregroundStyle(foreground).fixedSize()
                .padding(.horizontal, 14).frame(minHeight: 36)
                .background(selected && !usesSharedHighlight ? Color.primary : .clear, in: .capsule)
                .anchorPreference(key: FilterChipSelectionBounds.self, value: .bounds) {
                    selected && usesSharedHighlight ? $0 : nil
                }
                .frame(minHeight: 44).contentShape(.rect)
        }
        .buttonStyle(ChatPressStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct FilterChipScrollFade: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    private struct Edges: Equatable {
        var left = false
        var right = false
    }
    @State private var edges = Edges()
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: Edges.self) { geometry in
                let start = -geometry.contentInsets.leading
                let end = max(start, geometry.contentSize.width - geometry.containerSize.width + geometry.contentInsets.trailing)
                let overflows = end > start + 1
                return Edges(left: overflows && geometry.contentOffset.x > start + 1,
                             right: overflows && geometry.contentOffset.x < end - 1)
            } action: { _, next in edges = next }
            .overlay(alignment: layoutDirection == .leftToRight ? .leading : .trailing) {
                fade(left: true).opacity(edges.left ? 1 : 0)
            }
            .overlay(alignment: layoutDirection == .leftToRight ? .trailing : .leading) {
                fade(left: false).opacity(edges.right ? 1 : 0)
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: edges)
    }

    private func fade(left: Bool) -> some View {
        let background = Color(.systemGroupedBackground)
        let fromLeading = left == (layoutDirection == .leftToRight)
        return LinearGradient(colors: [background, background.opacity(0)],
                              startPoint: fromLeading ? .leading : .trailing,
                              endPoint: fromLeading ? .trailing : .leading)
            .frame(width: 20)
            .allowsHitTesting(false).accessibilityHidden(true)
    }
}

struct PageTitle: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    private let title: LocalizedStringKey
    private let accessibilityID: String
    private let viewport: String?
    @Environment(\.pageTitleVisible) private var visibility

    init(_ title: LocalizedStringKey, accessibilityID: String = "pageTitle", viewport: String? = nil) {
        self.title = title
        self.accessibilityID = accessibilityID
        self.viewport = viewport
    }

    var body: some View {
        if let viewport {
            label.onGeometryChange(for: Bool.self) { geometry in
                geometry.frame(in: .named(viewport)).maxY > 0
            } action: { visibility.wrappedValue = $0 }
        } else {
            label.onScrollVisibilityChange(threshold: 0.05) { visibility.wrappedValue = $0 }
        }
    }

    private var label: some View {
        Text(title)
            .font(.largeTitle.weight(.semibold).width(.expanded))
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier(accessibilityID)
    }

    var listRow: some View {
        self.listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}

private struct ScrollingNavigationTitle: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let title: LocalizedStringKey
    @State private var titleVisible = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .environment(\.pageTitleVisible, $titleVisible)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    // Preserve the toolbar item's width throughout the fade.
                    let label = Text(title).font(.headline.weight(.medium).width(.expanded)).lineLimit(1)
                    label.hidden().accessibilityHidden(true)
                        .overlay {
                            if !titleVisible {
                                label.accessibilityIdentifier("inlinePageTitle").transition(.opacity)
                            }
                        }
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: titleVisible)
                }.sharedBackgroundVisibility(.hidden)
            }
    }
}

private struct NavigationHeaderFade: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let background: Color
    let coversSafeAreaAtRest: Bool
    let height: CGFloat
    @State private var fadeOpacity = 0.0

    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: Double.self) { geometry in
                let distance = geometry.contentOffset.y + geometry.contentInsets.top
                return min(max(distance / 24, 0), 1)
            } action: { _, opacity in
                fadeOpacity = opacity
            }
            .scrollEdgeEffectHidden(for: .top)
            .overlay(alignment: .top) {
                VStack(spacing: 0) {
                    // Fill behind the navigation controls and fade below their safe-area edge.
                    background.frame(height: 1)
                        .background(background, ignoresSafeAreaEdges: .top)
                        .opacity(coversSafeAreaAtRest ? 1 : fadeOpacity)
                    HeaderFade(background: background, height: height).opacity(fadeOpacity)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .toolbarBackground(.hidden, for: .navigationBar)
    }
}

struct HeaderFade: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    nonisolated static let defaultHeight: CGFloat = 44
    let background: Color
    var height = HeaderFade.defaultHeight

    var body: some View {
        LinearGradient(stops: [
            .init(color: background, location: 0),
            .init(color: background.opacity(0.9), location: 0.22),
            .init(color: background.opacity(0.47), location: 0.55),
            .init(color: background.opacity(0.1), location: 0.82),
            .init(color: .clear, location: 1),
        ], startPoint: .top, endPoint: .bottom)
        .frame(height: height)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

func compactRelativeAge(_ date: Date, now: Date) -> String {
    let seconds = max(0, now.timeIntervalSince(date))
    if seconds < 45 { return "just now" }
    if seconds < 3600 { return "\(max(1, Int(seconds / 60)))m ago" }
    if seconds < 86400 { return "\(Int(seconds / 3600))h ago" }
    if seconds < 30 * 86400 { return "\(Int(seconds / 86400))d ago" }
    if seconds < 365 * 86400 { return "\(Int(seconds / (30 * 86400)))mo ago" }
    return "\(Int(seconds / (365 * 86400)))y ago"
}

enum AppBrand {
    static var accent: Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 59 / 255, green: 130 / 255, blue: 246 / 255, alpha: 1)
                : UIColor(red: 37 / 255, green: 99 / 255, blue: 235 / 255, alpha: 1)
        })
    }
}

struct KeyboardTransition {
    let duration: TimeInterval
    private let curve: Int?
    private let start = ProcessInfo.processInfo.systemUptime

    init(_ notification: Notification) {
        duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? TimeInterval ?? 0.25
        curve = notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int
    }

    var remainingDuration: TimeInterval { max(0, duration - (ProcessInfo.processInfo.systemUptime - start)) }

    func animation(duration: TimeInterval) -> Animation? {
        guard duration > 0 else { return nil }
        return switch curve {
        case UIView.AnimationCurve.easeIn.rawValue: .easeIn(duration: duration)
        case UIView.AnimationCurve.easeInOut.rawValue: .easeInOut(duration: duration)
        case UIView.AnimationCurve.linear.rawValue: .linear(duration: duration)
        case UIView.AnimationCurve.easeOut.rawValue: .easeOut(duration: duration)
        default: .timingCurve(0.16, 0.78, 0.24, 1, duration: duration)
        }
    }
}

/// A hit target behind the page content, never a gesture on the composer or
/// its controls. Ending editing also updates ContextTextEditor's focus binding.
struct KeyboardDismissBackground: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    var color: Color = .clear
    var dismissFocus: (() -> Void)? = nil
    var body: some View {
        color.contentShape(Rectangle())
            .onTapGesture {
                dismissFocus?()
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
            .accessibilityHidden(true)
    }
}

struct TranscriptKeyboardDismissArea: UIViewRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let active: Bool

    func makeUIView(context: Context) -> TapArea { TapArea(frame: .zero) }
    func updateUIView(_ view: TapArea, context: Context) { view.active = active }

    final class TapArea: UIView, UIGestureRecognizerDelegate {
        var active = false
        private weak var composer: ComposerTextView?
        private lazy var tap: UITapGestureRecognizer = {
            let tap = UITapGestureRecognizer(target: self, action: #selector(dismissComposer))
            tap.cancelsTouchesInView = false
            tap.delegate = self
            return tap
        }()

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
        }

        required init?(coder: NSCoder) { nil }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard tap.view !== window else { return }
            tap.view?.removeGestureRecognizer(tap)
            // Observe taps even when the scroll view or a message owns the hit.
            window?.addGestureRecognizer(tap)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard active, bounds.contains(touch.location(in: self)),
                  let composer = window?.focusedTextInput as? ComposerTextView,
                  touch.view?.isDescendant(of: composer) != true else { return false }
            self.composer = composer
            return true
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }

        @objc private func dismissComposer() {
            if active, let composer, composer.isFirstResponder { composer.resignFirstResponder() }
            composer = nil
        }
    }
}

extension UIView {
    var focusedTextInput: UIView? {
        if isFirstResponder, self is UITextView || self is UITextField { return self }
        for subview in subviews {
            if let input = subview.focusedTextInput { return input }
        }
        return nil
    }
}

extension Provider {
    static func accent(_ id: String?) -> Color {
        switch id {
        case "claude_code": Color(red: 0.85, green: 0.47, blue: 0.34)
        case "codex": Color(red: 0.004, green: 0.412, blue: 0.80)
        case "copilot_cli": Color(red: 0.52, green: 0.20, blue: 0.95)
        case "cursor": Color(white: 0.45)
        case "opencode": Color(red: 0.36, green: 0.42, blue: 1)
        default: .blue
        }
    }
}

struct GlassSurface: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    var radius: CGFloat = 28
    var tint: Color = .clear
    var interactive = true
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(Color(.secondarySystemBackground), in: .rect(cornerRadius: radius))
                .overlay { RoundedRectangle(cornerRadius: radius).strokeBorder(.primary.opacity(0.12)) }
        } else {
            content.glassEffect(.regular.tint(tint).interactive(interactive), in: .rect(cornerRadius: radius))
        }
    }
}

@MainActor
@Observable
final class ActionToast {
    struct Message {
        let id = UUID()
        let text: LocalizedStringResource
    }

    private(set) var message: Message?

    func show(_ text: LocalizedStringResource) {
        withAnimation(.easeInOut(duration: 0.18)) { message = Message(text: text) }
        AccessibilityNotification.Announcement(String(localized: text)).post()
    }

    func dismiss() {
        withAnimation(.easeInOut(duration: 0.18)) { message = nil }
    }
}

private struct ActionToastHost: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var toast = ActionToast()

    func body(content: Content) -> some View {
        content
            .environment(toast)
            .overlay(alignment: .top) {
                if let message = toast.message {
                    HStack(spacing: 12) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title3)
                            .accessibilityHidden(true)
                        Text(message.text)
                            .font(.subheadline.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("actionToast")
                    }
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                    .modifier(GlassSurface(radius: 24, interactive: false))
                    .frame(maxWidth: 460)
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .allowsHitTesting(false)
                    .transition(reduceMotion ? .opacity : .offset(y: -8).combined(with: .opacity))
                }
            }
            .task(id: toast.message?.id) {
                guard let id = toast.message?.id else { return }
                do { try await Task.sleep(for: .seconds(2.4)) } catch { return }
                guard toast.message?.id == id, !Task.isCancelled else { return }
                toast.dismiss()
            }
            .onDisappear { toast.dismiss() }
    }
}

struct GlassSelectionTab<Icon: View>: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let title: String
    let selected: Bool
    let showLabel: Bool
    let selection: Namespace.ID
    @ViewBuilder let icon: () -> Icon

    var body: some View {
        HStack(spacing: 8) {
            icon().frame(width: 22, height: 22)
            if showLabel {
                Text(title).fixedSize().lineLimit(1)
                    .transition(.opacity.combined(with: .scale(scale: 0.92, anchor: .leading)))
            }
        }
        .font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
        .padding(.horizontal, selected || showLabel ? 14 : 11)
        .frame(minWidth: 44, minHeight: 40).clipped()
        .background(alignment: .center) {
            if selected {
                Color.clear.modifier(GlassSurface(radius: 20))
                    .matchedGeometryEffect(id: "selection", in: selection)
            }
        }
        .padding(.vertical, 2).contentShape(.rect)
    }
}

struct RoundControl: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let symbol: String
    let label: String
    var size: CGFloat = 46
    var rectangularHitArea = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 21, weight: .regular))
                .frame(width: size, height: size)
                .contentShape(.rect(cornerRadius: rectangularHitArea ? 0 : size / 2))
        }
        .buttonStyle(ChatPressStyle()).modifier(GlassSurface(radius: size / 2))
        .accessibilityLabel(label)
    }
}

/// Matches mobile's SidebarIcon: two leading-aligned strokes on a 24-unit grid.
struct SidebarIcon: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    var body: some View {
        Path { path in
            let scale = 22.0 / 24.0
            path.move(to: CGPoint(x: 4 * scale, y: 9 * scale))
            path.addLine(to: CGPoint(x: 20 * scale, y: 9 * scale))
            path.move(to: CGPoint(x: 4 * scale, y: 15 * scale))
            path.addLine(to: CGPoint(x: 14 * scale, y: 15 * scale))
        }
        .stroke(style: StrokeStyle(lineWidth: 2.2 * 22 / 24, lineCap: .round))
        .frame(width: 22, height: 22)
        .accessibilityHidden(true)
    }
}

struct SidebarControl: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let action: () -> Void
    var isOpen = false
    let onLayout: (CGRect) -> Void
    var body: some View {
        let size = AppNavigationStyle.inlineToolbarHeight
        Button(action: action) {
            SidebarIcon()
                .frame(width: size, height: size)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .modifier(GlassSurface(radius: size / 2, interactive: false))
        .accessibilityLabel(isOpen ? "Close sidebar" : "Open sidebar")
        .accessibilityIdentifier("openSidebar")
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { onLayout($0) }
    }
}

/// Uses the same vector registry and stored icon tokens as desktop and Expo.
struct RegistryIcon: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let token: String?
    var fallback = "folder"
    var fallbackAsset: String? = nil
    var size: CGFloat = 20
    var tint: Color = .secondary
    var useStoredColor = true
    @Environment(\.colorScheme) private var scheme
    private var parts: [String] {
        let stored = token ?? ""
        let value = stored.hasPrefix("icon:") ? String(stored.dropFirst(5)) : stored
        return value.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    }
    private var resolvedTint: Color { useStoredColor ? (Self.color(token, dark: scheme == .dark) ?? tint) : tint }
    var body: some View {
        Group {
            if let token, token.hasPrefix("emoji:") {
                Text(String(token.dropFirst(6))).font(.system(size: size)).fixedSize()
            } else if let name = parts.first, UIImage(named: "registry-" + name.lowercased()) != nil {
                Image("registry-" + name.lowercased()).renderingMode(.template).resizable().scaledToFit()
                    .foregroundStyle(resolvedTint)
            } else if let token, !token.hasPrefix("icon:"), token.unicodeScalars.contains(where: { $0.properties.isEmoji && $0.value > 127 }) {
                Text(token).font(.system(size: size)).fixedSize()
            } else {
                let image = fallbackAsset.map { Image($0).renderingMode(.template) } ?? Image(systemName: fallback)
                image.resizable().scaledToFit().foregroundStyle(resolvedTint)
            }
        }.frame(width: size, height: size).accessibilityHidden(true)
    }
    static func color(_ token: String?, dark: Bool) -> Color? {
        guard token?.hasPrefix("emoji:") != true,
              let value = token?.components(separatedBy: "|").dropFirst().first?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !value.isEmpty, value != "default",
              let color = UIColor(named: "registry-color-" + value) else { return nil }
        return Color(uiColor: color.resolvedColor(with: UITraitCollection(userInterfaceStyle: dark ? .dark : .light)))
    }
}

struct BridgeIcon: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    var size: CGFloat = 16
    var body: some View {
        RegistryIcon(token: "icon:bridge", size: size, tint: .secondary)
    }
}

struct BridgeReadOnlyNotice: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let text: String
    var body: some View {
        HStack(spacing: 10) {
            BridgeIcon(size: 20)
            Text(text).font(.footnote).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(.primary.opacity(0.06)) }
        .accessibilityElement(children: .combine).accessibilityIdentifier("readOnlyNotice")
    }
}

struct SpaceDisc: View {
    static let size: CGFloat = 44
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let space: Space
    let selected: Bool
    let action: () -> Void
    var body: some View {
        let tint: Color = selected ? .white : .primary
        Button(action: action) {
            Group {
                if space.icon != nil { RegistryIcon(token: space.icon, size: 22, tint: tint, useStoredColor: !selected) }
                else { Text(String(space.name.prefix(1)).uppercased()).font(.title3.weight(.semibold)).foregroundStyle(tint) }
            }.frame(width: Self.size, height: Self.size).contentShape(.rect)
        }
        .buttonStyle(ChatPressStyle())
        .accessibilityLabel("\(space.name) space")
        .accessibilityIdentifier("space-\(space.id)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
