import SwiftUI

struct ComposerSheet<Content: View>: View {
    let title: String
    var backgroundStyle = AnyShapeStyle(.regularMaterial)
    @ViewBuilder let content: () -> Content
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            content()
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Close", systemImage: "xmark") { dismiss() }
                            .accessibilityIdentifier("closeComposerSheet")
                    }
                }
        }
        .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
        .presentationCornerRadius(40).presentationBackground(backgroundStyle)
    }
}

struct TargetSheet: View {
    let session: BackendSession
    let space: Space
    @Environment(\.dismiss) private var dismiss
    private var target: HomeTarget { session.homeTargets[space.id] ?? HomeTarget() }
    var body: some View {
        ComposerSheet(title: space.mode == "developer" ? "Workspace" : "Project", backgroundStyle: AnyShapeStyle(Color(.secondarySystemBackground))) {
            VStack(alignment: .leading, spacing: 8) {
                Text(space.mode == "developer" ? "Mains runs code inside a workspace on your computer." : "File this run under a project, or leave it standalone.")
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(.horizontal, 20).padding(.top, 8)
                List {
                    Section {
                        if space.mode == "developer" {
                            let local = session.workspaces.filter { $0.isReplica != true }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
                            if local.isEmpty { Text("No local workspaces yet.").foregroundStyle(.secondary).listRowBackground(Color(.tertiarySystemBackground)) }
                            ForEach(local) { workspace in
                                let missing = session.gitStates.first(where: { $0.workspaceId == workspace.id })?.pathExists == false
                                Button {
                                    var next = target; next.workspaceID = workspace.id
                                    session.selectTarget(next, spaceID: space.id); dismiss()
                                } label: {
                                    HStack {
                                        WorkspaceLabel(session: session, workspace: workspace)
                                        if workspace.id == target.workspaceID { Image(systemName: "checkmark").foregroundStyle(.blue) }
                                    }.contentShape(.rect)
                                }.buttonStyle(.plain).disabled(missing)
                                    .listRowInsets(EdgeInsets(top: 6, leading: 20, bottom: 6, trailing: 20))
                                    .listRowBackground(Color(.tertiarySystemBackground))
                                    .accessibilityAddTraits(workspace.id == target.workspaceID ? .isSelected : [])
                                    .accessibilityIdentifier("target-\(workspace.id)")
                            }
                        } else {
                            projectChoice("No project", icon: nil, selected: target.collectionID == nil) {
                                var next = target; next.collectionID = nil; session.selectTarget(next, spaceID: space.id); dismiss()
                            }.accessibilityIdentifier("target-none")
                            ForEach(session.collections) { collection in
                                projectChoice(collection.name, icon: collection.icon, selected: target.collectionID == collection.id) {
                                    var next = target; next.collectionID = collection.id; session.selectTarget(next, spaceID: space.id); dismiss()
                                }.accessibilityIdentifier("target-\(collection.id)")
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped).scrollContentBackground(.hidden)
                .contentMargins(.top, 0, for: .scrollContent)
                .environment(\.defaultMinListRowHeight, 44)
            }
        }
    }
    private func projectChoice(_ name: String, icon: String?, selected: Bool, action: @escaping () -> Void) -> some View {
        return Button(action: action) {
            HStack(spacing: 10) {
                RegistryIcon(token: icon, fallback: "tray", size: 19)
                Text(name).foregroundStyle(.primary).lineLimit(1)
                Spacer(minLength: 8)
                if selected { Image(systemName: "checkmark").foregroundStyle(.blue) }
            }.font(.body).frame(minHeight: 32).contentShape(.rect)
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 6, leading: 20, bottom: 6, trailing: 20))
        .listRowBackground(Color(.tertiarySystemBackground))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct ModelSheet: View {
    let session: BackendSession
    let context: ComposerContext
    @State private var selecting = false
    @Environment(\.dismiss) private var dismiss
    private var settings: ComposerSettings { context.settings(session) }
    private var models: [ModelChoice] { session.models[context.providerId] ?? [] }
    private var selected: ModelChoice? { context.model(session) }
    private var blocked: Bool { selecting || context.saving(session) || !session.isConnected || session.sending }
    var body: some View {
        ComposerSheet(title: "Select model", backgroundStyle: AnyShapeStyle(Color(.secondarySystemBackground))) {
            catalogue
                .safeAreaInset(edge: .bottom, spacing: 0) { SettingsRecoveryNotice(session: session, runID: context.runID) }
                .task { await session.loadModels(context.providerId) }
        }
    }
    private var catalogue: some View {
        ScrollViewReader { reader in
            ScrollView {
                VStack(spacing: 0) {
                    if context.modelsLoading(session) && models.isEmpty {
                        HStack { ProgressView(); Text("Loading models…").foregroundStyle(.secondary) }.padding(16)
                    }
                    if let error = session.modelErrors[context.providerId] {
                        Text(error).font(.caption).foregroundStyle(.secondary).padding(16)
                        Button("Try again") { Task { await session.loadModels(context.providerId, force: true) } }.padding(.bottom, 12)
                    }
                    if models.isEmpty && session.modelErrors[context.providerId] == nil && !context.modelsLoading(session) {
                        Text("No models available.").font(.subheadline).foregroundStyle(.secondary).padding(16)
                    }
                    if !settings.model.isEmpty && selected == nil && !context.modelsLoading(session) && session.modelErrors[context.providerId] == nil {
                        modelRow(settings.model, detail: "Saved selection", selected: true) { dismiss() }
                            .id(settings.model)
                        separator
                    }
                    ForEach(models) { model in
                        modelRow(model.name, detail: model.description, selected: selected?.id == model.id) {
                            var next = settings; next.select(model, provider: context.providerId); choose(next)
                        }.id(model.id).accessibilityIdentifier("model-\(model.id)")
                        if model.id != models.last?.id { separator }
                    }
                }
                .background(Color(.tertiarySystemBackground), in: .rect(cornerRadius: 24))
                .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 16)
            }
            .onChange(of: selected?.id, initial: true) { _, id in
                reader.scrollTo(id ?? settings.model, anchor: .center)
            }
        }
    }
    private var separator: some View { Color(.separator).frame(height: 0.5).padding(.horizontal, 16) }
    private func modelRow(_ title: String, detail: String?, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.body).foregroundStyle(.primary).lineLimit(2)
                    if let detail, !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                }.frame(maxWidth: .infinity, alignment: .leading)
                if selected { Image(systemName: "checkmark").foregroundStyle(.blue) }
            }.padding(.horizontal, 16).padding(.vertical, 12).frame(minHeight: 44).contentShape(.rect)
        }.buttonStyle(ChatPressStyle()).disabled(blocked).accessibilityAddTraits(selected ? .isSelected : [])
    }
    private func choose(_ next: ComposerSettings) {
        guard !blocked else { return }
        guard next != settings else { dismiss(); return }
        selecting = true
        let owner = session.ownership
        Task {
            guard owner == session.ownership else { return }
            defer { if owner == session.ownership { selecting = false } }
            do {
                try await context.commit(next, session: session)
                guard owner == session.ownership else { return }
                dismiss()
            } catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
        }
    }

}

