import SwiftUI

struct MatesView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let openMate: (String) -> Void
    @State private var directory: MateDirectory?
    @State private var error: String?
    @State private var creating = false
    @State private var reload = 0

    var body: some View {
        List {
            if session.mateCommandUncertain {
                Button("Check Mate change", systemImage: "arrow.clockwise") {
                    Task {
                        do { try await session.checkMateCommand(); error = nil }
                        catch { self.error = error.localizedDescription }
                    }
                }.disabled(!session.isConnected)
            }
            if let error { Text(error).foregroundStyle(.secondary) }
            if let directory {
                if directory.mates.isEmpty {
                    ContentUnavailableView {
                        Label { Text("No Mates yet") } icon: { RegistryIcon(token: "icon:assistant-steps", size: 34) }
                    }
                } else {
                    mateSections(directory)
                }
            } else if error == nil { ProgressView().accessibilityLabel("Loading Mates") }
        }
        .navigationTitle("Mates")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New Mate", systemImage: "plus") { creating = true }
                    .disabled(directory == nil || !session.isConnected || session.mateCommandPending)
                    .accessibilityIdentifier("newMate")
            }
        }
        .sheet(isPresented: $creating) {
            if let directory {
                NavigationStack {
                    NewMateForm(session: session, teams: directory.teams, dismiss: { creating = false }) { id in
                        creating = false
                        openMate(id)
                    }
                }
            }
        }
        .task(id: "\(session.ownership):\(session.isConnected):\(session.matesRevision):\(reload)") { await load() }
        .refreshable { reload += 1 }
    }

    @ViewBuilder private func mateSections(_ directory: MateDirectory) -> some View {
        let members = Dictionary(grouping: directory.mates, by: \.teamId)
        let teamNames = Dictionary(directory.teams.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        var seen: Set<String> = []
        let teamIDs = directory.mates.compactMap(\.teamId).filter { seen.insert($0).inserted }

        ForEach(teamIDs, id: \.self) { teamID in
            Section(teamNames[teamID] ?? "Unavailable team") {
                mateRows(members[teamID] ?? [])
            }
        }
        if let unassigned = members[nil] {
            if teamIDs.isEmpty { mateRows(unassigned) }
            else { Section("No team") { mateRows(unassigned) } }
        }
    }

    private func mateRows(_ mates: [Mate]) -> some View {
        ForEach(mates) { mate in
            Button { openMate(mate.id) } label: {
                HStack(spacing: 12) {
                    MateRobotThumbnail(preset: MateRobotAssets.catalogue?.preset(for: mate.avatar, mateID: mate.id))
                        .frame(width: 40, height: 40)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(mate.name).font(.headline)
                        if !mate.ready { Text("Finish setup").font(.subheadline).foregroundStyle(.secondary) }
                        else if !mate.description.isEmpty { Text(mate.description).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
            }.buttonStyle(ChatPressStyle()).accessibilityIdentifier("mate-\(mate.id)")
        }
    }

    private func load() async {
        let owner = session.ownership
        guard session.isConnected else { error = "Connect to your computer to use Mates."; return }
        do { directory = try await session.loadMates(); error = nil }
        catch { if !Task.isCancelled, owner == session.ownership { self.error = error.localizedDescription } }
    }
}

private struct NewMateForm: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let teams: [MateTeam]
    let dismiss: () -> Void
    let created: (String) -> Void
    @State private var name = ""
    @State private var spaceID = ""
    @State private var modelID = ""
    @State private var effort = ""
    @State private var teamID = ""
    @State private var avatar = MateRobotAssets.catalogue?.defaultPreset?.avatar ?? MateAvatar(shape: "terminal-amber", color: "amber")
    @State private var error: String?
    private var spaces: [Space] { session.mateSpaces }
    private var space: Space? { spaces.first { $0.id == spaceID } }
    private var models: [ModelChoice] { space.flatMap { session.models[$0.providerId] } ?? [] }
    private var levels: [String] { models.first { $0.id == modelID }?.supportedEffortLevels ?? [] }
    private var valid: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.utf16.count <= 100 && !modelID.isEmpty && space != nil }

    var body: some View {
        Form {
            Section {
                if let catalogue = MateRobotAssets.catalogue {
                    MateRobotPicker(catalogue: catalogue, avatar: $avatar)
                }
                TextField("Name", text: $name).accessibilityIdentifier("mateName")
                Picker("Team", selection: $teamID) {
                    Text("No team").tag("")
                    ForEach(teams) { Text($0.name).tag($0.id) }
                }
            }
            Section("Model") {
                if spaces.isEmpty { Text("Enable a Claude or Codex Space on your computer.").foregroundStyle(.secondary) }
                Picker("Space", selection: $spaceID) {
                    ForEach(spaces) { Text("\($0.name) · \(Provider.name($0.providerId))").tag($0.id) }
                }
                if let space, session.loadingModels.contains(space.providerId) { ProgressView("Loading models") }
                if let space, let message = session.modelErrors[space.providerId] {
                    Text(message).foregroundStyle(.secondary)
                    Button("Retry models") { Task { await session.loadModels(space.providerId, force: true) } }
                }
                Picker("Model", selection: $modelID) {
                    ForEach(models) { Text($0.displayName).tag($0.id) }
                }
                if !levels.isEmpty {
                    Picker("Effort", selection: $effort) {
                        Text("Default").tag("")
                        ForEach(levels, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                }
            }
            if let error { Section { Text(error).foregroundStyle(.secondary) } }
            if session.mateCommandUncertain {
                Section { Button("Check creation") { Task { await checkCreation() } }.disabled(!session.isConnected) }
            }
        }
        .navigationTitle("New Mate").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: dismiss).disabled(session.mateCommandPending && !session.mateCommandUncertain)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Create") { Task { await create() } }
                    .disabled(!valid || !session.isConnected || session.mateCommandPending)
                    .accessibilityIdentifier("createMate")
            }
        }
        .interactiveDismissDisabled(session.mateCommandPending && !session.mateCommandUncertain)
        .onAppear { if spaceID.isEmpty { spaceID = spaces.first?.id ?? "" } }
        .task(id: spaceID) {
            guard let selected = space else { return }
            modelID = ""; effort = ""
            await session.loadModels(selected.providerId)
            guard !Task.isCancelled, spaceID == selected.id else { return }
            modelID = models.first(where: { $0.id == selected.model })?.id
                ?? models.first(where: { $0.isDefault == true })?.id ?? models.first?.id ?? ""
        }
        .onChange(of: modelID) { if !levels.contains(effort) { effort = "" } }
    }
    private func create() async {
        let owner = session.ownership
        guard let space else { return }
        do {
            let id = try await session.createMate(name: name, space: space, model: modelID, effort: effort,
                                                  teamID: teamID.isEmpty ? nil : teamID, avatar: avatar)
            if owner == session.ownership { created(id) }
        } catch { if owner == session.ownership { self.error = error.localizedDescription } }
    }
    private func checkCreation() async {
        do {
            if let id = try await session.checkMateCommand() { created(id) }
            else { dismiss() }
        }
        catch { self.error = error.localizedDescription }
    }
}

