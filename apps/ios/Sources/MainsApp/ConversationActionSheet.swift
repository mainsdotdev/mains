import SwiftUI

struct ConversationProjectSheet: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let runID: String
    let owner: Int
    @State private var query = ""
    @State private var error: String?
    @State private var active = true
    @Environment(\.dismiss) private var dismiss
    private var current: String? { session.conversations.first { $0.id == runID }?.collectionId }
    private var projects: [ProjectCollection] {
        session.collections.filter { !$0.isArchived && (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)) }
    }
    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).foregroundStyle(.red).font(.subheadline) }
                Button { move(nil) } label: {
                    HStack {
                        Label("No project", systemImage: "tray")
                        Spacer()
                        if current == nil { Image(systemName: "checkmark").foregroundStyle(.secondary) }
                    }.contentShape(.rect)
                }.disabled(!canMove || current == nil).accessibilityIdentifier("moveChatNoProject")
                Section("Projects") {
                    ForEach(projects) { project in
                        Button { move(project.id) } label: {
                            HStack(spacing: 10) {
                                RegistryIcon(token: project.icon, fallback: "folder", size: 20)
                                Text(project.name).foregroundStyle(.primary)
                                Spacer()
                                if current == project.id { Image(systemName: "checkmark").foregroundStyle(.secondary) }
                            }.contentShape(.rect)
                        }.disabled(!canMove || current == project.id).accessibilityIdentifier("moveChatProject-" + project.id)
                    }
                    if projects.isEmpty { Text(query.isEmpty ? "No projects yet." : "No matching projects.").foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Move to project").navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Search projects")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .safeAreaInset(edge: .bottom) {
                if session.pendingConversationAction?.runID == runID { ConversationActionDeliveryNotice(session: session) }
            }
            .task { if owner == session.ownership { await session.refresh() } }
        }
        .onChange(of: session.ownership) { _, _ in dismiss() }
        .onDisappear { active = false }
        .accessibilityIdentifier("moveChatProjectSheet")
    }
    private var canMove: Bool { owner == session.ownership && session.canManageConversation(runID, action: .moveToProject(nil)) }
    private func move(_ projectID: String?) {
        guard canMove else { return }
        error = nil
        Task {
            guard active && owner == session.ownership else { return }
            do {
                try await session.manageConversation(runID, action: .moveToProject(projectID))
                if active && owner == session.ownership { dismiss() }
            } catch {
                if active && owner == session.ownership && session.pendingConversationAction == nil {
                    let message = error.localizedDescription
                    self.error = message.contains("not available to paired devices")
                        ? "Update Mains on your computer to move chats from this iPhone." : message
                }
            }
        }
    }
}

/// Reachable even after the user dismisses the menu/sheet or changes chats.
struct ConversationActionDeliveryNotice: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    var body: some View {
        if let pending = session.pendingConversationAction, pending.status == .uncertain {
            ChatNotice(title: "Chat change unconfirmed", message: "Check whether your computer completed “\(pending.action.title)” before making another change.",
                       symbol: "exclamationmark.circle", warning: true, horizontalInset: 12) {
                Button("Check change") {
                    let owner = session.ownership
                    Task {
                        guard owner == session.ownership, session.pendingConversationAction?.id == pending.id else { return }
                        do { try await session.checkConversationAction() }
                        catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
                    }
                }.disabled(!session.isConnected).accessibilityIdentifier("checkConversationAction")
            }.padding(.vertical, 8).background(Color(.systemBackground))
        }
    }
}
