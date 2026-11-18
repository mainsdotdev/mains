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
                if directory.mates.isEmpty { ContentUnavailableView("No Mates yet", systemImage: "squareshape.split.2x2") }
                ForEach(directory.mates) { mate in
                    Button { openMate(mate.id) } label: {
                        HStack(spacing: 12) {
                            MateAvatarIcon(avatar: mate.avatar)
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
            } else if error == nil { ProgressView().accessibilityLabel("Loading Mates") }
        }
        .navigationTitle("Mates")
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
    @State private var avatar = MateAvatar(shape: "sphere", color: "blue")
    @State private var error: String?
    private var spaces: [Space] { session.mateSpaces }
    private var space: Space? { spaces.first { $0.id == spaceID } }
    private var models: [ModelChoice] { space.flatMap { session.models[$0.providerId] } ?? [] }
    private var levels: [String] { models.first { $0.id == modelID }?.supportedEffortLevels ?? [] }
    private var valid: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.utf16.count <= 100 && !modelID.isEmpty && space != nil }

    var body: some View {
        Form {
            Section {
                HStack { MateAvatarIcon(avatar: avatar); TextField("Name", text: $name).accessibilityIdentifier("mateName") }
                Picker("Shape", selection: $avatar.shape) {
                    ForEach(MateAvatarIcon.shapes, id: \.self) { Text($0.replacingOccurrences(of: "-", with: " ").capitalized).tag($0) }
                }
                Picker("Color", selection: $avatar.color) {
                    ForEach(["coral", "amber", "lime", "mint", "cyan", "blue", "violet", "rose"], id: \.self) { Text($0.capitalized).tag($0) }
                }
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
    @State private var mate: Mate?
    @State private var chats: [MateChat] = []
    @State private var answer = ""
    @State private var profile: MateProfile?
    @State private var draft = ConversationDraft()
    @State private var error: String?
    @State private var loading = true
    @State private var reload = 0
    @State private var consent: ConsentContext?
    @State private var afterConsent: (() -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            List {
                if let error { Text(error).foregroundStyle(.secondary) }
                if session.mateCommandUncertain {
                    Button("Check Mate change") { Task { await attempt { _ = try await session.checkMateCommand() } } }
                        .disabled(!session.isConnected)
                }
                if let mate {
                    Section {
                        HStack(spacing: 12) {
                            MateAvatarIcon(avatar: mate.avatar)
                            VStack(alignment: .leading) {
                                Text(mate.name).font(.headline)
                                Text(Provider.name(mate.providerId)).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                        if !mate.description.isEmpty { Text(mate.description).font(.subheadline).foregroundStyle(.secondary) }
                    }
                    if !mate.ready { setup(mate) }
                    else {
                        if let welcome = mate.welcome { welcomeSection(mate, welcome) }
                        Section("Chats") {
                            let history = chats.filter { $0.id != mate.welcome?.runId || mate.welcome?.state == "starting" }
                            if history.isEmpty { Text("No chats yet").foregroundStyle(.secondary) }
                            ForEach(history) { chat in
                                Button { openChat(chat.id) } label: {
                                    HStack {
                                        Text(chat.displayTitle).lineLimit(1)
                                        Spacer()
                                        Text(chat.updatedAt, style: .relative).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                } else if loading { ProgressView().accessibilityLabel("Loading Mate") }
            }
            if let mate, mate.ready {
                if session.pendingMessage?.status == .uncertain {
                    Button("Check message delivery", systemImage: "arrow.clockwise") {
                        Task {
                            let owner = session.ownership
                            do {
                                let runID = try await session.checkDelivery()
                                if owner == session.ownership { openChat(runID) }
                            } catch { if owner == session.ownership { self.error = error.localizedDescription } }
                        }
                    }.disabled(!session.isConnected).padding(.vertical, 8)
                }
                MessageComposer(session: session, context: ComposerContext(mate: mate), draft: draft,
                    canSend: session.isConnected && !session.sending && session.pendingMessage?.status != .uncertain && !draft.isSending,
                    model: {}, options: {}, send: { withConsent(mate) { Task { await send(mate) } } })
                    .padding(.bottom, 8)
            }
        }
        .navigationTitle(mate?.name ?? "Mate").navigationBarTitleDisplayMode(.inline)
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

    @ViewBuilder private func setup(_ mate: Mate) -> some View {
        Section("Profile setup") {
            if let welcome = mate.welcome, let question = welcome.question, let setup = question.profileSetup {
                ForEach(Array(setup.turns.enumerated()), id: \.offset) { _, turn in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(turn.question).foregroundStyle(.secondary)
                        Text(turn.answer)
                    }
                }
                if let profile {
                    TextField("Responsibility", text: Binding(get: { profile.description }, set: { self.profile?.description = $0 }), axis: .vertical)
                    TextField("Instructions", text: Binding(get: { profile.instructions }, set: { self.profile?.instructions = $0 }), axis: .vertical)
                        .lineLimit(3...8)
                    Button("Save profile") { Task { await attempt { try await session.saveMateSetup(mate.id, profile: profile) } } }
                        .disabled(session.mateCommandPending || !session.isConnected || profile.instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } else if welcome.state == "ready" {
                    Text(question.question)
                    TextField("Your answer", text: $answer, axis: .vertical)
                    Button("Send answer") {
                        let text = answer
                        withConsent(mate) {
                            Task {
                                await attempt {
                                    try await session.answerMateSetup(mate.id, step: setup.turns.count, answer: text)
                                    if answer == text { answer = "" }
                                }
                            }
                        }
                    }.disabled(session.mateCommandPending || !session.isConnected || answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } else { welcomeStatus(mate, welcome) }
            }
        }
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
            guard let current = directory.mates.first(where: { $0.id == mateID }) else {
                mate = nil; error = "This Mate is unavailable."; loading = false; return
            }
            mate = current
            if profile == nil { profile = current.welcome?.question?.profileSetup?.draft }
            if current.ready { chats = try await session.loadMateChats(mateID) }
            error = nil
            loading = false
        } catch { if !Task.isCancelled, owner == session.ownership { self.error = error.localizedDescription; loading = false } }
    }
}

struct MateAvatarIcon: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let avatar: MateAvatar
    static let shapes = ["steps", "sphere", "cube", "flower", "weave", "lantern", "arch", "kite", "swallow", "mains",
                         "badge-card", "badge-pin", "badge-shield", "badge-ticket", "felt-sprout", "felt-pebble", "felt-cloud", "felt-bloom"]
    var body: some View {
        let colors: [String: Color] = ["coral": .red, "amber": .orange, "lime": .green, "mint": .mint, "cyan": .cyan, "blue": .blue, "violet": .purple, "rose": .pink]
        let symbols = ["steps": "square.stack.3d.up", "sphere": "circle.grid.3x3.fill", "cube": "cube.fill", "flower": "camera.aperture", "weave": "square.grid.3x3.fill",
                       "lantern": "lamp.table.fill", "arch": "arcade.stick", "kite": "diamond.fill", "swallow": "bird.fill", "mains": "squareshape.split.2x2",
                       "badge-card": "rectangle.fill", "badge-pin": "pin.fill", "badge-shield": "shield.fill", "badge-ticket": "ticket.fill",
                       "felt-sprout": "leaf.fill", "felt-pebble": "capsule.fill", "felt-cloud": "cloud.fill", "felt-bloom": "camera.macro"]
        let color = colors[avatar.color] ?? .blue
        Image(systemName: symbols[avatar.shape] ?? "circle.grid.3x3.fill")
            .font(.system(size: 20, weight: .semibold)).foregroundStyle(color)
            .frame(width: 40, height: 40).background(color.opacity(0.14), in: .rect(cornerRadius: 12))
            .accessibilityHidden(true)
    }
}
