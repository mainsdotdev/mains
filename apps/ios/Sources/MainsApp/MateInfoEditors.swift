import SwiftUI

struct MateRecordView<Record, Content: View>: View {
    let session: BackendSession
    let title: String
    var reloadOnChange = false
    var dismissWithCheckmark = false
    let load: () async throws -> Record
    @ViewBuilder let content: (Record) -> Content

    @State private var record: Record?
    @State private var error: String?
    @State private var retry = 0

    var body: some View {
        NavigationStack {
            Group {
                if let record {
                    content(record)
                } else {
                    Group {
                        if !session.isConnected {
                            ContentUnavailableView("Computer offline", systemImage: "wifi.slash")
                        } else if let error {
                            ContentUnavailableView {
                                Label("\(title) unavailable", systemImage: "exclamationmark.circle")
                            } description: {
                                Text(error)
                            } actions: {
                                Button("Try Again") { retry += 1 }
                            }
                        } else {
                            ProgressView()
                        }
                    }
                    .expandedNavigationTitle(title)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { MateRecordDoneButton(checkmark: dismissWithCheckmark) }
                    }
                }
            }
        }
        .task(id: "\(session.ownership):\(session.isConnected):\(reloadOnChange ? session.matesRevision : 0):\(retry)") {
            guard session.isConnected, record == nil || reloadOnChange else { return }
            let owner = session.ownership
            let revision = session.matesRevision
            do {
                let current = try await load()
                guard !Task.isCancelled, owner == session.ownership, !reloadOnChange || revision == session.matesRevision else { return }
                record = current
                error = nil
            } catch {
                guard !Task.isCancelled, owner == session.ownership, !reloadOnChange || revision == session.matesRevision else { return }
                record = nil
                self.error = error.localizedDescription
            }
        }
    }
}

private struct MateRecordDoneButton: View {
    let checkmark: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if checkmark {
            Button("Done", systemImage: "checkmark") { dismiss() }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("closeMateAssignment")
        } else {
            Button("Done") { dismiss() }
        }
    }
}

private struct MateEditorForm<Content: View>: View {
    let session: BackendSession
    let mateID: String
    let title: String
    var submit = "Save"
    var editable = true
    let change: MateChange?
    var delete: MateChange? = nil
    @ViewBuilder let content: () -> Content

    @Environment(\.dismiss) private var dismiss
    @State private var submitting = false
    @State private var checking = false
    @State private var confirmDelete = false
    @State private var error: String?

    private var canWrite: Bool {
        editable && !submitting && session.isConnected && session.supportsMateInfo && !session.mateCommandPending
    }

