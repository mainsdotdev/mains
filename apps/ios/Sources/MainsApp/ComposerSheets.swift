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
                .navigationHeaderFade(background: Color(.secondarySystemBackground))
                .expandedNavigationTitle(title)
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

struct HomeTargetPicker: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let context: ComposerContext
    let closing: Bool
    let close: () -> Void
    @State private var previewID: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .title2) private var rowHeight: CGFloat = 54

    private struct Choice: Identifiable, Equatable {
        let targetID: String?
        let name: String
        let icon: String?
        var detail: String? = nil
        var available = true
        var id: String { targetID.map { "target-\($0)" } ?? "no-project" }
        var accessibleName: String { detail.map { "\(name), \($0)" } ?? name }
    }

    private var isWorkspace: Bool { context.mode == "developer" }
    private var title: String { isWorkspace ? "Workspace" : "Project" }
    private var savedTarget: HomeTarget { context.spaceID.flatMap { session.homeTargets[$0] } ?? HomeTarget() }
    private var savedID: String? { isWorkspace ? savedTarget.workspaceID : savedTarget.collectionID }
    private var blocked: Bool { closing || !session.isConnected || session.changingMode || session.sending }

    private var choices: [Choice] {
        if isWorkspace {
            let projects = Dictionary(session.projects.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            let gitStates = Dictionary(session.gitStates.map { ($0.workspaceId, $0) }, uniquingKeysWith: { first, _ in first })
            return session.workspaces.filter { $0.isReplica != true }
                .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
                .map { workspace in
                    let git = gitStates[workspace.id]
                    let missing = git?.pathExists == false
                    return Choice(targetID: workspace.id, name: workspace.name,
                                  icon: workspace.projectId.flatMap { projects[$0]?.icon },
                                  detail: missing ? "Folder unavailable" : git?.branch ?? "No branch", available: !missing)
                }
        }
        return [Choice(targetID: nil, name: "No project", icon: nil)] + session.collections.map {
            Choice(targetID: $0.id, name: $0.name, icon: $0.icon)
        }
    }

    var body: some View {
        let items = choices
        let saved = savedID
        let selected = items.first { $0.id == previewID }
            ?? items.first { $0.targetID == saved }
            ?? items.first(where: \.available)
            ?? items.first
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Button(action: close) {
                    Image(systemName: "xmark").foregroundStyle(.secondary)
                        .frame(width: 44, height: 44).contentShape(.circle)
                }
                .accessibilityLabel("Close").accessibilityIdentifier("closeTargetPicker")
                Text(title).font(.headline.width(.expanded)).frame(maxWidth: .infinity)
                    .accessibilityAddTraits(.isHeader)
                Button {
                    if let selected { apply(selected) }
                } label: {
                    Image(systemName: "checkmark").font(.body.weight(.semibold))
                        .frame(width: 44, height: 44).contentShape(.circle)
                }
                .disabled(blocked || selected?.available != true)
                .accessibilityLabel(isWorkspace ? "Confirm workspace" : "Confirm project")
                .accessibilityIdentifier("confirmTarget")
            }
            .buttonStyle(ChatPressStyle())
            if let selected {
                ComposerChoiceWheel(items: items, selectedID: selected.id, accessibilityTitle: title,
                                    accessibilityID: "selectTarget", enabled: !blocked, rowHeight: rowHeight,
                                    reduceMotion: reduceMotion, alignsRowColumns: true, accessibleName: \.accessibleName,
                                    canSelect: \.available, onSelect: { previewID = $0.id }) { choice in
                    HStack(spacing: 10) {
                        RegistryIcon(token: choice.icon, fallback: isWorkspace ? "folder" : "tray", size: 22)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(choice.name).font(.title2.weight(.semibold))
                            if let detail = choice.detail {
                                Text(detail).font(.caption).foregroundStyle(Color(.secondaryLabel))
                            }
                        }
                        .lineLimit(1).truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "checkmark")
                            .font(.footnote.weight(.semibold)).foregroundStyle(Provider.accent(context.providerId))
                            .fixedSize().opacity(choice.targetID == saved ? 1 : 0)
                    }
                    .foregroundStyle(choice.available ? .primary : .secondary)
                    .padding(.horizontal, 12)
                }
                .frame(height: rowHeight * (dynamicTypeSize.isAccessibilitySize || items.count == 1 ? 1.8 : 3))
                .composerWheelFade()
            } else {
                Text("No local workspaces yet.").font(.subheadline).foregroundStyle(.secondary)
                    .padding(.vertical, 16)
            }
        }
        .padding(.horizontal, 20).padding(.bottom, 12)
    }

    private func apply(_ choice: Choice) {
        guard !blocked, let space = session.selectedSpace, space.id == context.spaceID, space.mode == context.mode,
              let current = choices.first(where: { $0.id == choice.id }), current.available else { return }
        var next = savedTarget
        if isWorkspace { next.workspaceID = current.targetID }
        else { next.collectionID = current.targetID }
        if next != savedTarget { session.selectTarget(next, spaceID: space.id) }
        close()
    }
}

