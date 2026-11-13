import SwiftUI

struct AtlasTrashView: View {
    let session: BackendSession
    let owner: Int
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var page = 1
    @State private var result: AtlasTrashPage?
    @State private var loading = false
    @State private var error: String?
    @State private var restoreError: String?
    @State private var reload = 0
    @State private var readID = UUID()
    @State private var restoring: String?
    private var key: String { "\(page):\(session.connection):\(session.atlasRevision):\(reload)" }
    var body: some View {
        NavigationStack {
            List {
                if loading { HStack(spacing: 12) { ProgressView(); Text("Loading Trash…").foregroundStyle(.secondary) } }
                if let error {
                    Text(error).foregroundStyle(.secondary)
                    Button("Try again") { reload += 1 }.disabled(loading || !session.isConnected)
                }
                if let result {
                    if result.items.isEmpty {
                        ContentUnavailableView("Trash is empty", systemImage: "trash", description: Text("Items moved to Trash can be restored here."))
                            .listRowBackground(Color.clear).accessibilityIdentifier("atlasTrashEmpty")
                    }
                    ForEach(result.items) { item in
                        HStack(alignment: .center, spacing: 10) {
                            RegistryIcon(token: "icon:atlas-" + item.kind, fallback: symbol(item.kind), size: 22, tint: .secondary)
                                .frame(width: 24, height: 24)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.title).font(.subheadline.weight(.medium))
                                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                                TimelineView(.periodic(from: .now, by: 60)) { clock in
                                    let trashedAt = date(item.trashedAt)
                                    let project = session.collections.first(where: { $0.id == item.collectionId })?.name
                                    Text([trashedAt.map { compactRelativeAge($0, now: clock.date) }, project].compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption2).foregroundStyle(.secondary)
                                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                                        .accessibilityLabel([trashedAt.map { "Trashed on " + $0.formatted(date: .abbreviated, time: .shortened) }, project].compactMap { $0 }.joined(separator: ", "))
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            if restoring == item.id { ProgressView().frame(minWidth: 44, minHeight: 44) }
                            else {
                                Button("Restore", systemImage: "arrow.uturn.backward") { restore(item) }
                                    .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                                    .accessibilityLabel("Restore " + item.title).accessibilityIdentifier("atlasRestore-" + item.id)
                                    .disabled(!session.canSaveToAtlas || owner != session.ownership)
                            }
                        }.frame(minHeight: AppListStyle.minimumContentHeight)
                            .listRowInsets(AppListStyle.rowInsets)
                            .accessibilityIdentifier("atlasTrashItem-" + item.id)
                    }
                    if result.page > 1 || result.hasNext {
                        HStack {
                            Button("Previous") { page = max(1, page - 1) }.disabled(page == 1 || loading)
                            Spacer()
                            Text("Page \(result.page)").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Button("Next") { page += 1 }.disabled(!result.hasNext || loading)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped).navigationTitle("Trash").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) { Button("Refresh", systemImage: "arrow.clockwise") { reload += 1 }.disabled(loading || !session.isConnected) }
            }
            .safeAreaInset(edge: .top) { AtlasSaveDeliveryNotice(session: session) }
            .task(id: key) { await load() }
            .refreshable { await load() }
            .accessibilityIdentifier("atlasTrash")
            .alert("Couldn’t restore item", isPresented: Binding(get: { restoreError != nil }, set: { if !$0 { restoreError = nil } })) { Button("OK", role: .cancel) {} } message: { Text(restoreError ?? "") }
        }
        .onChange(of: session.ownership) { _, _ in readID = UUID(); dismiss() }
        .onDisappear { readID = UUID() }
    }
    private func restore(_ item: AtlasTrashItem) {
        restoring = item.id
        Task {
            defer { if owner == session.ownership { restoring = nil } }
            do { _ = try await session.restoreAtlasItem(item, owner: owner) }
            catch { if owner == session.ownership { restoreError = error.localizedDescription } }
        }
    }
    private func load() async {
        let ticket = UUID(); readID = ticket
        let requested = page
        loading = true; error = nil; result = nil
        defer { if readID == ticket { loading = false } }
        do {
            guard owner == session.ownership else { throw MainsError.changedBackend }
            let next = try await session.atlasTrash(page: requested)
            try Task.checkCancellation()
            guard readID == ticket, page == requested, owner == session.ownership else { return }
            if next.items.isEmpty, page > 1 { page = 1; return }
            result = next
        } catch { if readID == ticket, !Task.isCancelled, owner == session.ownership { self.error = error.localizedDescription } }
    }
    private func symbol(_ kind: String) -> String { ["page": "doc.text", "file": "doc", "image": "photo", "bookmark": "bookmark"][kind] ?? "doc" }
    private func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
