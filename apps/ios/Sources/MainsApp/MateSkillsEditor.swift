import SwiftUI

struct MateSkillsEditor: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let mate: Mate
    @Binding var selected: [MateSkill]
    let editable: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var unavailable: Set<String> = []
    @State private var pluginIDs: Set<String> = []

    private var visible: [MateSkill] { selected.filter { !pluginIDs.contains($0.id) } }
    private var active: [MateSkill] { visible.filter { !unavailable.contains($0.id) } }
    private var inactive: [MateSkill] { visible.filter { unavailable.contains($0.id) } }
    private var canAdd: Bool { session.isConnected && !session.mateCommandPending && selected.count < 20 }
    private var blocksDismissal: Bool { session.mateCommandPending && !session.mateCommandUncertain }

    var body: some View {
        NavigationStack {
            List {
                Section("\(mate.name) Skills") {
                    if active.isEmpty {
                        Label(inactive.isEmpty ? "No skills assigned" : "No active skills", systemImage: "puzzlepiece.extension")
                            .foregroundStyle(.secondary)
                    } else {
                        skillRows(active)
                    }
                }
                if editable {
                    Section {
                        NavigationLink {
                            MateSkillLibrary(session: session, mateID: mate.id, excluded: Set(selected.map(\.id)), select: add)
                        } label: { Label("Add from Library", systemImage: "plus") }
                        .disabled(!canAdd).accessibilityIdentifier("mateAddSkill")
                        NavigationLink {
                            MateSkillAuthor(session: session, mate: mate, onSave: add)
                        } label: { Label("Create with Mains", systemImage: "sparkles") }
                        .disabled(!canAdd).accessibilityIdentifier("mateCreateSkill")
                    } footer: {
                        if selected.count >= 20 { Text("This Mate has 20 skill assignments. Remove one to add another.") }
                    }
                }
                if !inactive.isEmpty {
                    Section {
                        DisclosureGroup {
                            skillRows(inactive)
                        } label: {
                            Label("Unavailable skills (\(inactive.count))", systemImage: "exclamationmark.triangle")
                        }
                    }
                }
            }
            .expandedNavigationTitle("Skills")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.disabled(blocksDismissal)
                }
            }
            .task(id: "\(session.ownership):\(session.isConnected):\(session.matesRevision)") { await loadAvailability() }
        }
        .interactiveDismissDisabled(blocksDismissal)
        .onChange(of: session.ownership) { _, _ in dismiss() }
    }

    private func skillRows(_ entries: [MateSkill]) -> some View {
        ForEach(entries) { skill in
            HStack(spacing: 12) {
                MateSkillLabel(skill: skill)
                if editable {
                    Spacer(minLength: 0)
                    Button("Remove \(skill.name)", systemImage: "xmark") {
                        selected.removeAll { $0.id == skill.id }
                    }.labelStyle(.iconOnly).buttonStyle(.borderless).foregroundStyle(.secondary)
                        .disabled(session.mateCommandPending)
                }
            }
        }
    }

    private func add(_ skill: MateSkill) {
        guard editable, selected.count < 20, !selected.contains(where: { $0.id == skill.id }) else { return }
        selected.append(skill)
    }

    private func loadAvailability() async {
        guard session.isConnected, mate.ready else { return }
        do {
            let page = try await session.loadMateSkills(mate.id)
            guard !Task.isCancelled else { return }
            unavailable = Set(page.unavailableIds)
            pluginIDs = Set(page.pluginSkillIds)
        } catch { /* The saved assignments are still readable when discovery fails. */ }
    }
}

struct MateSkillsLinkLabel: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let count: Int

    var body: some View {
        LabeledContent {
            HStack(spacing: 8) {
                Text(count, format: .number).monospacedDigit()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).accessibilityHidden(true)
            }
        } label: { Label("Skills", systemImage: "puzzlepiece.extension") }
    }
}

private struct MateSkillLabel: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let skill: MateSkill

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "puzzlepiece.extension").foregroundStyle(.secondary)
                .frame(width: 36, height: 36)
                .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 10)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(skill.name).font(.body.weight(.medium))
                if !skill.description.isEmpty { Text(skill.description).font(.footnote).foregroundStyle(.secondary).lineLimit(2) }
            }
        }
        .foregroundStyle(.primary)
    }
}

