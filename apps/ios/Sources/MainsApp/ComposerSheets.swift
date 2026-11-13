import SwiftUI

struct ComposerSheet<Content: View>: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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

/// A transparent snapping wheel. Native scrolling supplies momentum, while the
/// rows have no system picker highlight or model-dependent height.
struct ComposerModelWheel: UIViewRepresentable {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let models: [ModelChoice]
    let selectedID: String
    let pendingModel: ModelChoice?
    let providerID: String
    let loading: Bool
    let enabled: Bool
    let rowHeight: CGFloat
    var reduceMotion = false
    let onSelect: (ModelChoice) -> Void

    fileprivate struct Item: Equatable {
        let id: String
        let title: String
        let displayName: String
        let accessibilityDetail: String?
        let model: ModelChoice?
        var accessibleName: String { accessibilityDetail.map { title + ", " + $0 } ?? title }
    }
    fileprivate var items: [Item] {
        let catalogue = providerID == "opencode" ? OpenCodeModelDisplay.groups(models).flatMap(\.models) : models
        var result = catalogue.map { model in
            Item(id: model.id, title: model.label(for: providerID), displayName: model.displayName,
                 accessibilityDetail: providerID == "opencode" ? OpenCodeModelDisplay.parts(model.displayName)?.provider : nil, model: model)
        }
        if !result.contains(where: { $0.id == selectedID }) {
            let name = pendingModel?.label(for: providerID) ?? (providerID == "opencode" ? OpenCodeModelDisplay.parts(selectedID)?.name : nil) ?? selectedID
            let title = !name.isEmpty ? name : loading ? "Loading models…" : models.isEmpty ? "No models available" : "Select model"
            result.insert(Item(id: selectedID, title: title, displayName: pendingModel?.displayName ?? selectedID,
                               accessibilityDetail: selectedID.isEmpty ? nil : "Saved selection", model: nil), at: 0)
        }
        return result
    }
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> ModelWheelScroller {
        let view = ModelWheelScroller()
        let coordinator = context.coordinator
        coordinator.view = view; view.delegate = coordinator
        view.configureRow = { [weak coordinator] index, reused in coordinator?.row(index, reusing: reused) ?? UIView() }
        view.onChoose = { [weak coordinator] index, animated in coordinator?.choose(index, animated: animated) }
        view.onGeometryChange = { [weak coordinator] in coordinator?.restorePosition() }
        view.accessibilityIdentifier = "selectModel"; view.accessibilityLabel = "Model"
        return view
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ModelWheelScroller, context: Context) -> CGSize? {
        guard let width = proposal.width, let height = proposal.height, width.isFinite, height.isFinite else { return nil }
        return CGSize(width: width, height: height)
    }
    func updateUIView(_ view: ModelWheelScroller, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        let nextItems = items
        let changed = coordinator.items != nextItems || coordinator.lastRowHeight != rowHeight
        let availabilityChanged = coordinator.lastEnabled != enabled
        coordinator.items = nextItems; coordinator.lastRowHeight = rowHeight
        coordinator.lastEnabled = enabled
        view.rowHeight = rowHeight; view.rowCount = nextItems.count; view.reduceMotion = reduceMotion
        if changed { view.reloadRows(); view.layoutIfNeeded() }
        // History/effort refreshes must not interrupt an in-progress wheel spin.
        // Programmatic positioning/reload never invokes the selection callback.
        if changed || availabilityChanged || coordinator.lastSelectedID != selectedID { coordinator.restorePosition() }
        view.isUserInteractionEnabled = enabled && !models.isEmpty
        view.accessibilityTraits = enabled ? [.adjustable] : [.adjustable, .notEnabled]
        coordinator.updateAccessibility()
    }
    static func dismantleUIView(_ view: ModelWheelScroller, coordinator: Coordinator) {
        view.delegate = nil; view.configureRow = nil; view.onChoose = nil; view.onGeometryChange = nil
    }
    @MainActor final class Coordinator: NSObject, UIScrollViewDelegate {
        var parent: ComposerModelWheel
        fileprivate var items: [Item]
        weak var view: ModelWheelScroller?
        var lastSelectedID: String?
        var lastRowHeight: CGFloat = 0
        var lastEnabled: Bool?
        private var userInitiated = false
        init(_ parent: ComposerModelWheel) { self.parent = parent; items = parent.items }
        func row(_ index: Int, reusing view: UIView?) -> UIView {
            guard items.indices.contains(index) else { return UIView() }
            let item = items[index]
            let providerID = parent.providerID
            let configuration = UIHostingConfiguration { ModelWheelRow(item: item, providerID: providerID) }
                .background { Color.clear }.margins(.all, 0)
            if let view, let content = view as? UIContentView {
                content.configuration = configuration
                return view
            }
            let content = configuration.makeContentView()
            content.backgroundColor = .clear
            return content
        }
        func restorePosition() {
            userInitiated = false
            guard let view, let index = items.firstIndex(where: { $0.id == parent.selectedID }) else { return }
            let offset = CGPoint(x: 0, y: CGFloat(index) * parent.rowHeight)
            if abs(view.contentOffset.y - offset.y) > 0.5 { view.setContentOffset(offset, animated: false) }
            lastSelectedID = parent.selectedID; updateAccessibility()
        }
        func choose(_ index: Int, animated: Bool) {
            guard parent.enabled, let view, items.indices.contains(index) else { return }
            userInitiated = true
            let offset = CGPoint(x: 0, y: CGFloat(index) * parent.rowHeight)
            if animated && !parent.reduceMotion && abs(view.contentOffset.y - offset.y) > 0.5 {
                view.setContentOffset(offset, animated: true)
            } else { view.setContentOffset(offset, animated: false); finish(endingInteraction: true) }
        }
        func updateAccessibility() {
            guard let view, items.indices.contains(view.centeredIndex) else { return }
            view.accessibilityValue = items[view.centeredIndex].accessibleName
        }
        private func finish(endingInteraction: Bool = false) {
            guard let view, endingInteraction || (!view.isTracking && !view.isDragging) else { return }
            guard userInitiated, parent.enabled, items.indices.contains(view.centeredIndex),
                  let model = items[view.centeredIndex].model else { restorePosition(); return }
            userInitiated = false
            view.setContentOffset(CGPoint(x: 0, y: CGFloat(view.centeredIndex) * parent.rowHeight), animated: false)
            lastSelectedID = model.id
            parent.onSelect(model)
        }
        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) { userInitiated = parent.enabled }
        func scrollViewDidScroll(_ scrollView: UIScrollView) { updateAccessibility() }
        func scrollViewWillEndDragging(_ scrollView: UIScrollView, withVelocity velocity: CGPoint, targetContentOffset: UnsafeMutablePointer<CGPoint>) {
            guard let view else { return }
            let index = userInitiated && parent.enabled ? view.index(at: targetContentOffset.pointee.y)
                : items.firstIndex(where: { $0.id == parent.selectedID }) ?? 0
            targetContentOffset.pointee = CGPoint(x: 0, y: CGFloat(index) * parent.rowHeight)
        }
        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) { if !decelerate { finish(endingInteraction: true) } }
        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { finish() }
        func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) { finish() }
    }
}

