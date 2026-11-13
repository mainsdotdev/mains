import SwiftUI

extension EnvironmentValues {
    @Entry var conversationPaneVisible = true
}

struct ConversationWorkspace<ConversationContent: View, OutputContent: View>: View {
    let state: ConversationCompanionState
    let conversation: ConversationContent
    let output: OutputContent
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.layoutDirection) private var layoutDirection

    init(state: ConversationCompanionState, @ViewBuilder conversation: () -> ConversationContent, @ViewBuilder output: () -> OutputContent) {
        self.state = state; self.conversation = conversation(); self.output = output()
    }
    var body: some View {
        GeometryReader { geometry in
            let plan = ConversationPanePlan.make(size: geometry.size, expanded: horizontalSizeClass == .regular,
                                                 accessibilityText: dynamicTypeSize.isAccessibilitySize, rightToLeft: layoutDirection == .rightToLeft,
                                                 state: state, divisions: divisions(in: geometry))
            ConversationReaderLayout(plan: plan) {
                ZStack { conversation }
                    .frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
                    .environment(\.conversationPaneVisible, plan.showsConversation)
                    .opacity(plan.showsConversation ? 1 : 0).allowsHitTesting(plan.showsConversation)
                    .accessibilityHidden(!plan.showsConversation)
                ZStack { output }
                    .frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
                    .opacity(plan.showsOutput ? 1 : 0).allowsHitTesting(plan.showsOutput)
                    .accessibilityHidden(!plan.showsOutput)
            }
            .accessibilityIdentifier("conversationWorkspace-\(String(describing: plan.mode))")
        }
    }
    private func divisions(in proxy: GeometryProxy) -> [CGRect] {
        if #available(iOS 27.1, *) { return proxy.reservedRegions(kind: .division).map(\.frame) }
        return []
    }
}

/// A stable layout tree: resizing never swaps HStack/VStack or navigation roots.
private struct ConversationReaderLayout: Layout {
    let plan: ConversationPanePlan
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize { proposal.replacingUnspecifiedDimensions() }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 2 else { return }
        for (view, frame) in zip(subviews, [plan.conversation, plan.output]) {
            view.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), anchor: .topLeading,
                       proposal: ProposedViewSize(width: frame.width, height: frame.height))
        }
    }
}
