import SwiftUI

struct TurnFileSelection: Hashable {
    let runID: String
    let turnID: Int
    let file: TurnFileChange
    let owner: Int
}

struct TurnChangesCard: View {
    let turn: RunTurn
    let open: (TurnFileChange) -> Void
    @State private var expanded = false
    var body: some View {
        if let changes = turn.changes {
            let count = changes.fileCount ?? changes.files.count
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "doc.badge.plus").foregroundStyle(.secondary)
                    Text(changes.undoneAt != nil ? "Changes undone" : "Edited \(count) \(count == 1 ? "file" : "files")")
                        .font(.footnote.weight(.semibold)).frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityLabel("Turn \((turn.turnIndex ?? 0) + 1). \(changes.undoneAt != nil ? "Changes undone" : "Edited \(count) files")")
                    DiffCounts(additions: changes.additions, deletions: changes.deletions)
                }.padding(14)
                Divider()
                ForEach(Array((expanded ? changes.files : Array(changes.files.prefix(2))).enumerated()), id: \.offset) { _, file in
                    Button { open(file) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: file.binary ? "doc.zipper" : "doc.text").foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(file.path.split(separator: "/").last.map(String.init) ?? file.path)
                                    .font(.footnote.weight(.medium)).lineLimit(1).truncationMode(.middle)
                                let detail = context(file)
                                if !detail.isEmpty { Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head) }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            if file.binary { Text("Binary").font(.caption2).foregroundStyle(.secondary) }
                            else { DiffCounts(additions: file.additions, deletions: file.deletions) }
                            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                        }.padding(.horizontal, 14).padding(.vertical, 10).frame(minHeight: 44).contentShape(.rect)
                    }.buttonStyle(ChatPressStyle()).foregroundStyle(.primary)
                        .accessibilityLabel("\(file.path), \(file.status), \(file.binary ? "Binary file" : "\(file.additions) additions, \(file.deletions) deletions")\(file.shared == true ? ", Also edited by another run" : "")")
                        .accessibilityHint("View this file’s diff").accessibilityIdentifier("turnFile-\(turn.id)-\(file.path)")
                }
                if changes.files.count > 2 {
                    Divider()
                    Button { expanded.toggle() } label: {
                        HStack {
                            Text(expanded ? "Show fewer files" : "Show \(changes.files.count - 2) more files")
                            Spacer()
                            Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 14)
                            .frame(maxWidth: .infinity, minHeight: 44).contentShape(.rect)
                    }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("expandTurnChanges-\(turn.id)")
                        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                }
                if count > changes.files.count { notice("The full file list is available on desktop.") }
                if changes.truncated { notice("Only part of this turn’s diff was stored.") }
            }
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
        }
    }
    private func context(_ file: TurnFileChange) -> String {
        let directory = file.path.split(separator: "/").dropLast().joined(separator: "/")
        return [directory, file.oldPath.map { "from " + $0 } ?? (file.status == "modified" ? "" : file.status), file.shared == true ? "Shared" : ""]
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }
    private func notice(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 14).padding(.bottom, 12)
    }
}

struct DiffCounts: View {
    let additions: Int
    let deletions: Int
    var body: some View {
        HStack(spacing: 8) {
            Text("+\(additions)").foregroundStyle(.green)
            Text("−\(deletions)").foregroundStyle(.red)
        }.font(.caption.monospacedDigit()).fixedSize()
    }
}