    var body: some View {
        Form {
            content().disabled(submitting || checking)
            if let error {
                Section { Text(error).foregroundStyle(.secondary) }
            }
            if checking && session.mateCommandUncertain {
                Section {
                    Button("Check Mate change", systemImage: "arrow.clockwise") { send(nil) }
                        .disabled(!session.isConnected || submitting)
                }
            }
            if editable, delete != nil {
                Section {
                    Button("Delete Memory", role: .destructive) { confirmDelete = true }.disabled(!canWrite)
                }
            }
        }
        .expandedNavigationTitle(title)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(editable ? "Cancel" : "Done") { dismiss() }.disabled(submitting)
            }
            if editable {
                ToolbarItem(placement: .confirmationAction) {
                    Button(submit) { if let change { send(change) } }.disabled(change == nil || !canWrite)
                }
            }
        }
        .interactiveDismissDisabled(submitting)
        .confirmationDialog("Delete this memory?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Memory", role: .destructive) { if let delete { send(delete) } }
        }
    }

    private func send(_ change: MateChange?) {
        let owner = session.ownership
        Task {
            guard !submitting, owner == session.ownership else { return }
            if change != nil {
                guard canWrite else { return }
            } else {
                guard checking, session.mateCommandUncertain, session.isConnected else { return }
            }
            submitting = true
            defer { submitting = false }
            error = nil
            do {
                if let change { try await session.manageMate(mateID, change: change) }
                else { try await session.checkMateCommand() }
                if owner == session.ownership { dismiss() }
            } catch {
                if owner == session.ownership {
                    checking = session.mateCommandUncertain
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

struct MateProfileEditor: View {
    let session: BackendSession
    let mateID: String
    let teams: [MateTeam]
    @State private var original: MateEditableProfile
    @State private var profile: MateEditableProfile
    @State private var originalTeamID: String?
    @State private var teamID: String?
    @State private var rememberedStyles: [String: String] = [:]

    init(session: BackendSession, mateID: String, original: MateEditableProfile, teamID: String?, teams: [MateTeam]) {
        self.session = session
        self.mateID = mateID
        self.teams = teams
        _original = State(initialValue: original)
        _profile = State(initialValue: original)
        _originalTeamID = State(initialValue: teamID)
        _teamID = State(initialValue: teamID)
    }

    private var change: MateChange? {
        var edited = profile
        edited.name = edited.name.trimmingCharacters(in: .whitespacesAndNewlines)
        edited.description = edited.description.trimmingCharacters(in: .whitespacesAndNewlines)
        edited.instructions = edited.instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        guard validText(edited.name, limit: 100), edited.description.utf16.count <= 1000,
              validText(edited.instructions, limit: 16_000), edited != original || teamID != originalTeamID else { return nil }
        return .updateProfile(edited, original: original, teamID: teamID, originalTeamID: originalTeamID)
    }

    var body: some View {
        NavigationStack {
            MateEditorForm(session: session, mateID: mateID, title: "Edit Profile", change: change) {
                if let catalogue = MateRobotAssets.catalogue {
                    Section {
                        MateRobotPicker(catalogue: catalogue, avatar: $profile.avatar, remembered: $rememberedStyles,
                                        stageHeight: 135, previewActive: true, isSelecting: true)
                    }
                }
                Section {
                    TextField("Name", text: $profile.name)
                    TextField("Description", text: $profile.description, axis: .vertical).lineLimit(2...5)
                    Picker("Team", selection: $teamID) {
                        Text("No team").tag(nil as String?)
                        ForEach(teams) { team in Text(team.name).tag(Optional(team.id)) }
                        if let teamID, !teams.contains(where: { $0.id == teamID }) {
                            Text("Unavailable team").tag(Optional(teamID))
                        }
                    }
                }
                Section {
                    TextEditor(text: $profile.instructions).frame(minHeight: 120)
                        .accessibilityLabel("Instructions")
                } header: {
                    MateSectionHeading("Instructions")
                }
            }
        }
    }
}

struct MateMemoryEditor: View {
    let session: BackendSession
    let mate: Mate
    @Environment(\.dismiss) private var dismiss
    @State private var note: MateMemoryNote
    @State private var originalTeamID: String?
    @State private var editing: Bool

    init(session: BackendSession, mate: Mate, note: MateMemoryNote) {
        self.session = session
        self.mate = mate
        var note = note
        if note.revision == 0 { note.shared = mate.teamId != nil }
        _note = State(initialValue: note)
        _originalTeamID = State(initialValue: mate.teamId)
        _editing = State(initialValue: note.revision == 0)
    }

    private var change: MateChange? {
        guard validText(note.title, limit: 200), validText(note.content, limit: 6000) else { return nil }
        return .saveMemory(note, expectedTeamID: originalTeamID)
    }

    var body: some View {
        if mate.ready && editing {
            MateEditorForm(session: session, mateID: mate.id, title: note.revision == 0 ? "New Memory" : "Edit Memory",
                           change: change, delete: note.revision > 0 ? .deleteMemory(id: note.id, revision: note.revision) : nil) {
                Section {
                    TextField("Title", text: $note.title)
                    Toggle("Pinned", isOn: $note.pinned)
                    if note.revision == 0, originalTeamID != nil {
                        Toggle("Share with team", isOn: $note.shared)
                    } else {
                        LabeledContent("Visibility", value: note.shared ? "Team" : "Private")
                    }
                }
                Section {
                    TextEditor(text: $note.content).frame(minHeight: 150)
                        .accessibilityLabel("Memory text").accessibilityIdentifier("mateMemoryText")
                } header: {
                    MateSectionHeading("Memory")
                }
            }
        } else {
            List {
                Section {
                    Text(note.title).font(.headline.width(.expanded)).accessibilityAddTraits(.isHeader)
                    MateInfoMarkdown(text: note.content)
                }
                Section {
                    LabeledContent("Visibility", value: note.shared ? "Team" : "Private")
                    if note.pinned { Label("Pinned", systemImage: "pin.fill") }
                }
            }
            .listStyle(.insetGrouped)
            .expandedNavigationTitle("Memory")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                if mate.ready {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Edit") { editing = true }
                            .disabled(!session.isConnected || session.mateCommandPending)
                    }
                }
            }
        }
    }
}

struct MateTaskEditor: View {
    let session: BackendSession
    let mateID: String
    var taskID: String? = nil

    @State private var title = ""
    @State private var prompt = ""

    private var change: MateChange? {
        guard validText(prompt, limit: 24_000) else { return nil }
        if let taskID { return .followup(id: taskID, message: prompt) }
        return validText(title, limit: 200) ? .assign(title: title, prompt: prompt) : nil
    }

    var body: some View {
        MateEditorForm(session: session, mateID: mateID, title: taskID == nil ? "New Assignment" : "Follow Up",
                       submit: taskID == nil ? "Assign" : "Send", change: change) {
            if taskID == nil { Section { TextField("Title", text: $title) } }
            Section {
                TextEditor(text: $prompt).frame(minHeight: 160).accessibilityLabel("Task message")
            } header: {
                MateSectionHeading(taskID == nil ? "Task and completion criteria" : "Follow-up message")
            }
        }
    }
}

struct MateTaskDetail: View {
    let session: BackendSession
    let mate: Mate
    let task: MateTask
    let openChat: (String) -> Void
    @State private var showFollowup = false
    @State private var confirmCancel = false
    @State private var error: String?

    private var canWrite: Bool { session.isConnected && session.supportsMateInfo && !session.mateCommandPending }

    var body: some View {
        List {
            Section {
                Text(task.title).font(.headline).accessibilityAddTraits(.isHeader)
                LabeledContent("Status", value: mateTaskStatus(task.status))
                if let assignee = task.assignee { LabeledContent("Assigned to", value: assignee.name) }
                if let id = task.workerRunId {
                    Button("Open Chat", systemImage: "bubble.left") { openChat(id) }.disabled(!session.isConnected)
                }
            }
            if !task.brief.isEmpty {
                Section { MateInfoMarkdown(text: task.brief) } header: { MateSectionHeading("Task brief") }
            }
            if let result = task.result, !result.isEmpty {
                Section { MateInfoMarkdown(text: result) } header: { MateSectionHeading("Report") }
            }
            if !task.evidence.isEmpty {
                Section {
                    ForEach(Array(task.evidence.enumerated()), id: \.offset) { _, evidence in
                        Text(evidence).font(.subheadline)
                    }
                } header: {
                    MateSectionHeading("Evidence")
                }
            }
            if let failure = error ?? task.error {
                Section { Text(failure) } header: { MateSectionHeading("Status details") }
            }
            if session.mateCommandUncertain {
                Section {
                    Button("Check Mate change", systemImage: "arrow.clockwise") { perform(nil) }.disabled(!session.isConnected)
                }
            } else if mate.ready {
                actions
            }
        }
        .listStyle(.insetGrouped)
        .expandedNavigationTitle("Assignment")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { MateRecordDoneButton(checkmark: true) }
        }
        .sheet(isPresented: $showFollowup) {
            NavigationStack { MateTaskEditor(session: session, mateID: mate.id, taskID: task.id) }
        }
        .confirmationDialog("Cancel this assignment?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel Assignment", role: .destructive) { perform(.cancelTask(task.id)) }
        }
    }

    @ViewBuilder private var actions: some View {
        if task.isOpen || (task.status == "completed" && task.error != nil) {
            Section {
                if task.status == "blocked" {
                    Button("Follow Up", systemImage: "arrow.turn.up.right") { showFollowup = true }
                }
                if task.status == "uncertain" || (task.status == "completed" && task.error != nil) {
                    Button("Check Delivery", systemImage: "arrow.clockwise") { perform(.checkTask(task.id)) }
                }
                if task.isOpen {
                    Button("Cancel Assignment", role: .destructive) { confirmCancel = true }
                }
            }.disabled(!canWrite)
        }
    }

    private func perform(_ change: MateChange?) {
        let owner = session.ownership
        Task {
            guard owner == session.ownership, session.isConnected else { return }
            do {
                if let change {
                    guard canWrite else { return }
                    try await session.manageMate(mate.id, change: change)
                } else {
                    try await session.checkMateCommand()
                }
                error = nil
            } catch {
                if owner == session.ownership { self.error = error.localizedDescription }
            }
        }
    }
}

