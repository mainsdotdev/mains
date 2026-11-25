import SwiftUI

extension EnvironmentValues {
    @Entry var conversationPaneVisible = true
    @Entry var conversationOutputPaneVisible = true
}

struct ConversationWorkspace<ConversationContent: View, OutputContent: View>: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let plan: ConversationPanePlan
    let fillsViewport: Bool
    let extendsConversationUnderHeader: Bool
    let conversation: ConversationContent
    let output: OutputContent

    init(plan: ConversationPanePlan, fillsViewport: Bool, extendsConversationUnderHeader: Bool = false,
         @ViewBuilder conversation: () -> ConversationContent, @ViewBuilder output: () -> OutputContent) {
        self.plan = plan; self.fillsViewport = fillsViewport
        self.extendsConversationUnderHeader = extendsConversationUnderHeader
        self.conversation = conversation(); self.output = output()
    }
    var body: some View {
        // A single full-size pane can follow the native keyboard layout directly.
        // Keep the same readers when switching to geometry-based split placement.
        let layout = fillsViewport ? AnyLayout(ZStackLayout()) : AnyLayout(ConversationReaderLayout(plan: plan))
        layout {
            ZStack { conversation }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipShape(ConversationReaderClip(extendsAbove: extendsConversationUnderHeader))
                .environment(\.conversationPaneVisible, plan.showsConversation)
                .opacity(plan.showsConversation ? 1 : 0).allowsHitTesting(plan.showsConversation)
                .accessibilityHidden(!plan.showsConversation)
            ZStack { output }
                .frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
                .environment(\.conversationOutputPaneVisible, plan.showsOutput)
                .opacity(plan.showsOutput ? 1 : 0).allowsHitTesting(plan.showsOutput)
                .accessibilityHidden(!plan.showsOutput)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversationWorkspace-\(String(describing: plan.mode))")
    }
}

private struct ConversationReaderClip: Shape {
    let extendsAbove: Bool
    func path(in rect: CGRect) -> Path {
        Path(extendsAbove ? rect.union(rect.offsetBy(dx: 0, dy: -rect.height)) : rect)
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
