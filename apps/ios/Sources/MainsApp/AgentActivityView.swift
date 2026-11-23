import SwiftUI

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
                Image(systemName: "sparkle").foregroundStyle(Provider.accent(providerID))
                    .frame(width: 15).accessibilityHidden(true)
            case .mate(let mate):
                if let mate { MateActivityAvatar(mate: mate) }
            }
            Text(activity.label).lineLimit(1)
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
