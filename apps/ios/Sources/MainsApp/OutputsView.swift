import SwiftUI
import AVKit
import QuickLook
import UniformTypeIdentifiers

struct OutputsView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let runID: String
    @State private var page: RunOutputsPage?
    @State private var offset = 0
    @State private var previous: [Int] = []
    @State private var loading = false
    @State private var error: String?
    @State private var selection: RunOutput?
    @State private var offlineSelection: OfflineFile?
    @State private var savedOutputs: [OfflineFile] = []
    @State private var pageOwner: Int?
    var body: some View {
        ComposerSheet(title: "Outputs") {
            List {
                if loading && page == nil { ContentSkeleton(label: "Loading outputs…").listRow }
                if let error {
                    Text(error).foregroundStyle(.secondary)
                    Button("Try again") { Task { await load() } }
                }
                if session.isConnected && page?.items.isEmpty == true { Text("No outputs yet.").foregroundStyle(.secondary) }
                if !session.isConnected && savedOutputs.isEmpty && !loading {
                    Text("No outputs saved on this iPhone.").foregroundStyle(.secondary)
                }
                ForEach(savedOutputs) { file in
                    Button { offlineSelection = file } label: { Label(file.name, systemImage: "arrow.down.circle") }
                }
                ForEach(session.isConnected ? page?.items ?? [] : []) { output in
                    Button { selection = output } label: {
                        HStack(spacing: 12) {
                            Image(systemName: output.previewType == "image" ? "photo" : "doc.text").foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(output.name).foregroundStyle(.primary)
                                Text(output.byteSize > output.downloadLimit ? "Larger than the 100 MB download limit" : ByteCountFormatter.string(fromByteCount: Int64(output.byteSize), countStyle: .file))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }.padding(.vertical, 5)
                    }.disabled(output.byteSize > output.downloadLimit || !session.isConnected)
                        .accessibilityIdentifier("output-\(output.id)")
                        .contextMenu { if let pageOwner, AtlasSaveSource.supports(output.name) { AtlasSaveButton(session: session, source: .output(output), owner: pageOwner) } }
                }
                if session.isConnected && (!previous.isEmpty || page?.nextOffset != nil) {
                    HStack {
                        Button("Previous") { if let last = previous.popLast() { offset = last } }.disabled(previous.isEmpty || loading)
                        Spacer()
                        Button("Next") { if let next = page?.nextOffset { previous.append(offset); offset = next } }.disabled(page?.nextOffset == nil || loading)
                    }
                }
            }.scrollContentBackground(.hidden).pullToRefresh { await load() }
                .task(id: "\(offset):\(session.isConnected):\(session.ownership)") { await load() }
        }
        .presentationDetents([.large])
        .fullScreenCover(item: $selection) { output in OutputPreviewView(session: session, output: output) }
        .fullScreenCover(item: $offlineSelection, onDismiss: { Task { await load() } }) { file in
            OutputPreviewView(session: session, savedFile: file)
        }
    }
    private func load() async {
        let owner = session.ownership
        loading = true; error = nil
        defer { loading = false }
        savedOutputs = []
        if !session.isConnected {
            let files = await session.savedOfflineOutputs(runID)
            guard !Task.isCancelled, owner == session.ownership, !session.isConnected else { return }
            savedOutputs = files
            return
        }
        do {
            let result = try await session.listOutputs(runID, offset: offset)
            try Task.checkCancellation()
            guard owner == session.ownership else { return }
            page = result; pageOwner = owner
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

struct OutputPreviewView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    private let output: RunOutput?
    private let media: TranscriptMedia?
    private let linkedFile: RunLinkedFileSelection?
    private let savedFile: OfflineFile?
    private let embedded: Bool
    init(session: BackendSession, output: RunOutput, embedded: Bool = false) { self.session = session; self.output = output; media = nil; linkedFile = nil; savedFile = nil; self.embedded = embedded }
    init(session: BackendSession, media: TranscriptMedia, embedded: Bool = false) { self.session = session; self.media = media; output = nil; linkedFile = nil; savedFile = nil; self.embedded = embedded }
    init(session: BackendSession, linkedFile: RunLinkedFileSelection, embedded: Bool = false) { self.session = session; self.linkedFile = linkedFile; output = nil; media = nil; savedFile = nil; self.embedded = embedded }
    init(session: BackendSession, savedFile: OfflineFile, embedded: Bool = false) { self.session = session; self.savedFile = savedFile; output = nil; media = nil; linkedFile = nil; self.embedded = embedded }
    private var runID: String { output?.runId ?? media?.runID ?? linkedFile?.runID ?? "" }
    private var name: String { downloadedName ?? savedFile?.name ?? output?.name ?? media?.name ?? linkedFile.flatMap { RunFileReference($0.href)?.name } ?? "File" }
    private var offlineKey: OfflineFileKey? {
        if let output { return .output(runID: output.runId, artifactID: output.artifactId) }
        guard let media else { return nil }
        switch media.source {
        case .artifact(let id): return .output(runID: media.runID, artifactID: id)
        case .attachment(let id): return .attachment(runID: media.runID, attachmentID: id)
        default: return nil
        }
    }
    @Environment(\.dismiss) private var dismiss
    @Environment(\.conversationOutputPaneVisible) private var outputPaneVisible
    @State private var url: URL?
    @State private var folder: URL?
    @State private var error: String?
    @State private var previewType = "unsupported"
    @State private var downloadedName: String?
    @State private var relativePath: String?
    @State private var progress = 0.0
    @State private var retry = 0
    @State private var loadID = UUID()
    @State private var atlasSource: AtlasSaveSource?
    @State private var offlineFile: OfflineFile?
    @State private var offlinePreview: PreviewExportFile?
    @State private var loadedOwner: Int?
    var body: some View {
        Group {
            if embedded {
                previewContent.overlay(alignment: .topTrailing) {
                    if let url, let loadedOwner {
                        FileOptionsMenu(url: url, image: previewType == "image", session: session, owner: loadedOwner,
                                        source: atlasSource, reload: { retry += 1 }, offlineFile: offlineFile)
                            .buttonStyle(.glass).padding(12)
                    }
                }
            } else {
                FilePreviewNavigation(name: name, url: url, previewType: previewType, session: session,
                                      source: atlasSource, owner: loadedOwner ?? session.ownership,
                                      reload: savedFile == nil ? { retry += 1 } : nil, offlineFile: offlineFile) {
                    previewContent
                }
            }
        }
        .runFileLinks(session: session, runID: runID, relativeTo: relativePath)
        .task(id: retry) { await download() }
        .onDisappear { loadID = UUID(); cleanup() }
        .onChange(of: session.ownership) { _, _ in loadID = UUID(); cleanup(); if !embedded { dismiss() } }
    }
    private var previewContent: some View {
        Group {
                if let url {
                    if previewType == "image" && !embedded { FullScreenFileImage(url: url) }
                    else if ["text", "markdown"].contains(previewType) { LocalTextFilePreview(url: url, markdown: previewType == "markdown") }
                    else if isVideoFile(url) { OutputVideoPreview(url: url, visible: outputPaneVisible).id(url) }
                    else if isAudioFile(url) && !outputPaneVisible { Color.clear }
                    else if previewType != "unsupported" || isAudioFile(url), QLPreviewController.canPreview(url as NSURL) {
                        OutputQuickLook(url: url).accessibilityIdentifier("outputPreview")
                    }
                    else {
                        EmptyStateView(artwork: .documents, title: "File ready",
                                       description: Text("A preview isn’t available for this file. Share it or save it to Files.")) {
                            ShareLink(item: url) { Label("Share or Save to Files", systemImage: "square.and.arrow.up") }
                                .accessibilityIdentifier("exportDownloadedFile")
                        }.centered
                    }
                } else if let error {
                    EmptyStateView(artwork: .documents, title: "Couldn’t open file", description: Text(error)) {
                        Button("Try again") { retry += 1 }
                    }.centered
                } else {
                    MediaSkeleton(symbol: "doc")
                        .accessibilityLabel("Opening \(name)").accessibilityValue(progress.formatted(.percent))
                }
        }
    }
    private func isAudioFile(_ url: URL) -> Bool { UTType(filenameExtension: url.pathExtension)?.conforms(to: .audio) == true }
    private func isVideoFile(_ url: URL) -> Bool {
        guard let type = UTType(filenameExtension: url.pathExtension) else { return false }
        return type.conforms(to: .movie) || type.conforms(to: .video)
    }
    private func cleanup() { if let folder { try? FileManager.default.removeItem(at: folder) }; folder = nil; url = nil; offlinePreview = nil }
    private func download() async {
        let ticket = UUID(); loadID = ticket
        let owner = session.ownership
        atlasSource = nil; loadedOwner = nil; offlineFile = nil
        cleanup(); error = nil; progress = 0
        var destination: URL?
        do {
            if let linkedFile { guard linkedFile.owner == session.ownership else { throw MainsError.changedBackend } }
            if savedFile != nil || !session.isConnected, let file = try await fileForOfflinePreview() {
                let reader = try await session.offlineFilePreview(file, owner: owner)
                guard ticket == loadID else { return }
                offlinePreview = reader; url = reader.url; offlineFile = file
                previewType = file.previewType; downloadedName = file.name; loadedOwner = owner; relativePath = nil
                return
            }
            var selected = output
            var linkedMarkdown: RunLinkedMarkdown?
            if let linkedFile {
                switch try await session.resolveFileReference(linkedFile.href, runID: runID, relativeTo: linkedFile.base) {
                case .output(let file): selected = file
                case .markdown(let document): linkedMarkdown = document
                }
            }
            var attachment: RunAttachmentFile?
            var imagePreview: ArtifactImage?
            if let media {
                if case .attachment = media.source { attachment = try await session.describeAttachment(media) }
                else if case .artifact(let id) = media.source {
                    selected = try await session.listOutputs(runID, artifactID: id).items.first
                    if selected?.artifactId != id || selected?.runId != runID {
                        selected = nil
                        if media.image { imagePreview = try await session.readImage(media, maxSide: 1600) }
                        else { throw MainsError.server("This output is no longer available.") }
                    }
                } else { throw MainsError.server("This older attachment has no downloadable file.") }
            } else if let file = selected, retry > 0 {
                selected = try await session.listOutputs(runID, artifactID: file.artifactId).items.first
                guard selected?.artifactId == file.artifactId, selected?.runId == runID else { throw MainsError.server("This output is no longer available.") }
            }
            try Task.checkCancellation()
            guard ticket == loadID, owner == session.ownership else { throw CancellationError() }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("mains-output-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            destination = directory; folder = directory
            let fileName = imagePreview.map { (TranscriptMedia.fileName(name) as NSString).deletingPathExtension + "." + (UTType(mimeType: $0.mime)?.preferredFilenameExtension ?? "jpg") }
                ?? TranscriptMedia.fileName(linkedMarkdown?.fileName ?? attachment?.name ?? selected?.name ?? name)
            let fileURL = directory.appendingPathComponent(fileName)
            if let imagePreview, let bytes = imagePreview.data {
                try bytes.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                previewType = "image"; relativePath = nil
            } else if let linkedMarkdown {
                try Data(linkedMarkdown.content.utf8).write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                previewType = "markdown"; relativePath = linkedMarkdown.relativePath
            } else if let attachment {
                try await session.downloadAttachment(attachment, to: fileURL) { if ticket == loadID { progress = $0 } }
                previewType = attachment.previewType; relativePath = attachment.name
            } else if let selected {
                try await session.downloadOutput(selected, to: fileURL) { if ticket == loadID { progress = $0 } }
                previewType = selected.previewType
                relativePath = linkedFile.flatMap { RunFileReference($0.href, relativeTo: $0.base)?.path } ?? selected.name
            } else { throw MainsError.invalidReply }
            try Task.checkCancellation()
            guard ticket == loadID else { throw CancellationError() }
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: fileURL.path)
            downloadedName = fileName; url = fileURL
            atlasSource = AtlasSaveSource.supports(fileName) ? selected.map(AtlasSaveSource.output) ?? attachment.map(AtlasSaveSource.attachment) : nil
            offlineFile = selected.map { OfflineFile($0) } ?? attachment.map { OfflineFile($0) }
            loadedOwner = owner
        } catch {
            if let destination { try? FileManager.default.removeItem(at: destination) }
            if ticket == loadID { cleanup(); if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }

    private func fileForOfflinePreview() async throws -> OfflineFile? {
        if let savedFile { return savedFile }
        guard let key = offlineKey else { return nil }
        guard let file = await session.savedOfflineFiles().first(where: { $0.key == key }) else {
            throw MainsError.server("This file isn’t saved on this iPhone.")
        }
        return file
    }
}

private struct OutputVideoPreview: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let url: URL
    let visible: Bool
    @State private var player: AVPlayer?
    @State private var failed = false
    @State private var started = false

    var body: some View {
        Group {
            if let player {
                OutputVideoPlayer(player: player, visible: visible)
                    .accessibilityIdentifier("outputPreview")
                    .overlay {
                        if !started {
                            Button("Play video", systemImage: "play.fill") { player.play() }
                                .labelStyle(.iconOnly).font(.title2)
                                .frame(minWidth: 56, minHeight: 56)
                                .buttonBorderShape(.circle).buttonStyle(.glass)
                                .environment(\.colorScheme, .dark)
                        }
                    }
                    .onReceive(player.publisher(for: \.timeControlStatus)) { status in
                        if status == .playing { started = true }
                    }
            } else if failed {
                EmptyStateView(artwork: .documents, title: "Video preview unavailable",
                               description: Text("Share or save the file to open it in another app.")).centered
            } else {
                MediaSkeleton(symbol: "film").accessibilityLabel("Opening video")
            }
        }
        .task(id: url) {
            let asset = AVURLAsset(url: url)
            let playable = (try? await asset.load(.isPlayable)) == true
            guard !Task.isCancelled else { return }
            if playable { player = AVPlayer(playerItem: AVPlayerItem(asset: asset)) }
            else { failed = true }
        }
    }
}

private struct OutputVideoPlayer: UIViewControllerRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let player: AVPlayer
    let visible: Bool
    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.allowsPictureInPicturePlayback = false
        return controller
    }
    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
        if !visible { player.pause() }
    }
    static func dismantleUIViewController(_ controller: AVPlayerViewController, coordinator: Void) {
        controller.player?.pause()
        controller.player = nil
    }
}