struct RunOptionsSheet: View {
    let session: BackendSession
    let context: ComposerContext
    @State private var catalog: CodexPermissions?
    @State private var catalogError: String?
    @State private var loading = true
    private var settings: ComposerSettings { context.settings(session) }
    private var model: ModelChoice? { session.models[context.providerId]?.first { $0.id == settings.model || settings.model.isEmpty && $0.isDefault == true } }
    var body: some View {
        ComposerSheet(title: "Run options", backgroundStyle: AnyShapeStyle(Color(.secondarySystemBackground))) {
            List {
                if context.mode == "developer" {
                    Section("Permissions") {
                        if context.providerId == "codex", loading { HStack { ProgressView(); Text("Loading computer policy…") }.modifier(CompactOptionRow()) }
                        else if let catalogError {
                            Text(catalogError).foregroundStyle(.secondary).modifier(CompactOptionRow())
                            Button("Try again") { Task { await loadPolicy() } }.modifier(CompactOptionRow())
                        } else {
                            ForEach(permissions) { option in
                                choice(option.title, detail: option.disabledReason ?? option.detail, detailLimit: option.disabledReason == nil ? 1 : nil,
                                       selected: settings.permission(provider: context.providerId) == option.id,
                                       first: option.id == permissions.first?.id, last: option.id == permissions.last?.id) {
                                    var next = settings; next.setPermission(option.id, provider: context.providerId); context.save(next, session: session)
                                }.disabled(option.disabledReason != nil).accessibilityIdentifier("permission-\(option.id)")
                            }
                        }
                    }
                }
                if context.providerId == "codex" {
                    Section {
                        if context.mode == "developer" {
                            Toggle("Plan mode", isOn: configToggle("planMode", exclusive: "goalMode")).modifier(CompactOptionRow())
                        }
                        if context.mode != "chat" { Toggle("Goal mode", isOn: configToggle("goalMode", exclusive: "planMode")).modifier(CompactOptionRow()) }
                    }
                }
                if let tiers = model?.serviceTiers, !tiers.isEmpty {
                    Section("Speed") {
                        Picker("Service tier", selection: Binding(get: {
                            let value = settings.config["serviceTier"]?.string ?? ""
                            return value.isEmpty ? "default" : value
                        }, set: { value in
                            var next = settings; next.config["serviceTier"] = .string(value); context.save(next, session: session)
                        })) {
                            Text("Default").tag("default")
                            ForEach(tiers.filter { $0.id != "default" }) { Text($0.name).tag($0.id) }
                        }.modifier(CompactOptionRow())
                    }
                } else if model?.supportsFastMode == true {
                    Section {
                        Toggle("Fast mode", isOn: Binding(get: {
                            context.providerId == "codex" ? ["fast", "priority", "ultrafast"].contains(settings.config["serviceTier"]?.string ?? "") : settings.config["fastMode"]?.bool == true
                        }, set: { on in
                            var next = settings
                            if context.providerId == "codex" { next.config["serviceTier"] = .string(on ? "fast" : "default") }
                            else { next.config["fastMode"] = .bool(on) }
                            context.save(next, session: session)
                        })).modifier(CompactOptionRow())
                    }
                }
            }
                .listStyle(.insetGrouped).scrollContentBackground(.hidden).contentMargins(.top, 0, for: .scrollContent)
                .listSectionSpacing(8).environment(\.defaultMinListRowHeight, 44).environment(\.defaultMinListHeaderHeight, 24)
                .textCase(nil).tint(Provider.accent(context.providerId))
                .disabled(context.saving(session) || !session.isConnected || session.sending)
                .safeAreaInset(edge: .bottom) { SettingsRecoveryNotice(session: session, runID: context.runID) }
                .task(id: context.workspace(session)) { await loadPolicy() }
        }
    }
    private var permissions: [PermissionChoice] {
        if context.providerId == "codex" { return catalog?.choices(current: settings.permission(provider: context.providerId)) ?? [] }
        return PermissionChoice.choices(provider: context.providerId)
    }
    private func configToggle(_ key: String, exclusive: String) -> Binding<Bool> {
        Binding(get: { settings.config[key]?.bool == true }, set: { value in
            var next = settings; next.config[key] = .bool(value)
            if value { next.config[exclusive] = .bool(false) }
            context.save(next, session: session)
        })
    }
    private func loadPolicy() async {
        guard context.providerId == "codex", context.mode == "developer" else { loading = false; return }
        loading = true; catalogError = nil
        do { catalog = try await session.codexPermissions(workspaceID: context.workspace(session)) }
        catch { catalogError = error.localizedDescription }
        loading = false
    }
}

@MainActor private func choice(_ title: String, detail: String? = nil, detailLimit: Int? = 1, selected: Bool,
                              first: Bool, last: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(.primary).lineLimit(1)
                if let detail, !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(detailLimit) }
            }
            Spacer(minLength: 8)
            if selected { Image(systemName: "checkmark").foregroundStyle(.blue) }
        }.frame(minHeight: 32).contentShape(.rect)
    }.buttonStyle(.plain).modifier(CompactOptionRow(top: first ? 12 : 5, bottom: last ? 12 : 5)).accessibilityAddTraits(selected ? .isSelected : [])
}

private struct CompactOptionRow: ViewModifier {
    var top: CGFloat = 10
    var bottom: CGFloat = 10
    func body(content: Content) -> some View {
        content.listRowInsets(EdgeInsets(top: top, leading: 20, bottom: bottom, trailing: 20)).listRowBackground(Color(.tertiarySystemBackground))
    }
}