struct MateRoutineEditor: View {
    let session: BackendSession
    let mate: Mate
    let routine: MateRoutine?
    @State private var schedule: MateRoutineSchedule
    @State private var workspaceID: String?

    init(session: BackendSession, mate: Mate, routine: MateRoutine?) {
        self.session = session
        self.mate = mate
        self.routine = routine
        _schedule = State(initialValue: routine?.schedule ?? MateRoutineSchedule())
        _workspaceID = State(initialValue: routine?.workspaceId)
    }

    private var change: MateChange? {
        guard validText(schedule.title, limit: 200), validText(schedule.prompt, limit: 24_000) else { return nil }
        var value = schedule
        value.dayOfWeek = value.frequency == .weekly ? value.dayOfWeek ?? 1 : nil
        if let routine { return .updateRoutine(id: routine.id, revision: routine.revision, schedule: value) }
        return .createRoutine(value, workspaceID: workspaceID)
    }

    private var time: Binding<Date> {
        Binding(get: { schedule.wallTime }, set: { value in
            let minutes = Int(value.timeIntervalSince1970) / 60
            schedule.hour = (minutes / 60 % 24 + 24) % 24
            schedule.minute = (minutes % 60 + 60) % 60
        })
    }

    var body: some View {
        MateEditorForm(session: session, mateID: mate.id, title: routine == nil ? "New Routine" : "Routine",
                       submit: routine == nil ? "Create" : "Save", editable: mate.ready, change: change) {
            if mate.ready {
                Section { TextField("Routine name", text: $schedule.title) }
                Section {
                    TextEditor(text: $schedule.prompt).frame(minHeight: 120).accessibilityLabel("Routine task")
                } header: {
                    MateSectionHeading("Task and completion criteria")
                }
                scheduleFields
            } else {
                Section { MateInfoMarkdown(text: schedule.prompt) } header: { MateSectionHeading(schedule.title) }
                Section {
                    LabeledContent("Repeats", value: schedule.displayTime)
                    LabeledContent("Time zone", value: schedule.timezone)
                    LabeledContent("Run in", value: executionLabel)
                } header: {
                    MateSectionHeading("Schedule")
                }
            }
        }
    }

