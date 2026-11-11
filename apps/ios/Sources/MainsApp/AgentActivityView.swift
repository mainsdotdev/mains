import SwiftUI

/// Same two-second diagonal square sweep as desktop's AsciiSpinner.
struct AgentAsciiSpinner: View {
    let providerID: String
    var animated = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animated || reduceMotion || scenePhase != .active || !visible)) { context in
            let phase = reduceMotion || !animated ? 0.24 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2) / 2
            Canvas { canvas, size in
                let cell = (min(size.width, size.height) - 2) / 3
                for row in 0..<3 {
                    for column in 0..<3 {
                        let first = Double(row + column) / 4 * 0.25
                        let second = 0.5 + Double(2 - row + column) / 4 * 0.25
                        let strength = max(pulse(phase - first + 0.28), pulse(phase - second + 0.28))
                        let scale = 0.15 + strength * 0.85
                        let rect = CGRect(x: CGFloat(column) * (cell + 1) + cell * (1 - scale) / 2,
                                          y: CGFloat(row) * (cell + 1) + cell * (1 - scale) / 2, width: cell * scale, height: cell * scale)
                        canvas.fill(Path(roundedRect: rect, cornerRadius: 0.6), with: .color(Provider.accent(providerID).opacity(0.15 + 0.85 * strength)))
                    }
                }
            }
        }
        .frame(width: 15, height: 15).accessibilityHidden(true)
        .onAppear { visible = true }.onDisappear { visible = false }
    }
    private func pulse(_ value: Double) -> Double {
        let phase = (value + 2).truncatingRemainder(dividingBy: 1)
        guard phase < 0.48 else { return 0 }
        return (1 - cos(phase / 0.48 * 2 * .pi)) / 2
    }
}

private struct ActivityShimmer: ViewModifier {
    let enabled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    func body(content: Content) -> some View {
        content.overlay {
            if enabled && !reduceMotion && scenePhase == .active && visible {
                GeometryReader { geometry in
                    TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                        let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2) / 2
                        LinearGradient(colors: [.clear, .primary.opacity(0.65), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: geometry.size.width * 0.8)
                            .offset(x: geometry.size.width * (phase * 1.8 - 0.8))
                    }
                }.mask(content).allowsHitTesting(false).accessibilityHidden(true)
            }
        }.onAppear { visible = true }.onDisappear { visible = false }
    }
}

extension View {
    func activityShimmer(_ enabled: Bool = true) -> some View { modifier(ActivityShimmer(enabled: enabled)) }
}

struct AgentActivityView: View {
    let activity: AgentActivity
    let providerID: String
    var body: some View {
        HStack(spacing: 9) {
            AgentAsciiSpinner(providerID: providerID)
            Text(activity.label).lineLimit(1).activityShimmer()
        }.font(.footnote).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
            .accessibilityElement(children: .ignore).accessibilityLabel(activity.label)
            .accessibilityIdentifier("agentActivity")
    }
}

struct ActiveToolFramesKey: PreferenceKey {
    static let defaultValue: [Int: CGRect] = [:]
    static func reduce(value: inout [Int: CGRect], nextValue: () -> [Int: CGRect]) { value.merge(nextValue()) { _, new in new } }
}
