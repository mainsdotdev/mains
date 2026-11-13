import SwiftUI

struct RunLinkedFileSelection: Identifiable {
    let id = UUID()
    let runID: String
    let href: String
    let base: String?
    let owner: Int
}

extension View {
    func runFileLinks(session: BackendSession, runID: String, relativeTo base: String? = nil) -> some View {
        modifier(RunFileLinkHost(session: session, runID: runID, base: base))
    }
}

private struct RunFileLinkHost: ViewModifier {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let runID: String
    let base: String?
    @Environment(\.openConversationOutput) private var openCompanion
    @State private var selection: RunLinkedFileSelection?
    func body(content: Content) -> some View {
        content.environment(\.openURL, OpenURLAction { url in
            if ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") { return .systemAction }
            guard RunFileReference(url.relativeString, relativeTo: base) != nil else { return .discarded }
            let file = RunLinkedFileSelection(runID: runID, href: url.relativeString, base: base, owner: session.ownership)
            if !openCompanion(runID, .linkedFile(file)) { selection = file }
            return .handled
        })
        .sheet(item: $selection) { OutputPreviewView(session: session, linkedFile: $0) }
        .onChange(of: session.ownership) { _, _ in selection = nil }
    }
}

struct LocalTextFilePreview: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let url: URL
    let markdown: Bool
    @State private var page: LocalTextFilePage?
    @State private var offset = 0
    @State private var previous: [Int] = []
    @State private var error: String?
    var body: some View {
        ScrollView {
            if let page {
                Group {
                    if markdown { ChatMessageBody(text: page.text) }
                    else { Text(page.text).font(.system(.body, design: .monospaced)).textSelection(.enabled) }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
            } else if let error { ContentUnavailableView("Preview unavailable", systemImage: "doc", description: Text(error)) }
            else { ProgressView().padding() }
        }
        .id(offset)
        .accessibilityIdentifier("outputTextPreview")
        .safeAreaInset(edge: .bottom) {
            if !previous.isEmpty || page?.nextOffset != nil {
                HStack {
                    Button("Previous") { if let last = previous.popLast() { offset = last } }.disabled(previous.isEmpty)
                    Spacer()
                    Text("Byte \(offset + 1)").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Next") { if let next = page?.nextOffset { previous.append(offset); offset = next } }.disabled(page?.nextOffset == nil)
                }.padding().background(.bar)
            }
        }
        .task(id: offset) {
            page = nil; error = nil
            do {
                let file = url, start = offset
                let result = try await Task.detached(priority: .userInitiated) { try LocalTextFilePage.read(file, offset: start) }.value
                try Task.checkCancellation(); page = result
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }
}
