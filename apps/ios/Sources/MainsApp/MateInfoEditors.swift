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
                            DisconnectedState(message: "Connect to your computer to load this information.").centered
                        } else if let error {
                            EmptyStateView(artwork: .mates, title: "\(title) unavailable", description: Text(error)) {
                                Button("Try Again") { retry += 1 }
                            }.centered
                        } else {
                            ContentSkeleton(label: "Loading \(title)…", layout: .fields)
                                .frame(maxHeight: .infinity, alignment: .top)
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
    var avatarBackdrop: MateAvatar? = nil
    var dismissFocus: (() -> Void)? = nil
    @ViewBuilder let content: () -> Content

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @State private var submitting = false
    @State private var checking = false
    @State private var confirmDelete = false
    @State private var error: String?
    @State private var consentRequest: MateConsentRequest?

    private var canWrite: Bool {
        let supported = (change ?? delete).map(session.supportsMateChange) ?? session.supportsMateInfo
        return editable && !submitting && consentRequest == nil && session.isConnected && supported && !session.mateCommandPending
    }

    var body: some View {
        Group {
            if let avatarBackdrop {
                ZStack {
                    MateAvatarBackdrop(avatar: avatarBackdrop)
                    GeometryReader { viewport in
                        ScrollViewReader { scroll in
                            ScrollView {
                                VStack(spacing: 20) {
                                    content().disabled(submitting || checking)
                                    feedback.id("mateEditorFeedback")
                                }
                                .padding(.vertical, 16)
                                .frame(maxWidth: 560)
                                .frame(maxWidth: .infinity, minHeight: viewport.size.height, alignment: .top)
                                .background(alignment: .center) {
                                    KeyboardDismissBackground(dismissFocus: dismissFocus)
                                }
                            }
                            .scrollDismissesKeyboard(.interactively)
                            .navigationHeaderFade(
                                background: MateAvatarBackdrop.headerFill(for: avatarBackdrop, in: colorScheme),
                                coversSafeAreaAtRest: false
                            )
                            .onChange(of: error) { _, message in
                                if message != nil { scroll.scrollTo("mateEditorFeedback", anchor: .bottom) }
                            }
                        }
                    }
                }
                .mateCreationChrome(title, extendsBackdrop: true)
            } else {
                Form { formRows }
                    .expandedNavigationTitle(title)
            }
        }
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
        .mateConsentSheet($consentRequest, session: session) { send($0) }
        .confirmationDialog("Delete this memory?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Memory", role: .destructive) { if let delete { send(delete) } }
        }
    }

    @ViewBuilder private var formRows: some View {
        content().disabled(submitting || checking)
        feedback
        if editable, delete != nil {
            Section {
                Button("Delete Memory", role: .destructive) { confirmDelete = true }.disabled(!canWrite)
            }
        }
    }

    @ViewBuilder private var feedback: some View {
        if let error {
            Section { Text(error).foregroundStyle(.secondary) }
        }
        if checking && session.mateCommandUncertain {
            Section {
                Button("Check Mate change", systemImage: "arrow.clockwise") { send(nil) }
                    .disabled(!session.isConnected || submitting)
            }
        }
    }

    private func send(_ change: MateChange?) {
        let owner = session.ownership
        Task {
            guard !submitting, consentRequest == nil, owner == session.ownership else { return }
            if change != nil {
                guard editable else { return }
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
            } catch let requirement as MateConsentRequired {
                if let change, owner == session.ownership {
                    consentRequest = MateConsentRequest(requirement: requirement, change: change)
                }
            } catch {
                if owner == session.ownership {
                    checking = session.mateCommandUncertain
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

struct MateTeamSelection {
    var id: String?
    private var created: [MateTeam] = []

    init(id: String? = nil) { self.id = id }

    func choices(in teams: [MateTeam]) -> [MateTeam] {
        teams + created.filter { team in !teams.contains { $0.id == team.id } }
    }

    mutating func select(_ team: MateTeam) {
        created.removeAll { $0.id == team.id }
        created.append(team)
        id = team.id
    }
}

struct MateTeamPicker<MenuLabel: View>: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let teams: [MateTeam]
    @Binding var selection: MateTeamSelection
    let openEditor: () -> Void
    @ViewBuilder let label: (String) -> MenuLabel

    var body: some View {
        let choices = selection.choices(in: teams)
        let name = selection.id.map { id in choices.first { $0.id == id }?.name ?? "Unavailable team" } ?? "No team"
        Menu {
            option("No team", id: nil)
            ForEach(choices) { team in option(team.name, id: team.id) }
            if session.supportsMateTeamCreation || session.pendingMateTeamName != nil {
                Divider()
                Button("New Team", systemImage: "plus", action: openEditor)
                    .disabled(session.mateCommandPending && !(session.mateCommandUncertain && session.pendingMateTeamName != nil))
                    .accessibilityIdentifier("newMateTeam")
            }
        } label: {
            label(name)
        }
        .accessibilityLabel("Team")
        .accessibilityValue(name)
        .accessibilityIdentifier("mateTeamPicker")
        .disabled(choices.isEmpty && selection.id == nil && !session.supportsMateTeamCreation && session.pendingMateTeamName == nil)
    }

    private func option(_ name: String, id: String?) -> some View {
        Button { selection.id = id } label: {
            if selection.id == id { Label(name, systemImage: "checkmark") }
            else { Text(name) }
        }
    }
}

struct MateTeamEditor: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let select: (MateTeam) -> Void
    @Environment(\.dismiss) private var dismiss
    @FocusState private var enteringName: Bool
    @State private var name = ""
    @State private var sending = false
    @State private var error: String?

    private var checking: Bool { session.mateCommandUncertain && session.pendingMateTeamName != nil }
    private var canSubmit: Bool {
        guard session.isConnected, !sending else { return false }
        return checking || (session.supportsMateTeamCreation && !session.mateCommandPending && validText(name, limit: 100))
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Team name", text: $name)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.done)
                    .focused($enteringName)
                    .onSubmit(submit)
                    .disabled(sending || checking)
                    .accessibilityIdentifier("mateTeamName")
                if let error { Text(error).foregroundStyle(.secondary) }
            }
            .defaultFocus($enteringName, true)
            .expandedNavigationTitle("New Team")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(sending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(checking ? "Check" : "Create", action: submit)
                        .disabled(!canSubmit)
                        .accessibilityIdentifier("submitMateTeam")
                }
            }
        }
        .onAppear { if let pending = session.pendingMateTeamName { name = pending } }
        .interactiveDismissDisabled(sending)
    }

    private func submit() {
        guard canSubmit else { return }
        let owner = session.ownership
        let recover = checking
        sending = true
        error = nil
        Task {
            defer { sending = false }
            guard owner == session.ownership else { return }
            do {
                let team = if recover { try await session.checkMateTeamCreation() }
                else { try await session.createMateTeam(name: name) }
                guard owner == session.ownership else { return }
                select(team)
                dismiss()
            } catch {
                if owner == session.ownership { self.error = error.localizedDescription }
            }
        }
    }
}

