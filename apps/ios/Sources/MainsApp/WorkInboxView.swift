import SwiftUI

struct WorkInboxView: View {
    let session: BackendSession
    let openConversation: (String) -> Void
    let openSettings: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { clock in
            let snapshot = session.displayedWorkInbox
            let live = session.isConnected && session.workInboxIsCurrent
            let groups = snapshot.groups(now: clock.date, live: live)
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(session.isDemo ? "Across your Demo Mac" : "Across all spaces")
                            .font(.subheadline.weight(.medium))
                        if !session.isConnected {
                            Text("Saved activity. Connect to check requests and update your work.")
                                .font(.footnote).foregroundStyle(.secondary)
                            Button("Connection settings", action: openSettings).font(.footnote.weight(.medium))
                        } else if let error = session.workInboxError {
                            Text(error).font(.footnote).foregroundStyle(.secondary)
                            Button("Try again") { Task { await session.refreshWorkInbox() } }.font(.footnote.weight(.medium))
                        } else if session.workInboxLoading && !live {
                            HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Checking your work…").font(.footnote).foregroundStyle(.secondary) }
                        } else if let date = snapshot.updatedAt {
                            Text("Updated \(conversationAge(date, now: clock.date))").font(.footnote).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 4)
                }.listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))

                inboxSection("Needs you", items: groups.needsYou, kind: .waiting, now: clock.date, live: live)
                inboxSection("Running", items: groups.running, kind: .running, now: clock.date, live: live)
                inboxSection("Needs attention", items: groups.failed, kind: .failed, now: clock.date, live: live)
                inboxSection("Recently finished", items: groups.finished, kind: .finished, now: clock.date, live: live)

                if groups.isEmpty && !session.workInboxLoading {
                    ContentUnavailableView(live ? "You're all caught up" : "No saved activity", systemImage: live ? "checkmark.circle" : "tray",
                        description: Text(live ? "Requests and running work appear here. Finished work stays for 24 hours." : "Connect to your computer to see what needs you."))
                        .listRowBackground(Color.clear).listRowSeparator(.hidden)
                        .accessibilityIdentifier("workInboxEmpty")
                }
                if snapshot.isLimited {
                    Text("Showing up to 100 conversations, with requests and running work first. Older chats are available in Search.")
                        .font(.footnote).foregroundStyle(.secondary).listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
            }
            .listStyle(.insetGrouped).scrollContentBackground(.hidden)
            .background(Color(.systemBackground))
            .accessibilityIdentifier("workInboxList")
        }
        .navigationTitle("Activity").navigationBarTitleDisplayMode(.large)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Refresh activity", systemImage: "arrow.clockwise") { Task { await session.refreshWorkInbox() } }
                    .disabled(!session.isConnected || session.workInboxLoading).accessibilityIdentifier("refreshWorkInbox")
            }
        }
        .refreshable { await session.refreshWorkInbox() }
    }

    @ViewBuilder
    private func inboxSection(_ title: String, items: [WorkInboxItem], kind: WorkInboxRow.Kind, now: Date, live: Bool) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { item in
                    WorkInboxRow(session: session, item: item, kind: kind, now: now, live: live) { openConversation(item.id) }
                        .listRowBackground(Color(.secondarySystemBackground))
                }
            } header: {
                HStack { Text(title); Spacer(); Text(items.count, format: .number).monospacedDigit() }
            }
        }
    }
}

private struct WorkInboxRow: View {
    enum Kind { case waiting, running, failed, finished }
    let session: BackendSession
    let item: WorkInboxItem
    let kind: Kind
    let now: Date
    let live: Bool
    let open: () -> Void
    private var run: Conversation { item.run }
    private var status: String {
        if kind == .waiting { return item.requestCount == 1 ? (item.hasQuestion ? "Answer needed" : "Approval needed") : "\(item.requestCount) requests waiting" }
        let label = kind == .running ? (run.status == "queued" ? "Queued" : "Running") : kind == .failed ? "Failed" : run.status == "canceled" ? "Stopped" : "Completed"
        return live ? label : "Last known: \(label.lowercased())"
    }
    private var symbol: String {
        switch kind {
        case .waiting: item.hasQuestion ? "questionmark.bubble" : "hand.raised"
        case .running: "circle.dotted"
        case .failed: "exclamationmark.circle"
        case .finished: run.status == "canceled" ? "stop.circle" : "checkmark.circle"
        }
    }
    private var tint: Color {
        switch kind {
        case .waiting, .failed: .orange
        case .running: Provider.accent(run.providerId)
        case .finished: .secondary
        }
    }
    private var context: String {
        let target = session.workspaces.first { $0.id == run.workspaceId }?.name ?? session.collections.first { $0.id == run.collectionId }?.name
        return [Provider.name(run.providerId), Experience.label(run.mode), target].compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Button(action: open) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: symbol).font(.system(size: 21)).foregroundStyle(tint)
                        .frame(width: 25, height: 26).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(run.displayTitle).font(.body.weight(.medium)).foregroundStyle(.primary).lineLimit(2)
                        Text(context).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        HStack(spacing: 5) {
                            Text(status).foregroundStyle(tint)
                            Text("· " + conversationAge(run.updatedAt, now: now)).foregroundStyle(.secondary)
                        }.font(.caption).lineLimit(2)
                        if run.isReplica == true { Text("Read-only · another computer").font(.caption2).foregroundStyle(.secondary) }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.padding(.vertical, 7).frame(minHeight: 60).contentShape(.rect)
            }
            .buttonStyle(.plain).accessibilityIdentifier("inboxRun-\(run.id)")
            .accessibilityHint(kind == .waiting ? "Open conversation to review and answer" : "Open conversation")

            if live && run.isActive && run.isReplica != true {
                Button {
                    let owner = session.ownership
                    Task {
                        guard session.canStopInboxRun(run.id) else { return }
                        do { try await session.stop(run.id) }
                        catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
                    }
                } label: {
                    Group {
                        if session.stoppingRunID == run.id { ProgressView().controlSize(.small) }
                        else { Image(systemName: "stop.fill").font(.system(size: 12)) }
                    }.frame(width: 44, height: 44)
                }
                .buttonStyle(.borderless).modifier(GlassSurface(radius: 22))
                .disabled(!session.canStopInboxRun(run.id)).accessibilityLabel("Stop \(run.displayTitle)")
                .accessibilityIdentifier("inboxStop-\(run.id)")
            } else {
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
        }
    }
}
