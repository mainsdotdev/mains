import SwiftUI

struct AtlasSaveButton: View {
    let session: BackendSession
    let source: AtlasSaveSource
    let owner: Int
    @State private var saving = false
    @State private var saved = false
    @State private var error: String?
    @State private var operation = UUID()
    var body: some View {
        Button {
            let ticket = UUID(); operation = ticket
            saving = true
            Task {
                defer { if owner == session.ownership, operation == ticket { saving = false } }
                do { _ = try await session.saveAtlasFile(source, owner: owner); if owner == session.ownership, operation == ticket { saved = true } }
                catch { if owner == session.ownership, operation == ticket { self.error = error.localizedDescription } }
            }
        } label: {
            Label(saving ? "Saving…" : saved ? "Saved to Atlas" : "Save to Atlas", systemImage: saved ? "checkmark" : "square.stack.badge.plus")
        }
        .disabled(saved || saving || !session.canSaveToAtlas || owner != session.ownership || session.conversations.first(where: { $0.id == source.runId })?.isReplica == true)
        .accessibilityIdentifier("saveToAtlas")
        .onChange(of: source) { _, _ in operation = UUID(); saved = false; saving = false; error = nil }
        .alert("Couldn’t save to Atlas", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK", role: .cancel) {} } message: { Text(error ?? "") }
    }
}

/// A lost save acknowledgement can be recovered after leaving the original file/form.
struct AtlasSaveDeliveryNotice: View {
    let session: BackendSession
    @State private var message: String?
    @State private var failed = false
    var body: some View {
        VStack(spacing: 0) {
            if let pending = session.pendingAtlasSave, pending.status == .uncertain {
                ChatNotice(title: "Atlas save unconfirmed", message: "Check whether \(pending.label) was saved before saving another item.", symbol: "exclamationmark.circle", warning: true, horizontalInset: 12) {
                    Button("Check save") {
                        let owner = session.ownership
                        Task {
                            do { let item = try await session.checkAtlasSaveDelivery(); if owner == session.ownership { failed = false; message = item.title } }
                            catch { if owner == session.ownership { failed = true; message = error.localizedDescription } }
                        }
                    }.disabled(!session.isConnected).accessibilityIdentifier("checkAtlasSaveDelivery")
                }.padding(.vertical, 8).background(Color(.systemBackground))
            }
        }
        .alert(failed ? "Couldn’t check save" : "Saved to Atlas", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) { Button("Done", role: .cancel) {} } message: { Text(message ?? "") }
        .onChange(of: session.ownership) { _, _ in message = nil }
    }
}

struct NewAtlasBookmarkView: View {
    let session: BackendSession
    let owner: Int
    let onSaved: () -> Void
    @State var collectionID: String?
    @State private var url = ""
    @State private var saving = false
    @State private var error: String?
    @State private var visible = true
    @Environment(\.dismiss) private var dismiss
    @FocusState private var linkFocused: Bool
    var body: some View {
        NavigationStack {
            Form {
                Section("Link") {
                    TextField("https://example.com", text: $url).keyboardType(.URL).textContentType(.URL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().focused($linkFocused)
                        .accessibilityIdentifier("atlasBookmarkURL")
                    PasteButton(payloadType: String.self) { values in if let value = values.first { url = String(value.prefix(4096)) } }
                    if !url.isEmpty, AtlasBookmarkURL.validate(url) == nil {
                        Text("Enter a complete http:// or https:// link.").font(.caption).foregroundStyle(.secondary)
                    }
                }.disabled(saving || session.pendingAtlasSave != nil)
                Section {
                    Picker("Project", selection: $collectionID) {
                        Text("No project").tag(String?.none)
                        ForEach(session.collections) { Text($0.name).tag(Optional($0.id)) }
                    }.disabled(saving || session.pendingAtlasSave != nil)
                }
                if let error { Section { Text(error).foregroundStyle(.secondary) } }
                if session.pendingAtlasSave?.status == .uncertain {
                    Section {
                        Text("The save hasn’t been confirmed. Check it before adding another bookmark.").foregroundStyle(.secondary)
                        Button("Check save") { save(check: true) }.disabled(!session.isConnected || saving)
                    }
                }
            }
            .navigationTitle("New bookmark").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { save(check: false) }
                        .disabled(saving || !session.canSaveToAtlas || AtlasBookmarkURL.validate(url) == nil)
                        .accessibilityIdentifier("saveAtlasBookmark")
                }
            }
            .task { linkFocused = true }
        }
        .onDisappear { visible = false }
        .onChange(of: session.ownership) { _, _ in dismiss() }
    }
    private func save(check: Bool) {
        let submittedURL = url, project = collectionID
        saving = true; error = nil; linkFocused = false
        Task {
            defer { if owner == session.ownership { saving = false } }
            do {
                if check { _ = try await session.checkAtlasSaveDelivery() }
                else { _ = try await session.saveAtlasBookmark(submittedURL, collectionID: project, owner: owner) }
                guard owner == session.ownership, visible else { return }
                onSaved(); dismiss()
            } catch { if owner == session.ownership, visible { self.error = error.localizedDescription } }
        }
    }
}