/// A transparent snapping wheel. Native scrolling supplies momentum, while the
/// rows have no system picker highlight or model-dependent height.
struct ComposerModelWheel: View {
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

    fileprivate struct Item: Identifiable, Equatable {
        let id: String
        let title: String
        let displayName: String
        let accessibilityDetail: String?
        let model: ModelChoice?
        var accessibleName: String {
            if title.isEmpty { return String(localized: "Loading models…") }
            return accessibilityDetail.map { title + ", " + $0 } ?? title
        }
    }
    private var items: [Item] {
        let catalogue = providerID == "opencode" ? OpenCodeModelDisplay.groups(models).flatMap(\.models) : models
        var result = catalogue.map { model in
            Item(id: model.id, title: model.label(for: providerID), displayName: model.displayName,
                 accessibilityDetail: providerID == "opencode" ? OpenCodeModelDisplay.parts(model.displayName)?.provider : nil, model: model)
        }
        if !result.contains(where: { $0.id == selectedID }) {
            let name = pendingModel?.label(for: providerID) ?? (providerID == "opencode" ? OpenCodeModelDisplay.parts(selectedID)?.name : nil) ?? selectedID
            let title = !name.isEmpty ? name : loading ? "" : models.isEmpty ? "No models available" : "Select model"
            result.insert(Item(id: selectedID, title: title, displayName: pendingModel?.displayName ?? selectedID,
                               accessibilityDetail: selectedID.isEmpty ? nil : "Saved selection", model: nil), at: 0)
        }
        return result
    }
    var body: some View {
        ComposerChoiceWheel(items: items, selectedID: selectedID, accessibilityTitle: "Model", accessibilityID: "selectModel",
                            enabled: enabled && !models.isEmpty, rowHeight: rowHeight, reduceMotion: reduceMotion,
                            accessibleName: \.accessibleName, canSelect: { $0.model != nil }, onSelect: {
                                if let model = $0.model { onSelect(model) }
                            }) { ModelWheelRow(item: $0, providerID: providerID) }
    }
}

