import SwiftUI

struct ConversationActionRequest: Identifiable {
    enum Prompt { case rename, move, delete }
    let runID: String
    let title: String
    let owner: Int
    let prompt: Prompt
    var id: String { runID }
}

struct ConversationMenuActions: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let run: Conversation
    @Binding var request: ConversationActionRequest?

    var body: some View {
        if run.isReplica != true {
            if session.supportsChatOrganization {
                Button("Rename", systemImage: "pencil") { present(.rename) }
                    .disabled(!session.canManageConversation(run.id, action: .rename(run.displayTitle)))
                    .accessibilityIdentifier("renameConversation")
                if run.isPinnableChat {
                    let pinned = run.pinnedAt != nil
                    Button(pinned ? "Unpin" : "Pin", systemImage: pinned ? "pin.slash" : "pin") {
                        perform(.setPinned(!pinned))
                    }
                    .disabled(!session.canManageConversation(run.id, action: .setPinned(!pinned)))
                    .accessibilityIdentifier("pinConversation")
                }
            }
            if run.mode == "work" || run.mode == "chat" {
                Button("Move to project", systemImage: "folder") { present(.move) }
                    .disabled(!session.canManageConversation(run.id, action: .moveToProject(nil)))
                    .accessibilityIdentifier("moveConversationToProject")
            }
            Divider()
            Button("Archive", systemImage: "archivebox") { perform(.archive) }
                .disabled(!session.canManageConversation(run.id, action: .archive))
                .accessibilityIdentifier("archiveConversation")
            Button("Delete", systemImage: "trash", role: .destructive) { present(.delete) }
                .disabled(!session.canManageConversation(run.id, action: .delete))
                .accessibilityIdentifier("deleteConversation")
        }
    }

    private func present(_ prompt: ConversationActionRequest.Prompt) {
        request = .init(runID: run.id, title: run.displayTitle, owner: session.ownership, prompt: prompt)
    }

    private func perform(_ action: ConversationAction) {
        let owner = session.ownership
        Task { await performConversationAction(session, runID: run.id, owner: owner, action: action) }
    }
}

struct ConversationActionPrompts: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    @Binding var request: ConversationActionRequest?

    func body(content: Content) -> some View {
        content
            .sheet(item: Binding(get: { request?.prompt == .delete ? nil : request },
                                 set: { if request?.prompt != .delete { request = $0 } })) { request in
                if request.prompt == .rename {
                    RenameItemSheet(title: "Rename chat", field: "Chat title", initialValue: request.title) { name in
                        guard request.owner == session.ownership else { throw MainsError.changedBackend }
                        try await session.manageConversation(request.runID, action: .rename(name))
                    }
                } else {
                    ConversationProjectSheet(session: session, runID: request.runID, owner: request.owner)
                }
            }
            .confirmationDialog("Delete chat?", isPresented: Binding(get: { request?.prompt == .delete },
                set: { if !$0 && request?.prompt == .delete { request = nil } }), titleVisibility: .visible, presenting: request) { target in
                Button("Delete chat", role: .destructive) {
                    Task { await performConversationAction(session, runID: target.runID, owner: target.owner, action: .delete) }
                }
            } message: { _ in
                Text("This permanently deletes the chat and its chat files. This can’t be undone.")
            }
            .onChange(of: session.ownership) { _, _ in request = nil }
    }
}

@MainActor private func performConversationAction(_ session: BackendSession, runID: String, owner: Int, action: ConversationAction) async {
    guard owner == session.ownership else { return }
    do { try await session.manageConversation(runID, action: action) }
    catch {
        guard owner == session.ownership, session.pendingConversationAction?.status != .uncertain else { return }
        let message = error.localizedDescription
        session.actionError = message.contains("not available to paired devices")
            ? "Update Mains on your computer to manage chats from this iPhone." : message
    }
}

