import SwiftUI
import QuickLook

private let atlasTypes = [("all", "All", "square.stack"), ("page", "Pages", "doc.text"), ("file", "Docs", "doc"), ("image", "Images", "photo"), ("bookmark", "Bookmarks", "bookmark")]
private let atlasScopes = [("all", "All sources"), ("saved", "Saved to Atlas"), ("generated", "Generated"), ("uploads", "Uploads"), ("favorites", "Favorites")]

struct AtlasView: View {
    let session: BackendSession
    let openPage: (String) -> Void
    let openConversation: (String) -> Void
    @State private var query = AtlasQuery()
    @State private var library: AtlasLibraryPage?
    @State private var error: String?
    @State private var loading = false
    @State private var reload = 0
    @State private var bookmark: AtlasEntry?
    @State private var file: AtlasFileSelection?
    @State private var addingBookmark = false
    @State private var bookmarkOwner = 0
    @State private var libraryOwner: Int?
    @State private var moveSelection: AtlasMoveSelection?
    @State private var editError: String?
    @State private var bookmarkEdit: AtlasBookmarkEditSelection?
    @State private var showingTrash = false
    @State private var trashOwner = 0
    @State private var tagEdit: AtlasTagEditSelection?
    @State private var showingTagFilter = false
    @State private var tagFilterOwner = 0
    @State private var activeTag: AtlasTag?
    private var canOrganize: Bool { libraryOwner == session.ownership && session.canSaveToAtlas }
    private var filter: String { "\(query.type):\(query.scope):\(query.collectionID ?? ""):\(query.tagID ?? ""):\(query.text)" }
    private var loadKey: String { "\(query.hashValue):\(session.connection):\(session.atlasRevision):\(reload)" }

