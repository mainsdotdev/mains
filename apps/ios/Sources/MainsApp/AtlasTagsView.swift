import SwiftUI

struct AtlasTagEditSelection: Identifiable {
    let id = UUID()
    let itemID: String
    let owner: Int
}

struct AtlasTagsEditor: View {
    let session: BackendSession
    let selection: AtlasTagEditSelection
    @Environment(\.dismiss) private var dismiss
    @State private var original: AtlasItemTags?
    @State private var selected: [AtlasTag] = []
    @State private var newName = ""
    @State private var loading = false
    @State private var saving = false
    @State private var error: String?
    @State private var visible = true
    @State private var readID = UUID()
    private var editable: Bool { !loading && !saving && session.canSaveToAtlas && selection.owner == session.ownership }
    private var canSave: Bool {
        guard let original else { return false }
        return editable && selected.count <= 30 && Set(selected.map(\.id)) != Set(original.tags.map(\.id))
    }
    var body: some View {
        NavigationStack {
            List {
                if loading { HStack(spacing: 12) { ProgressView(); Text("Loading tags…").foregroundStyle(.secondary) } }
                if let original {
                    Section { Text(original.title).font(.headline) }
                    Section("Selected tags (\(selected.count)/30)") {
                        if selected.isEmpty { Text("No tags selected").foregroundStyle(.secondary) }
                        ForEach(selected) { tag in
                            Button { selected.removeAll { $0.id == tag.id } } label: {
                                HStack { Text(tag.name).foregroundStyle(.primary); Spacer(); Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }.frame(minHeight: 44)
                            }.disabled(!editable).accessibilityLabel("Remove tag " + tag.name)
                        }
                    }
                    Section {
                        TextField("New tag name", text: $newName).autocorrectionDisabled().textInputAutocapitalization(.never)
                            .accessibilityIdentifier("newAtlasTagName")
                        Button("Add new tag", systemImage: "plus") { addNewTag() }
                            .disabled(AtlasTagNames.normalized(newName) == nil || selected.count >= 30)
                            .accessibilityIdentifier("addAtlasTag")
                        if !newName.isEmpty, AtlasTagNames.normalized(newName) == nil { Text("Use a name of 64 characters or fewer, without control characters.").font(.caption).foregroundStyle(.secondary) }
                    } footer: { Text("New tags are created when you save.") }
                    .disabled(!editable)
                    AtlasTagCatalogue(session: session, owner: selection.owner, selected: Set(selected.map(\.id)), enabled: editable, allowsAdditional: selected.count < 30) { tag in
                        if selected.contains(where: { $0.id == tag.id }) { selected.removeAll { $0.id == tag.id } }
                        else if selected.count < 30 { add(tag) }
                    }
                    if selected.count > 30 { Text("Keep up to 30 tags before saving.").foregroundStyle(.secondary) }
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.secondary)
                        Button(original == nil ? "Try again" : "Discard edits and reload") { Task { await load() } }
                            .disabled(loading || saving || session.pendingAtlasSave != nil || !session.isConnected)
                    }
                }
                if session.pendingAtlasSave?.status == .uncertain {
                    Section {
                        Text("The change hasn’t been confirmed. Check its result before editing again.").foregroundStyle(.secondary)
                        Button("Check change") { save(check: true) }.disabled(!session.isConnected || saving)
                    }
                }
            }
            .navigationTitle("Edit tags").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "Saving…" : "Save") { save() }.disabled(!canSave).accessibilityIdentifier("saveAtlasTags") }
            }
        }
        .task { await load() }
        .onDisappear { visible = false; readID = UUID() }
        .onChange(of: session.ownership) { _, _ in dismiss() }
    }
    private func add(_ tag: AtlasTag) {
        let key = tag.name.precomposedStringWithCompatibilityMapping.lowercased()
        selected.removeAll { $0.id == tag.id || $0.name.precomposedStringWithCompatibilityMapping.lowercased() == key }
        selected.append(tag)
    }
    private func addNewTag() {
        guard let name = AtlasTagNames.normalized(newName), selected.count < 30 else { return }
        if !selected.contains(where: { $0.name.precomposedStringWithCompatibilityMapping.lowercased() == name.lowercased() }) { add(AtlasTag(id: name, name: name)) }
        newName = ""
    }
    private func load() async {
        let ticket = UUID(); readID = ticket; loading = true; error = nil
        defer { if readID == ticket { loading = false } }
        do {
            guard selection.owner == session.ownership else { throw MainsError.changedBackend }
            let result = try await session.readAtlasTags(selection.itemID)
            try Task.checkCancellation()
            guard readID == ticket, visible, selection.owner == session.ownership else { return }
            original = result; selected = result.tags; newName = ""
        } catch { if readID == ticket, !Task.isCancelled, selection.owner == session.ownership { self.error = error.localizedDescription } }
    }
    private func save(check: Bool = false) {
        guard let original, check || canSave else { return }
        let tags = selected
        saving = true; error = nil
        Task {
            defer { if selection.owner == session.ownership { saving = false } }
            do {
                if check { _ = try await session.checkAtlasSaveDelivery() }
                else { _ = try await session.setAtlasTags(original, tags: tags, owner: selection.owner) }
                if visible, selection.owner == session.ownership { dismiss() }
            } catch { if visible, selection.owner == session.ownership { self.error = error.localizedDescription } }
        }
    }
}