struct TurnFileDiffView: View {
    let session: BackendSession
    let selection: TurnFileSelection
    let close: () -> Void
    @State private var part = 0
    @State private var bookmarks: [FileDiffCursor?] = [nil]
    @State private var page: FileDiffPage?
    @State private var error: String?
    @State private var attempt = 0
    private var key: String { "\(part):\(attempt):\(session.ownership):\(session.isConnected)" }
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Color.clear.frame(height: 1).id("diff-top")
                    Text(selection.file.path).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                    if let old = selection.file.oldPath { Text("Renamed from \(old)").font(.caption).foregroundStyle(.secondary) }
                    if let page {
                        if page.binary { message("Binary file changes can be viewed on desktop.") }
                        else if !page.found { message("This file’s diff is not included in the stored changes. Check it on desktop.") }
                        else if page.lines.isEmpty { message("No line changes. The file was renamed or its metadata changed.") }
                        else { NumberedDiffBody(lines: page.lines) }
                        if page.shortened { message("Very long lines were shortened. View the full lines on desktop.") }
                    } else if let error {
                        message(error)
                        Button("Try again") { attempt += 1 }.frame(minHeight: 44).accessibilityIdentifier("retryFileDiff")
                    } else { ProgressView("Loading file diff…").frame(maxWidth: .infinity).padding(.vertical, 24) }
                }.padding(.horizontal, 16).padding(.bottom, 20)
            }.accessibilityIdentifier("fileDiffContent")
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if part > 0 || page?.next != nil {
                        HStack {
                            Button("Previous") { part -= 1 }.disabled(part == 0 || page == nil).accessibilityIdentifier("previousDiffPart")
                            Spacer()
                            Text("Part \(part + 1)").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Button("Next") {
                                if let next = page?.next { bookmarks = Array(bookmarks.prefix(part + 1)) + [next]; part += 1 }
                            }.disabled(page?.next == nil).accessibilityIdentifier("nextDiffPart")
                        }.frame(minHeight: 44).padding(.horizontal, 20).padding(.vertical, 8).background(.bar)
                    }
                }
                .task(id: key) {
                    await load()
                    guard !Task.isCancelled else { return }
                    proxy.scrollTo("diff-top", anchor: .top)
                }
        }
        .background(Color(.systemBackground)).navigationTitle(selection.file.path.split(separator: "/").last.map(String.init) ?? "File diff")
        .navigationBarTitleDisplayMode(.inline).toolbarRole(.editor)
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Back", systemImage: "chevron.left", action: close).labelStyle(.iconOnly).accessibilityIdentifier("closeFileDiff")
            }
        }
        .onChange(of: session.ownership) { _, _ in page = nil; close() }
    }
    private func message(_ text: String) -> some View { Text(text).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled) }
    private func load() async {
        page = nil; error = nil
        guard selection.owner == session.ownership else { return }
        do {
            let result = try await session.readFileDiff(runID: selection.runID, turnID: selection.turnID, file: selection.file,
                                                      owner: selection.owner, cursor: bookmarks[part])
            try Task.checkCancellation()
            guard selection.owner == session.ownership else { return }
            page = result
        } catch { if !Task.isCancelled, selection.owner == session.ownership { self.error = error.localizedDescription } }
    }
}

private struct NumberedDiffBody: View {
    let lines: [FileDiffLine]
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let highest = lines.compactMap { $0.newNo ?? $0.oldNo }.max() ?? 0
        let width = CGFloat(String(highest).count) * 8
        let emphasis = DiffWordEmphasis.build(lines)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.element.id) { index, line in
                if index > 0, line.hunkStart {
                    let previous = lines[index - 1]
                    let gap = (line.newNo ?? line.oldNo ?? 0) - (previous.newNo ?? previous.oldNo ?? 0) - 1
                    if gap != 0 { Text(gap > 0 ? "\(gap) unmodified lines" : "⋯").font(.caption2).foregroundStyle(.secondary).padding(10) }
                }
                let hue: Color = line.kind == .add ? .green : .red
                HStack(alignment: .top, spacing: 0) {
                    Rectangle().fill(line.kind == .context ? .clear : hue).frame(width: 3)
                    Text(String(line.newNo ?? line.oldNo ?? 0)).foregroundStyle(.tertiary)
                        .frame(width: width, alignment: .trailing).padding(.leading, 8)
                    Text(line.kind == .add ? "+" : line.kind == .remove ? "−" : " ")
                        .foregroundStyle(.secondary).padding(.leading, 6)
                    Text(highlighted(line, segments: emphasis[line.id], hue: hue)).textSelection(.enabled)
                        .foregroundStyle(line.kind == .context ? .secondary : .primary)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8)
                }.font(.system(.caption, design: .monospaced)).fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 2).background(line.kind == .context ? .clear : hue.opacity(0.12))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(line.kind == .add ? "Added" : line.kind == .remove ? "Removed" : "Context"), line \(line.newNo ?? line.oldNo ?? 0): \(line.text)")
            }
        }.padding(.vertical, 8).background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12)).clipShape(.rect(cornerRadius: 12))
    }
    private func highlighted(_ line: FileDiffLine, segments: [DiffWordEmphasis.Segment]?, hue: Color) -> AttributedString {
        guard let segments else { return AttributedString(line.text.isEmpty ? " " : line.text) }
        var result = AttributedString()
        for segment in segments {
            var text = AttributedString(segment.text)
            if segment.changed { text.backgroundColor = hue.opacity(scheme == .dark ? 0.4 : 0.28) }
            result.append(text)
        }
        return result
    }
}