    var body: some View {
        List {
            Section {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(atlasTypes, id: \.0) { type in
                            Button { query.type = type.0 } label: {
                                Label(type.1, systemImage: type.2).font(.subheadline.weight(.medium)).fixedSize()
                                    .padding(.horizontal, 14).frame(minHeight: 44)
                                    .background(query.type == type.0 ? Color.primary.opacity(0.1) : Color(.tertiarySystemGroupedBackground), in: .capsule)
                            }.buttonStyle(ChatPressStyle()).foregroundStyle(.primary)
                                .accessibilityAddTraits(query.type == type.0 ? .isSelected : [])
                                .accessibilityIdentifier("atlasType-" + type.0)
                        }
                    }.padding(.vertical, 4)
                }.scrollIndicators(.hidden)
                HStack {
                    Menu {
                        Picker("Source", selection: $query.scope) {
                            ForEach(atlasScopes, id: \.0) { Text($0.1).tag($0.0) }
                        }
                        Picker("Project", selection: $query.collectionID) {
                            Text("All projects").tag(String?.none)
                            ForEach(session.collections) { Text($0.name).tag(Optional($0.id)) }
                        }
                        Button("Tag…", systemImage: "tag") { tagFilterOwner = session.ownership; showingTagFilter = true }
                    } label: {
                        Label(query.scope == "all" && query.collectionID == nil && query.tagID == nil ? "Filter" : "Filtered", systemImage: "line.3.horizontal.decrease")
                            .frame(minHeight: 44)
                    }.accessibilityIdentifier("atlasFilters")
                    Spacer()
                    if query.scope != "all" || query.collectionID != nil || query.tagID != nil {
                        Button("Reset") { query.scope = "all"; query.collectionID = nil; query.tagID = nil; activeTag = nil }
                    }
                }
                if query.scope != "all" || query.collectionID != nil || query.tagID != nil {
                    Text([atlasScopes.first(where: { $0.0 == query.scope })?.1,
                          session.collections.first(where: { $0.id == query.collectionID })?.name,
                          activeTag.map { "#" + $0.name }].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }.listRowBackground(Color.clear).listRowSeparator(.hidden)

            if loading { HStack(spacing: 12) { ProgressView(); Text("Loading Atlas…").foregroundStyle(.secondary) } }
            if session.pendingAtlasSave?.isUpdate == true, session.pendingAtlasSave?.status == .sending {
                HStack(spacing: 12) { ProgressView(); Text("Updating item…").foregroundStyle(.secondary) }
            }
            if let error {
                Section {
                    Text(error).foregroundStyle(.secondary)
                    Button("Try again") { reload += 1 }.disabled(!session.isConnected)
                }
            }
            if let library {
                if library.items.isEmpty {
                    ContentUnavailableView(query.text.isEmpty ? "No items here yet" : "No matches", systemImage: "square.stack",
                                           description: Text(query.text.isEmpty ? "Pages, saved files and files from Work chats appear here." : "Try another search or change the filters."))
                        .listRowBackground(Color.clear).accessibilityIdentifier("atlasEmpty")
                }
                ForEach(library.items) { entry in
                    Button { open(entry) } label: { AtlasEntryRow(entry: entry, project: session.collections.first { $0.id == entry.collectionId }?.name) }
                        .buttonStyle(.plain).accessibilityIdentifier("atlasItem-" + entry.key)
                        .contextMenu {
                            if entry.savedIdentity != nil {
                                if entry.kind == "bookmark", let id = entry.savedIdentity {
                                    Button("Edit bookmark", systemImage: "pencil") {
                                        if let owner = libraryOwner { bookmarkEdit = AtlasBookmarkEditSelection(itemID: id, owner: owner) }
                                    }.disabled(!canOrganize)
                                }
                                Button(entry.isFavorite ? "Remove from favorites" : "Add to favorites", systemImage: entry.isFavorite ? "star.slash" : "star") { favorite(entry) }
                                    .disabled(!canOrganize)
                                Button("Move to project", systemImage: "folder") { move(entry) }.disabled(!canOrganize)
                                Button("Edit tags", systemImage: "tag") {
                                    if let id = entry.savedIdentity, let owner = libraryOwner { tagEdit = AtlasTagEditSelection(itemID: id, owner: owner) }
                                }.disabled(!canOrganize)
                                Button("Move to Trash", systemImage: "trash", role: .destructive) { trash(entry) }.disabled(!canOrganize)
                            }
                            if let id = entry.sourceRunId { Button("Open source chat", systemImage: "bubble.left") { openConversation(id) } }
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if entry.savedIdentity != nil {
                                Button("Move", systemImage: "folder") { move(entry) }.tint(.blue).disabled(!canOrganize)
                                Button("Trash", systemImage: "trash") { trash(entry) }.tint(.red).disabled(!canOrganize)
                                Button(entry.isFavorite ? "Unfavorite" : "Favorite", systemImage: entry.isFavorite ? "star.slash" : "star") { favorite(entry) }
                                    .tint(.orange).disabled(!canOrganize)
                            }
                        }
                }
                if library.page > 1 || library.hasNext {
                    HStack {
                        Button("Previous") { query.page = max(1, library.page - 1) }.disabled(library.page == 1 || loading)
                        Spacer()
                        Text("Page \(library.page)").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Next") { query.page = library.page + 1 }.disabled(!library.hasNext || loading)
                    }
                }
            }
        }
        .listStyle(.insetGrouped).navigationTitle("Atlas")
        .searchable(text: $query.text, prompt: "Search Atlas")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Trash", systemImage: "trash") { trashOwner = session.ownership; showingTrash = true }
                    .accessibilityIdentifier("openAtlasTrash")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("New bookmark", systemImage: "bookmark.badge.plus") { bookmarkOwner = session.ownership; addingBookmark = true }
                    .disabled(!session.canSaveToAtlas).accessibilityIdentifier("newAtlasBookmark")
            }
            ToolbarItem(placement: .topBarTrailing) {
            Button("Refresh", systemImage: "arrow.clockwise") { reload += 1 }.disabled(loading || !session.isConnected)
        } }
        .accessibilityIdentifier("atlasLibrary")
        .task(id: loadKey) { await load() }
        .refreshable { await load() }
        .onChange(of: filter) { _, _ in query.page = 1 }
        .sheet(item: $file) { AtlasFilePreview(session: session, selection: $0, openConversation: { id in file = nil; openConversation(id) }) }
        .sheet(item: $bookmark) { entry in
            AtlasBookmarkView(session: session, entry: entry, owner: libraryOwner ?? session.ownership, openConversation: { id in bookmark = nil; openConversation(id) })
        }
        .sheet(isPresented: $addingBookmark) {
            NewAtlasBookmarkView(session: session, owner: bookmarkOwner, onSaved: {
                query = AtlasQuery(); query.type = "bookmark"; reload += 1
            }, collectionID: query.collectionID)
        }
        .sheet(item: $moveSelection) { MoveAtlasItemView(session: session, selection: $0) }
        .sheet(item: $bookmarkEdit) { AtlasBookmarkEditor(session: session, selection: $0, onSaved: { reload += 1 }) }
        .sheet(isPresented: $showingTrash) { AtlasTrashView(session: session, owner: trashOwner) }
        .sheet(item: $tagEdit) { AtlasTagsEditor(session: session, selection: $0) }
        .sheet(isPresented: $showingTagFilter) {
            AtlasTagFilterView(session: session, owner: tagFilterOwner, selected: activeTag) { tag in
                activeTag = tag; query.tagID = tag?.id
            }
        }
        .onChange(of: session.ownership) { _, _ in query.tagID = nil; activeTag = nil }
        .alert("Couldn’t update item", isPresented: Binding(get: { editError != nil }, set: { if !$0 { editError = nil } })) { Button("OK", role: .cancel) {} } message: { Text(editError ?? "") }
    }
    private func favorite(_ entry: AtlasEntry) {
        guard let owner = libraryOwner, canOrganize else { return }
        Task {
            do { _ = try await session.setAtlasFavorite(entry, to: !entry.isFavorite, owner: owner) }
            catch { if owner == session.ownership { editError = error.localizedDescription } }
        }
    }
    private func trash(_ entry: AtlasEntry) {
        guard let owner = libraryOwner, canOrganize else { return }
        Task {
            do { _ = try await session.trashAtlasItem(entry, owner: owner) }
            catch { if owner == session.ownership { editError = error.localizedDescription } }
        }
    }
    private func move(_ entry: AtlasEntry) {
        guard let owner = libraryOwner, canOrganize else { return }
        moveSelection = AtlasMoveSelection(entry: entry, owner: owner)
    }
    private func open(_ entry: AtlasEntry) {
        if let id = entry.pageId { openPage(id) }
        else if let reference = entry.file { file = AtlasFileSelection(reference: reference, owner: session.ownership, sourceRunID: entry.sourceRunId) }
        else if entry.kind == "bookmark" { bookmark = entry }
    }
    @State private var readID = UUID()
    private func load() async {
        let ticket = UUID(); readID = ticket
        let requested = query, owner = session.ownership
        loading = true; error = nil; library = nil
        defer { if readID == ticket { loading = false } }
        guard session.isConnected else { error = "Connect to your computer to browse Atlas."; return }
        do {
            try await Task.sleep(for: .milliseconds(250))
            let result = try await session.atlasLibrary(requested)
            guard readID == ticket, query == requested, owner == session.ownership else { return }
            libraryOwner = owner; library = result
        } catch {
            if readID == ticket, !Task.isCancelled, owner == session.ownership { self.error = error.localizedDescription }
        }
    }
}

