import SwiftUI

struct AtlasBookmarkEditSelection: Identifiable {
    let id = UUID()
    let itemID: String
    let owner: Int
}

struct AtlasBookmarkEditor: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let selection: AtlasBookmarkEditSelection
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var original: AtlasBookmarkDocument?
    @State private var draft = AtlasBookmarkDraft()
    @State private var loading = false
    @State private var saving = false
    @State private var error: String?
    @State private var visible = true
    @State private var readID = UUID()
    private var canSave: Bool {
        guard let original else { return false }
        return !loading && !saving && session.canSaveToAtlas && selection.owner == session.ownership
            && draft.validationError == nil && !draft.changes(from: original).isEmpty
    }
    var body: some View {
        NavigationStack {
            Form {
                if loading { HStack(spacing: 12) { ProgressView(); Text("Loading bookmark…").foregroundStyle(.secondary) } }
                if let original {
                    Section("Link") { Text(original.url).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled) }
                    Group {
                        Section("Title") { TextField("Title", text: $draft.title).accessibilityIdentifier("editBookmarkTitle") }
                        Section("Description") { TextField("Description", text: $draft.description, axis: .vertical).lineLimit(2...6).accessibilityIdentifier("editBookmarkDescription") }
                        Section("Note") { TextEditor(text: $draft.note).frame(minHeight: 160).accessibilityIdentifier("editBookmarkNote") }
                    }.disabled(loading || saving || session.pendingAtlasSave != nil)
                    if let validation = draft.validationError { Text(validation).font(.caption).foregroundStyle(.secondary) }
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.secondary)
                        if session.pendingAtlasSave == nil {
                            Button(original == nil ? "Try again" : "Discard edits and reload") { Task { await load() } }.disabled(loading || saving || !session.isConnected)
                        }
                    }
                }
                if session.pendingAtlasSave?.status == .uncertain {
                    Section {
                        Text("The change hasn’t been confirmed. Check its result before editing again.").foregroundStyle(.secondary)
                        Button("Check change") { save(check: true) }.disabled(!session.isConnected || saving)
                    }
                }
            }
            .navigationTitle("Edit bookmark").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { save(check: false) }.disabled(!canSave).accessibilityIdentifier("saveBookmarkEdits")
                }
            }
        }
        .task { await load() }
        .onDisappear { visible = false; readID = UUID() }
        .onChange(of: session.ownership) { _, _ in dismiss() }
    }
    private func load() async {
        let ticket = UUID(); readID = ticket
        loading = true; error = nil
        defer { if readID == ticket { loading = false } }
        do {
            guard selection.owner == session.ownership else { throw MainsError.changedBackend }
            let item = try await session.readAtlasBookmark(selection.itemID)
            try Task.checkCancellation()
            guard readID == ticket, visible, selection.owner == session.ownership else { return }
            original = item; draft = item.draft
        } catch { if readID == ticket, !Task.isCancelled, selection.owner == session.ownership { self.error = error.localizedDescription } }
    }
    private func save(check: Bool) {
        let submitted = draft, initial = original
        saving = true; error = nil
        Task {
            defer { if selection.owner == session.ownership { saving = false } }
            do {
                if check { _ = try await session.checkAtlasSaveDelivery() }
                else if let initial { _ = try await session.editAtlasBookmark(initial, draft: submitted, owner: selection.owner) }
                else { throw MainsError.invalidReply }
                guard selection.owner == session.ownership, visible else { return }
                onSaved(); dismiss()
            } catch { if selection.owner == session.ownership, visible { self.error = error.localizedDescription } }
        }
    }
}
