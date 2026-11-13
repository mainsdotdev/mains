import SwiftUI
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
    @State private var pageOwner: Int?
    var body: some View {
        ComposerSheet(title: "Outputs") {
            List {
                if loading { HStack { ProgressView(); Text("Loading outputs…").foregroundStyle(.secondary) } }
                if let error {
                    Text(error).foregroundStyle(.secondary)
                    Button("Try again") { Task { await load() } }
                }
                if page?.items.isEmpty == true { Text("No outputs yet.").foregroundStyle(.secondary) }
                ForEach(page?.items ?? []) { output in
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
                if !previous.isEmpty || page?.nextOffset != nil {
                    HStack {
                        Button("Previous") { if let last = previous.popLast() { offset = last } }.disabled(previous.isEmpty || loading)
                        Spacer()
                        Button("Next") { if let next = page?.nextOffset { previous.append(offset); offset = next } }.disabled(page?.nextOffset == nil || loading)
                    }
                }
            }.scrollContentBackground(.hidden).refreshable { await load() }.task(id: offset) { await load() }
        }
        .presentationDetents([.large])
        .sheet(item: $selection) { output in OutputPreviewView(session: session, output: output) }
    }
    private func load() async {
        let owner = session.ownership
        loading = true; error = nil
        defer { loading = false }
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
    private let embedded: Bool
    init(session: BackendSession, output: RunOutput, embedded: Bool = false) { self.session = session; self.output = output; media = nil; linkedFile = nil; self.embedded = embedded }
    init(session: BackendSession, media: TranscriptMedia, embedded: Bool = false) { self.session = session; self.media = media; output = nil; linkedFile = nil; self.embedded = embedded }
    init(session: BackendSession, linkedFile: RunLinkedFileSelection, embedded: Bool = false) { self.session = session; self.linkedFile = linkedFile; output = nil; media = nil; self.embedded = embedded }
    private var runID: String { output?.runId ?? media?.runID ?? linkedFile?.runID ?? "" }
    private var name: String { downloadedName ?? output?.name ?? media?.name ?? linkedFile.flatMap { RunFileReference($0.href)?.name } ?? "File" }
    @Environment(\.dismiss) private var dismiss
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
    @State private var loadedOwner: Int?
    var body: some View {
        Group {
            if embedded {
                previewContent.safeAreaInset(edge: .bottom, spacing: 0) {
                    HStack {
                        if let url { ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up").frame(minHeight: 44).contentShape(.rect) }.accessibilityIdentifier("shareOutput") }
                        Spacer()
                        if let atlasSource, let loadedOwner { AtlasSaveButton(session: session, source: atlasSource, owner: loadedOwner).frame(minHeight: 44).contentShape(.rect) }
                        Button { retry += 1 } label: { Image(systemName: "arrow.clockwise").frame(width: 44, height: 44).contentShape(.rect) }
                            .accessibilityLabel("Reload file").disabled(!session.isConnected)
                    }.font(.footnote).padding(.horizontal, 16).frame(minHeight: 48).background(.bar)
                }
            } else {
                NavigationStack {
                    previewContent
                        .navigationTitle(name).navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) { Button("Close preview", systemImage: "xmark") { dismiss() } }
                            ToolbarItem(placement: .topBarTrailing) {
                                if let url { ShareLink(item: url) { Label("Share output", systemImage: "square.and.arrow.up") }.accessibilityIdentifier("shareOutput") }
                            }
                            ToolbarItem(placement: .bottomBar) {
                                if let atlasSource, let loadedOwner { AtlasSaveButton(session: session, source: atlasSource, owner: loadedOwner) }
                            }
                        }
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
                    if ["text", "markdown"].contains(previewType) { LocalTextFilePreview(url: url, markdown: previewType == "markdown") }
                    else if previewType != "unsupported", QLPreviewController.canPreview(url as NSURL) { OutputQuickLook(url: url).accessibilityIdentifier("outputPreview") }
                    else {
                        ContentUnavailableView {
                            Label("File ready", systemImage: "doc.zipper")
                        } description: {
                            Text("A preview isn’t available for this file. Share it or save it to Files.")
                        } actions: {
                            ShareLink(item: url) { Label("Share or Save to Files", systemImage: "square.and.arrow.up") }
                                .accessibilityIdentifier("exportDownloadedFile")
                        }
                    }
                } else if let error {
                    ContentUnavailableView {
                        Label("Couldn’t open file", systemImage: "doc.badge.ellipsis")
                    } description: { Text(error) } actions: { Button("Try again") { retry += 1 } }
                } else { VStack(spacing: 16) { ProgressView(value: progress).frame(maxWidth: 180); Text("Opening \(name)…").font(.footnote).foregroundStyle(.secondary) } }
        }
    }
    private func cleanup() { if let folder { try? FileManager.default.removeItem(at: folder) }; folder = nil; url = nil }
    private func download() async {
        let ticket = UUID(); loadID = ticket
        let owner = session.ownership
        atlasSource = nil; loadedOwner = nil
        cleanup(); error = nil; progress = 0
        var destination: URL?
        do {
            if let linkedFile { guard linkedFile.owner == session.ownership else { throw MainsError.changedBackend } }
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
            loadedOwner = owner
        } catch {
            if let destination { try? FileManager.default.removeItem(at: destination) }
            if ticket == loadID { cleanup(); if !Task.isCancelled { self.error = error.localizedDescription } }
        }
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