private struct AtlasEntryRow: View {
    let entry: AtlasEntry
    let project: String?
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if let icon = entry.icon { RegistryIcon(token: icon, size: 24, tint: .secondary) }
                else { Image(systemName: atlasTypes.first { $0.0 == entry.kind }?.2 ?? "doc").font(.title3).foregroundStyle(.secondary) }
            }.frame(width: 30, height: 32).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(entry.title).font(.body.weight(.medium)).foregroundStyle(.primary).lineLimit(2)
                    if entry.isFavorite { Image(systemName: "star.fill").font(.caption).foregroundStyle(.yellow).accessibilityLabel("Favorite") }
                }
                Text([entry.origin == "saved" ? "Saved to Atlas" : entry.origin == "attachment" ? "Uploaded" : "Generated", project].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                if let tags = entry.tags, !tags.isEmpty {
                    Text(tags.map { "#" + $0.name }.joined(separator: "  ")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        .accessibilityLabel("Tags: " + tags.map(\.name).joined(separator: ", "))
                }
                if let date = ISO8601DateFormatter.atlasDate(entry.date) { Text(date, style: .relative).font(.caption2).foregroundStyle(.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary).padding(.top, 7)
        }.padding(.vertical, 7).frame(minHeight: 60).contentShape(.rect)
    }
}

