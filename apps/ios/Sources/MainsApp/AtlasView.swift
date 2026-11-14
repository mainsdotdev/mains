import SwiftUI
import QuickLook
import ImageIO

private let atlasTypes = [("all", "All", "atlas-all"), ("page", "Pages", "atlas-page"), ("file", "Docs", "atlas-file"), ("image", "Images", "atlas-image"), ("bookmark", "Bookmarks", "atlas-bookmark")]
private let atlasScopes = [("all", "All sources"), ("saved", "Saved to Atlas"), ("generated", "Generated"), ("uploads", "Uploads"), ("favorites", "Favorites")]

struct AtlasView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
    private var hasFilters: Bool { query.scope != "all" || query.collectionID != nil || query.tagID != nil }
    private var filter: String { "\(query.type):\(query.scope):\(query.collectionID ?? ""):\(query.tagID ?? ""):\(query.text)" }
    private var loadKey: String { "\(query.hashValue):\(session.connection):\(session.atlasRevision):\(reload)" }

    var body: some View {
        List {
            Section {
                libraryFilters.listRowInsets(EdgeInsets())
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
                    Button { open(entry) } label: { AtlasEntryRow(session: session, entry: entry, project: session.collections.first { $0.id == entry.collectionId }?.name) }
                        .buttonStyle(.plain).accessibilityIdentifier("atlasItem-" + entry.key)
                        .listRowInsets(AppListStyle.rowInsets)
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
        .contentMargins(.top, 8, for: .scrollContent)
        .listSectionSpacing(.compact)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query.text, placement: .toolbar, prompt: "Search Atlas")
        .toolbar {
            DefaultToolbarItem(kind: .search, placement: .bottomBar)
            ToolbarSpacer(.flexible, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) {
                Menu {
                    Button("New bookmark", systemImage: "bookmark.badge.plus") { bookmarkOwner = session.ownership; addingBookmark = true }
                        .disabled(!session.canSaveToAtlas).accessibilityIdentifier("newAtlasBookmark")
                    Button("Trash", systemImage: "trash") { trashOwner = session.ownership; showingTrash = true }
                        .accessibilityIdentifier("openAtlasTrash")
                    Divider()
                    Button("Refresh", systemImage: "arrow.clockwise") { reload += 1 }
                        .disabled(loading || !session.isConnected)
                } label: {
                    Label("Atlas options", systemImage: "ellipsis")
                }
                .labelStyle(.iconOnly)
                .buttonBorderShape(.circle)
                .accessibilityIdentifier("atlasOptions")
            }
        }
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
    private var libraryFilters: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(atlasTypes, id: \.0) { type in
                            Button { query.type = type.0 } label: {
                                Label {
                                    Text(type.1)
                                } icon: {
                                    RegistryIcon(token: "icon:" + type.2, size: 18, tint: .primary)
                                }
                                    .font(.subheadline.weight(.medium)).fixedSize()
                                    .padding(.horizontal, 14).frame(minHeight: 36)
                                    .background(query.type == type.0 ? Color.primary.opacity(0.1) : Color(.tertiarySystemGroupedBackground), in: .capsule)
                                    .frame(minHeight: 44).contentShape(.rect)
                            }.buttonStyle(ChatPressStyle()).foregroundStyle(.primary)
                                .accessibilityAddTraits(query.type == type.0 ? .isSelected : [])
                                .accessibilityIdentifier("atlasType-" + type.0)
                        }
                    }
                }
                .scrollIndicators(.hidden)
                .modifier(AtlasTypeScrollFade())
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
                    Image(systemName: "line.3.horizontal.decrease")
                        .font(.body.weight(.medium))
                        .foregroundStyle(hasFilters ? Color.accentColor : .primary)
                        .frame(width: 36, height: 36)
                        .background(Color(.tertiarySystemGroupedBackground), in: .circle)
                        .frame(width: 44, height: 44).contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(hasFilters ? "Filtered" : "Filter")
                .accessibilityIdentifier("atlasFilters")
            }
            if hasFilters {
                HStack(spacing: 8) {
                    Text([atlasScopes.first(where: { $0.0 == query.scope })?.1,
                          session.collections.first(where: { $0.id == query.collectionID })?.name,
                          activeTag.map { "#" + $0.name }].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button("Reset") { query.scope = "all"; query.collectionID = nil; query.tagID = nil; activeTag = nil }
                        .font(.caption).fixedSize().frame(minHeight: 44).buttonStyle(.plain)
                }
            }
        }
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

