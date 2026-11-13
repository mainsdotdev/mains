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

struct ConversationMessageActions: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let copyText: String?
    let copyIsPreview: Bool
    let forkRunID: String?
    let fork: () -> Void
    @State private var copied = false
    @State private var copyID: UUID?

    var body: some View {
        HStack(spacing: 0) {
            if let copyText, !copyText.isEmpty {
                Button {
                    UIPasteboard.general.string = copyText
                    copied = true; copyID = UUID()
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                } label: {
                    Image(systemName: copied ? "checkmark" : "square.on.square")
                        .font(.system(size: 16)).frame(width: 16, height: 16)
                        .frame(width: 32, height: 28, alignment: .leading).contentShape(.rect)
                }
                .accessibilityLabel(copyIsPreview ? "Copy answer preview" : "Copy answer")
                .accessibilityValue(copied ? "Copied" : "")
                .accessibilityIdentifier("copyAnswer")
            }
            if let forkRunID {
                Button(action: fork) {
                    Group {
                        if session.pendingFork?.sourceRunID == forkRunID, session.pendingFork?.status == .sending { ProgressView().controlSize(.mini) }
                        else { ConversationActionIcons.fork.resizable() }
                    }.frame(width: 16, height: 16)
                        .frame(width: 32, height: 28, alignment: .leading).contentShape(.rect)
                }
                .disabled(!session.canForkConversation(forkRunID))
                .accessibilityLabel("Fork conversation").accessibilityIdentifier("forkFromLastResponse")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .buttonStyle(ChatPressStyle()).foregroundStyle(.secondary)
        .task(id: copyID) {
            guard copyID != nil else { return }
            do { try await Task.sleep(for: .seconds(2)) } catch { return }
            copied = false
        }
        .onChange(of: copyText) { _, _ in copied = false; copyID = nil }
        .onDisappear { copied = false; copyID = nil }
    }
}