struct AtlasPageView: View {
    let session: BackendSession
    let pageID: String
    let openPage: (String) -> Void
    let openConversation: (String) -> Void
    @State private var content: AtlasPageContent?
    @State private var version: Int?
    @State private var offset = 0
    @State private var previous: [Int] = []
    @State private var error: String?
    @State private var reload = 0
    @State private var file: AtlasFileSelection?
    private var key: String { "\(pageID):\(offset):\(reload):\(session.connection)" }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let error {
                    ContentUnavailableView("Couldn’t read page", systemImage: "doc.text", description: Text(error))
                    Button("Refresh page", action: refresh).frame(maxWidth: .infinity)
                } else if let content {
                    HStack(alignment: .top, spacing: 12) {
                        if let icon = content.icon { RegistryIcon(token: icon, size: 30) }
                        Text(content.title).font(.largeTitle.bold()).textSelection(.enabled)
                    }
                    ChatMessageBody(text: content.markdown).accessibilityIdentifier("atlasPageContent")
                    if !content.embeddedFiles.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Files in this part").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                            ForEach(Array(content.embeddedFiles.enumerated()), id: \.element) { index, id in
                                Button("Open embedded file \(index + 1)", systemImage: "doc.richtext") {
                                    file = AtlasFileSelection(reference: .saved(id), owner: session.ownership)
                                }.frame(minHeight: 44)
                            }
                        }
                    }
                    if let id = content.sourceRunId {
                        Button("Open source chat", systemImage: "bubble.left") { openConversation(id) }
                    }
                } else { ProgressView("Reading page…").frame(maxWidth: .infinity) }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
        }
        .id(offset).navigationTitle("Page").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Refresh page", systemImage: "arrow.clockwise", action: refresh) } }
        .safeAreaInset(edge: .bottom) {
            if !previous.isEmpty || content?.nextOffset != nil {
                HStack {
                    Button("Previous") { if let last = previous.popLast() { offset = last } }.disabled(previous.isEmpty || content == nil)
                    Spacer()
                    Text("Part \(previous.count + 1)").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Next") { if let next = content?.nextOffset { previous.append(offset); offset = next } }.disabled(content?.nextOffset == nil)
                }.padding().background(.bar)
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            if let link = AtlasLink(url) {
                switch link {
                case .page(let id): openPage(id)
                case .file(let id): file = AtlasFileSelection(reference: .saved(id), owner: session.ownership)
                }
                return .handled
            }
            return ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") ? .systemAction : .discarded
        })
        .sheet(item: $file) { AtlasFilePreview(session: session, selection: $0) }
        .task(id: key) {
            content = nil; error = nil
            guard session.isConnected else { error = "Connect to your computer to read this page."; return }
            do {
                let result = try await session.atlasPage(pageID, offset: offset, version: version)
                try Task.checkCancellation(); version = result.version; content = result
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }
    private func refresh() { version = nil; offset = 0; previous = []; reload += 1 }
}

private struct AtlasBookmarkView: View {
    let session: BackendSession
    let entry: AtlasEntry
    let owner: Int
    let openConversation: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var current: AtlasBookmarkDocument?
    @State private var editing: AtlasBookmarkEditSelection?
    @State private var refresh = 0
    @State private var error: String?
    private var title: String { current?.title ?? entry.title }
    private var description: String { current?.description ?? entry.description ?? "" }
    private var note: String { current?.note ?? entry.note ?? "" }
    private var webURL: URL? {
        guard let current else { return entry.webURL }
        guard let url = URL(string: current.url), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { return nil }
        return url
    }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(title).font(.title2.bold()).textSelection(.enabled)
                    if !description.isEmpty { Text(description).textSelection(.enabled) }
                    if let url = webURL {
                        Link(url.host ?? url.absoluteString, destination: url)
                        ShareLink(item: url) { Label("Share link", systemImage: "square.and.arrow.up") }
                    }
                }
                if !note.isEmpty { Section("Notes") { Text(note).textSelection(.enabled) } }
                if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                if let id = entry.sourceRunId { Button("Open source chat", systemImage: "bubble.left") { openConversation(id) } }
            }.navigationTitle("Bookmark").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button("Close", systemImage: "xmark") { dismiss() } }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Edit") { if let id = entry.savedIdentity { editing = AtlasBookmarkEditSelection(itemID: id, owner: owner) } }
                            .disabled(!session.canSaveToAtlas || owner != session.ownership).accessibilityIdentifier("editAtlasBookmark")
                    }
                }
        }
        .sheet(item: $editing) { AtlasBookmarkEditor(session: session, selection: $0, onSaved: { refresh += 1 }) }
        .task(id: "\(session.connection):\(session.atlasRevision):\(refresh)") {
            error = nil
            do {
                guard owner == session.ownership, let id = entry.savedIdentity else { throw MainsError.changedBackend }
                let item = try await session.readAtlasBookmark(id)
                try Task.checkCancellation(); guard owner == session.ownership else { return }
                current = item
            } catch { if !Task.isCancelled, owner == session.ownership { self.error = error.localizedDescription } }
        }
        .onChange(of: session.ownership) { _, _ in dismiss() }
    }
}

