import SwiftUI

struct MateInfoProfile: Identifiable {
    let mate: Mate
    let teams: [MateTeam]
    var id: String { mate.id }
}

struct MateInfoView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif

    private enum Tab: String, CaseIterable, Identifiable {
        case details = "Details", chats = "Chats", memory = "Memory", assignments = "Assignments", routines = "Routines"
        var id: Self { self }
        var requiresMateInfo: Bool { self != .details && self != .chats }
    }

    private enum Pane {
        case chats([MateChat]), memory([MateMemoryNote]), assignments(MateTasks), routines(MateRoutines)
    }

    private enum Sheet: Identifiable {
        case profile, memory(String?), newAssignment, task(String), routine(String?)

        var id: String {
            switch self {
            case .profile: "profile"
            case .memory(let id): "memory-\(id ?? "new")"
            case .newAssignment: "assignment-new"
            case .task(let id): "assignment-\(id)"
            case .routine(let id): "routine-\(id ?? "new")"
            }
        }
    }

    private struct LoadRequest: Equatable {
        let owner: Int
        let connected: Bool
        let supportsMateInfo: Bool
        let revision: Int
        let refresh: Int
    }

    private struct PaneRequest: Equatable {
        let base: LoadRequest
        let tab: Tab
        let offset: Int
    }

    let session: BackendSession
    let mateID: String
    let currentChatID: String?
    let openChat: (String, String?) -> Void
    let newTask: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var profile: MateInfoProfile?
    @State private var rendersAvatar: Bool
    @State private var tab: Tab = .details
    @State private var offset = 0
    @State private var pane: (request: PaneRequest, content: Pane)?
    @State private var paneError: (request: PaneRequest, message: String)?
    @State private var profileError: String?
    @State private var actionError: String?
    @State private var refresh = 0
    @State private var activeTasks = 0
    @State private var sheet: Sheet?
    @State private var chatAfterSheet: (id: String, mateID: String?)?
    @State private var confirmArchive = false
    @State private var routineToDelete: MateRoutine?

    init(session: BackendSession, mateID: String, initialProfile: MateInfoProfile? = nil, currentChatID: String? = nil,
         openChat: @escaping (String, String?) -> Void, newTask: @escaping () -> Void) {
        self.session = session
        self.mateID = mateID
        self.currentChatID = currentChatID
        self.openChat = openChat
        self.newTask = newTask
        _profile = State(initialValue: initialProfile)
        _rendersAvatar = State(initialValue: initialProfile == nil)
    }

    private var request: LoadRequest {
        LoadRequest(owner: session.ownership, connected: session.isConnected, supportsMateInfo: session.supportsMateInfo,
                    revision: session.matesRevision, refresh: refresh)
    }
    private var paneRequest: PaneRequest { PaneRequest(base: request, tab: tab, offset: offset) }

    private var canWrite: Bool { session.isConnected && session.supportsMateInfo && !session.mateCommandPending }

    var body: some View {
        Group {
            if !session.isConnected {
                ContentUnavailableView("Computer offline", systemImage: "wifi.slash",
                                       description: Text("Connect to your computer to see this Mate’s details."))
            } else if let profile {
                info(profile)
            } else if let profileError {
                ContentUnavailableView {
                    Label("Mate details unavailable", systemImage: "person.crop.circle.badge.exclamationmark")
                } description: {
                    Text(profileError)
                } actions: {
                    Button("Try Again") { refresh += 1 }
                }
            } else {
                ProgressView().accessibilityLabel("Loading Mate details")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .expandedNavigationTitle("Mate Details")
        .toolbarBackground(.hidden, for: .navigationBar)
        .task(id: request) { await loadProfile(request) }
        .task(id: PaneActivity(request: paneRequest, foreground: scenePhase == .active)) { await watchPane(paneRequest) }
        .task {
            guard !rendersAvatar else { return }
            // Keep the thumbnail visible while the system runs the zoom.
            do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
            rendersAvatar = true
        }
        .sheet(item: $sheet, onDismiss: openChatFromSheet) { selection in
            if let profile { sheetContent(selection, profile: profile) }
        }
    }

    private func info(_ profile: MateInfoProfile) -> some View {
        let mate = profile.mate
        return VStack(spacing: 0) {
            header(mate)
            tabStrip
            List {
                if session.mateCommandUncertain {
                    Button("Check Mate change", systemImage: "arrow.clockwise") { Task { await checkChange() } }
                }
                if let actionError { Text(actionError).foregroundStyle(.secondary) }
                if tab == .details { details(profile) }
                else { tabContent(mate) }
            }
            .listStyle(.insetGrouped)
            .contentMargins(.top, 12, for: .scrollContent)
            .id(tab)
            .refreshable { refresh += 1 }
        }
        .confirmationDialog("Archive \(mate.name)?", isPresented: $confirmArchive, titleVisibility: .visible) {
            Button("Archive Mate", role: .destructive) { perform(.archive(true)) }
        } message: {
            Text("This pauses the Mate’s future routines.")
        }
        .confirmationDialog("Delete routine?", isPresented: Binding(
            get: { routineToDelete != nil }, set: { if !$0 { routineToDelete = nil } }
        ), presenting: routineToDelete) { routine in
            Button("Delete Routine", role: .destructive) { perform(.deleteRoutine(routine.id)) }
        } message: { routine in
            Text("Future runs of \(routine.schedule.title) will stop.")
        }
    }

    private func header(_ mate: Mate) -> some View {
        let compact = verticalSizeClass == .compact || typeSize.isAccessibilitySize
        let layout = compact ? AnyLayout(HStackLayout(spacing: 12)) : AnyLayout(VStackLayout(spacing: 6))
        return layout {
            headerAvatar(mate)
                .frame(width: compact ? 48 : 106, height: compact ? 48 : 106)
                .accessibilityHidden(true)
            VStack(alignment: compact ? .leading : .center, spacing: 6) {
                Text(mate.name)
                    .font((compact ? Font.headline : .title2).weight(.semibold).width(.expanded))
                    .lineLimit(2)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("mateInfoName")
                if !mate.description.isEmpty {
                    Text(mate.description).font(.subheadline).foregroundStyle(.secondary).lineLimit(compact ? 1 : 3)
                }
            }
            .multilineTextAlignment(compact ? .leading : .center)
        }
        .frame(maxWidth: .infinity, alignment: compact ? .leading : .center)
        .padding(.horizontal, 24)
        .padding(.top, 4)
        .padding(.bottom, 12)
    }

    @ViewBuilder private func headerAvatar(_ mate: Mate) -> some View {
        if let preset = MateRobotAssets.catalogue?.preset(for: mate.avatar, mateID: mate.id) {
            MateRobotPreview(preset: preset, acceptsDrag: false, renders: rendersAvatar)
        } else {
            MateRobotThumbnail(preset: nil)
        }
    }

    private var tabStrip: some View {
        let animation: Animation? = reduceMotion ? nil : .easeInOut(duration: 0.24)
        return ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(Tab.allCases) { item in
                        FilterChip(selected: item == tab, usesSharedHighlight: true, action: {
                            guard tab != item else { return }
                            tab = item
                            offset = 0
                            pane = nil
                            paneError = nil
                        }) { foreground in
                            tabLabel(item, foreground: foreground)
                        }
                        .accessibilityIdentifier("mateInfoTab-\(item.rawValue)")
                        .id(item)
                    }
                }
                .padding(.horizontal, 16)
                .backgroundPreferenceValue(FilterChipSelectionBounds.self) { bounds in
                    GeometryReader { geometry in
                        if let bounds {
                            let rect = geometry[bounds]
                            Capsule().fill(Color.primary)
                                .frame(width: rect.width, height: rect.height)
                                .position(x: rect.midX, y: rect.midY)
                                .animation(animation, value: rect)
                        }
                    }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
            }
            .scrollIndicators(.hidden)
            .modifier(FilterChipScrollFade())
            .defaultScrollAnchor(.center, for: .alignment)
            .onChange(of: tab) { _, item in
                withAnimation(animation) { proxy.scrollTo(item, anchor: .center) }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Mate Details sections")
            .accessibilityIdentifier("mateInfoTabs")
        }
    }

    private func tabLabel(_ item: Tab, foreground: Color) -> some View {
        HStack(spacing: 5) {
            Text(item.rawValue)
            if item == .assignments && activeTasks > 0 {
                Text(activeTasks, format: .number).font(.caption2.weight(.semibold).monospacedDigit())
                    .padding(.horizontal, 5).padding(.vertical, 2)
                    .background(foreground.opacity(0.12), in: Capsule())
                    .accessibilityLabel("\(activeTasks) active")
            }
        }
    }

    @ViewBuilder private func details(_ profile: MateInfoProfile) -> some View {
        let mate = profile.mate
        let team = mate.teamId.map { id in profile.teams.first(where: { $0.id == id })?.name ?? "Unavailable team" } ?? "No team"
        let model = session.models[mate.providerId]?.first(where: { $0.id == mate.model })?.label(for: mate.providerId) ?? mate.model
        Section {
            LabeledContent("Team", value: team)
            if let details = mate.details { LabeledContent("Space", value: details.spaceName) }
            LabeledContent("Model", value: model)
            if let details = mate.details {
                LabeledContent("Effort", value: details.effort.isEmpty ? "Default" : ComposerSettings.effortLabel(details.effort))
            }
        }
        if let details = mate.details, !details.instructions.isEmpty {
            Section { MateInfoMarkdown(text: details.instructions) } header: { MateSectionHeading("Instructions") }
        }
        if session.supportsMateInfo {
            Section {
                if mate.isArchived == true {
                    Button("Restore Mate", systemImage: "archivebox") { perform(.archive(false)) }
                        .disabled(!canWrite)
                } else {
                    if mate.ready, MateEditableProfile(mate: mate) != nil {
                        Button("Edit Profile", systemImage: "pencil") { sheet = .profile }.disabled(!canWrite)
                    }
                    Button(role: .destructive) { confirmArchive = true } label: {
                        HStack(spacing: 16) {
                            Image(systemName: "archivebox").frame(width: 24).accessibilityHidden(true)
                            Text("Archive Mate")
                        }
                        .foregroundStyle(Color(uiColor: .systemRed))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .disabled(!canWrite)
                }
            }
        }
    }

    @ViewBuilder private func tabContent(_ mate: Mate) -> some View {
        if tab.requiresMateInfo && !session.supportsMateInfo {
            Label("Update Mains on your computer to use this tab.", systemImage: "arrow.down.circle")
                .foregroundStyle(.secondary)
        } else if let failure = paneError, failure.request == paneRequest {
            Section {
                Label(failure.message, systemImage: "exclamationmark.circle").foregroundStyle(.secondary)
                Button("Try Again") { refresh += 1 }
            }
        } else if let pane, pane.request == paneRequest {
            switch pane.content {
            case .chats(let chats): chatRows(chats, mate: mate)
            case .memory(let notes): memoryRows(notes, mate: mate)
            case .assignments(let tasks): taskRows(tasks, mate: mate)
            case .routines(let routines): routineRows(routines, mate: mate)
            }
        } else {
            ProgressView().accessibilityLabel("Loading \(tab.rawValue)")
        }
    }

    @ViewBuilder private func chatRows(_ chats: [MateChat], mate: Mate) -> some View {
        let history = chats.filter { mate.showsChat($0) }
        if mate.ready {
            Section { Button("New Task", systemImage: "square.and.pencil", action: newTask) }
        }
        Section {
            if history.isEmpty { Text("No chats yet").foregroundStyle(.secondary) }
            ForEach(history) { chat in
                Button { openChat(chat.id, mateID) } label: {
                    HStack {
                        Text(chat.displayTitle).lineLimit(2)
                        Spacer()
                        TimelineView(.periodic(from: .now, by: 60)) { clock in
                            Text(compactRelativeAge(chat.updatedAt, now: clock.date)).font(.caption).foregroundStyle(.secondary)
                        }
                        if chat.id == currentChatID {
                            Image(systemName: "checkmark").font(.caption).accessibilityLabel("Current chat")
                        } else {
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                                .foregroundStyle(.tertiary).accessibilityHidden(true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("mateInfoChat-\(chat.id)")
            }
        }
    }

    @ViewBuilder private func memoryRows(_ notes: [MateMemoryNote], mate: Mate) -> some View {
        if mate.ready {
            Section { Button("New Memory", systemImage: "plus") { sheet = .memory(nil) }.disabled(!canWrite) }
        }
        Section {
            if notes.isEmpty { Text("No memories yet").foregroundStyle(.secondary) }
            ForEach(notes) { note in
                Button { sheet = .memory(note.id) } label: {
                    MateInfoRow(title: note.title, subtitle: note.shared ? "Shared with team" : "Private to this Mate",
                                preview: note.content, icon: note.pinned ? "pin.fill" : "note.text")
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private func taskRows(_ tasks: MateTasks, mate: Mate) -> some View {
        if mate.ready {
            Section { Button("New Assignment", systemImage: "plus") { sheet = .newAssignment }.disabled(!canWrite) }
        }
        Section {
            if tasks.items.isEmpty { Text("No assignments yet").foregroundStyle(.secondary) }
            ForEach(tasks.items) { task in
                Button { sheet = .task(task.id) } label: {
                    MateInfoRow(title: task.title, subtitle: [task.assignee?.name, mateTaskStatus(task.status)].compactMap { $0 }.joined(separator: " · "),
                                preview: task.result ?? task.brief, icon: "checklist")
                }
                .buttonStyle(.plain)
            }
        }
        pagination(hasNext: tasks.hasMore)
    }

    @ViewBuilder private func routineRows(_ routines: MateRoutines, mate: Mate) -> some View {
        if mate.ready {
            Section { Button("New Routine", systemImage: "plus") { sheet = .routine(nil) }.disabled(!canWrite) }
        }
        Section {
            if routines.items.isEmpty { Text("No routines yet").foregroundStyle(.secondary) }
            ForEach(routines.items) { routine in
                VStack(alignment: .leading, spacing: 10) {
                    Button { sheet = .routine(routine.id) } label: {
                        MateInfoRow(title: routine.schedule.title,
                                    subtitle: "\(routine.schedule.displayTime) · \(routine.schedule.timezone)",
                                    preview: routine.schedule.prompt, icon: "clock.arrow.circlepath")
                    }
                    .buttonStyle(.plain)
                    if routine.isActive, let next = routine.nextRunAt {
                        Text("Next: \(next.formatted(date: .abbreviated, time: .shortened))").font(.caption)
                    } else {
                        Text(routine.isActive ? "Scheduled" : "Paused").font(.caption)
                    }
                    if let status = routine.lastAssignmentStatus {
                        Text("Last task: \(mateTaskStatus(status))").font(.caption).foregroundStyle(.secondary)
                    }
                    if let error = routine.lastError {
                        Text(error).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                    }
                    routineActions(routine, mate: mate)
                }
                .padding(.vertical, 4)
            }
        }
        pagination(hasNext: routines.nextOffset != nil)
    }

    @ViewBuilder private func routineActions(_ routine: MateRoutine, mate: Mate) -> some View {
        if let lastRun = routine.lastRunId {
            Button("Open Last Chat", systemImage: "bubble", action: { openChat(lastRun, mateID) })
                .buttonStyle(.borderless)
        }
        if mate.ready {
            Menu("Routine Actions", systemImage: "ellipsis.circle") {
                Button("Run Now", systemImage: "play") { perform(.runRoutine(routine.id)) }
                Button(routine.isActive ? "Pause" : "Resume", systemImage: routine.isActive ? "pause" : "play.circle") {
                    perform(.toggleRoutine(id: routine.id, isActive: !routine.isActive))
                }
                Button("Delete Routine", systemImage: "trash", role: .destructive) { routineToDelete = routine }
            }
            .disabled(!canWrite)
        }
    }

    @ViewBuilder private func pagination(hasNext: Bool) -> some View {
        if offset > 0 || hasNext {
            Section {
                if offset > 0 { Button("Previous Page") { offset -= 100 } }
                if hasNext { Button("Next Page") { offset += 100 } }
            }
        }
    }

    @ViewBuilder private func sheetContent(_ selection: Sheet, profile: MateInfoProfile) -> some View {
        let mate = profile.mate
        switch selection {
        case .profile:
            if let original = MateEditableProfile(mate: mate) {
                MateProfileEditor(session: session, mateID: mateID, original: original, teamID: mate.teamId, teams: profile.teams)
            }
        case .memory(let id):
            if let id {
                MateRecordView(session: session, title: "Memory", load: { try await session.readMateMemory(id, mateID: mateID) }) { note in
                    MateMemoryEditor(session: session, mate: mate, note: note)
                }
            } else {
                NavigationStack { MateMemoryEditor(session: session, mate: mate, note: MateMemoryNote()) }
            }
        case .newAssignment:
            NavigationStack { MateTaskEditor(session: session, mateID: mateID) }
        case .task(let id):
            MateRecordView(session: session, title: "Assignment", reloadOnChange: true, dismissWithCheckmark: true,
                           load: { try await session.readMateTask(id, mateID: mateID) }) { task in
                MateTaskDetail(session: session, mate: mate, task: task) { runID in
                    chatAfterSheet = (runID, task.assignee?.id)
                    sheet = nil
                }
            }
        case .routine(let id):
            if let id {
                MateRecordView(session: session, title: "Routine", load: { try await session.readMateRoutine(id, mateID: mateID) }) { routine in
                    MateRoutineEditor(session: session, mate: mate, routine: routine)
                }
            } else {
                NavigationStack { MateRoutineEditor(session: session, mate: mate, routine: nil) }
            }
        }
    }

    private func loadProfile(_ request: LoadRequest) async {
        guard request.connected else { return }
        do {
            let response = try await session.loadMates(mateID: mateID, archived: request.supportsMateInfo)
            guard !Task.isCancelled, request == self.request else { return }
            guard let mate = response.mates.first(where: { $0.id == mateID }) else {
                throw MainsError.server("This Mate is unavailable.")
            }
            profile = MateInfoProfile(mate: mate, teams: response.teams)
            profileError = nil
        } catch {
            guard !Task.isCancelled, request == self.request else { return }
            profile = nil
            profileError = error.localizedDescription
        }
    }

    private func loadPane(_ request: PaneRequest) async {
        guard request.base.connected, !request.tab.requiresMateInfo || request.base.supportsMateInfo else { return }
        do {
            let content: Pane
            switch request.tab {
            case .details: return
            case .chats: content = .chats(try await session.loadMateChats(mateID))
            case .memory: content = .memory(try await session.loadMateMemory(mateID))
            case .assignments: content = .assignments(try await session.loadMateTasks(mateID, offset: request.offset))
            case .routines: content = .routines(try await session.loadMateRoutines(mateID, offset: request.offset))
            }
            guard !Task.isCancelled, request == paneRequest else { return }
            if case .assignments(let tasks) = content, request.offset == 0 || !tasks.items.isEmpty {
                activeTasks = tasks.activeCount
            }
            pane = (request, content)
            paneError = nil
        } catch {
            guard !Task.isCancelled, request == paneRequest else { return }
            paneError = (request, error.localizedDescription)
        }
    }

    private struct PaneActivity: Equatable {
        let request: PaneRequest
        let foreground: Bool
    }

    private func watchPane(_ request: PaneRequest) async {
        guard scenePhase == .active else { return }
        await loadPane(request)
        guard request.tab == .routines, request.base.connected, request.base.supportsMateInfo else { return }
        while !Task.isCancelled {
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            await loadPane(request)
        }
    }

    private func perform(_ change: MateChange) {
        let owner = session.ownership
        Task {
            guard owner == session.ownership, canWrite else { return }
            do { try await session.manageMate(mateID, change: change); actionError = nil }
            catch { if owner == session.ownership { actionError = error.localizedDescription } }
        }
    }

    private func checkChange() async {
        let owner = session.ownership
        do { try await session.checkMateCommand(); actionError = nil }
        catch { if owner == session.ownership { actionError = error.localizedDescription } }
    }

    private func openChatFromSheet() {
        guard let chat = chatAfterSheet else { return }
        chatAfterSheet = nil
        openChat(chat.id, chat.mateID)
    }
}

struct MateInfoMarkdown: View {
    let text: String

    var body: some View {
        ChatMessageBody(text: text).equatable()
            .environment(\.openURL, OpenURLAction { url in
                ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") ? .systemAction : .discarded
            })
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
    }
}

private struct MateInfoRow: View {
    let title: String
    let subtitle: String
    let preview: String
    let icon: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.subheadline).foregroundStyle(.secondary).frame(width: 22)
                .padding(.top, 3).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.body.weight(.medium).width(.expanded))
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
                if !preview.isEmpty { Text(preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                .padding(.top, 4).accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

struct MateSectionHeading: View {
    let title: String

    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title).font(.footnote.weight(.semibold).width(.expanded))
            .accessibilityAddTraits(.isHeader)
    }
}

func mateTaskStatus(_ status: String) -> String { status == "uncertain" ? "Needs Attention" : status.capitalized }