private struct ComposerChoiceWheel<Item: Identifiable & Equatable, Row: View>: UIViewRepresentable where Item.ID == String {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let items: [Item]
    let selectedID: String
    let accessibilityTitle: String
    let accessibilityID: String
    let enabled: Bool
    let rowHeight: CGFloat
    let reduceMotion: Bool
    var alignsRowColumns = false
    let accessibleName: (Item) -> String
    let canSelect: (Item) -> Bool
    let onSelect: (Item) -> Void
    @ViewBuilder let rowContent: (Item) -> Row

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> ComposerWheelScroller {
        let view = ComposerWheelScroller()
        let coordinator = context.coordinator
        coordinator.view = view; view.delegate = coordinator
        view.configureRow = { [weak coordinator] index, reused in coordinator?.row(index, reusing: reused) ?? UIView() }
        view.onChoose = { [weak coordinator] index, animated in coordinator?.choose(index, animated: animated) }
        view.onGeometryChange = { [weak coordinator] in coordinator?.restorePosition() }
        view.canChoose = { [weak coordinator] in coordinator?.canChoose($0) == true }
        view.accessibilityIdentifier = accessibilityID; view.accessibilityLabel = accessibilityTitle
        return view
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ComposerWheelScroller, context: Context) -> CGSize? {
        guard let width = proposal.width, let height = proposal.height, width.isFinite, height.isFinite else { return nil }
        return CGSize(width: width, height: height)
    }
    func updateUIView(_ view: ComposerWheelScroller, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        let nextItems = items
        let changed = coordinator.items != nextItems || coordinator.lastRowHeight != rowHeight
        let availabilityChanged = coordinator.lastEnabled != enabled
        coordinator.items = nextItems; coordinator.lastRowHeight = rowHeight
        coordinator.lastEnabled = enabled
        view.rowHeight = rowHeight; view.rowCount = nextItems.count; view.reduceMotion = reduceMotion
        view.alignsRowColumns = alignsRowColumns
        if changed { view.reloadRows(); view.layoutIfNeeded() }
        // History/effort refreshes must not interrupt an in-progress wheel spin.
        // Programmatic positioning/reload never invokes the selection callback.
        if changed || availabilityChanged || coordinator.lastSelectedID != selectedID { coordinator.restorePosition() }
        view.isUserInteractionEnabled = enabled
        view.accessibilityTraits = enabled ? [.adjustable] : [.adjustable, .notEnabled]
        coordinator.updateAccessibility()
    }
    static func dismantleUIView(_ view: ComposerWheelScroller, coordinator: Coordinator) {
        view.delegate = nil; view.configureRow = nil; view.onChoose = nil; view.canChoose = nil; view.onGeometryChange = nil
    }
    @MainActor final class Coordinator: NSObject, UIScrollViewDelegate {
        var parent: ComposerChoiceWheel
        var items: [Item]
        weak var view: ComposerWheelScroller?
        var lastSelectedID: String?
        var lastRowHeight: CGFloat = 0
        var lastEnabled: Bool?
        private var userInitiated = false
        init(_ parent: ComposerChoiceWheel) { self.parent = parent; items = parent.items }
        func row(_ index: Int, reusing view: UIView?) -> UIView {
            guard items.indices.contains(index) else { return UIView() }
            let item = items[index]
            let rowContent = parent.rowContent
            let configuration = UIHostingConfiguration { rowContent(item) }
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
        func canChoose(_ index: Int) -> Bool {
            parent.enabled && items.indices.contains(index) && parent.canSelect(items[index])
        }
        func choose(_ index: Int, animated: Bool) {
            guard let view, canChoose(index) else { return }
            userInitiated = true
            let offset = CGPoint(x: 0, y: CGFloat(index) * parent.rowHeight)
            if animated && !parent.reduceMotion && abs(view.contentOffset.y - offset.y) > 0.5 {
                view.setContentOffset(offset, animated: true)
            } else { view.setContentOffset(offset, animated: false); finish(endingInteraction: true) }
        }
        func updateAccessibility() {
            guard let view, items.indices.contains(view.centeredIndex) else { return }
            view.accessibilityValue = parent.accessibleName(items[view.centeredIndex])
        }
        private func finish(endingInteraction: Bool = false) {
            guard let view, endingInteraction || (!view.isTracking && !view.isDragging) else { return }
            guard userInitiated, canChoose(view.centeredIndex) else { restorePosition(); return }
            let item = items[view.centeredIndex]
            userInitiated = false
            view.setContentOffset(CGPoint(x: 0, y: CGFloat(view.centeredIndex) * parent.rowHeight), animated: false)
            lastSelectedID = item.id
            parent.onSelect(item)
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

extension View {
    func composerWheelFade() -> some View {
        mask {
            LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .white.opacity(0.55), location: 0.16),
                                   .init(color: .white, location: 0.4), .init(color: .white, location: 0.6),
                                   .init(color: .white.opacity(0.55), location: 0.84), .init(color: .clear, location: 1)],
                           startPoint: .top, endPoint: .bottom)
        }
    }
}

/// Reuses only nearby rows. Transparent native scrolling avoids depending on
/// UIPickerView's private selection-background hierarchy.
final class ComposerWheelScroller: UIScrollView {
    var rowHeight: CGFloat = 52
    var rowCount = 0
    var reduceMotion = false
    var alignsRowColumns = false
    var configureRow: (@MainActor (Int, UIView?) -> UIView)?
    var onChoose: (@MainActor (Int, Bool) -> Void)?
    var canChoose: (@MainActor (Int) -> Bool)?
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
                // Leading-aligned rows can tilt without shifting their columns sideways.
                transform.m34 = alignsRowColumns ? 0 : -1 / 600
                transform = CATransform3DRotate(transform, max(-1.2, min(1.2, distance * .pi / 7)), 1, 0, 0)
                transform = CATransform3DScale(transform, alignsRowColumns ? 1 : scale, scale, 1)
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
        if let next = (0..<rowCount).dropFirst(centeredIndex + 1).first(where: { canChoose?($0) == true }) {
            onChoose?(next, false)
        }
    }
    override func accessibilityDecrement() {
        if let previous = (0..<rowCount).prefix(centeredIndex).last(where: { canChoose?($0) == true }) {
            onChoose?(previous, false)
        }
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
            if item.title.isEmpty { SkeletonLine(width: 112, height: 16) }
            else { Text(item.title).font(.title2.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.85) }
        }.foregroundStyle(.primary).frame(maxWidth: .infinity, alignment: .center).padding(.horizontal, 4)
            .transaction { $0.animation = nil; $0.disablesAnimations = true }
            .accessibilityElement(children: .ignore).accessibilityLabel(item.accessibleName)
    }
}

