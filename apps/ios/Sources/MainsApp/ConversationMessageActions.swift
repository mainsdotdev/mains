import SwiftUI

enum ConversationActionIcons {
    /// Desktop's 24-unit fork path, including SessionTimeBar's 90° rotation.
    static var fork: Image {
        Image(size: CGSize(width: 20, height: 20)) { context in
            var path = Path()
            path.move(to: CGPoint(x: 21, y: 8.5))
            path.addLine(to: CGPoint(x: 21, y: 6.6))
            path.addCurve(to: CGPoint(x: 20.473, y: 3.527), control1: CGPoint(x: 21, y: 4.903), control2: CGPoint(x: 21, y: 4.054))
            path.addCurve(to: CGPoint(x: 17.4, y: 3), control1: CGPoint(x: 19.946, y: 3), control2: CGPoint(x: 19.097, y: 3))
            path.addLine(to: CGPoint(x: 15.5, y: 3))
            path.move(to: CGPoint(x: 20, y: 4))
            path.addLine(to: CGPoint(x: 14.5, y: 9.5))
            path.move(to: CGPoint(x: 3, y: 8.5))
            path.addLine(to: CGPoint(x: 3, y: 6.6))
            path.addCurve(to: CGPoint(x: 3.527, y: 3.527), control1: CGPoint(x: 3, y: 4.903), control2: CGPoint(x: 3, y: 4.054))
            path.addCurve(to: CGPoint(x: 6.6, y: 3), control1: CGPoint(x: 4.054, y: 3), control2: CGPoint(x: 4.903, y: 3))
            path.addLine(to: CGPoint(x: 8.5, y: 3))
            path.move(to: CGPoint(x: 4, y: 4))
            path.addLine(to: CGPoint(x: 9.657, y: 9.657))
            path.addCurve(to: CGPoint(x: 11.695, y: 12.127), control1: CGPoint(x: 10.813, y: 10.813), control2: CGPoint(x: 11.391, y: 11.391))
            path.addCurve(to: CGPoint(x: 12, y: 15.314), control1: CGPoint(x: 12, y: 12.861), control2: CGPoint(x: 12, y: 13.679))
            path.addLine(to: CGPoint(x: 12, y: 21))
            context.scaleBy(x: 20.0 / 24, y: 20.0 / 24)
            context.translateBy(x: 24, y: 0)
            context.rotate(by: .degrees(90))
            context.stroke(path, with: .color(.black), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
        }.renderingMode(.template)
    }
}

struct ForkConversationButton: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let runID: String
    let fork: () -> Void

    var body: some View {
        Button(action: fork) {
            ConversationActionIcons.fork.resizable().frame(width: 16, height: 16)
                .opacity(session.pendingFork?.sourceRunID == runID && session.pendingFork?.status == .sending ? 0.5 : 1)
                .frame(width: 32, height: 28, alignment: .leading).contentShape(.rect)
        }
        .disabled(!session.canForkConversation(runID))
        .accessibilityLabel("Fork conversation").accessibilityIdentifier("forkFromLastResponse")
        .buttonStyle(ChatPressStyle()).foregroundStyle(.secondary)
    }
}