struct OutputQuickLook: UIViewControllerRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController(); controller.dataSource = context.coordinator; return controller
    }
    func updateUIViewController(_ controller: QLPreviewController, context: Context) {}
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem { url as NSURL }
    }
}

/// A full-screen file reader, with local export separate from permanent Atlas storage.
struct FilePreviewNavigation<Content: View>: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let name: String
    let url: URL?
    let previewType: String
    let session: BackendSession
    let source: AtlasSaveSource?
    let owner: Int
    var savedInAtlas = false
    var openSourceChat: (() -> Void)? = nil
    var reload: (() -> Void)? = nil
    var offlineFile: OfflineFile? = nil
    @ViewBuilder let content: Content
    @Environment(\.dismiss) private var dismiss
    private var image: Bool { previewType == "image" }
    var body: some View {
        NavigationStack {
            reader
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(image ? Color.black : Color(.systemBackground))
                .expandedNavigationTitle(image ? "" : name)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button("Close preview", systemImage: "xmark") { dismiss() } }
                    ToolbarItem(placement: .topBarTrailing) {
                        if let url { FileOptionsMenu(url: url, image: image, session: session, owner: owner, source: source,
                                                     savedInAtlas: savedInAtlas, openSourceChat: openSourceChat, reload: reload, offlineFile: offlineFile) }
                    }
                }
        }
        .safeAreaPadding(.top, AppNavigationStyle.topInset)
        .background(image ? Color.black : Color(.systemBackground))
        .preferredColorScheme(image ? .dark : nil)
    }

    @ViewBuilder private var reader: some View {
        if ["text", "markdown"].contains(previewType) {
            content.navigationHeaderFade()
        } else {
            content.toolbarBackground(image ? .hidden : .automatic, for: .navigationBar)
        }
    }
}