struct RenameItemSheet: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let title: String
    let field: String
    let save: (String) async throws -> Void
    @State private var value: String
    @State private var saving = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    init(title: String, field: String, initialValue: String, save: @escaping (String) async throws -> Void) {
        self.title = title
        self.field = field
        self.save = save
        _value = State(initialValue: initialValue)
    }

    private var name: String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSave: Bool { !saving && !name.isEmpty && name.utf16.count <= 240 }

    var body: some View {
        NavigationStack {
            Form {
                TextField(field, text: $value).autocorrectionDisabled()
                    .submitLabel(.done).onSubmit(submit)
                    .accessibilityIdentifier("renameItemField")
                if saving { ProgressView().accessibilityLabel("Saving") }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: submit).disabled(!canSave).accessibilityIdentifier("saveItemName")
                }
            }
        }
        .presentationDetents([.medium])
        .interactiveDismissDisabled(saving)
    }

    private func submit() {
        guard canSave else { return }
        let submitted = name
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do { try await save(submitted); dismiss() }
            catch { self.error = error.localizedDescription }
        }
    }
}

struct ConversationProjectSheet: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let runID: String
    let owner: Int
    @State private var error: String?
    @State private var active = true
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        MoveToProjectSheet(projects: session.collections,
                           selectedProjectID: session.conversations.first { $0.id == runID }?.collectionId,
                           canMove: canMove, error: error,
                           rowIdentifier: { $0.map { "moveChatProject-" + $0 } ?? "moveChatNoProject" },
                           move: move) {
            if session.pendingConversationAction?.runID == runID { ConversationActionDeliveryNotice(session: session) }
        }
        .task { if owner == session.ownership { await session.refresh() } }
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

struct MoveToProjectSheet<Status: View>: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let projects: [ProjectCollection]
    let selectedProjectID: String?
    var isSelectionKnown = true
    let canMove: Bool
    let error: String?
    let rowIdentifier: (String?) -> String
    let move: (String?) -> Void
    @ViewBuilder let status: () -> Status
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var visibleProjects: [ProjectCollection] {
        projects.filter { !$0.isArchived && (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)) }
    }

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).foregroundStyle(.red).font(.subheadline) }
                destination(nil, spacing: nil) {
                    Label("No project", systemImage: "tray")
                }
                Section {
                    ForEach(visibleProjects) { project in
                        destination(project.id, spacing: 10) {
                            RegistryIcon(token: project.icon, fallback: "folder", size: 20)
                            Text(project.name).foregroundStyle(.primary)
                        }
                    }
                    if visibleProjects.isEmpty {
                        Text(query.isEmpty ? "No projects yet." : "No matching projects.").foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Projects").fontWidth(.expanded)
                }
            }
            .navigationHeaderFade(background: Color(.systemGroupedBackground))
            .expandedNavigationTitle("Move to project")
            .searchable(text: $query, prompt: "Search projects")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .safeAreaInset(edge: .bottom, content: status)
        }
    }

    private func destination<Label: View>(_ id: String?, spacing: CGFloat?,
                                          @ViewBuilder label: () -> Label) -> some View {
        let selected = isSelectionKnown && selectedProjectID == id
        return Button { move(id) } label: {
            HStack(spacing: spacing) {
                label()
                Spacer()
                if selected { Image(systemName: "checkmark").foregroundStyle(.secondary).accessibilityHidden(true) }
            }.contentShape(.rect)
        }
        .disabled(!canMove || selected)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier(rowIdentifier(id))
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

struct WorkspaceActionDeliveryNotice: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    var body: some View {
        if let pending = session.pendingWorkspaceAction, pending.status == .uncertain {
            ChatNotice(title: "Workspace change unconfirmed", message: "Check whether your computer completed the change.",
                       symbol: "exclamationmark.circle", warning: true, horizontalInset: 12) {
                Button("Check change") {
                    let owner = session.ownership
                    Task {
                        guard owner == session.ownership, session.pendingWorkspaceAction?.id == pending.id else { return }
                        do { try await session.checkWorkspaceAction() }
                        catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
                    }
                }.disabled(!session.isConnected).accessibilityIdentifier("checkWorkspaceAction")
            }.padding(.vertical, 8).background(Color(.systemBackground))
        }
    }
}
