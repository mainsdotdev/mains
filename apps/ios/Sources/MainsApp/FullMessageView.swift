import SwiftUI

struct FullMessageView: View {
    let session: BackendSession
    let artifactID: Int
    var source = "artifact"
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var offset = 0
    @State private var next: Int?
    @State private var previous: [Int] = []
    @State private var error: String?
    @State private var loading = false
    var body: some View {
        ScrollView { Text(text).font(source == "artifact" ? .body : .system(.callout, design: .monospaced)).textSelection(.enabled).padding(20).frame(maxWidth: .infinity, alignment: .leading) }
            .overlay { if loading { ProgressView() } }
            .safeAreaInset(edge: .bottom) {
                VStack {
                    if let error { Text(error).font(.caption).foregroundStyle(.red) }
                    HStack {
                        Button("Previous") { if let last = previous.popLast() { offset = last } }.disabled(previous.isEmpty || loading)
                        Spacer()
                        if error != nil { Button("Retry") { Task { await load() } } }
                        Text("Character \(offset + 1)").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Next") { if let next { previous.append(offset); offset = next } }.disabled(next == nil || loading)
                    }
                }.padding().background(.bar)
            }
            .navigationTitle(source == "tool-output" ? "Tool output" : source == "tool-input" ? "Tool input" : "Full message").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task(id: offset) { await load() }
            .onChange(of: session.ownership) { _, _ in text = ""; dismiss() }
    }
    private func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let result = try await session.readContent(artifactID: artifactID, offset: offset, source: source)
            try Task.checkCancellation()
            text = result["text"].string ?? ""
            next = result["nextOffset"].number.map(Int.init)
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}