/// Uses the advertised tier IDs, including legacy Codex Fast and boolean-only providers.
struct ComposerSpeed {
    private static let fastIDs = ["fast", "priority", "ultrafast"]
    let tiers: [ModelServiceTier]
    let fastTier: String?
    private let usesServiceTier: Bool

    static func activeTint(in scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 1, green: 0.33, blue: 0.38) : Color(red: 0.7, green: 0.08, blue: 0.18)
    }

    init?(model: ModelChoice?, providerID: String) {
        guard let model else { return nil }
        let reported = model.serviceTiers ?? []
        let hasFast = reported.contains { $0.id == "fast" }
        tiers = reported.filter { !$0.id.isEmpty && $0.id != "default" && !(hasFast && $0.id == "priority") }
        guard !tiers.isEmpty || model.supportsFastMode == true else { return nil }
        usesServiceTier = !tiers.isEmpty || providerID == "codex"
        if tiers.isEmpty && usesServiceTier {
            fastTier = "fast"
        } else {
            let available = Set(tiers.map(\.id))
            fastTier = Self.fastIDs.first { available.contains($0) }
        }
    }

    var showsFast: Bool { !usesServiceTier || fastTier != nil }

    func tier(in settings: ComposerSettings) -> String {
        let saved = settings.config["serviceTier"]?.string ?? ""
        let canonical = saved == "priority" && tiers.contains { $0.id == "fast" } ? "fast" : saved
        return tiers.contains { $0.id == canonical } ? canonical : "default"
    }

    func isFast(in settings: ComposerSettings) -> Bool {
        guard usesServiceTier else { return settings.config["fastMode"]?.bool == true }
        let value = tiers.isEmpty ? settings.config["serviceTier"]?.string ?? "" : tier(in: settings)
        return Self.fastIDs.contains(value)
    }

    func setFast(_ enabled: Bool, in settings: inout ComposerSettings) {
        if let fastTier { settings.config["serviceTier"] = .string(enabled ? fastTier : "default") }
        else if !usesServiceTier { settings.config["fastMode"] = .bool(enabled) }
    }
}