private struct AtlasTypeScrollFade: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    private struct Edges: Equatable {
        var left = false
        var right = false
    }
    @State private var edges = Edges()
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: Edges.self) { geometry in
                let start = -geometry.contentInsets.leading
                let end = max(start, geometry.contentSize.width - geometry.containerSize.width + geometry.contentInsets.trailing)
                let overflows = end > start + 1
                return Edges(left: overflows && geometry.contentOffset.x > start + 1,
                             right: overflows && geometry.contentOffset.x < end - 1)
            } action: { _, next in edges = next }
            .overlay(alignment: layoutDirection == .leftToRight ? .leading : .trailing) {
                fade(left: true).opacity(edges.left ? 1 : 0)
            }
            .overlay(alignment: layoutDirection == .leftToRight ? .trailing : .leading) {
                fade(left: false).opacity(edges.right ? 1 : 0)
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: edges)
    }

    private func fade(left: Bool) -> some View {
        let background = Color(.systemGroupedBackground)
        let fromLeading = left == (layoutDirection == .leftToRight)
        return LinearGradient(colors: [background, background.opacity(0)],
                              startPoint: fromLeading ? .leading : .trailing,
                              endPoint: fromLeading ? .trailing : .leading)
            .frame(width: 20)
            .allowsHitTesting(false).accessibilityHidden(true)
    }
}

private struct AtlasEntryRow: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let entry: AtlasEntry
    let project: String?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var detail: String? {
        if entry.kind == "bookmark", let host = entry.webURL?.host?.lowercased() {
            return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        }
        if entry.kind == "page", let preview = entry.preview {
            let text = (try? AttributedString(markdown: preview)).map { String($0.characters) } ?? preview
            let summary = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            return summary.isEmpty ? nil : summary
        }
        guard entry.kind == "file" || entry.kind == "image" else { return nil }
        let name = entry.fileName ?? entry.title
        let suffix = (name as NSString).pathExtension
        let type = !suffix.isEmpty && suffix.count <= 10 ? suffix.uppercased() : entry.mimeType?.split(separator: "/").last.map { $0.uppercased() }
        let size = entry.byteSize.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }
        let info = [type, size].compactMap { $0 }.joined(separator: " · ")
        return info.isEmpty ? nil : info
    }
    var body: some View {
        let date = ISO8601DateFormatter.atlasDate(entry.date)
        let detail = self.detail
        HStack(alignment: .center, spacing: 10) {
            Group {
                if entry.kind == "image", let reference = entry.file {
                    AtlasListImage(session: session, reference: reference, revision: entry.date)
                }
                else if let icon = entry.icon { RegistryIcon(token: icon, size: 22, tint: .secondary) }
                else { RegistryIcon(token: "icon:" + (atlasTypes.first { $0.0 == entry.kind }?.2 ?? "document"), size: 22, tint: .secondary) }
            }.frame(width: 36, height: 36).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(entry.title).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                    if entry.isFavorite { Image(systemName: "star.fill").font(.caption).foregroundStyle(.yellow).accessibilityLabel("Favorite") }
                }
                TimelineView(.periodic(from: .now, by: 60)) { clock in
                    Text([date.map { compactRelativeAge($0, now: clock.date) }, detail, project].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption2).foregroundStyle(.secondary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                        .accessibilityLabel([date.map { $0.formatted(date: .abbreviated, time: .shortened) }, project, detail].compactMap { $0 }.joined(separator: ", "))
                }
                if let tags = entry.tags, !tags.isEmpty {
                    Text(tags.map { "#" + $0.name }.joined(separator: "  ")).font(.caption2).foregroundStyle(.secondary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                        .accessibilityLabel("Tags: " + tags.map(\.name).joined(separator: ", "))
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                .padding(.leading, 8).accessibilityHidden(true)
        }.frame(minHeight: AppListStyle.minimumContentHeight).contentShape(.rect)
    }
}

private struct AtlasListImage: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let reference: AtlasFileReference
    let revision: String
    @State private var visible = false
    @State private var image: UIImage?
    private var loadKey: String { "\(reference.hashValue):\(revision):\(session.ownership):\(session.connection):\(session.atlasRevision):\(visible)" }
    var body: some View {
        ZStack {
            Color(.tertiarySystemGroupedBackground)
            if let image { Image(uiImage: image).resizable().scaledToFill() }
            else { RegistryIcon(token: "icon:atlas-image", size: 22, tint: .secondary) }
        }
        .frame(width: 36, height: 36).clipShape(.rect(cornerRadius: 8))
        .onScrollVisibilityChange(threshold: 0.01) { visible = $0 }
        .task(id: loadKey) {
            image = nil
            guard visible, session.isConnected else { return }
            let owner = session.ownership
            do {
                let preview = try await session.readAtlasImage(reference)
                try Task.checkCancellation()
                guard owner == session.ownership, let data = preview.data,
                      let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceThumbnailMaxPixelSize: 128,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                      ] as CFDictionary) else { return }
                image = UIImage(cgImage: thumbnail)
            } catch { /* Keep the category icon when a preview is unavailable. */ }
        }
        .onDisappear { image = nil }
    }
}