struct AtlasFileSelection: Identifiable {
    let id = UUID()
    let reference: AtlasFileReference
    let owner: Int
    var sourceRunID: String? = nil
}
struct AtlasFilePreview: View {
    let session: BackendSession
    let selection: AtlasFileSelection
    var openConversation: ((String) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var file: AtlasFile?
    @State private var url: URL?
    @State private var folder: URL?
    @State private var error: String?
    @State private var progress = 0.0
    @State private var retry = 0
    @State private var readID = UUID()
    var body: some View {
        NavigationStack {
            Group {
                if let url, let file {
                    if ["markdown", "text"].contains(file.previewType) { LocalTextFilePreview(url: url, markdown: file.previewType == "markdown") }
                    else if file.previewType != "unsupported", QLPreviewController.canPreview(url as NSURL) { OutputQuickLook(url: url).accessibilityIdentifier("atlasFilePreview") }
                    else { ContentUnavailableView("File ready", systemImage: "doc", description: Text("Use Share to save or open this file in another app.")) }
                } else if let error {
                    ContentUnavailableView { Label("Couldn’t open file", systemImage: "doc") } description: { Text(error) } actions: { Button("Try again") { retry += 1 } }
                } else { VStack(spacing: 16) { ProgressView(value: progress).frame(maxWidth: 180); Text("Opening file…").foregroundStyle(.secondary) } }
            }
            .navigationTitle(file?.name ?? "Atlas file").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) { if let url { ShareLink(item: url) { Label("Share or save", systemImage: "square.and.arrow.up") } } }
                ToolbarItem(placement: .bottomBar) {
                    if let id = selection.sourceRunID, let openConversation { Button("Open source chat", systemImage: "bubble.left") { openConversation(id) } }
                }
                ToolbarItem(placement: .bottomBar) {
                    if let file, let source = AtlasSaveSource.generated(file) { AtlasSaveButton(session: session, source: source, owner: selection.owner) }
                }
            }
        }
        .environment(\.openURL, OpenURLAction { url in ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") ? .systemAction : .discarded })
        .task(id: retry) { await download() }
        .onDisappear { readID = UUID(); cleanup() }
        .onChange(of: session.ownership) { _, _ in readID = UUID(); cleanup(); dismiss() }
    }
    private func cleanup() { if let folder { try? FileManager.default.removeItem(at: folder) }; folder = nil; url = nil }
    private func download() async {
        let ticket = UUID(); readID = ticket; cleanup(); error = nil; progress = 0
        var destination: URL?
        do {
            guard selection.owner == session.ownership else { throw MainsError.changedBackend }
            let descriptor = try await session.describeAtlasFile(selection.reference)
            try Task.checkCancellation()
            guard readID == ticket else { return }
            file = descriptor
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("mains-atlas-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            destination = directory; folder = directory
            let target = directory.appendingPathComponent(TranscriptMedia.fileName(descriptor.name))
            try await session.downloadAtlasFile(descriptor, owner: selection.owner, to: target) { if readID == ticket { progress = $0 } }
            try Task.checkCancellation()
            guard ticket == readID else { if let destination { try? FileManager.default.removeItem(at: destination) }; return }
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: target.path)
            url = target
        } catch {
            if let destination { try? FileManager.default.removeItem(at: destination) }
            if ticket == readID { cleanup(); if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }
}

private extension ISO8601DateFormatter {
    static func atlasDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
