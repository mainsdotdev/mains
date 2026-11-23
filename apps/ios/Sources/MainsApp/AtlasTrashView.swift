import SwiftUI

struct AtlasTrashView: View {
    private enum Operation: Equatable { case restore, delete }
    private struct Confirmation {
        let item: AtlasTrashItem
        let operation: Operation
    }

    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let owner: Int
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var page = 1
    @State private var result: AtlasTrashPage?
    @State private var loading = false
    @State private var error: String?
    @State private var actionError: String?
    @State private var confirmation: Confirmation?
    @State private var reload = 0
    @State private var readID = UUID()
    @State private var changingItemID: String?
    private var canChange: Bool { session.canSaveToAtlas && owner == session.ownership && changingItemID == nil }
    private var key: String { "\(page):\(session.connection):\(session.atlasRevision):\(reload)" }
    var body: some View {
        NavigationStack {
            Group {
                if result?.items.isEmpty == true || !session.isConnected && result == nil {
                    ScrollView {
                        if !session.isConnected {
                            DisconnectedState(message: "Connect to your computer to see what’s in Trash.")
                        } else {
                            EmptyStateView(artwork: .trash, title: "Trash is empty",
                                           description: Text("Items moved to Trash appear here."))
                                .accessibilityIdentifier("atlasTrashEmpty")
                        }
                    }
                    .defaultScrollAnchor(.center, for: .alignment)
                } else {
                    trashList
                }
            }
            .background(Color(.systemGroupedBackground))
            .expandedNavigationTitle("Trash")
            .navigationHeaderFade(background: Color(.systemGroupedBackground))
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) { Button("Refresh", systemImage: "arrow.clockwise") { reload += 1 }.disabled(loading || !session.isConnected) }
            }
            .safeAreaInset(edge: .top) { AtlasSaveDeliveryNotice(session: session) }
            .task(id: key) { await load() }
            .pullToRefresh { await load() }
            .accessibilityIdentifier("atlasTrash")
            .alert(confirmationTitle,
                   isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }),
                   presenting: confirmation) { selection in
                if selection.operation == .delete {
                    Button(selection.item.sourceOnly == true ? "Remove from Trash" : "Delete Permanently", role: .destructive) { perform(selection) }
                } else {
                    Button("Restore") { perform(selection) }
                }
                Button("Cancel", role: .cancel) {}
            } message: { selection in
                if selection.operation == .delete && selection.item.sourceOnly == true {
                    Text("“(selection.item.title)” will stay hidden in Atlas. The original is still available in its conversation.")
                } else if selection.operation == .delete {
                    Text("“\(selection.item.title)” will be permanently deleted from Atlas. This can’t be undone.")
                } else {
                    Text("“\(selection.item.title)” will return to your Atlas library.")
                }
            }
            .alert("Couldn’t update item", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(actionError ?? "") }
        }
        .onChange(of: session.ownership) { _, _ in readID = UUID(); dismiss() }
        .onDisappear { readID = UUID() }
    }

    private var trashList: some View {
        List {
            if !session.isConnected {
                DisconnectedState(message: "Connect to your computer to see what’s in Trash.")
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else if loading {
                ContentSkeleton(label: "Loading Trash…").listRow
            }
            if session.isConnected, let error {
                Text(error).foregroundStyle(.secondary)
                Button("Try again") { reload += 1 }.disabled(loading || !session.isConnected)
            }
            if let result {
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
                        HStack(spacing: 0) {
                            Button { confirmation = Confirmation(item: item, operation: .restore) } label: {
                                Image(systemName: "arrow.uturn.backward")
                                    .frame(width: 44, height: 44).contentShape(.rect)
                            }
                            .accessibilityLabel("Restore " + item.title)
                            .accessibilityIdentifier("atlasRestore-" + item.id)
                            if result.canDeletePermanently == true {
                                Button(role: .destructive) { confirmation = Confirmation(item: item, operation: .delete) } label: {
                                    Image(systemName: "trash").foregroundStyle(.red)
                                        .frame(width: 44, height: 44).contentShape(.rect)
                                }
                                .accessibilityLabel(item.sourceOnly == true ? "Remove " + item.title + " from Trash" : "Delete " + item.title + " permanently")
                                .accessibilityIdentifier("atlasDelete-" + item.id)
                            }
                        }
                        .buttonStyle(.borderless)
                        .disabled(!canChange)
                        .opacity(changingItemID == item.id ? 0.5 : 1)
                    }.frame(minHeight: AppListStyle.minimumContentHeight)
                        .listRowInsets(AppListStyle.rowInsets)
                        .accessibilityElement(children: .contain)
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
        .listStyle(.insetGrouped)
    }
    private var confirmationTitle: String {
        guard let confirmation, confirmation.operation == .delete else { return "Restore item?" }
        return confirmation.item.sourceOnly == true ? "Remove from Trash?" : "Delete permanently?"
    }
    private func perform(_ selection: Confirmation) {
        guard canChange else { return }
        changingItemID = selection.item.id
        Task {
            defer { changingItemID = nil }
            do {
                switch selection.operation {
                case .restore: _ = try await session.restoreAtlasItem(selection.item, owner: owner)
                case .delete: _ = try await session.deleteAtlasTrashItem(selection.item, owner: owner)
                }
            } catch {
                if owner == session.ownership { actionError = error.localizedDescription }
            }
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