struct AtlasPageView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
    @ScaledMetric(relativeTo: .largeTitle) private var iconSize: CGFloat = 64
    private var key: String { "\(pageID):\(offset):\(reload):\(session.ownership):\(session.connection)" }
    var body: some View {
        GeometryReader { geometry in
          ScrollView {
            VStack(alignment: .leading, spacing: 0) {
              if let content, error == nil { pageHeader(content, width: geometry.size.width) }
              VStack(alignment: .leading, spacing: 20) {
                if let error {
                    ContentUnavailableView("Couldn’t read page", systemImage: "doc.text", description: Text(error))
                    Button("Refresh page", action: refresh).frame(maxWidth: .infinity)
                } else if let content {
                    AtlasPageBody(session: session, page: content) { id in
                        file = AtlasFileSelection(reference: .saved(id), owner: session.ownership)
                    }.accessibilityIdentifier("atlasPageContent")
                    let otherFiles = content.embeddedFiles.filter { !content.inlineImageIDs.contains($0) }
                    if !otherFiles.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Files in this part").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                            ForEach(Array(otherFiles.enumerated()), id: \.element) { index, id in
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
              }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 24).padding(.bottom, 24)
            }.frame(maxWidth: .infinity, alignment: .leading)
          }
          .id(offset)
          .ignoresSafeArea(.container, edges: content?.coverFileId != nil && error == nil ? .top : [])
          .refreshable { refresh() }
        }
        .background(Color(.systemBackground))
        .navigationTitle("").navigationBarTitleDisplayMode(.inline).toolbarRole(.editor)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {} label: { Image(systemName: "ellipsis") }
                    .disabled(true).accessibilityLabel("Page options").accessibilityIdentifier("atlasPageOptions")
            }
        }
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
            let owner = session.ownership
            guard session.isConnected else { error = "Connect to your computer to read this page."; return }
            do {
                let result = try await session.atlasPage(pageID, offset: offset, version: version)
                try Task.checkCancellation()
                guard owner == session.ownership else { return }
                version = result.version; content = result
            } catch { if !Task.isCancelled && owner == session.ownership { self.error = error.localizedDescription } }
        }
    }
    private func pageHeader(_ page: AtlasPageContent, width: CGFloat) -> some View {
        let icon = page.icon.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        return VStack(alignment: .leading, spacing: 0) {
            if let cover = page.coverFileId {
                AtlasPageCoverView(session: session, pageID: pageID, coverFileID: cover)
                    .frame(height: min(280, max(208, width * 0.56)))
            }
            VStack(alignment: .leading, spacing: 20) {
                if let icon { RegistryIcon(token: icon, size: iconSize, tint: .primary) }
                Text(page.title).font(.largeTitle.bold()).textSelection(.enabled)
                    .accessibilityAddTraits(.isHeader).accessibilityIdentifier("atlasPageTitle")
            }
            .padding(.horizontal, 24)
            .padding(.top, page.coverFileId != nil ? (icon != nil ? -28 : 20) : (icon != nil ? 24 : 12))
            .padding(.bottom, 24)
        }
    }
    private func refresh() { version = nil; offset = 0; previous = []; reload += 1 }
}