private struct MateSkillLibrary: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let mateID: String
    let excluded: Set<String>
    let select: (MateSkill) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var page: MateSkillPage?
    @State private var offset = 0
    @State private var error: String?
    @State private var retry = 0

    private var request: String { "\(session.ownership):\(session.isConnected):\(query):\(offset):\(retry)" }

    var body: some View {
        List {
            if !session.isConnected {
                Label("Connect to your computer to load skills.", systemImage: "wifi.slash").foregroundStyle(.secondary)
            } else if let error {
                Text(error).foregroundStyle(.secondary)
                Button("Try Again") { retry += 1 }
            } else if let page {
                let choices = page.items.filter { !excluded.contains($0.id) }
                if choices.isEmpty { Text("No matching skills").foregroundStyle(.secondary) }
                ForEach(choices) { skill in
                    Button { select(skill); dismiss() } label: { MateSkillLabel(skill: skill) }.buttonStyle(.plain)
                }
                if offset > 0 || page.nextOffset != nil {
                    Section {
                        if offset > 0 { Button("Previous Page") { offset -= 50 } }
                        if let next = page.nextOffset { Button("Next Page") { offset = next } }
                    }
                }
            } else {
                ProgressView("Loading skills…")
            }
        }
        .expandedNavigationTitle("Skill Library")
        .searchable(text: $query, prompt: "Search skills")
        .onChange(of: query) { _, _ in offset = 0 }
        .task(id: request) {
            let current = request
            page = nil; error = nil
            guard session.isConnected else { return }
            do {
                if !query.isEmpty { try await Task.sleep(for: .milliseconds(200)) }
                let search = String(decoding: query.utf16.prefix(100), as: UTF16.self)
                let result = try await session.loadMateSkills(mateID, query: search, offset: offset)
                guard !Task.isCancelled, current == request else { return }
                page = result
            } catch {
                guard !Task.isCancelled, current == request else { return }
                self.error = error.localizedDescription
            }
        }
    }
}

private struct MateSkillAuthor: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    private enum Operation: Equatable { case generate, save }
    private struct SharingRequest: Identifiable {
        let id = UUID()
        let requirement: MateConsentRequired
        let workflow: String
    }

    let session: BackendSession
    let mate: Mate
    let onSave: (MateSkill) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var workflow = ""
    @State private var draft: MateSkillDraft?
    @State private var busy = false
    @State private var retryOperation: Operation?
    @State private var error: String?
    @State private var sharing: SharingRequest?
    @State private var approvedWorkflow: String?

    private var request: String { workflow.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var enabled: Bool { session.isConnected && !busy && !session.mateCommandPending }

    var body: some View {
        Form {
            Section("Skill Workflow") {
                TextField("Describe what this skill should do", text: $workflow, axis: .vertical)
                    .lineLimit(3...6).disabled(!enabled).accessibilityIdentifier("mateSkillWorkflow")
                Button("Generate Draft", systemImage: "sparkles") { perform(.generate, workflow: request) }
                    .disabled(!enabled || request.isEmpty || request.utf16.count > 8000)
            }
            if let fields = Binding($draft) {
                Section("Draft") {
                    TextField("Title", text: fields.title)
                    TextField("Skill name", text: fields.name).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("When to use this skill", text: fields.description, axis: .vertical).lineLimit(2...5)
                    TextEditor(text: fields.markdown).frame(minHeight: 160).accessibilityLabel("Workflow instructions in Markdown")
                }.disabled(!enabled)
                Section {
                    Button("Save Skill") { perform(.save) }.disabled(!enabled || draft?.isValid != true)
                }
            }
            if busy { ProgressView(retryOperation == .save ? "Saving skill…" : "Generating draft…") }
            if let error { Section { Text(error).foregroundStyle(.secondary) } }
            if let retryOperation, session.mateCommandUncertain {
                Section {
                    Button(retryOperation == .save ? "Check Save" : "Check Generation") { perform(retryOperation, recovering: true) }
                        .disabled(busy || !session.isConnected)
                }
            }
        }
        .expandedNavigationTitle("New Skill")
        .navigationBarBackButtonHidden(busy)
        .sheet(item: $sharing, onDismiss: resumeGeneration) { pending in
            let consent = pending.requirement
            ConsentView(context: ConsentContext(backendID: consent.backendID, providerID: consent.providerID, isDemo: session.isDemo)) {
                guard consent.owner == session.ownership, consent.backendID == session.pairing?.descriptor.backendId else { return }
                session.grantConsent(providerID: consent.providerID, backendID: consent.backendID)
                approvedWorkflow = pending.workflow
            }
        }
    }

    private func resumeGeneration() {
        let workflow = approvedWorkflow
        approvedWorkflow = nil
        if let workflow { perform(.generate, workflow: workflow) }
    }

    private func perform(_ operation: Operation, workflow: String = "", recovering: Bool = false) {
        guard !busy, session.isConnected, recovering || !session.mateCommandPending else { return }
        let owner = session.ownership
        let submittedDraft = draft
        busy = true; error = nil; retryOperation = operation
        Task {
            defer { busy = false }
            do {
                switch operation {
                case .generate:
                    let generated = if recovering { try await session.checkMateSkillGeneration(mate.id) }
                        else { try await session.generateMateSkill(mate, request: workflow) }
                    guard owner == session.ownership else { return }
                    draft = generated
                case .save:
                    guard let submittedDraft else { return }
                    let saved = if recovering { try await session.checkMateSkillSave(mate.id) }
                        else { try await session.saveMateSkill(mate.id, draft: submittedDraft) }
                    guard owner == session.ownership else { return }
                    onSave(saved)
                    dismiss()
                }
                retryOperation = nil
            } catch let requirement as MateConsentRequired {
                if owner == session.ownership { sharing = SharingRequest(requirement: requirement, workflow: workflow) }
                retryOperation = nil
            } catch {
                if owner == session.ownership { self.error = error.localizedDescription }
                if !session.mateCommandUncertain { retryOperation = nil }
            }
        }
    }
}