    private var executionLabel: String {
        guard let workspaceID else { return "Work" }
        return session.workspaces.first(where: { $0.id == workspaceID })?.name ?? "Workspace unavailable"
    }

    private var scheduleFields: some View {
        Section {
            Picker("Repeats", selection: $schedule.frequency) {
                ForEach(MateRoutineSchedule.Frequency.allCases) { frequency in
                    Text(frequency.rawValue.capitalized).tag(frequency)
                }
            }
            if schedule.frequency == .weekly {
                Picker("Day", selection: Binding(get: { schedule.dayOfWeek ?? 1 }, set: { schedule.dayOfWeek = $0 })) {
                    ForEach(Array(Calendar.current.weekdaySymbols.enumerated()), id: \.offset) { index, day in Text(day).tag(index) }
                }
            }
            if schedule.frequency == .hourly {
                Picker("Minute", selection: $schedule.minute) {
                    ForEach(0..<60) { minute in Text(minute, format: .number).tag(minute) }
                }
            } else {
                DatePicker("Time", selection: time, displayedComponents: .hourAndMinute).environment(\.timeZone, .gmt)
            }
            LabeledContent("Time zone", value: schedule.timezone)
            if routine == nil {
                Picker("Run in", selection: $workspaceID) {
                    Text("Work").tag(nil as String?)
                    ForEach(session.workspaces.filter { !$0.isArchived && $0.isReplica != true }) { workspace in
                        Text(workspace.name).tag(Optional(workspace.id))
                    }
                }
            } else {
                LabeledContent("Run in", value: executionLabel)
            }
        } header: {
            MateSectionHeading("Schedule")
        }
    }
}

extension MateRoutineSchedule {
    fileprivate var wallTime: Date { Date(timeIntervalSince1970: Double(hour * 3600 + minute * 60)) }

    var displayTime: String {
        if frequency == .hourly { return "Hourly at :\(minute.formatted(.number.precision(.integerLength(2))))" }
        let time = wallTime.formatted(Date.FormatStyle(date: .omitted, time: .shortened, timeZone: .gmt))
        if frequency == .weekly, let dayOfWeek, Calendar.current.weekdaySymbols.indices.contains(dayOfWeek) {
            return "\(Calendar.current.weekdaySymbols[dayOfWeek]) at \(time)"
        }
        return "\(frequency.rawValue.capitalized) at \(time)"
    }
}

private func validText(_ value: String, limit: Int) -> Bool {
    !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf16.count <= limit
}