struct FileOptionsMenu: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let url: URL
    let image: Bool
    let session: BackendSession
    let owner: Int
    var source: AtlasSaveSource? = nil
    var savedInAtlas = false
    var openSourceChat: (() -> Void)? = nil
    var reload: (() -> Void)? = nil
    var offlineFile: OfflineFile? = nil
    @State private var keptOffline: Bool?
    @State private var changingOffline = false
    @State private var retention: Bool?
    @State private var retentionError: String?
    @State private var retryRetention = 0
    private var readKey: String { "\(String(describing: source)):\(owner):\(session.ownership):\(session.isConnected):\(session.atlasRevision):\(retryRetention)" }
    @State private var photos = PreviewPhotoSaver()
    @State private var export: PreviewExportFile?
    @State private var preparing = false
    @State private var error: String?
    @State private var permissionDenied = false
    @State private var operation = UUID()
    var body: some View {
        Menu {
            if image {
                Button(photos.saving ? "Saving…" : photos.savedURL == url ? "Saved to Photos" : "Save image to Photos",
                       systemImage: photos.savedURL == url ? "checkmark" : "arrow.down.to.line") { savePhoto() }
                    .disabled(photos.saving || preparing || photos.savedURL == url)
                    .accessibilityIdentifier("saveImageToPhotos")
            }
            Button(preparing ? "Preparing…" : "Save to Files", systemImage: "folder") { exportFile() }
                .disabled(photos.saving || preparing).accessibilityIdentifier("saveFileToFiles")
            ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }.accessibilityIdentifier("shareOutput")
            if let offlineFile, session.canKeepFilesOffline, let keptOffline {
                Button(keptOffline ? "Remove Offline Copy" : "Keep Offline",
                       systemImage: keptOffline ? "trash" : "arrow.down.circle") {
                    changeOffline(offlineFile, remove: keptOffline)
                }.disabled(changingOffline).accessibilityIdentifier("keepFileOffline")
            }
            if let source, session.isConnected {
                if retentionError != nil {
                    Button("Retry Atlas check", systemImage: "arrow.clockwise") { retryRetention += 1 }.disabled(!session.isConnected)
                } else if let retention {
                    AtlasSaveButton(session: session, source: source, owner: owner, knownSaved: retention,
                                    onFailure: { permissionDenied = false; error = $0 })
                } else {
                    Button {} label: { Label("Keep in Atlas", image: "registry-globe") }.disabled(true)
                        .accessibilityValue("Checking Atlas")
                }
            } else if savedInAtlas { Label("Saved in Atlas", systemImage: "checkmark") }
            if let openSourceChat { Button("Open chat with source", systemImage: "bubble.left", action: openSourceChat) }
            if let reload { Button("Reload file", systemImage: "arrow.clockwise", action: reload).disabled(!session.isConnected) }
        } label: {
            Label("File options", systemImage: "ellipsis")
        }
        .labelStyle(.iconOnly)
        .buttonBorderShape(.circle)
        .accessibilityLabel("File options").accessibilityIdentifier("fileOptions")
        .disabled(owner != session.ownership)
        .task(id: "\(owner):\(offlineFile?.version ?? ""):\(url)") {
            keptOffline = nil
            guard let offlineFile, session.canKeepFilesOffline else { return }
            let saved = await session.savedOfflineFiles()
            if !Task.isCancelled, owner == session.ownership {
                keptOffline = saved.contains { $0.key == offlineFile.key && $0.version == offlineFile.version }
            }
        }
        .task(id: readKey) {
            guard let source, owner == session.ownership, session.isConnected else { return }
            retentionError = nil
            do {
                let saved = try await session.atlasSaveStatus(source, owner: owner)
                try Task.checkCancellation()
                if owner == session.ownership { retention = saved ?? false }
            } catch { if !Task.isCancelled, owner == session.ownership { retentionError = error.localizedDescription } }
        }
        .sheet(item: $export) { file in DocumentFileExport(file: file) { export = nil } }
        .alert(permissionDenied ? "Photo access needed" : "Couldn’t save file", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            if permissionDenied { Button("Open Settings") { if let settings = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(settings) } } }
            if image { Button("Save to Files") { exportFile() } }
            Button("OK", role: .cancel) {}
        } message: { Text(error ?? "") }
        .sensoryFeedback(.success, trigger: photos.savedURL)
        .onDisappear { operation = UUID() }
        .onChange(of: session.ownership) { _, _ in operation = UUID(); export = nil; error = nil }
    }
    private func changeOffline(_ file: OfflineFile, remove: Bool) {
        changingOffline = true
        Task {
            defer { changingOffline = false }
            do {
                if remove { try await session.removeOffline(file, owner: owner) }
                else { try await session.keepOffline(file, copying: url, owner: owner) }
                if owner == session.ownership { keptOffline = !remove }
            } catch {
                if owner == session.ownership { permissionDenied = false; self.error = error.localizedDescription }
            }
        }
    }
    private func savePhoto() {
        guard owner == session.ownership, !photos.saving else { return }
        let ticket = UUID(); operation = ticket; permissionDenied = false
        Task {
            do { try await photos.save(url) { operation == ticket && owner == session.ownership } }
            catch {
                guard operation == ticket, owner == session.ownership, !(error is CancellationError) else { return }
                permissionDenied = (error as? PhotoLibrarySaveError) == .denied
                self.error = error is PhotoLibrarySaveError ? error.localizedDescription : "This image couldn’t be saved to Photos. You can save the original to Files instead."
            }
        }
    }
    private func exportFile() {
        guard owner == session.ownership, !preparing else { return }
        let ticket = UUID(); operation = ticket; preparing = true; permissionDenied = false
        Task {
            defer { if operation == ticket { preparing = false } }
            do {
                let file = try await Task.detached(priority: .userInitiated) { try PreviewExportFile(copying: url) }.value
                guard operation == ticket, owner == session.ownership else { return }
                export = file
            } catch { if operation == ticket, owner == session.ownership { self.error = error.localizedDescription } }
        }
    }
}

struct DocumentFileExport: UIViewControllerRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let file: PreviewExportFile
    let finished: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(file: file, finished: finished) }
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forExporting: [file.url], asCopy: true)
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}
    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let file: PreviewExportFile
        let finished: () -> Void
        init(file: PreviewExportFile, finished: @escaping () -> Void) { self.file = file; self.finished = finished }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finished() }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finished() }
    }
}