private struct AtlasPageBody: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let page: AtlasPageContent
    let openImage: (String) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(page.sections.enumerated()), id: \.offset) { _, section in
                switch section {
                case .markdown(let text): ChatMessageBody(text: text, presentation: .atlas)
                case .image(let reference):
                    AtlasPageInlineImage(session: session, pageID: page.id, version: page.version, reference: reference) { openImage(reference.fileId) }
                }
            }
        }
    }
}

private struct AtlasPageInlineImage: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let pageID: String
    let version: Int
    let reference: AtlasPageImageReference
    let open: () -> Void
    @State private var visible = false
    @State private var image: UIImage?
    @State private var failed = false
    @State private var retry = 0
    private var key: String { "\(pageID):\(version):\(reference.fileId):\(session.ownership):\(session.connection):\(visible):\(retry)" }
    private var label: String { reference.caption.isEmpty ? "Image" : reference.caption }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { if failed { retry += 1 } else { open() } } label: {
                ChatImageFrame(widthLimit: .infinity, heightLimit: 320, fixedHeight: false) {
                    ZStack {
                        Color(.secondarySystemBackground)
                        if let image { Image(uiImage: image).resizable().scaledToFit() }
                        else if failed {
                            VStack(spacing: 8) {
                                Image(systemName: "photo").font(.title2)
                                Text("Tap to retry").font(.caption)
                            }.foregroundStyle(.secondary)
                        } else { ProgressView() }
                    }
                }.clipShape(.rect(cornerRadius: 12))
            }
            .buttonStyle(ChatPressStyle()).disabled(!session.isConnected)
            .accessibilityLabel(label).accessibilityHint(failed ? "Retry image preview" : "Open full image")
            .accessibilityIdentifier("atlasPageImage-" + reference.fileId)
            .contextMenu { Button("Open image", systemImage: "arrow.up.right", action: open) }
            if !reference.caption.isEmpty { Text(reference.caption).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
        }
        .onScrollVisibilityChange(threshold: 0.01) { visible = $0 }
        .task(id: key) {
            image = nil; failed = false
            guard visible, session.isConnected else { return }
            let owner = session.ownership
            do {
                let result = try await session.readAtlasPageImage(pageID, fileID: reference.fileId, version: version)
                try Task.checkCancellation()
                guard owner == session.ownership, let data = result.data,
                      let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let preview = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceThumbnailMaxPixelSize: 768,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                      ] as CFDictionary) else { throw MainsError.invalidReply }
                image = UIImage(cgImage: preview)
            } catch { if !Task.isCancelled && owner == session.ownership { failed = true } }
        }
        .onDisappear { image = nil }
    }
}

private struct AtlasPageCoverView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let pageID: String
    let coverFileID: String
    @State private var visible = false
    @State private var image: UIImage?
    private var key: String { "\(pageID):\(coverFileID):\(session.ownership):\(session.connection):\(visible)" }
    var body: some View {
        GeometryReader { bounds in
            ZStack {
                Color(.secondarySystemBackground)
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                        .frame(width: bounds.size.width, height: bounds.size.height)
                }
            }.frame(width: bounds.size.width, height: bounds.size.height).clipped()
        }
        .accessibilityHidden(true)
        .onScrollVisibilityChange(threshold: 0.01) { visible = $0 }
        .task(id: key) {
            image = nil
            guard visible, session.isConnected else { return }
            let owner = session.ownership
            do {
                let preview = try await session.readAtlasPageCover(pageID, coverFileID: coverFileID)
                try Task.checkCancellation()
                guard owner == session.ownership, let data = preview.data,
                      let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let cover = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceThumbnailMaxPixelSize: 768,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                      ] as CFDictionary) else { return }
                image = UIImage(cgImage: cover)
            } catch { /* The Page remains readable if its decorative cover cannot load. */ }
        }
        .onDisappear { image = nil }
    }
}

private struct AtlasBookmarkView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
                    if let file, let source = AtlasSaveSource.file(file) { AtlasSaveButton(session: session, source: source, owner: selection.owner) }
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
