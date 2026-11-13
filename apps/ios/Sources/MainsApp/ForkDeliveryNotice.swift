import SwiftUI

/// App-scoped recovery remains reachable after leaving the source conversation.
struct ForkDeliveryNotice: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let open: (String) -> Void
    var body: some View {
        if let pending = session.pendingFork, pending.status == .uncertain {
            ChatNotice(title: "Fork unconfirmed", message: "Check whether your computer created the new conversation before starting another.",
                       symbol: "exclamationmark.circle", warning: true, horizontalInset: 12) {
                Button("Check fork") {
                    let owner = session.ownership
                    Task {
                        do {
                            let id = try await session.checkForkDelivery()
                            guard owner == session.ownership else { return }
                            open(id)
                        } catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
                    }
                }.disabled(!session.isConnected).accessibilityIdentifier("checkForkDelivery")
            }.padding(.vertical, 8).background(Color(.systemBackground))
        }
    }
}
