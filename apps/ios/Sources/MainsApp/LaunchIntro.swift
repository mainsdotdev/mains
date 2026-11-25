import ImageIO
import SwiftUI

struct LaunchIntro: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let preferredScheme: ColorScheme?
    let finish: (Bool) -> Void
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var artwork: CGImage?

    private var scheme: ColorScheme { preferredScheme ?? colorScheme }
    private var activeScheme: ColorScheme? { scenePhase == .active ? scheme : nil }

    var body: some View {
        GeometryReader { geometry in
            let width = min(180, min(geometry.size.width, geometry.size.height) * 0.43)
            ZStack {
                Color(.systemBackground)
                if let artwork {
                    LaunchLogo(artwork: artwork)
                        .frame(width: width, height: width * LaunchArtwork.aspectRatio)
                }
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
        .task(id: activeScheme) {
            guard let activeScheme, artwork == nil else { return }
            guard !reduceMotion else { finish(true); return }

            let dark = activeScheme == .dark
            let image = await Task.detached(priority: .userInitiated) { LaunchArtwork.load(dark: dark) }.value
            guard !Task.isCancelled else { return }
            guard let image else { finish(false); return }
            artwork = image
            do {
                try await Task.sleep(for: .seconds(LaunchArtwork.duration))
                finish(true)
            } catch { return }
        }
        .onChange(of: scenePhase) { previous, phase in
            if previous == .active && phase != .active { finish(false) }
        }
        .onChange(of: scheme) { _, _ in
            if artwork != nil { finish(false) }
        }
        .onChange(of: reduceMotion) { _, enabled in
            if enabled { finish(false) }
        }
    }
}

private enum LaunchArtwork {
    static let duration = 1.02
    static let columns = 8
    static let rows = 6
    static let frameWidth = 320
    static let frameHeight = 272
    static let aspectRatio = CGFloat(frameHeight) / CGFloat(frameWidth)

    static func load(dark: Bool) -> CGImage? {
        guard let url = Bundle.main.url(forResource: dark ? "Dark" : "Light", withExtension: "webp", subdirectory: "LaunchIntro"),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary),
              image.width == columns * frameWidth, image.height == rows * frameHeight else { return nil }
        return image
    }

    // The rendered poses are laid out in reading order in a single texture.
    static func rect(for frame: Int) -> CGRect {
        let width = 1 / CGFloat(columns)
        let height = 1 / CGFloat(rows)
        return CGRect(x: CGFloat(frame % columns) * width, y: CGFloat(frame / columns) * height, width: width, height: height)
    }
}

private struct LaunchLogo: UIViewRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let artwork: CGImage

    func makeUIView(context: Context) -> Surface { Surface(artwork: artwork) }
    func updateUIView(_ view: Surface, context: Context) {}

    final class Surface: UIView {
        private let sprite = CALayer()

        init(artwork: CGImage) {
            super.init(frame: .zero)
            layer.addSublayer(sprite)
            sprite.contents = artwork
            let frameCount = LaunchArtwork.rows * LaunchArtwork.columns
            sprite.contentsRect = LaunchArtwork.rect(for: frameCount - 1)

            let animation = CAKeyframeAnimation(keyPath: #keyPath(CALayer.contentsRect))
            animation.values = (0..<frameCount).map { NSValue(cgRect: LaunchArtwork.rect(for: $0)) }
            animation.calculationMode = .discrete
            animation.duration = LaunchArtwork.duration
            sprite.add(animation, forKey: "launchSpin")
        }

        required init?(coder: NSCoder) { nil }

        override func layoutSubviews() {
            super.layoutSubviews()
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            sprite.frame = bounds
            CATransaction.commit()
        }
    }
}