/// Reuses only nearby rows. Transparent native scrolling avoids depending on
/// UIPickerView's private selection-background hierarchy.
final class ModelWheelScroller: UIScrollView {
    var rowHeight: CGFloat = 52
    var rowCount = 0
    var reduceMotion = false
    var configureRow: (@MainActor (Int, UIView?) -> UIView)?
    var onChoose: (@MainActor (Int, Bool) -> Void)?
    var onGeometryChange: (@MainActor () -> Void)?
    private var rows: [Int: UIView] = [:]
    private var reusableRows: [UIView] = []
    private var previousSize = CGSize.zero
    var centeredIndex: Int { index(at: contentOffset.y) }
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear; clipsToBounds = true; bounces = false
        showsVerticalScrollIndicator = false; showsHorizontalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never; keyboardDismissMode = .none
        decelerationRate = .fast; isDirectionalLockEnabled = true
        isAccessibilityElement = true; accessibilityTraits = .adjustable
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped(_:))))
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func index(at offset: CGFloat) -> Int { min(max(0, rowCount - 1), max(0, Int((offset / max(1, rowHeight)).rounded()))) }
    func reloadRows() {
        for view in rows.values { view.removeFromSuperview(); reusableRows.append(view) }
        rows.removeAll(); setNeedsLayout()
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin(); CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        let resized = previousSize != bounds.size
        previousSize = bounds.size
        let size = CGSize(width: bounds.width, height: bounds.height + CGFloat(max(0, rowCount - 1)) * rowHeight)
        if contentSize != size { contentSize = size }
        if resized { onGeometryChange?() }
        guard rowCount > 0, rowHeight > 0, bounds.height > 0 else { return }
        let radius = Int(ceil(bounds.height / rowHeight / 2)) + 1
        let visible = Set(max(0, centeredIndex - radius)...min(rowCount - 1, centeredIndex + radius))
        for index in Array(rows.keys) where !visible.contains(index) {
            if let view = rows.removeValue(forKey: index) { view.removeFromSuperview(); reusableRows.append(view) }
        }
        let padding = (bounds.height - rowHeight) / 2
        for index in visible {
            let row: UIView
            if let existing = rows[index] { row = existing }
            else {
                row = configureRow?(index, reusableRows.popLast()) ?? UIView()
                row.isUserInteractionEnabled = false; row.accessibilityElementsHidden = true
                rows[index] = row; addSubview(row)
            }
            row.bounds = CGRect(x: 0, y: 0, width: bounds.width, height: rowHeight)
            row.center = CGPoint(x: bounds.width / 2, y: padding + (CGFloat(index) + 0.5) * rowHeight)
            let distance = (row.center.y - contentOffset.y - bounds.height / 2) / rowHeight
            let scale = 1 - min(2, abs(distance)) * 0.06
            var transform = CATransform3DIdentity
            if !reduceMotion {
                transform.m34 = -1 / 600
                transform = CATransform3DRotate(transform, max(-1.2, min(1.2, distance * .pi / 7)), 1, 0, 0)
                transform = CATransform3DScale(transform, scale, scale, 1)
            }
            row.layer.transform = transform
            row.alpha = max(0.15, 1 - abs(distance) * 0.45)
        }
    }
    @objc private func tapped(_ gesture: UITapGestureRecognizer) {
        let row = index(at: gesture.location(in: self).y - bounds.height / 2)
        onChoose?(row, true)
    }
    override func accessibilityIncrement() {
        let next = min(max(0, rowCount - 1), centeredIndex + 1)
        if next != centeredIndex { onChoose?(next, false) }
    }
    override func accessibilityDecrement() {
        let next = max(0, centeredIndex - 1)
        if next != centeredIndex { onChoose?(next, false) }
    }
}

private struct ModelWheelRow: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let item: ComposerModelWheel.Item
    let providerID: String
    var body: some View {
        HStack(spacing: 7) {
            ComposerModelIcon(name: item.displayName, providerID: providerID)
            Text(item.title).font(.title2.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.85)
        }.foregroundStyle(.primary).frame(maxWidth: .infinity, alignment: .center).padding(.horizontal, 4)
            .transaction { $0.animation = nil; $0.disablesAnimations = true }
            .accessibilityElement(children: .ignore).accessibilityLabel(item.accessibleName)
    }
}

struct RunOptionsSheet: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
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
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    var top: CGFloat = 10
    var bottom: CGFloat = 10
    func body(content: Content) -> some View {
        content.listRowInsets(EdgeInsets(top: top, leading: 20, bottom: bottom, trailing: 20)).listRowBackground(Color(.tertiarySystemBackground))
    }
}
