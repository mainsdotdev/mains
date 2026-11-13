import SwiftUI

struct ConversationOutputSelection: Identifiable {
    enum Source { case output(RunOutput), media(TranscriptMedia), linkedFile(RunLinkedFileSelection) }
    let id = UUID()
    let source: Source
    let owner: Int
    var title: String {
        switch source {
        case .output(let file): file.name
        case .media(let file): file.name
        case .linkedFile(let file): RunFileReference(file.href, relativeTo: file.base)?.name ?? "File"
        }
    }
}

struct OpenConversationOutputAction {
    var action: (String, ConversationOutputSelection.Source) -> Bool = { _, _ in false }
    func callAsFunction(_ runID: String, _ source: ConversationOutputSelection.Source) -> Bool { action(runID, source) }
}
extension EnvironmentValues {
    @Entry var openConversationOutput = OpenConversationOutputAction()
}

struct ConversationOutputsPane: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let runID: String
    let owner: Int
    @Binding var selection: ConversationOutputSelection?
    let close: () -> Void
    @State private var page: RunOutputsPage?
    @State private var offset = 0
    @State private var previous: [Int] = []
    @State private var loading = false
    @State private var error: String?
    @State private var reload = 0
    @State private var readID = UUID()
    private var run: Conversation? { session.conversations.first { $0.id == runID } }
    private var key: String {
        let files = session.transcript.page?.artifacts.filter { ["document", "file", "image", "visualization"].contains($0.kind) }.map { String($0.id) }.joined(separator: ",") ?? ""
        return "\(offset):\(session.connection):\(run?.updatedAt.timeIntervalSince1970 ?? 0):\(run?.status ?? ""):\(files):\(reload)"
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Menu {
                    if loading { Text("Loading outputs…") }
                    ForEach(page?.items ?? []) { output in
                        Button(output.name, systemImage: output.previewType == "image" ? "photo" : "doc.text") {
                            selection = ConversationOutputSelection(source: .output(output), owner: owner)
                        }.disabled(output.byteSize > output.downloadLimit || !session.isConnected)
                    }
                    if !previous.isEmpty { Button("Previous outputs") { if let last = previous.popLast() { offset = last } }.disabled(loading) }
                    if let next = page?.nextOffset, previous.count < 128 {
                        Button("More outputs") { previous.append(offset); offset = next }.disabled(loading)
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "doc.on.doc")
                        Text(selection?.title ?? "Outputs").lineLimit(1).truncationMode(.middle)
                        Image(systemName: "chevron.down").font(.caption2)
                    }.font(.subheadline.weight(.medium)).frame(minHeight: 44)
                }.accessibilityLabel("Choose output").accessibilityIdentifier("chooseCompanionOutput")
                Spacer(minLength: 0)
                Button { reload += 1 } label: { Image(systemName: "arrow.clockwise").frame(width: 44, height: 44).contentShape(.rect) }
                    .accessibilityLabel("Refresh outputs").disabled(loading || !session.isConnected)
                Button(action: close) { Image(systemName: "xmark").frame(width: 44, height: 44).contentShape(.rect) }
                    .accessibilityLabel("Close outputs").accessibilityIdentifier("closeCompanionOutput")
            }.padding(.horizontal, 16).padding(.vertical, 4).background(.bar)
            Divider()
            if let selection, selection.owner == session.ownership {
                preview(selection).id(selection.id).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if loading {
                ProgressView("Loading outputs…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView("No outputs yet", systemImage: "doc.on.doc", description: Text("Files from this conversation appear here."))
            }
            if let error {
                HStack {
                    Text(error).font(.caption).foregroundStyle(.secondary)
                    Button("Try again") { reload += 1 }.disabled(loading || !session.isConnected)
                }.padding(12)
            }
        }
        .background(Color(.systemBackground))
        .overlay(alignment: .leading) { Rectangle().fill(.separator).frame(width: 0.5).allowsHitTesting(false) }
        .task(id: key) { await load() }
        .onDisappear { readID = UUID() }
        .accessibilityIdentifier("conversationOutputsPane")
    }
    @ViewBuilder private func preview(_ selection: ConversationOutputSelection) -> some View {
        switch selection.source {
        case .output(let output): OutputPreviewView(session: session, output: output, embedded: true)
        case .media(let media): OutputPreviewView(session: session, media: media, embedded: true)
        case .linkedFile(let file): OutputPreviewView(session: session, linkedFile: file, embedded: true)
        }
    }
    private func load() async {
        let ticket = UUID(); readID = ticket
        let requested = offset
        loading = true; error = nil
        defer { if readID == ticket { loading = false } }
        do {
            guard owner == session.ownership else { throw MainsError.changedBackend }
            let next = try await session.availableOutputs(runID, offset: requested)
            try Task.checkCancellation()
            guard ticket == readID, requested == offset, owner == session.ownership else { return }
            page = next
            if selection == nil, let first = next.items.first(where: { $0.byteSize <= $0.downloadLimit }) {
                selection = ConversationOutputSelection(source: .output(first), owner: owner)
            }
        } catch { if ticket == readID, !Task.isCancelled, owner == session.ownership { self.error = error.localizedDescription } }
    }
}
