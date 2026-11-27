import SwiftUI

struct EmptyStateView<Actions: View>: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let artwork: EmptyStateIllustration.Artwork
    var title: LocalizedStringKey? = nil
    var description: Text? = nil
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        VStack(spacing: 16) {
            EmptyStateIllustration(artwork: artwork)
            VStack(spacing: 6) {
                if let title {
                    Text(title).font(.title3.weight(.semibold).width(.expanded))
                        .accessibilityAddTraits(.isHeader)
                }
                if let description {
                    description.font(.subheadline).foregroundStyle(Color(.secondaryLabel))
                }
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            actions().buttonStyle(.bordered)
        }
        .frame(maxWidth: 320)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .accessibilityElement(children: .contain)
    }

    var centered: some View {
        ScrollView { self }
            .scrollBounceBehavior(.basedOnSize)
            .defaultScrollAnchor(.center, for: .alignment)
    }
}

extension EmptyStateView where Actions == EmptyView {
    init(artwork: EmptyStateIllustration.Artwork, title: LocalizedStringKey? = nil, description: Text? = nil) {
        self.init(artwork: artwork, title: title, description: description, actions: { EmptyView() })
    }
}

/// Keep the header in the scroll view and center the empty state in the space below it.
struct EmptyStateLayout<Header: View, Content: View>: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    @ViewBuilder let header: () -> Header
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { viewport in
            ScrollView {
                VStack(spacing: 0) {
                    header()
                    Spacer(minLength: 0)
                    content()
                    Spacer(minLength: 0)
                }
                .frame(minHeight: viewport.size.height)
            }
        }
    }
}

struct EmptyStateIllustration: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif

    enum Artwork: String {
        case library, pages, documents, images, bookmarks
        case search, offline, activity, trash, chats, spaces, mates, pairing
    }

    let artwork: Artwork

    var body: some View {
        Image("EmptyStates/\(artwork.rawValue)")
            .resizable()
            .scaledToFit()
            .foregroundStyle(Color.primary.opacity(0.82))
            .frame(width: 128, height: 104)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
