import SwiftUI
import QuickLook
import UniformTypeIdentifiers

struct OutputsView: View {
    let session: BackendSession
    let runID: String
    @State private var page: RunOutputsPage?
    @State private var offset = 0
    @State private var previous: [Int] = []
    @State private var loading = false
    @State private var error: String?
    @State private var selection: RunOutput?
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
                                Text(output.byteSize > output.previewLimit ? "Larger than the phone preview limit" : ByteCountFormatter.string(fromByteCount: Int64(output.byteSize), countStyle: .file))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }.padding(.vertical, 5)
                    }.disabled(output.byteSize > output.previewLimit || !session.isConnected)
                        .accessibilityIdentifier("output-\(output.id)")
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
        loading = true; error = nil
        defer { loading = false }
        do {
            let result = try await session.listOutputs(runID, offset: offset)
            try Task.checkCancellation(); page = result
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

struct OutputPreviewView: View {
    let session: BackendSession
    private let output: RunOutput?
    private let media: TranscriptMedia?
    init(session: BackendSession, output: RunOutput) { self.session = session; self.output = output; media = nil }
    init(session: BackendSession, media: TranscriptMedia) { self.session = session; self.media = media; output = nil }
    private var name: String { output?.name ?? media?.name ?? "Attachment" }
    @Environment(\.dismiss) private var dismiss
    @State private var url: URL?
    @State private var folder: URL?
    @State private var error: String?
    @State private var text: String?
    @State private var markdown = false
    @State private var progress = 0.0
    @State private var retry = 0
    var body: some View {
        NavigationStack {
            Group {
                if let text {
                    ScrollView {
                        Group {
                            if markdown { ChatMessageBody(text: text) }
                            else { Text(text).font(.system(.body, design: .monospaced)).textSelection(.enabled) }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
                    }.accessibilityIdentifier("outputTextPreview")
                } else if let url { OutputQuickLook(url: url).accessibilityIdentifier("outputPreview") }
                else if let error {
                    ContentUnavailableView {
                        Label("Couldn’t open output", systemImage: "doc.badge.ellipsis")
                    } description: { Text(error) } actions: {
                        Button("Try again") { retry += 1 }
                    }
                } else { VStack(spacing: 16) { ProgressView(value: progress).frame(maxWidth: 180); Text("Opening \(name)…").font(.footnote).foregroundStyle(.secondary) } }
            }
            .navigationTitle(name).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close preview", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    if let url { ShareLink(item: url) { Label("Share output", systemImage: "square.and.arrow.up") }.accessibilityIdentifier("shareOutput") }
                }
            }
        }
        .task(id: retry) { await download() }
        .onDisappear { cleanup() }
        .onChange(of: session.ownership) { _, _ in cleanup(); dismiss() }
    }
    private func cleanup() { if let folder { try? FileManager.default.removeItem(at: folder) }; folder = nil; url = nil; text = nil }
    private func download() async {
        cleanup(); error = nil; progress = 0
        do {
            let bytes: Data
            var fileName = name
            var previewType = "native"
            if let media, media.image {
                let image = try await session.readImage(media, maxSide: 1600)
                guard let data = image.data else { throw MainsError.invalidReply }
                bytes = data
                let ext = UTType(mimeType: image.mime)?.preferredFilenameExtension ?? "jpg"
                fileName = (TranscriptMedia.fileName(name) as NSString).deletingPathExtension + "." + ext
            } else if let media, case .attachment = media.source {
                let file = try await session.describeAttachment(media)
                guard file.previewType != "unsupported" else { throw MainsError.server("Open this file in Mains on your computer.") }
                bytes = try await session.downloadAttachment(file) { progress = $0 }
                fileName = file.name; previewType = file.previewType
            } else {
                let selected: RunOutput
                if let output, retry == 0 { selected = output }
                else {
                    let runID = output?.runId ?? media?.runID ?? ""
                    let artifactID: Int
                    if let output { artifactID = output.artifactId }
                    else if let media, case .artifact(let id) = media.source { artifactID = id }
                    else { throw MainsError.server("This older attachment has no downloadable preview.") }
                    guard let current = try await session.listOutputs(runID, artifactID: artifactID).items.first,
                          current.runId == runID, current.artifactId == artifactID else { throw MainsError.server("This output is no longer available.") }
                    selected = current
                }
                guard selected.previewType != "unsupported" else { throw MainsError.server("Open this file in Mains on your computer.") }
                bytes = try await session.downloadOutput(selected) { progress = $0 }
                fileName = selected.name; previewType = selected.previewType
            }
            try Task.checkCancellation()
            let destination = FileManager.default.temporaryDirectory.appendingPathComponent("mains-output-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            folder = destination
            let name = TranscriptMedia.fileName(fileName)
            let file = destination.appendingPathComponent(name.isEmpty || [".", ".."].contains(name) ? "Output" : name)
            try bytes.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            markdown = previewType == "markdown"
            if ["text", "markdown"].contains(previewType) {
                text = String(data: bytes, encoding: .utf8)
            }
            url = file
        } catch {
            cleanup()
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }
}

private struct OutputQuickLook: UIViewControllerRepresentable {
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
