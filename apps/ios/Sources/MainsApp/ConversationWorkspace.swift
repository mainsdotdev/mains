import SwiftUI

extension EnvironmentValues {
    @Entry var conversationPaneVisible = true
}

struct ConversationWorkspace<ConversationContent: View, OutputContent: View>: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let plan: ConversationPanePlan
    let conversation: ConversationContent
    let output: OutputContent

    init(plan: ConversationPanePlan, @ViewBuilder conversation: () -> ConversationContent, @ViewBuilder output: () -> OutputContent) {
        self.plan = plan; self.conversation = conversation(); self.output = output()
    }
    var body: some View {
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