struct AtlasTagFilterView: View {
    let session: BackendSession
    let owner: Int
    let selected: AtlasTag?
    let onSelect: (AtlasTag?) -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Button("All tags") { choose(nil) }.frame(minHeight: 44)
                AtlasTagCatalogue(session: session, owner: owner, selected: Set([selected?.id].compactMap { $0 }), enabled: session.isConnected) { choose($0) }
            }
            .navigationTitle("Filter by tag").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { dismiss() } } }
        }
        .onChange(of: session.ownership) { _, _ in dismiss() }
    }
    private func choose(_ tag: AtlasTag?) { if owner == session.ownership { onSelect(tag) }; dismiss() }
}

/// One searchable page, independent of the item's in-memory edit selection.
private struct AtlasTagCatalogue: View {
    let session: BackendSession
    let owner: Int
    let selected: Set<String>
    let enabled: Bool
    var allowsAdditional = true
    let onSelect: (AtlasTag) -> Void
    @State private var query = ""
    @State private var page = 1
    @State private var result: AtlasTagPage?
    @State private var loading = false
    @State private var error: String?
    @State private var reload = 0
    @State private var readID = UUID()
    private var key: String { "\(query):\(page):\(session.connection):\(session.atlasRevision):\(reload)" }
    var body: some View {
        Section("Find tags") {
            TextField("Search tags", text: $query).autocorrectionDisabled().textInputAutocapitalization(.never).accessibilityIdentifier("searchAtlasTags")
            if loading { ProgressView().accessibilityLabel("Loading tags") }
            if let error {
                Text(error).foregroundStyle(.secondary)
                Button("Try again") { reload += 1 }.disabled(!session.isConnected || loading)
            }
            if let result {
                if result.items.isEmpty { Text("No tags found").foregroundStyle(.secondary) }
                ForEach(result.items) { tag in
                    Button { onSelect(tag) } label: {
                        HStack { Text(tag.name).foregroundStyle(.primary); Spacer(); if selected.contains(tag.id) { Image(systemName: "checkmark").foregroundStyle(.tint) } }.frame(minHeight: 44)
                    }.disabled(!enabled || owner != session.ownership || !allowsAdditional && !selected.contains(tag.id))
                        .accessibilityAddTraits(selected.contains(tag.id) ? .isSelected : [])
                        .accessibilityIdentifier("atlasTag-" + tag.id)
                }
                if result.page > 1 || result.hasNext {
                    HStack {
                        Button("Previous") { page -= 1 }.disabled(page == 1 || loading)
                        Spacer(); Text("Page \(result.page)").font(.caption).foregroundStyle(.secondary); Spacer()
                        Button("Next") { page += 1 }.disabled(!result.hasNext || loading)
                    }
                }
            }
        }
        .task(id: key) { await load() }
        .onChange(of: query) { _, value in
            var bounded = String(value.prefix(64)); while bounded.utf16.count > 64 { bounded.removeLast() }
            if bounded != value { query = bounded }
            page = 1
        }
        .onDisappear { readID = UUID() }
    }
    private func load() async {
        let ticket = UUID(); readID = ticket
        let requested = page, search = query
        loading = true; error = nil; result = nil
        defer { if readID == ticket { loading = false } }
        do {
            try await Task.sleep(for: .milliseconds(250))
            guard owner == session.ownership else { throw MainsError.changedBackend }
            let next = try await session.atlasTags(query: search, page: requested)
            try Task.checkCancellation()
            guard ticket == readID, requested == page, search == query, owner == session.ownership else { return }
            if next.items.isEmpty, page > 1 { page = 1; return }
            result = next
        } catch { if ticket == readID, !Task.isCancelled, owner == session.ownership { self.error = error.localizedDescription } }
    }
}