struct MateProfileEditor: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let mate: Mate
    let teams: [MateTeam]
    let original: MateEditableProfile
    @State private var profile: MateEditableProfile
    @State private var team: MateTeamSelection
    @State private var settings: ComposerSettings
    @State private var rememberedStyles: [String: String] = [:]
    @State private var showingTeamEditor = false
    @State private var previewActive = false
    private enum Field: Hashable { case name, description, instructions }
    @FocusState private var focusedField: Field?

    init(session: BackendSession, mate: Mate, original: MateEditableProfile, teams: [MateTeam]) {
        self.session = session
        self.mate = mate
        self.original = original
        self.teams = teams
        _profile = State(initialValue: original)
        _team = State(initialValue: MateTeamSelection(id: mate.teamId))
        var settings = ComposerSettings(model: mate.model)
        settings.setEffort(mate.details?.effort ?? "", provider: mate.providerId)
        _settings = State(initialValue: settings)
    }

    private var provider: String { mate.providerId }
    private var models: [ModelChoice] { session.models[provider] ?? [] }
    private var selectedModel: ModelChoice? { models.first { $0.id == settings.model } }
    private var originalEffort: String { mate.details?.effort ?? "" }
    private var canSelectModel: Bool { session.supportsMateModelEditing && !session.mateCommandPending }

    private var change: MateChange? {
        var edited = profile
        edited.name = edited.name.trimmingCharacters(in: .whitespacesAndNewlines)
        edited.description = edited.description.trimmingCharacters(in: .whitespacesAndNewlines)
        edited.instructions = edited.instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        let effort = settings.effort(provider: provider)
        let settingsChanged = settings.model != mate.model || effort != originalEffort
        let modelChange = settingsChanged
            ? MateModelChange(model: settings.model, effort: effort, expectedModel: mate.model, expectedEffort: originalEffort)
            : nil
        guard validText(edited.name, limit: 100), edited.description.utf16.count <= 1000,
              validText(edited.instructions, limit: 16_000),
              !settingsChanged || session.supportsMateModelEditing,
              edited != original || team.id != mate.teamId || settingsChanged else { return nil }
        return .updateProfile(edited, original: original, teamID: team.id, originalTeamID: mate.teamId, modelChange: modelChange)
    }

    var body: some View {
        NavigationStack {
            MateEditorForm(session: session, mateID: mate.id, title: "Edit Mate", change: change,
                           avatarBackdrop: profile.avatar, dismissFocus: { focusedField = nil }) {
                TextField("Mate name", text: $profile.name)
                    .font(.largeTitle.weight(.semibold).width(.expanded))
                    .multilineTextAlignment(.center).textInputAutocapitalization(.words)
                    .focused($focusedField, equals: .name).submitLabel(.done)
                    .onSubmit { focusedField = nil }
                    .padding(.horizontal, 24).frame(minHeight: 52)
                    .accessibilityIdentifier("editMateName")
                if let catalogue = MateRobotAssets.catalogue {
                    MateRobotPicker(catalogue: catalogue, avatar: $profile.avatar, remembered: $rememberedStyles,
                                    stageHeight: 185, previewActive: previewActive, isSelecting: true)
                } else {
                    MateRobotThumbnail(preset: nil).frame(height: 140)
                }
                MateTeamPicker(session: session, teams: teams, selection: $team, openEditor: {
                    focusedField = nil
                    showingTeamEditor = true
                }) { name in
                    mateCreationChoiceLabel(name, icon: "icon:users")
                }.frame(maxWidth: 230).padding(.horizontal, 24)
                modelOptions
                VStack(alignment: .leading, spacing: 16) {
                    MateSectionHeading("Description")
                    TextField("Description", text: $profile.description, axis: .vertical)
                        .lineLimit(2...5).focused($focusedField, equals: .description)
                        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .modifier(GlassSurface(radius: 20, interactive: false))
                        .accessibilityIdentifier("editMateDescription")
                    MateSectionHeading("Instructions")
                    TextEditor(text: $profile.instructions).frame(minHeight: 120)
                        .scrollContentBackground(.hidden)
                        .focused($focusedField, equals: .instructions)
                        .padding(12).modifier(GlassSurface(radius: 20, interactive: false))
                        .accessibilityLabel("Instructions")
                        .accessibilityIdentifier("editMateInstructions")
                }
                .padding(.horizontal, 20)
            }
            .background(alignment: .center) {
                MatePickerAppearance(isVisible: $previewActive)
                    .frame(width: 0, height: 0).allowsHitTesting(false).accessibilityHidden(true)
            }
        }
        .task(id: canSelectModel) {
            if canSelectModel { await session.loadModels(provider) }
        }
        .sheet(isPresented: $showingTeamEditor) {
            MateTeamEditor(session: session) { team.select($0) }
        }
    }

    @ViewBuilder private var modelOptions: some View {
        if session.supportsMateModelEditing {
            ModelEffortPicker(providerID: provider, models: models, model: selectedModel, settings: settings,
                              loading: session.loadingModels.contains(provider), enabled: canSelectModel,
                              storedEffortOnly: true, compactWheel: true, error: session.modelErrors[provider],
                              canRetry: canSelectModel, retry: { Task { await session.loadModels(provider, force: true) } },
                              selectModel: { model in
                                  focusedField = nil
                                  settings = mateSettings(settings, selecting: model, provider: provider)
                              }, updateEffort: { settings = $0 })
        } else {
            VStack(spacing: 8) {
                Text(mate.model + " · " + ComposerSettings.effortLabel(originalEffort, provider: provider))
                Text("Update Mains on your computer to change the model and effort.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 24)
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
                        .tint(AppBrand.accent)
                    if note.revision == 0, originalTeamID != nil {
                        Toggle("Share with team", isOn: $note.shared)
                            .tint(AppBrand.accent)
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
    let managingMateID: String?
    let task: MateTask
    let openChat: (String) -> Void
    @State private var showFollowup = false
    @State private var confirmCancel = false
    @State private var error: String?

    private var canWrite: Bool { session.isConnected && session.supportsMateAssignments && !session.mateCommandPending }

    var body: some View {
        List {
            Section {
                Text(task.title)
                    .font(.headline)
                    .fontWidth(task.title == "Mate request" ? nil : .expanded)
                    .accessibilityAddTraits(.isHeader)
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
            } else if managingMateID != nil {
                actions
            }
        }
        .listStyle(.insetGrouped)
        .expandedNavigationTitle("Assignment")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { MateRecordDoneButton(checkmark: true) }
        }
        .sheet(isPresented: $showFollowup) {
            if let managingMateID {
                NavigationStack { MateTaskEditor(session: session, mateID: managingMateID, taskID: task.id) }
            }
        }
        .confirmationDialog("Cancel this assignment?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel Assignment", role: .destructive) { perform(.cancelTask(task.id)) }
        }
    }

    @ViewBuilder private var actions: some View {
        if task.hasManagementActions {
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
                    guard canWrite, let managingMateID else { return }
                    try await session.manageMate(managingMateID, change: change)
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
