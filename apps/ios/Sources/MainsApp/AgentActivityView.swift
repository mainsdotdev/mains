import SwiftUI

struct AsciiSpinner: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    enum Kind { case square, generate }

    private struct TwinkleCell {
        let duration: Double
        let advance = Double.random(in: 0...2)

        init() {
            let tempos = [1.0, 1.2, 1.5, 2.0]
            duration = tempos[Int.random(in: tempos.indices)]
        }

        func pulse(at time: Double) -> Double {
            (1 - cos((time + advance) / duration * 2 * .pi)) / 2
        }
    }

    let kind: Kind
    let tint: Color
    let size: CGFloat
    let animated: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.conversationPaneVisible) private var paneVisible
    @State private var inViewport = false
    @State private var twinkleCells: [TwinkleCell]

    init(kind: Kind = .square, tint: Color, size: CGFloat = 15, animated: Bool = true) {
        self.kind = kind
        self.tint = tint
        self.size = size
        self.animated = animated
        _twinkleCells = State(initialValue: kind == .generate ? (0..<9).map { _ in TwinkleCell() } : [])
    }

    var body: some View {
        let animates = animated && paneVisible && inViewport && !reduceMotion && scenePhase == .active
        let twinkles = kind == .generate
        // The generate tempos all divide six seconds, so the clock wraps on a whole cycle for every cell.
        let period = twinkles ? 6.0 : 2.0
        let minScale = twinkles ? 0.4 : 0.15
        let minOpacity = twinkles ? 0.08 : 0.15
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animates)) { timeline in
            let time = animates ? timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period)
                : (twinkles ? 0.3 : 0.24) * period
            Canvas { canvas, size in
                let cell = (min(size.width, size.height) - 2) / 3
                for row in 0..<3 {
                    for column in 0..<3 {
                        let strength = twinkles ? twinkleCells[row * 3 + column].pulse(at: time)
                            : sweep(at: time / period, row: row, column: column)
                        let side = cell * (minScale + strength * (1 - minScale))
                        let inset = (cell - side) / 2
                        let rect = CGRect(x: CGFloat(column) * (cell + 1) + inset,
                                          y: CGFloat(row) * (cell + 1) + inset, width: side, height: side)
                        canvas.fill(Path(roundedRect: rect, cornerRadius: twinkles ? 1 : 0.6),
                                    with: .color(tint.opacity(minOpacity + strength * (1 - minOpacity))))
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .onScrollVisibilityChange(threshold: 0.1) { inViewport = $0 }
        .accessibilityHidden(true)
    }

    private func sweep(at phase: Double, row: Int, column: Int) -> Double {
        let first = Double(row + column) / 4 * 0.25
        let second = 0.5 + Double(2 - row + column) / 4 * 0.25
        return max(pulse(phase - first + 0.28), pulse(phase - second + 0.28))
    }

    private func pulse(_ value: Double) -> Double {
        let phase = (value + 2).truncatingRemainder(dividingBy: 1)
        guard phase < 0.48 else { return 0 }
        return (1 - cos(phase / 0.48 * 2 * .pi)) / 2
    }
}

private struct ActivityShimmer: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.conversationPaneVisible) private var paneVisible
    @State private var inViewport = false

    func body(content: Content) -> some View {
        content.overlay {
            if paneVisible && inViewport && !reduceMotion && scenePhase == .active {
                GeometryReader { geometry in
                    TimelineView(.animation(minimumInterval: 1.0 / 30)) { timeline in
                        let phase = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2) / 2
                        let width = geometry.size.width
                        LinearGradient(colors: [.clear, .primary.opacity(0.65), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: width * 0.8)
                            .offset(x: width * (phase * 1.8 - 0.8))
                    }
                }
                .mask(content)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
        }
        .onScrollVisibilityChange(threshold: 0.1) { inViewport = $0 }
    }
}

struct MateActivityAvatar: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let mate: Mate
    @Environment(\.conversationPaneVisible) private var paneVisible
    @State private var inViewport = false

    var body: some View {
        Group {
            if let preset = MateRobotAssets.catalogue?.preset(for: mate.avatar, mateID: mate.id) {
                MateRobotPreview(preset: preset, acceptsDrag: false, renders: inViewport && paneVisible, motion: .thinking)
            } else {
                MateRobotThumbnail(preset: nil)
            }
        }
        .frame(width: 34, height: 34)
        .onScrollVisibilityChange(threshold: 0.1) { inViewport = $0 }
        .accessibilityHidden(true)
    }
}

struct AgentActivityView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    enum Artwork {
        case provider(String)
        case mate(Mate?)
    }

    let activity: AgentActivity
    let artwork: Artwork
    var body: some View {
        HStack(spacing: 9) {
            switch artwork {
            case .provider(let providerID):
                AsciiSpinner(tint: Provider.accent(providerID))
            case .mate(let mate):
                if let mate { MateActivityAvatar(mate: mate) }
            }
            Text(activity.label).lineLimit(1).modifier(ActivityShimmer())
        }.font(.footnote).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: TranscriptRowMetrics.summaryHeight, alignment: .leading)
            .accessibilityElement(children: .ignore).accessibilityLabel(activity.label)
            .accessibilityIdentifier("agentActivity")
    }
}

struct ActiveToolFramesKey: PreferenceKey {
    static let defaultValue: [Int: CGRect] = [:]
    static func reduce(value: inout [Int: CGRect], nextValue: () -> [Int: CGRect]) { value.merge(nextValue()) { _, new in new } }
}