struct RunOptionsSheet: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let session: BackendSession
    let context: ComposerContext
    let closing: Bool
    let close: () -> Void
    @State private var catalog: CodexPermissions?
    @State private var catalogError: String?
    @State private var loading = true
    @State private var pendingSettings: ComposerSettings?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .title2) private var permissionRowHeight: CGFloat = 54

    private var settings: ComposerSettings { pendingSettings ?? context.settings(session) }
    private var blocked: Bool {
        closing || pendingSettings != nil || context.saving(session) || !session.isConnected || session.sending
    }
    private var selectedPermission: String { settings.permission(provider: context.providerId) }

    var body: some View {
        VStack(spacing: 12) {
            Text("Run options").font(.headline.width(.expanded))
                .padding(.horizontal, 48).frame(maxWidth: .infinity, minHeight: 44)
                .accessibilityAddTraits(.isHeader)
                .overlay(alignment: .trailing) {
                    Button(action: close) {
                        Image(systemName: "xmark").font(.body).foregroundStyle(.secondary)
                            .frame(width: 44, height: 44).contentShape(.circle)
                    }
                    .buttonStyle(ChatPressStyle())
                    .accessibilityLabel("Close").accessibilityIdentifier("closeRunOptions")
                }
            VStack(spacing: 14) {
                if context.mode == "developer" { permissionPicker }
                VStack(spacing: 0) {
                    if context.supportsGoalMode {
                        if context.mode == "developer" {
                            Toggle("Plan mode", isOn: configToggle("planMode", exclusive: "goalMode"))
                                .accessibilityIdentifier("runPlanMode").padding(.vertical, 5)
                        }
                        Toggle("Goal mode", isOn: configToggle("goalMode", exclusive: "planMode"))
                            .accessibilityIdentifier("runGoalMode").padding(.vertical, 5)
                    }
                    if let speed = ComposerSpeed(model: context.model(session), providerID: context.providerId) {
                        speedRow(speed)
                    }
                }
                .toggleStyle(.switch)
                .tint(Provider.accent(context.providerId))
                .disabled(blocked)
            }
            .padding(.horizontal, 8)
            SettingsRecoveryNotice(session: session, runID: context.runID)
        }
        .padding(.horizontal, 20).padding(.bottom, 16)
        .task(id: context.workspace(session)) { await loadPolicy() }
    }

    private var permissions: [PermissionChoice] {
        var choices = context.providerId == "codex"
            ? catalog?.choices(current: selectedPermission) ?? []
            : PermissionChoice.choices(provider: context.providerId)
        if !choices.isEmpty, !choices.contains(where: { $0.id == selectedPermission }) {
            let title = selectedPermission.isEmpty ? "Select permission" : selectedPermission
            choices.insert(PermissionChoice(id: selectedPermission, title: title, detail: "", disabledReason: "Saved selection"), at: 0)
        }
        return choices
    }

    private var permissionPicker: some View {
        let height = permissionRowHeight * (dynamicTypeSize.isAccessibilitySize ? 1.8 : 3)
        return Group {
            if context.providerId == "codex", loading {
                VStack(spacing: 6) {
                    SkeletonLine(width: 120, height: 16)
                    SkeletonLine(width: 178, height: 9)
                }
                .allowsHitTesting(false)
                .accessibilityElement(children: .ignore).accessibilityLabel("Loading computer policy…")
            } else if let catalogError {
                VStack(spacing: 8) {
                    Text(catalogError).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Button("Try again") { Task { await loadPolicy() } }.buttonStyle(ChatPressStyle()).disabled(blocked)
                }
            } else if permissions.isEmpty {
                Text("No permission options available").font(.subheadline).foregroundStyle(.secondary)
            } else {
                ComposerChoiceWheel(items: permissions, selectedID: selectedPermission, accessibilityTitle: "Permissions",
                                    accessibilityID: "selectPermission", enabled: !blocked, rowHeight: permissionRowHeight,
                                    reduceMotion: reduceMotion, accessibleName: { choice in
                    let detail = choice.disabledReason ?? choice.detail
                    return detail.isEmpty ? choice.title : "\(choice.title), \(detail)"
                },
                                    canSelect: { $0.disabledReason == nil }, onSelect: { item in
                    updateSettings { $0.setPermission(item.id, provider: context.providerId) }
                }) { item in
                    VStack(spacing: 2) {
                        HStack(spacing: 7) {
                            if item.disabledReason != nil { Image(systemName: "lock.fill").font(.footnote) }
                            Text(item.title).font(.title2.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.75)
                        }
                        Text(item.disabledReason ?? item.detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    .foregroundStyle(item.disabledReason == nil ? .primary : .secondary)
                    .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.horizontal, 4)
                }
                .composerWheelFade()
            }
        }
        .frame(maxWidth: .infinity, minHeight: height, idealHeight: height, maxHeight: height)
    }

    @ViewBuilder private func speedRow(_ speed: ComposerSpeed) -> some View {
        if speed.showsFast {
            let active = speed.isFast(in: settings)
            HStack(spacing: 8) {
                if speed.tiers.count > 1 {
                    tierMenu(speed, title: "Fast")
                    Spacer(minLength: 0)
                }
                Button {
                    updateSettings { speed.setFast(!active, in: &$0) }
                } label: {
                    HStack {
                        if speed.tiers.count <= 1 {
                            Text("Fast")
                            Spacer(minLength: 0)
                        }
                        FastBolt(active: active)
                            .frame(width: 48, height: 48)
                    }.contentShape(.rect)
                }
                .buttonStyle(ChatPressStyle()).accessibilityLabel("Fast")
                .accessibilityValue(active ? "On" : "Off")
                .accessibilityIdentifier("runFastMode")
            }
        } else {
            tierMenu(speed, title: "Service tier")
        }
    }

    private func tierMenu(_ speed: ComposerSpeed, title: String) -> some View {
        let current = speed.tier(in: settings)
        let name = speed.tiers.first { $0.id == current }?.name ?? "Default"
        return Menu {
            Picker("Service tier", selection: Binding(get: { current }, set: { value in
                updateSettings { $0.config["serviceTier"] = .string(value) }
            })) {
                Text("Default").tag("default")
                ForEach(speed.tiers) { Text($0.name).tag($0.id) }
            }
        } label: {
            HStack(spacing: 6) {
                Text(title)
                if current != "default", name.caseInsensitiveCompare(title) != .orderedSame {
                    Text(name).font(.caption).foregroundStyle(.secondary)
                }
                Image(systemName: "chevron.down").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            }
            .foregroundStyle(.primary).frame(minHeight: 44).contentShape(.rect)
        }
        .tint(.primary)
        .accessibilityLabel("Service tier").accessibilityValue(name)
        .accessibilityIdentifier("runServiceTier")
    }

    private func configToggle(_ key: String, exclusive: String) -> Binding<Bool> {
        Binding(get: { settings.config[key]?.bool == true }, set: { value in
            updateSettings {
                $0.config[key] = .bool(value)
                if value { $0.config[exclusive] = .bool(false) }
            }
        })
    }

    private func updateSettings(_ edit: (inout ComposerSettings) -> Void) {
        guard !blocked else { return }
        var next = settings
        edit(&next)
        guard next != settings else { return }
        let owner = session.ownership
        pendingSettings = next
        Task {
            guard owner == session.ownership else { return }
            defer { if owner == session.ownership { pendingSettings = nil } }
            do { try await context.commit(next, session: session) }
            catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
        }
    }

    private func loadPolicy() async {
        guard context.providerId == "codex", context.mode == "developer" else { return }
        let workspace = context.workspace(session)
        let owner = session.ownership
        loading = true; catalogError = nil; catalog = nil
        defer { if !Task.isCancelled && owner == session.ownership && workspace == context.workspace(session) { loading = false } }
        do {
            let policy = try await session.codexPermissions(workspaceID: workspace)
            if !Task.isCancelled && owner == session.ownership && workspace == context.workspace(session) { catalog = policy }
        } catch {
            if !Task.isCancelled && owner == session.ownership && workspace == context.workspace(session) { catalogError = error.localizedDescription }
        }
    }
}

private struct FastBolt: View {
    #if DEBUG && targetEnvironment(simulator)
    @ObserveHotReload private var hotReload
    #endif
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    private let size: CGFloat = 28

    private func bolt(_ name: String) -> some View {
        Image(name).renderingMode(.template).resizable().scaledToFit()
            .frame(width: size, height: size)
    }

    var body: some View {
        let glow = ComposerSpeed.activeTint(in: scheme)
        ZStack {
            bolt("registry-bolt").foregroundStyle(.secondary).opacity(active ? 0 : 1)
            bolt("registry-bolt-fill")
                .foregroundStyle(.linearGradient(colors: [glow, Color(red: 1, green: 0.55, blue: 0.62)], startPoint: .bottom, endPoint: .top))
                .mask(alignment: .bottom) { Rectangle().frame(height: active ? size : 0) }
                .shadow(color: glow.opacity(0.75), radius: 4)
                .shadow(color: glow.opacity(0.3), radius: 10)
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: active ? 0.38 : 0.24), value: active)
        .accessibilityHidden(true)
    }
}