struct MateView: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let mateID: String
    let openChat: (String) -> Void
    private struct SetupReply {
        let step: Int
        let turn: MateWelcome.Turn
    }
    private enum ProfileField: Hashable { case description, instructions }
    @State private var mate: Mate?
    @State private var chats: [MateChat] = []
    @State private var answer = ""
    @State private var submittedSetup: SetupReply?
    @State private var editedProfile: MateProfile?
    @FocusState private var focusedProfileField: ProfileField?
    @State private var savingProfile = false
    @State private var draft = ConversationDraft()
    @State private var error: String?
    @State private var loading = true
    @State private var reload = 0
    @State private var consent: ConsentContext?
    @State private var afterConsent: (() -> Void)?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var showsSetup: Bool {
        guard let mate else { return false }
        return mate.welcome?.question?.profileSetup != nil && (!mate.ready || chats.isEmpty)
    }

    var body: some View {
        Group {
            if showsSetup, let mate, let welcome = mate.welcome, let question = welcome.question, let setup = question.profileSetup {
                setupConversation(mate, welcome, question, setup)
            } else {
                mateDetails
            }
        }
        .navigationTitle(mate?.name ?? "Mate").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if showsSetup, let mate {
                ToolbarItem(placement: .principal) { MateConversationTitle(mate: mate) }
                    .sharedBackgroundVisibility(.hidden)
            }
        }
        .task(id: "\(session.ownership):\(session.isConnected):\(session.matesRevision):\(reload)") { await load() }
        .refreshable { reload += 1 }
        .sheet(item: $consent, onDismiss: { afterConsent = nil }) { consent in
            ConsentView(context: consent) {
                guard consent.backendID == session.pairing?.descriptor.backendId else { return }
                session.grantConsent(providerID: consent.providerID, backendID: consent.backendID)
                afterConsent?()
            }
        }
    }

    private var mateDetails: some View {
        VStack(spacing: 0) {
            List {
                if let error { Text(error).foregroundStyle(.secondary) }
                if session.mateCommandUncertain {
                    checkMateChange
                }
                if let mate {
                    Section {
                        VStack(spacing: 6) {
                            if let preset = MateRobotAssets.catalogue?.preset(for: mate.avatar, mateID: mate.id) {
                                MateRobotPreview(preset: preset).frame(width: 120, height: 120)
                            }
                            VStack(spacing: 3) {
                                Text(mate.name).font(.headline)
                                Text(Provider.name(mate.providerId)).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                        if !mate.description.isEmpty { Text(mate.description).font(.subheadline).foregroundStyle(.secondary) }
                    }
                    if mate.ready {
                        if let welcome = mate.welcome { welcomeSection(mate, welcome) }
                        Section("Chats") {
                            let history = chats.filter { $0.id != mate.welcome?.runId || mate.welcome?.state == "starting" }
                            if history.isEmpty { Text("No chats yet").foregroundStyle(.secondary) }
                            ForEach(history) { chat in
                                Button { openChat(chat.id) } label: {
                                    HStack {
                                        Text(chat.displayTitle).lineLimit(1)
                                        Spacer()
                                        TimelineView(.periodic(from: .now, by: 60)) { clock in
                                            Text(compactRelativeAge(chat.updatedAt, now: clock.date))
                                                .font(.caption).foregroundStyle(.secondary)
                                                .fixedSize(horizontal: true, vertical: false)
                                        }
                                    }
                                }
                            }
                        }
                    } else { Text("Loading profile setup…").foregroundStyle(.secondary) }
                } else if loading { ProgressView().accessibilityLabel("Loading Mate") }
            }
            if let mate, mate.ready { firstTaskComposer(mate) }
        }
    }

    private func setupConversation(_ mate: Mate, _ welcome: MateWelcome, _ question: MateWelcome.Question, _ setup: MateWelcome.Setup) -> some View {
        let tint = MateRobotAssets.chatTint(for: mate.avatar)
        let pending = submittedSetup.flatMap { $0.step == setup.turns.count ? $0.turn : nil }
        let canAnswer = welcome.state == "ready" && setup.saved != true && setup.draft == nil && pending == nil
        return GeometryReader { container in
            let visibleHeight = max(0, container.size.height - container.safeAreaInsets.top - container.safeAreaInsets.bottom)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    MateSetupHistory(turns: setup.turns + (pending.map { [$0] } ?? []), tint: tint)
                    if setup.saved == true {
                        MateSetupBubble(text: question.idleMessage)
                    } else if welcome.state == "failed" {
                        welcomeStatus(mate, welcome)
                    } else if welcome.state != "ready" || pending != nil {
                        preparingProfile(mate)
                    } else if let draft = setup.draft {
                        setupDraftCard(draft, mate: mate)
                    } else {
                        MateSetupBubble(text: question.question)
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                    if session.mateCommandUncertain { checkMateChange }
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(16)
                .frame(maxWidth: .infinity, minHeight: visibleHeight, alignment: .top)
                .background(alignment: .center) {
                    KeyboardDismissBackground(color: Color(.systemBackground)) { focusedProfileField = nil }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom, for: .sizeChanges)
            .accessibilityIdentifier("mateSetupConversation")
        }
        .safeAreaPadding(.top, 44)
        .scrollEdgeEffectStyle(.soft, for: .top)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if setup.saved == true, mate.ready { firstTaskComposer(mate) }
            else if canAnswer { setupComposer(mate, question: question.question, step: setup.turns.count) }
        }
    }

    private func preparingProfile(_ mate: Mate) -> some View {
        HStack(spacing: 10) {
            MateRobotThumbnail(preset: MateRobotAssets.catalogue?.preset(for: mate.avatar, mateID: mate.id))
                .frame(width: 34, height: 34)
            Text("Preparing the profile…").foregroundStyle(.secondary).activityShimmer()
        }
    }

    private func setupComposer(_ mate: Mate, question: String, step: Int) -> some View {
        let text = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        let expanded = !answer.isEmpty
        return MateComposerLayout(expanded: expanded) {
            TextField("What would you like help with?", text: $answer, axis: .vertical)
                .lineLimit(1...5).frame(maxWidth: .infinity)
                .accessibilityIdentifier("mateSetupAnswer")
            ComposerSendButton(providerID: mate.providerId) {
                let reply = SetupReply(step: step, turn: .init(question: question, answer: text))
                withConsent(mate) { Task { await submitSetupReply(reply) } }
            }
            .disabled(text.isEmpty || text.utf16.count > 24_000 || !session.isConnected || session.mateCommandPending || consent != nil)
            .accessibilityLabel("Send answer").accessibilityIdentifier("sendMateSetupAnswer")
        }
        .animation(reduceMotion ? nil : MateComposerLayout.transition, value: expanded)
        .padding(.horizontal, 8).padding(.vertical, 6)
        .modifier(GlassSurface(radius: 28, interactive: false))
        .padding(.horizontal, 12).padding(.bottom, 8)
    }

    private func setupDraftCard(_ draft: MateProfile, mate: Mate) -> some View {
        let profile = editedProfile ?? draft
        let busy = savingProfile || session.mateCommandPending
        return VStack(alignment: .leading, spacing: 14) {
            Text("Profile draft").font(.headline).accessibilityAddTraits(.isHeader)
            if editedProfile != nil {
                VStack(alignment: .leading, spacing: 12) {
                    draftField(.description, text: Binding(get: { editedProfile?.description ?? draft.description },
                        set: { editedProfile?.description = $0 }), lines: 1...5, identifier: "mateProfileDescription")
                    draftField(.instructions, text: Binding(get: { editedProfile?.instructions ?? draft.instructions },
                        set: { editedProfile?.instructions = $0 }), lines: 3...10, identifier: "mateProfileInstructions")
                }
                .disabled(busy)
            } else {
                Text(draft.description)
                Text("Instructions").font(.footnote).foregroundStyle(.secondary)
                Text(draft.instructions)
            }
            ViewThatFits(in: .horizontal) {
                HStack { draftActions(draft, profile: profile, mateID: mate.id, busy: busy) }
                VStack(alignment: .leading) { draftActions(draft, profile: profile, mateID: mate.id, busy: busy) }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .center) {
            KeyboardDismissBackground(color: Color(.secondarySystemBackground)) { focusedProfileField = nil }
                .clipShape(.rect(cornerRadius: 22))
        }
    }

    private func draftField(_ field: ProfileField, text: Binding<String>, lines: ClosedRange<Int>, identifier: String) -> some View {
        let title: LocalizedStringKey = field == .description ? "Description" : "Instructions"
        return VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.footnote).foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(title, text: text, axis: .vertical)
                .lineLimit(lines)
                .focused($focusedProfileField, equals: field)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 12))
                .overlay {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(focusedProfileField == field ? AppBrand.accent : Color(.separator))
                        .allowsHitTesting(false)
                }
                .accessibilityLabel(Text(title)).accessibilityIdentifier(identifier)
        }
    }

    @ViewBuilder private func draftActions(_ draft: MateProfile, profile: MateProfile, mateID: String, busy: Bool) -> some View {
        Button("Save profile") { Task { await saveSetupProfile(profile, mateID: mateID) } }
            .buttonStyle(.borderedProminent)
            .tint(AppBrand.accent)
            .disabled(busy || !session.isConnected || profile.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                      || profile.instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                      || profile.description.utf16.count > 1_000 || profile.instructions.utf16.count > 16_000)
            .accessibilityIdentifier("saveMateProfile")
        Button(editedProfile == nil ? "Edit" : "Discard edits") { editedProfile = editedProfile == nil ? draft : nil }
            .buttonStyle(.bordered)
            .disabled(busy)
            .accessibilityIdentifier("editMateProfile")
    }

    private var checkMateChange: some View {
        Button("Check Mate change", systemImage: "arrow.clockwise") {
            Task {
                await attempt { _ = try await session.checkMateCommand() }
                if error != nil, !session.mateCommandPending {
                    submittedSetup = nil
                    savingProfile = false
                }
            }
        }.disabled(!session.isConnected)
    }

    private func firstTaskComposer(_ mate: Mate) -> some View {
        VStack(spacing: 8) {
            if session.pendingMessage?.status == .uncertain {
                Button("Check message delivery", systemImage: "arrow.clockwise") {
                    Task {
                        let owner = session.ownership
                        do {
                            let runID = try await session.checkDelivery()
                            if owner == session.ownership { openChat(runID) }
                        } catch { if owner == session.ownership { self.error = error.localizedDescription } }
                    }
                }.disabled(!session.isConnected)
            }
            MessageComposer(session: session, context: ComposerContext(mate: mate), draft: draft,
                canSend: session.isConnected && !session.sending && session.pendingMessage?.status != .uncertain && !draft.isSending,
                model: {}, options: {}, send: { withConsent(mate) { Task { await send(mate) } } })
        }.padding(.bottom, 8)
    }

    private func submitSetupReply(_ reply: SetupReply) async {
        guard submittedSetup == nil, session.isConnected, !session.mateCommandPending, mate?.welcome?.state == "ready",
              let question = mate?.welcome?.question, let setup = question.profileSetup,
              setup.saved != true, setup.draft == nil, setup.turns.count == reply.step, question.question == reply.turn.question else { return }
        submittedSetup = reply
        await attempt { try await session.answerMateSetup(mateID, step: reply.step, answer: reply.turn.answer) }
        if error != nil, !session.mateCommandUncertain { submittedSetup = nil }
    }

    private func saveSetupProfile(_ profile: MateProfile, mateID: String) async {
        guard !savingProfile, session.isConnected, !session.mateCommandPending,
              mate?.welcome?.state == "ready", let setup = mate?.welcome?.question?.profileSetup,
              setup.saved != true, setup.draft != nil else { return }
        savingProfile = true
        await attempt { try await session.saveMateSetup(mateID, profile: profile) }
        if error != nil { savingProfile = false }
    }
    @ViewBuilder private func welcomeSection(_ mate: Mate, _ welcome: MateWelcome) -> some View {
        if welcome.question?.profileSetup == nil {
            Section {
                if welcome.state == "ready", let question = welcome.question {
                    Text(question.question)
                    ForEach(question.options, id: \.label) { option in
                        Button(option.label) { draft.text = option.label; withConsent(mate) { Task { await send(mate) } } }
                            .disabled(!session.isConnected || draft.isSending || session.sending)
                    }
                    Button("Skip") { Task { await attempt { try await session.skipMateWelcome(mate.id) } } }
                        .disabled(session.mateCommandPending || !session.isConnected)
                } else if welcome.state == "skipped", let message = welcome.question?.idleMessage { Text(message) }
                else { welcomeStatus(mate, welcome) }
            }
        }
    }
    @ViewBuilder private func welcomeStatus(_ mate: Mate, _ welcome: MateWelcome) -> some View {
        if welcome.state == "failed" {
            Text(welcome.error ?? "Couldn't prepare this Mate.").foregroundStyle(.secondary)
            Button("Retry") { withConsent(mate) { Task { await attempt { try await session.retryMateWelcome(mate.id) } } } }
                .disabled(session.mateCommandPending || !session.isConnected)
        } else if ["pending", "generating"].contains(welcome.state) { ProgressView("Preparing…") }
    }

    private func withConsent(_ mate: Mate, action: @escaping () -> Void) {
        if session.hasConsent(providerID: mate.providerId) { action() }
        else if let backend = session.pairing?.descriptor.backendId {
            afterConsent = action
            consent = ConsentContext(backendID: backend, providerID: mate.providerId)
        }
    }
    private func send(_ mate: Mate) async {
        let owner = session.ownership
        guard let submission = draft.begin(retainingContent: true) else { return }
        do {
            let id = try await session.send(submission.text, attachments: submission.attachments, contextSkills: submission.contextSkills,
                                            contextScope: submission.contextScope, mate: mate, useMateWelcome: true)
            guard owner == session.ownership else { return }
            draft.accept(submission)
            openChat(id)
        } catch {
            guard owner == session.ownership else { return }
            draft.reject(submission, message: error.localizedDescription, uncertain: session.pendingMessage?.status == .uncertain)
            self.error = error.localizedDescription
        }
    }
    private func attempt(_ action: () async throws -> Void) async {
        let owner = session.ownership
        do { try await action(); if owner == session.ownership { error = nil } }
        catch { if owner == session.ownership { self.error = error.localizedDescription } }
    }
    private func load() async {
        let owner = session.ownership
        guard session.isConnected else { error = "Connect to your computer to use Mates."; loading = false; return }
        do {
            let directory = try await session.loadMates(mateID: mateID)
            guard !Task.isCancelled, owner == session.ownership else { return }
            guard let current = directory.mates.first(where: { $0.id == mateID }) else {
                mate = nil; error = "This Mate is unavailable."; loading = false; return
            }
            mate = current
            let setup = current.welcome?.question?.profileSetup
            if let submitted = submittedSetup, let setup, setup.turns.indices.contains(submitted.step) {
                if setup.turns[submitted.step] == submitted.turn { answer = "" }
                submittedSetup = nil
            }
            if setup?.saved == true || setup == nil {
                savingProfile = false
                editedProfile = nil
            }
            if current.ready {
                let currentChats = try await session.loadMateChats(mateID)
                guard !Task.isCancelled, owner == session.ownership else { return }
                chats = currentChats
            }
            error = nil
            loading = false
        } catch { if !Task.isCancelled, owner == session.ownership { self.error = error.localizedDescription; loading = false } }
    }
}

struct MateSetupHistory: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let turns: [MateWelcome.Turn]
    let tint: Color

    var body: some View {
        if !turns.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(Array(turns.enumerated()), id: \.offset) { _, turn in
                    MateSetupBubble(text: turn.question)
                    PromptBubble(text: turn.answer, skills: [], fill: tint)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
        }
    }
}

private struct MateSetupBubble: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let text: String

    var body: some View {
        Text(text)
            .textSelection(.enabled)
            .padding(14)
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 22))
    }
}
