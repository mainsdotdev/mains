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
                if !session.isConnected || session.workInboxError != nil || session.workInboxLoading && !live {
                  Section {
                    VStack(alignment: .leading, spacing: 4) {
                        if !session.isConnected {
                            Text("Saved activity. Connect to check requests and update your work.")
                                .font(.footnote).foregroundStyle(.secondary)
                            Button("Connection settings", action: openSettings).font(.footnote.weight(.medium))
                        } else if let error = session.workInboxError {
                            Text(error).font(.footnote).foregroundStyle(.secondary)
                            Button("Try again") { Task { await session.refreshWorkInbox() } }.font(.footnote.weight(.medium))
                        } else if session.workInboxLoading && !live {
                            HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Checking your work…").font(.footnote).foregroundStyle(.secondary) }
                        }
                    }
                  }.listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                }

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
            .listSectionSpacing(.compact)
            .environment(\.defaultMinListRowHeight, 44)
            .background(Color(.systemBackground))
            .accessibilityIdentifier("workInboxList")
        }
        .navigationTitle("Activity").navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .refreshable { await session.refreshWorkInbox() }
    }

    @ViewBuilder
    private func inboxSection(_ title: String, items: [WorkInboxItem], kind: WorkInboxRow.Kind, now: Date, live: Bool) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { item in
                    WorkInboxRow(session: session, item: item, kind: kind, now: now, live: live) { openConversation(item.id) }
                        .listRowBackground(Color(.secondarySystemBackground))
                        .listRowInsets(AppListStyle.rowInsets)
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
    private var projectName: String? {
        let target = session.workspaces.first { $0.id == run.workspaceId }?.name ?? session.collections.first { $0.id == run.collectionId }?.name
        guard let name = target?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return nil }
        return name
    }

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Button(action: open) {
                HStack(alignment: .center, spacing: 10) {
                    Image(systemName: symbol).font(.system(size: 17)).foregroundStyle(tint)
                        .frame(width: 20, height: 22).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(run.displayTitle).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        HStack(alignment: .firstTextBaseline, spacing: 5) {
                            Text([compactRelativeAge(run.updatedAt, now: now), projectName].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption2).foregroundStyle(.secondary)
                                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                            if run.isReplica == true { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary) }
                            Spacer(minLength: 8)
                            Text(Provider.name(run.providerId)).font(.caption2).foregroundStyle(.secondary).fixedSize()
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.frame(minHeight: AppListStyle.minimumContentHeight).contentShape(.rect)
            }
            .buttonStyle(.plain).accessibilityIdentifier("inboxRun-\(run.id)")
            .accessibilityLabel([run.displayTitle, Provider.name(run.providerId), projectName, status, compactRelativeAge(run.updatedAt, now: now), run.isReplica == true ? "Read-only · another computer" : nil].compactMap { $0 }.joined(separator: ", "))
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
                        else { Image(systemName: "stop.fill").font(.system(size: 10)) }
                    }
                    .frame(width: 36, height: 36).modifier(GlassSurface(radius: 18))
                    .frame(width: 44, height: 44).contentShape(.circle)
                }
                .buttonStyle(.borderless)
                .disabled(!session.canStopInboxRun(run.id)).accessibilityLabel("Stop \(run.displayTitle)")
                .accessibilityIdentifier("inboxStop-\(run.id)")
            } else {
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
                    .padding(.leading, 8)
            }
        }
    }
}
