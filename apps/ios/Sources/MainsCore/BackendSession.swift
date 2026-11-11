import Foundation
import Observation

public struct CachedSnapshot: Codable, Sendable {
    public let backendID: String
    public let conversations: [Conversation]
    public let spaces: [Space]
    public let workspaces: [Workspace]
    public let histories: [String: HistoryPage]
    public var collections: [ProjectCollection]? = nil
    public var projects: [CodeProject]? = nil
    public var gitStates: [WorkspaceGitState]? = nil
    public var selectedSpaceID: String? = nil
    public var homeTargets: [String: HomeTarget]? = nil
    public var composerSettings: [String: ComposerSettings]? = nil
    public var lastSyncedAt: Date? = nil
}

@MainActor
public protocol SessionStorage: AnyObject {
    var demoEnabled: Bool { get }
    func setDemoEnabled(_ enabled: Bool)
    func loadPairing() throws -> PairedBackend?
    func savePairing(_ pairing: PairedBackend) throws
    func removePairing() throws
    func loadSnapshot() -> CachedSnapshot?
    func saveSnapshot(_ snapshot: CachedSnapshot)
    func removeSnapshot()
    func loadDraftText(_ key: TextDraftKey) throws -> String?
    func saveDraftText(_ text: String, for key: TextDraftKey) throws
    func removeDraftTexts(backendID: String, deviceID: String) throws
    func hasConsent(backendID: String, providerID: String) -> Bool
    func grantConsent(backendID: String, providerID: String)
    func revokeConsent(backendID: String, providerID: String)
    func revokeAllConsents(backendID: String)
}

extension SessionStorage {
    public var demoEnabled: Bool { false }
    public func setDemoEnabled(_ enabled: Bool) {}
    public func loadDraftText(_ key: TextDraftKey) throws -> String? { nil }
    public func saveDraftText(_ text: String, for key: TextDraftKey) throws {}
    public func removeDraftTexts(backendID: String, deviceID: String) throws {}
}

public enum ConnectionState: String, Sendable {
    case idle, connecting, syncing, connected, reconnecting, unreachable, offline, suspended, unauthorized, incompatible
    public var label: String {
        switch self {
        case .idle: "Not paired"
        case .connecting: "Connecting…"
        case .syncing: "Syncing…"
        case .connected: "Live"
        case .reconnecting: "Reconnecting…"
        case .unreachable: "Computer unreachable"
        case .offline: "iPhone is offline"
        case .suspended: "Connection paused"
        case .unauthorized: "Pair again"
        case .incompatible: "Update required"
        }
    }
    public var isBusy: Bool { [.connecting, .syncing, .reconnecting].contains(self) }
}

public struct PendingMessage: Sendable {
    public enum Status: Equatable, Sendable { case sending, accepted, uncertain }
    public var runID: String?
    public let text: String
    public let date: Date
    public var status: Status
    let commandID: String
    let channel: String
    let payload: JSONValue
    let backendID: String
    let owner: Int
    let previousArtifactID: Int
    public var attachments: [PromptAttachment] = []
    public var contextSkills: [ContextSkill] = []
    public var queueInputID: String? = nil
    public var id: String { commandID }
    public var isSteering: Bool { channel == "runs:steer" }
    public var isQueueOwned: Bool { queueInputID != nil }
    func matches(_ artifact: Artifact) -> Bool {
        guard let runID else { return false }
        guard artifact.runId == runID, artifact.kind == "user-prompt" else { return false }
        if isSteering { return artifact.metadata?["clientUserMessageId"].string == payload["clientUserMessageId"].string }
        return artifact.id > previousArtifactID && artifact.content == text
    }
}

/// One paired computer. All async writers are fenced by connection and pairing ownership.
@MainActor @Observable
public final class BackendSession {
    public private(set) var isDemo = false
    public private(set) var pairing: PairedBackend?
    public private(set) var activeEndpoint: URL?
    public private(set) var connectedDescriptor: BackendDescriptor?
    public private(set) var lastSyncedAt: Date?
    public private(set) var connection: ConnectionState = .idle
    public private(set) var conversations: [Conversation] = []
    public private(set) var spaces: [Space] = []
    public private(set) var workspaces: [Workspace] = []
    public private(set) var collections: [ProjectCollection] = []
    public private(set) var projects: [CodeProject] = []
    public private(set) var gitStates: [WorkspaceGitState] = []
    public private(set) var selectedSpaceID: String?
    public private(set) var changingMode = false
    public private(set) var savingConversationSettings: Set<String> = []
    public private(set) var uncertainConversationSettings: Set<String> = []
    public private(set) var models: [String: [ModelChoice]] = [:]
    public private(set) var modelErrors: [String: String] = [:]
    public private(set) var loadingModels: Set<String> = []
    public private(set) var homeTargets: [String: HomeTarget] = [:]
    public private(set) var composerSettings: [String: ComposerSettings] = [:]
    public private(set) var transcript = Transcript()
    public private(set) var viewingRunID: String?
    public private(set) var pendingMessage: PendingMessage?
    public private(set) var pendingFork: PendingFork?
    public private(set) var remoteQueues: [RemoteRunQueue] = []
    public private(set) var historyLoading = false
    public private(set) var historyError: String?
    public private(set) var historyRetryDirection = "latest"
    public private(set) var pendingApprovals: [PendingApproval] = []
    public var waitingForDecision: Bool { pendingApprovals.contains { $0.expiresAt > Date() } }
    public private(set) var refreshing = false
    public private(set) var pairingInProgress = false
    public private(set) var sending = false
    public private(set) var stoppingRunID: String?
    public var actionError: String?
    public private(set) var contextRevisions: [String: Int] = [:]
    @ObservationIgnored private var contextCatalogues: [ContextScope: ContextCatalogue] = [:]
    @ObservationIgnored private var contextRequests: [ContextScope: UUID] = [:]
    @ObservationIgnored private var contextOrder: [ContextScope] = []
    private var consentRevision = 0

    @ObservationIgnored private let storage: any SessionStorage
    @ObservationIgnored private let makeTransport: @MainActor (DemoBackend?) -> any BackendTransport
    @ObservationIgnored private var transport: (any BackendTransport)?
    @ObservationIgnored private var demoBackend: DemoBackend?
    @ObservationIgnored private var demoConsents: Set<String> = []
    @ObservationIgnored private var connectionTask: Task<Void, Never>?
    @ObservationIgnored private var eventRefresh: Task<Void, Never>?
    @ObservationIgnored private var listRefresh: Task<Void, Never>?
    @ObservationIgnored private var historyTask: Task<Bool, Never>?
    @ObservationIgnored private var historySequence = 0
    @ObservationIgnored private var initialHistoryCursor: HistoryCursor?
    @ObservationIgnored private var historyRefreshNeeded = false
    @ObservationIgnored private var snapshotRefreshNeeded = false
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var pairingOwner = 0
    @ObservationIgnored private var active = false
    @ObservationIgnored private var online = true
    @ObservationIgnored private var restored = false
    @ObservationIgnored private var accountID: String?
    @ObservationIgnored private var histories: [String: HistoryPage] = [:]
    @ObservationIgnored private var historyOrder: [String] = []
    @ObservationIgnored private var endpointIndex = 0
    @ObservationIgnored private var blocked: ConnectionState?
    @ObservationIgnored private var drafts: [String: ConversationDraft] = [:]
    @ObservationIgnored private var homeDrafts: [String: ConversationDraft] = [:]
    @ObservationIgnored private lazy var runQueues = RunQueueController(session: self)
    @ObservationIgnored private var remoteQueueRead: Task<Void, Never>?
    @ObservationIgnored private var remoteQueuePoll: Task<Void, Never>?
    @ObservationIgnored private var remoteQueueReadID: UUID?
    @ObservationIgnored private var remoteQueueReadAgain = false
    @ObservationIgnored private var providerConfigs: [String: [String: JSONValue]] = [:]
    private struct SettingsChange { let id: String; let settings: ComposerSettings; let owner: Int }
    @ObservationIgnored private var settingsChanges: [String: SettingsChange] = [:]
    @ObservationIgnored private var settingsRevision = 0
    @ObservationIgnored private var settingsVersions: [String: Int] = [:]
    @ObservationIgnored private var decisionDeliveries: [DecisionIdentity: DecisionDelivery] = [:]
    @ObservationIgnored private var approvalExpiryTask: Task<Void, Never>?
    @ObservationIgnored private var decisionRevision = 0

    public convenience init(storage: any SessionStorage) {
        self.init(storage: storage, makeTransport: { demo in
            if let demo { DemoTransport(backend: demo) } else { WebSocketTransport() }
        })
    }
    init(storage: any SessionStorage, makeTransport: @escaping @MainActor (DemoBackend?) -> any BackendTransport) {
        self.storage = storage; self.makeTransport = makeTransport
    }
    public var isConnected: Bool { connection == .connected }
    public var ownership: Int { pairingOwner }
    public var selectedSpace: Space? { spaces.first { $0.id == selectedSpaceID } }

    public func searchConversations(_ query: String, cursor: ConversationSearchCursor? = nil) async throws -> ConversationSearchPage {
        guard let transport, isConnected, let accountID else { throw MainsError.disconnected }
        let owner = pairingOwner, current = generation
        let trimmed = String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        guard !trimmed.isEmpty else { return ConversationSearchPage(items: [], nextCursor: nil) }
        var payload: [String: JSONValue] = ["accountId": .string(accountID), "query": .string(trimmed), "limit": .number(25)]
        if let cursor { payload["cursor"] = try .encode(cursor) }
        let value = try await transport.invoke("search:conversations", args: [.object(payload)])
        try Task.checkCancellation()
        guard owner == pairingOwner, current == generation, self.transport === transport else { throw MainsError.changedBackend }
        let page = try value.decode(ConversationSearchPage.self)
        func validTimestamp(_ value: Double) -> Bool { value.isFinite && value.rounded() == value && (0...253402300799000).contains(value) }
        guard page.items.count <= 25, Set(page.items.map(\.runId)).count == page.items.count,
              page.items.allSatisfy({ !$0.runId.isEmpty && $0.title.utf8.count <= 2048 && ($0.snippet?.utf8.count ?? 0) <= 4096 && validTimestamp($0.updatedAt) &&
                  ($0.messageCursor.map { $0.source == "artifact" && $0.id > 0 && $0.id < Int.max && validTimestamp($0.timestamp) } ?? true) }),
              page.nextCursor.map({ (0...4).contains($0.rank) && validTimestamp($0.createdAt) && !$0.runId.isEmpty && $0.runId.utf8.count <= 800 }) ?? true,
              page.nextCursor == nil || page.nextCursor != cursor else { throw MainsError.invalidReply }
        return page
    }

    public func draft(for runID: String) -> ConversationDraft {
        if let draft = drafts[runID] { return draft }
        let draft = makeDraft(owner: .conversation, id: runID)
        drafts[runID] = draft
        return draft
    }

    public func homeDraft(for spaceID: String) -> ConversationDraft {
        if let draft = homeDrafts[spaceID] { return draft }
        let draft = makeDraft(owner: .home, id: spaceID); homeDrafts[spaceID] = draft; return draft
    }

    private func makeDraft(owner: TextDraftKey.Owner, id: String) -> ConversationDraft {
        let draft = ConversationDraft()
        guard !isDemo, let pairing else { return draft }
        let key = TextDraftKey(backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId, owner: owner, ownerID: id)
        do { draft.text = try storage.loadDraftText(key) ?? "" }
        catch { draft.storageError = "The saved draft could not be read on this iPhone." }
        let currentOwner = pairingOwner
        draft.textChanged = { [weak self, weak draft] text in
            guard let self, let draft, self.pairingOwner == currentOwner, !self.isDemo else { return }
            do { try self.storage.saveDraftText(text, for: key); draft.storageError = nil }
            catch { draft.storageError = "Draft not saved: " + error.localizedDescription }
        }
        return draft
    }

    public func messageQueue(for id: String) -> ConversationQueue { runQueues.queue(id) }
    public func existingMessageQueue(for id: String) -> ConversationQueue? { runQueues.existing(id) }
    public func submitQueuedDraft(_ id: String) throws { try runQueues.submit(id, draft: draft(for: id)) }
    public func editQueuedMessage(_ runID: String, id: String) { runQueues.edit(runID, id: id) }
    public func cancelQueuedEdit(_ runID: String) { runQueues.cancelEdit(runID) }
    public func removeQueuedMessage(_ runID: String, id: String) { runQueues.remove(runID, id: id) }
    public func steerQueuedMessage(_ runID: String, id: String) async { await runQueues.steer(runID, id: id) }
    public func resumeMessageQueue(_ id: String) async { await runQueues.resume(id) }

    func readQueuedRun(_ id: String) async throws -> Conversation? {
        guard let transport, isConnected else { throw MainsError.disconnected }
        let owner = pairingOwner, current = generation
        let settingsReadVersion = settingsRevision
        let value = try await transport.invoke("runs:getById", args: [.string(id)])
        guard owner == pairingOwner, current == generation else { throw MainsError.changedBackend }
        guard value != .null else { return nil }
        let run = keepingSettings(try value.decode(Conversation.self), readVersion: settingsReadVersion)
        guard run.id == id else { throw MainsError.invalidReply }
        upsert(run)
        return run
    }

    public func checkQueuedInput(_ id: String) async throws -> Bool {
        guard let pending = pendingMessage, pending.queueInputID == id, pending.status == .uncertain,
              let transport, isConnected, !sending else { return false }
        let owner = pairingOwner, current = generation
        var input = pending.payload.objectValue
        input["runId"] = nil; input["accountId"] = nil; input["clientUserMessageId"] = nil
        do {
            let value = try await command("runs:inputStatus", args: [.object([
                "runId": pending.payload["runId"], "accountId": pending.payload["accountId"],
                "clientUserMessageId": .string(id), "input": .object(input),
                "delivery": .string(pending.isSteering ? "steer" : "queue"),
            ])], owner: owner)
            guard owner == pairingOwner, current == generation, self.transport === transport else { throw MainsError.changedBackend }
            if value["accepted"].bool {
                pendingMessage = nil; runQueues.kick()
                if pending.runID == viewingRunID { scheduleHistoryRefresh() }
                return true
            }
        } catch {
            guard owner == pairingOwner else { throw error }
            // Older computers can still check the original command receipt.
        }
        guard owner == pairingOwner, pendingMessage?.id == pending.id else { return false }
        _ = try await checkDelivery()
        return pendingMessage?.id != pending.id
    }

    public func selectSpace(_ id: String) {
        guard spaces.contains(where: { $0.id == id }) else { return }
        selectedSpaceID = id; saveCache()
    }

    public func selectTarget(_ target: HomeTarget, spaceID: String) {
        guard spaces.contains(where: { $0.id == spaceID }) else { return }
        homeTargets[spaceID] = target; saveCache()
    }

    public func settings(for space: Space) -> ComposerSettings {
        composerSettings[space.id] ?? .defaults(provider: space.providerId,
            model: space.model ?? models[space.providerId]?.first(where: { $0.isDefault == true })?.id ?? models[space.providerId]?.first?.id ?? "",
            config: providerConfigs[space.providerId] ?? [:])
    }

    public func setSettings(_ settings: ComposerSettings, spaceID: String) {
        guard spaces.contains(where: { $0.id == spaceID }) else { return }
        var safe = settings
        safe.config = safe.config.filter { ComposerSettings.allowedKeys.contains($0.key) }
        composerSettings[spaceID] = safe; saveCache()
    }

    public func setSpaceMode(_ mode: String, spaceID: String) async throws {
        guard !changingMode, isConnected, let space = spaces.first(where: { $0.id == spaceID }),
              Experience.modes(for: space.providerId).contains(mode) else { throw MainsError.server("This mode is unavailable for this space.") }
        guard space.mode != mode else { return }
        changingMode = true
        let owner = pairingOwner
        defer { if pairingOwner == owner { changingMode = false } }
        _ = try await command("space:update", args: [.string(spaceID), .object(["mode": .string(mode)])], owner: owner)
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        // The command is durable before changing the shell. The next snapshot stays authoritative.
        if let index = spaces.firstIndex(where: { $0.id == spaceID }) { spaces[index].mode = mode }
        saveCache()
        await refresh()
    }

    public func settings(forRunID id: String) -> ComposerSettings? {
        guard let run = conversations.first(where: { $0.id == id }) else { return nil }
        if let value = run.configSnapshot?["conversationSettings"], let saved = try? value.decode(ComposerSettings.self) {
            return saved
        }
        var config = providerConfigs[run.providerId] ?? [:]
        if case .object(let snapshot) = run.configSnapshot {
            config.merge(snapshot.filter { ComposerSettings.allowedKeys.contains($0.key) }) { _, next in next }
        }
        let latest = viewingRunID == id && transcript.page?.hasNewer != true
            ? transcript.page?.turns.max(by: { ($0.turnIndex ?? $0.id) < ($1.turnIndex ?? $1.id) })?.model : nil
        var result = ComposerSettings.defaults(provider: run.providerId, model: latest ?? run.model ?? "", config: config)
        for key in ["goalMode", "planMode"] { if let value = config[key] { result.config[key] = value } }
        return result
    }

    public func updateConversationSettings(_ settings: ComposerSettings, runID: String) async throws {
        guard isConnected, !sending, !savingConversationSettings.contains(runID), settingsChanges[runID] == nil,
              let run = conversations.first(where: { $0.id == runID }), run.isReplica != true else {
            throw MainsError.server("Conversation settings are unavailable. Check any unconfirmed save first.")
        }
        var safe = settings
        safe.config = safe.config.filter { ComposerSettings.allowedKeys.contains($0.key) }
        let change = SettingsChange(id: UUID().uuidString, settings: safe, owner: pairingOwner)
        settingsChanges[runID] = change
        try await deliverSettings(change, runID: runID)
    }

    public func checkConversationSettings(_ runID: String) async throws {
        guard uncertainConversationSettings.contains(runID), let change = settingsChanges[runID],
              !savingConversationSettings.contains(runID) else { throw MainsError.invalidReply }
        try await deliverSettings(change, runID: runID)
    }

    private func deliverSettings(_ change: SettingsChange, runID: String) async throws {
        savingConversationSettings.insert(runID)
        defer { if change.owner == pairingOwner { savingConversationSettings.remove(runID) } }
        do {
            let value = try await command("runs:updateConversationSettings", args: [.string(runID), try .encode(change.settings)], commandID: change.id, owner: change.owner)
            let saved = try value.decode(ComposerSettings.self)
            guard change.owner == pairingOwner else { throw MainsError.changedBackend }
            if var run = conversations.first(where: { $0.id == runID }) {
                var snapshot: [String: JSONValue] = [:]
                if case .object(let existing) = run.configSnapshot { snapshot = existing }
                snapshot["conversationSettings"] = try .encode(saved)
                settingsRevision += 1; settingsVersions[runID] = settingsRevision
                run.configSnapshot = .object(snapshot); upsert(run); saveCache()
            }
            settingsChanges[runID] = nil; uncertainConversationSettings.remove(runID)
        } catch {
            guard change.owner == pairingOwner else { throw MainsError.changedBackend }
            if let failure = error as? MainsError, case .server = failure, !failure.isUnconfirmedCommand {
                settingsChanges[runID] = nil; uncertainConversationSettings.remove(runID)
            } else { uncertainConversationSettings.insert(runID) }
            throw error
        }
    }

    public func listOutputs(_ runID: String, offset: Int = 0, artifactID: Int? = nil) async throws -> RunOutputsPage {
        guard let transport, isConnected else { throw MainsError.disconnected }
        let current = generation
        var payload: [String: JSONValue] = ["runId": .string(runID), "offset": .number(Double(offset))]
        if let artifactID { payload["artifactId"] = .number(Double(artifactID)) }
        let value = try await transport.invoke("runs:listOutputs", args: [.object(payload)])
        guard current == generation else { throw MainsError.disconnected }
        return try value.decode(RunOutputsPage.self)
    }

    public func hasOutputs(_ runID: String) async throws -> Bool {
        let owner = pairingOwner, current = generation
        return try await RunOutputsPage.containsOutput { offset in
            guard owner == self.pairingOwner, current == self.generation else { throw MainsError.changedBackend }
            let page = try await self.listOutputs(runID, offset: offset)
            guard owner == self.pairingOwner, current == self.generation else { throw MainsError.changedBackend }
            guard page.items.allSatisfy({ $0.runId == runID }) else { throw MainsError.invalidReply }
            return page
        }
    }

    public func readOutput(_ output: RunOutput, offset: Int) async throws -> RunOutputChunk {
        guard let transport, isConnected else { throw MainsError.disconnected }
        let current = generation
        let value = try await transport.invoke("runs:readOutputFile", args: [.object(["runId": .string(output.runId), "artifactId": .number(Double(output.artifactId)), "version": .string(output.version), "offset": .number(Double(offset))])])
        guard current == generation else { throw MainsError.disconnected }
        return try value.decode(RunOutputChunk.self)
    }

    public func downloadOutput(_ output: RunOutput, progress: (Double) -> Void = { _ in }) async throws -> Data {
        try await downloadFile(byteSize: output.byteSize, version: output.version,
                               read: { try await self.readOutput(output, offset: $0) }, progress: progress)
    }

    public func downloadOutput(_ output: RunOutput, to url: URL, progress: (Double) -> Void = { _ in }) async throws {
        try await RunFileTransfer.save(to: url) { write in
            try await self.receiveFile(byteSize: output.byteSize, version: output.version, read: { try await self.readOutput(output, offset: $0) }, write: write, progress: progress)
        }
    }

    public func resolveFileReference(_ href: String, runID: String, relativeTo base: String? = nil) async throws -> ResolvedRunFile {
        guard let reference = RunFileReference(href, relativeTo: base), isConnected,
              let transport, let run = conversations.first(where: { $0.id == runID }) else { throw MainsError.server("This file link is not available.") }
        let owner = pairingOwner, current = generation
        var offset = 0, matches: [RunOutput] = []
        for _ in 0..<128 {
            let page = try await listOutputs(runID, offset: offset)
            try Task.checkCancellation()
            guard owner == pairingOwner, current == generation, self.transport === transport,
                  page.items.count <= 100, page.items.allSatisfy({ $0.runId == runID }) else { throw MainsError.changedBackend }
            matches += page.items.filter { $0.name == reference.name }
            guard matches.count <= 1 else { throw MainsError.server("More than one output has this name. Choose the file in Outputs.") }
            guard let next = page.nextOffset else {
                if let output = matches.first { return .output(output) }
                guard run.mode != "developer", reference.isMarkdown else { throw MainsError.server("This file is not a downloadable output of this conversation.") }
                let value = try await transport.invoke("runs:readTextFile", args: [.object(["runId": .string(runID), "filePath": .string(reference.path)])])
                try Task.checkCancellation()
                guard owner == pairingOwner, current == generation, self.transport === transport else { throw MainsError.changedBackend }
                let document = try value.decode(RunLinkedMarkdown.self)
                guard document.content.utf8.count <= 2 * 1024 * 1024,
                      let relative = RunFileReference(document.relativePath), !relative.path.hasPrefix("/"),
                      relative.path.range(of: #"^[a-zA-Z]:/"#, options: .regularExpression) == nil else { throw MainsError.invalidReply }
                return .markdown(document)
            }
            guard next > offset else { throw MainsError.invalidReply }
            offset = next
        }
        throw MainsError.server("Open Outputs to find this file.")
    }

    public func readImage(_ media: TranscriptMedia, maxSide: Int = 512) async throws -> ArtifactImage {
        guard let transport, isConnected else { throw MainsError.disconnected }
        let current = generation
        var payload: [String: JSONValue] = ["runId": .string(media.runID), "maxSide": .number(Double(min(1600, max(64, maxSide))))]
        let channel: String
        switch media.source {
        case .artifact(let id): channel = "runArtifacts:readImage"; payload["artifactId"] = .number(Double(id))
        case .attachment(let id): channel = "runArtifacts:readAttachmentImage"; payload["attachmentId"] = .string(id)
        case .unavailable: throw MainsError.server("This older attachment has no downloadable preview.")
        }
        let value = try await transport.invoke(channel, args: [.object(payload)])
        guard current == generation, self.transport === transport else { throw MainsError.changedBackend }
        let image = try value.decode(ArtifactImage.self)
        guard image.data != nil else { throw MainsError.invalidReply }
        return image
    }

    public func describeAttachment(_ media: TranscriptMedia) async throws -> RunAttachmentFile {
        guard let transport, isConnected else { throw MainsError.disconnected }
        guard case .attachment(let id) = media.source, TranscriptMedia.validAttachmentID(id) else { throw MainsError.invalidReply }
        let current = generation
        let value = try await transport.invoke("runArtifacts:describeAttachmentFile", args: [.object(["runId": .string(media.runID), "attachmentId": .string(id)])])
        guard current == generation, self.transport === transport else { throw MainsError.changedBackend }
        let file = try value.decode(RunAttachmentFile.self)
        guard file.runId == media.runID, file.attachmentId == id else { throw MainsError.invalidReply }
        return file
    }

    public func downloadAttachment(_ file: RunAttachmentFile, progress: (Double) -> Void = { _ in }) async throws -> Data {
        guard TranscriptMedia.validAttachmentID(file.attachmentId) else { throw MainsError.invalidReply }
        return try await downloadFile(byteSize: file.byteSize, version: file.version, read: { try await self.readAttachmentChunk(file, offset: $0) }, progress: progress)
    }

    public func downloadAttachment(_ file: RunAttachmentFile, to url: URL, progress: (Double) -> Void = { _ in }) async throws {
        guard TranscriptMedia.validAttachmentID(file.attachmentId) else { throw MainsError.invalidReply }
        try await RunFileTransfer.save(to: url) { write in
            try await self.receiveFile(byteSize: file.byteSize, version: file.version, read: { try await self.readAttachmentChunk(file, offset: $0) }, write: write, progress: progress)
        }
    }

    private func readAttachmentChunk(_ file: RunAttachmentFile, offset: Int) async throws -> RunOutputChunk {
        guard let transport, isConnected else { throw MainsError.disconnected }
        let value = try await transport.invoke("runArtifacts:readAttachmentChunk", args: [.object([
            "runId": .string(file.runId), "attachmentId": .string(file.attachmentId), "version": .string(file.version), "offset": .number(Double(offset)),
        ])])
        return try value.decode(RunOutputChunk.self)
    }

    private func downloadFile(byteSize: Int, version: String,
                              read: (Int) async throws -> RunOutputChunk, progress: (Double) -> Void) async throws -> Data {
        var bytes = Data()
        try await receiveFile(byteSize: byteSize, version: version, read: read, write: { bytes.append($0) }, progress: progress)
        return bytes
    }

    private func receiveFile(byteSize: Int, version: String, read: (Int) async throws -> RunOutputChunk,
                             write: (Data) throws -> Void, progress: (Double) -> Void) async throws {
        let owner = pairingOwner, current = generation
        try await RunFileTransfer.receive(byteSize: byteSize, version: version, validate: {
            guard owner == self.pairingOwner, current == self.generation else { throw MainsError.changedBackend }
        }, read: read, write: write, progress: progress)
    }

    public func loadModels(_ providerID: String, force: Bool = false) async {
        guard let transport, isConnected, !loadingModels.contains(providerID), force || models[providerID] == nil else { return }
        let current = generation
        loadingModels.insert(providerID); modelErrors[providerID] = nil
        defer { if current == generation { loadingModels.remove(providerID) } }
        do {
            let value = try await transport.invoke("providers:getModels", args: [.string(providerID)])
            let choices = try list(value, key: "models", as: ModelChoice.self)
            guard current == generation, self.transport === transport else { return }
            models[providerID] = choices
        } catch {
            guard current == generation, !(error is CancellationError) else { return }
            modelErrors[providerID] = error.localizedDescription
        }
    }

    public func codexPermissions(workspaceID: String?) async throws -> CodexPermissions {
        guard let transport, isConnected else { throw MainsError.disconnected }
        let current = generation
        var args: [JSONValue] = [.string("codex")]
        if let path = workspaces.first(where: { $0.id == workspaceID })?.rootPath { args.append(.string(path)) }
        let value = try await transport.invoke("providers:getCodexPermissions", args: args)
        guard current == generation else { throw MainsError.disconnected }
        return try value.decode(CodexPermissions.self)
    }

    public func setHistoryFollowing(_ following: Bool) {
        transcript.setFollowing(following)
    }

    public func restore() {
        guard !restored else { return }
        restored = true
        do {
            pairing = try storage.loadPairing()
            if pairing == nil, storage.demoEnabled { try startDemo(); return }
            if pairing != nil { storage.setDemoEnabled(false) }
            if let cached = storage.loadSnapshot(), cached.backendID == pairing?.descriptor.backendId {
                conversations = cached.conversations.map(safeConversation); spaces = cached.spaces; workspaces = cached.workspaces
                histories = cached.histories; historyOrder = Array(histories.keys)
                collections = cached.collections ?? []; projects = cached.projects ?? []; gitStates = cached.gitStates ?? []
                selectedSpaceID = cached.selectedSpaceID
                homeTargets = cached.homeTargets ?? [:]; composerSettings = cached.composerSettings ?? [:]
                lastSyncedAt = cached.lastSyncedAt
            }
            restart()
        } catch { actionError = "Could not read the saved pairing: \(error.localizedDescription)" }
    }

    public func setActive(_ value: Bool) {
        guard active != value else { return }; active = value
        restart()
    }
    public func setOnline(_ value: Bool) {
        guard online != value else { return }; online = value
        if !isDemo { restart() }
    }
    public func retry() { restart() }

    /// Demo identity is only in memory; the stored flag restores a fresh sample
    /// session. A saved real pairing always wins and is never overwritten here.
    public func startDemo() throws {
        guard !isDemo else { return }
        guard pairing == nil, !pairingInProgress, try storage.loadPairing() == nil else {
            throw MainsError.server("Demo Mode is available before pairing a computer.")
        }
        let backend = try DemoBackend()
        restored = true
        pairingOwner += 1; resetProjection()
        demoBackend = backend; isDemo = true; demoConsents = []
        pairing = backend.pairing; blocked = nil; endpointIndex = 0; connection = .idle
        selectedSpaceID = "codex"
        homeTargets["codex"] = HomeTarget(workspaceID: backend.defaultWorkspaceID)
        storage.setDemoEnabled(true)
        restart()
    }

    public func exitDemo() {
        guard isDemo else { return }
        pairingOwner += 1; pairing = nil; blocked = nil
        storage.setDemoEnabled(false)
        restart()
        demoBackend?.shutdown(); demoBackend = nil; isDemo = false; demoConsents = []
        resetProjection()
    }

    public func pair(_ link: PairingLink, deviceName: String) async throws {
        guard !pairingInProgress else { return }
        pairingInProgress = true
        let owner = pairingOwner
        defer { pairingInProgress = false }
        let result = try await PairingClient().pair(link, deviceName: deviceName)
        try Task.checkCancellation()
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        // Credentials must be durable before the new computer becomes observable.
        try storage.savePairing(result)
        if !isDemo, let old = pairing, old.descriptor.backendId != result.descriptor.backendId || old.deviceId != result.deviceId {
            try? storage.removeDraftTexts(backendID: old.descriptor.backendId, deviceID: old.deviceId)
        }
        storage.setDemoEnabled(false)
        demoBackend?.shutdown(); demoBackend = nil; isDemo = false; demoConsents = []
        pairingOwner += 1
        resetProjection()
        storage.removeSnapshot()
        pairing = result
        endpointIndex = 0
        actionError = nil
        blocked = nil
        connection = .idle
        restart()
    }

    public func forget() throws {
        if isDemo { exitDemo(); return }
        try storage.removePairing()
        if let pairing { try? storage.removeDraftTexts(backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId) }
        pairingOwner += 1
        pairing = nil
        blocked = nil
        restart()
        resetProjection()
        storage.removeSnapshot()
    }

    private func resetProjection() {
        stopRemoteQueueWatch()
        runQueues.clear()
        initialHistoryCursor = nil
        activeEndpoint = nil; connectedDescriptor = nil; lastSyncedAt = nil
        consentRevision += 1
        conversations = []; spaces = []; workspaces = []; histories = [:]; historyOrder = []
        transcript = Transcript(); viewingRunID = nil; pendingMessage = nil; pendingFork = nil; accountID = nil
        sending = false; stoppingRunID = nil; drafts = [:]
        homeDrafts = [:]; collections = []; projects = []; gitStates = []
        selectedSpaceID = nil; homeTargets = [:]; composerSettings = [:]; providerConfigs = [:]
        models = [:]; modelErrors = [:]; loadingModels = []; changingMode = false
        savingConversationSettings = []; uncertainConversationSettings = []; settingsChanges = [:]
        settingsRevision = 0; settingsVersions = [:]
        contextCatalogues = [:]; contextRequests = [:]; contextRevisions = [:]; contextOrder = []
        actionError = nil; historyError = nil; pendingApprovals = []
        approvalExpiryTask?.cancel(); approvalExpiryTask = nil
        decisionDeliveries = [:]; decisionRevision += 1
    }

    private func restart() {
        stopRemoteQueueWatch()
        runQueues.pauseAll("Backend disconnected. Queued messages are paused.")
        generation += 1
        connectionTask?.cancel(); eventRefresh?.cancel(); listRefresh?.cancel(); historyTask?.cancel()
        approvalExpiryTask?.cancel(); approvalExpiryTask = nil
        connectionTask = nil; eventRefresh = nil; listRefresh = nil; historyTask = nil
        transport?.onDisconnect = nil
        transport?.close(); transport = nil
        historyLoading = false; refreshing = false
        loadingModels = []
        historyRefreshNeeded = false; snapshotRefreshNeeded = false
        transcript.clearStreams()
        guard let pairing else { connection = .idle; return }
        if let blocked { connection = blocked; return }
        guard active else { connection = .suspended; return }
        guard online || isDemo else { connection = .offline; return }
        if connection == .unauthorized || connection == .incompatible { return }
        let current = generation
        connection = conversations.isEmpty ? .connecting : .reconnecting
        connectionTask = Task { [weak self] in await self?.connect(pairing, generation: current) }
    }

    private func connect(_ pairing: PairedBackend, generation current: Int) async {
        var recoveryEnd = ContinuousClock.now + .seconds(30)
        var quiet = false
        while !Task.isCancelled && generation == current && active && (online || isDemo) {
            let candidate = makeTransport(demoBackend)
            let remaining = ContinuousClock.now.duration(to: recoveryEnd).components
            let seconds = Double(remaining.seconds) + Double(remaining.attoseconds) / 1e18
            let attemptLimit = quiet ? 20 : max(0.1, min(20, seconds))
            let attemptTimer = Task { [weak candidate] in
                do { try await Task.sleep(for: .seconds(attemptLimit)) } catch { return }
                candidate?.close()
            }
            defer { attemptTimer.cancel() }
            transport = candidate
            candidate.onEvent = { [weak self, weak candidate] channel, payload in
                guard let self, let candidate, self.transport === candidate, self.generation == current else { return }
                self.event(channel, payload)
            }
            candidate.onDisconnect = { [weak self, weak candidate] error in
                guard let self, let candidate, self.transport === candidate, self.generation == current else { return }
                if self.connection == .connected {
                    if error == .unauthorized { self.blocked = .unauthorized }
                    self.restart()
                }
            }
            do {
                let endpoint = pairing.endpoints[endpointIndex % pairing.endpoints.count]
                activeEndpoint = endpoint
                try candidate.open(endpoint: endpoint, token: pairing.deviceToken)
                let descriptor = try await candidate.invoke("backend:describe").decode(BackendDescriptor.self)
                guard descriptor.protocolVersion == Wire.protocolVersion else { throw MainsError.incompatible }
                guard descriptor.backendId == pairing.descriptor.backendId else { throw MainsError.changedBackend }
                guard generation == current else { return }
                connectedDescriptor = descriptor
                if !quiet { connection = .syncing }
                try await syncSnapshot(candidate, generation: current)
                guard generation == current, !Task.isCancelled else { return }
                attemptTimer.cancel()
                connection = .connected
                runQueues.kick()
                if let runID = viewingRunID { startRemoteQueueWatch(runID) }
                if viewingRunID != nil { await loadHistory(direction: "refresh") }
                return
            } catch {
                candidate.onDisconnect = nil; candidate.close()
                guard generation == current, !Task.isCancelled else { return }
                if error as? MainsError == .unauthorized || error as? MainsError == .changedBackend {
                    blocked = .unauthorized; connection = .unauthorized; return
                }
                if error as? MainsError == .incompatible { blocked = .incompatible; connection = .incompatible; return }
                endpointIndex += 1
                let exhausted = ContinuousClock.now >= recoveryEnd
                if quiet || exhausted {
                    connection = .unreachable
                    do { try await Task.sleep(for: .seconds(30)) } catch { return }
                    quiet = true
                    recoveryEnd = .now + .seconds(30)
                } else {
                    connection = .reconnecting
                    do { try await Task.sleep(for: .seconds(1)) } catch { return }
                }
            }
        }
    }

    public func contextScope(providerID: String, workspaceID: String? = nil) -> ContextScope {
        let workspace = workspaces.first { $0.id == workspaceID && $0.isReplica != true }
        return ContextScope(providerID: providerID, workspaceID: workspaceID, workspacePath: workspace?.rootPath)
    }

    public func cachedContext(_ scope: ContextScope) -> ContextCatalogue? { contextCatalogues[scope] }

    /// Lazy, workspace-scoped reads. A failed source keeps only that scope's previous successful list.
    public func loadContext(_ scope: ContextScope) async throws -> ContextCatalogue {
        guard isConnected, let candidate = transport else { throw MainsError.disconnected }
        guard scope == contextScope(providerID: scope.providerID, workspaceID: scope.workspaceID) else { throw MainsError.changedBackend }
        let owner = pairingOwner, current = generation, request = UUID()
        contextRequests[scope] = request
        let args: [JSONValue] = [.string(scope.providerID)] + (scope.workspacePath.map { [.string($0)] } ?? [])
        async let skills = Self.contextRead(candidate, "providers:getSkills", args)
        async let commands = Self.contextRead(candidate, "providers:getCommands", args)
        let sources = await (skills, commands)
        try Task.checkCancellation()
        guard owner == pairingOwner, current == generation,
              contextRequests[scope] == request,
              scope == contextScope(providerID: scope.providerID, workspaceID: scope.workspaceID) else { throw MainsError.changedBackend }
        var result = contextCatalogues[scope] ?? ContextCatalogue()
        var errors: [String] = []
        do { result.replaceSkills(try ContextCatalogue.skills(from: sources.0.get())) }
        catch { errors.append("Couldn't load skills. " + error.localizedDescription) }
        do { result.replaceCommands(try ContextCatalogue.commands(from: sources.1.get())) }
        catch { errors.append("Couldn't load commands. " + error.localizedDescription) }
        result.error = errors.isEmpty ? nil : errors.joined(separator: "\n")
        contextCatalogues[scope] = result
        contextOrder.removeAll { $0 == scope }; contextOrder.append(scope)
        while contextOrder.count > 8 { let old = contextOrder.removeFirst(); contextCatalogues[old] = nil; contextRequests[old] = nil }
        return result
    }
    private static func contextRead(_ candidate: any BackendTransport, _ channel: String, _ args: [JSONValue]) async -> Result<JSONValue, Error> {
        // Discovery may start Codex and read its installed-plugin catalogue.
        // Use the same deadline as the React Native transport, not the short
        // ordinary-read default; no mutation/retry deadline changes here.
        do { return .success(try await candidate.invoke(channel, args: args, timeout: 30)) } catch { return .failure(error) }
    }

    private func list<T: Decodable>(_ value: JSONValue, key: String, as type: T.Type) throws -> [T] {
        if case .array = value { return try value.decode([T].self) }
        return try value[key].decode([T].self)
    }

    private func syncSnapshot(_ candidate: any BackendTransport, generation current: Int) async throws {
        let settingsReadVersion = settingsRevision
        async let runResult = candidate.invoke("runs:getAll", args: [.number(100)])
        async let spaceResult = candidate.invoke("space:getAll")
        async let workspaceResult = candidate.invoke("workspace:list")
        async let accountResult = candidate.invoke("account:get")
        let (runValue, spaceValue, workspaceValue, accountValue) = try await (runResult, spaceResult, workspaceResult, accountResult)
        guard let id = accountValue["id"].string else { throw MainsError.invalidReply }
        async let collectionResult = candidate.invoke("collections:list", args: [.object(["accountId": .string(id)])])
        async let projectResult = candidate.invoke("projects:list")
        async let gitResult = candidate.invoke("workspace:listGitStates")
        async let providerResult = candidate.invoke("providers:getEnabled")
        let (collectionValue, projectValue, gitValue, providerValue) = try await (collectionResult, projectResult, gitResult, providerResult)
        let runs = try list(runValue, key: "runs", as: Conversation.self)
        let newSpaces = try list(spaceValue, key: "spaces", as: Space.self)
        let newWorkspaces = try list(workspaceValue, key: "workspaces", as: Workspace.self)
        let newCollections = try list(collectionValue, key: "collections", as: ProjectCollection.self)
        let newProjects = try list(projectValue, key: "projects", as: CodeProject.self)
        let newGitStates = try list(gitValue, key: "states", as: WorkspaceGitState.self)
        let providers = try list(providerValue, key: "providers", as: ProviderSummary.self)
        guard generation == current, transport === candidate else { return }
        accountID = id
        let viewed = conversations.first { $0.id == viewingRunID && !$0.isArchived }
        conversations = runs.map { safeConversation(keepingSettings($0, readVersion: settingsReadVersion)) }.filter { !$0.isArchived }.sorted { $0.updatedAt > $1.updatedAt }
        if let viewed, !conversations.contains(where: { $0.id == viewed.id }) { conversations.append(viewed) }
        spaces = newSpaces.filter { $0.isArchived != true }.sorted { ($0.sortOrder ?? 0) < ($1.sortOrder ?? 0) }
        workspaces = newWorkspaces.filter { !$0.isArchived }.sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
        collections = newCollections.filter { !$0.isArchived }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        projects = newProjects; gitStates = newGitStates
        providerConfigs = Dictionary(uniqueKeysWithValues: providers.map { ($0.id, ($0.config ?? [:]).filter { ComposerSettings.allowedKeys.contains($0.key) }) })
        if !spaces.contains(where: { $0.id == selectedSpaceID }) { selectedSpaceID = spaces.first?.id }
        lastSyncedAt = Date()
        saveCache()
        runQueues.kick()
    }

    public func refresh() async {
        guard let transport, isConnected else { return }
        if refreshing { snapshotRefreshNeeded = true; return }
        refreshing = true
        let current = generation
        defer {
            if current == generation {
                refreshing = false
                if snapshotRefreshNeeded { snapshotRefreshNeeded = false; scheduleListRefresh() }
            }
        }
        do { try await syncSnapshot(transport, generation: current) }
        catch { if current == generation { actionError = error.localizedDescription } }
    }

    public func selectConversation(_ id: String, around cursor: HistoryCursor? = nil) async {
        historyTask?.cancel()
        historyRefreshNeeded = false
        viewingRunID = id
        initialHistoryCursor = cursor
        startRemoteQueueWatch(id)
        transcript = Transcript()
        historyError = nil
        pendingApprovals = []; approvalExpiryTask?.cancel(); approvalExpiryTask = nil
        if cursor == nil, let page = histories[id] { transcript.replace(page) }
        if cursor != nil { transcript.setFollowing(false) }
        await loadHistory(direction: cursor == nil ? "latest" : "newer", initialCursor: cursor)
    }

    public func leaveConversation(_ id: String) {
        guard viewingRunID == id else { return }
        viewingRunID = nil
        initialHistoryCursor = nil
        stopRemoteQueueWatch()
        pendingApprovals = []; approvalExpiryTask?.cancel(); approvalExpiryTask = nil
        historyTask?.cancel(); eventRefresh?.cancel(); historyLoading = false
        eventRefresh = nil; historyRefreshNeeded = false
        transcript = Transcript()
    }

    @discardableResult public func loadHistory(direction: String, initialCursor: HistoryCursor? = nil) async -> Bool {
        guard let runID = viewingRunID, let transport, isConnected else { return false }
        if direction == "refresh", historyTask != nil { historyRefreshNeeded = true; return false }
        let previous = historyTask
        let initialCursor = initialCursor ?? (transcript.page == nil ? initialHistoryCursor : nil)
        let current = generation
        historySequence += 1
        let sequence = historySequence
        let job = Task { [weak self] in
            _ = await previous?.value
            guard let self, !Task.isCancelled, self.generation == current, self.viewingRunID == runID else { return false }
            self.historyLoading = true; self.historyError = nil
            defer { if self.generation == current, self.viewingRunID == runID { self.historyLoading = false } }
            do {
                let request: JSONValue
                if let initialCursor {
                    request = .object(["runId": .string(runID), "direction": .string("newer"), "cursor": try .encode(initialCursor), "profile": .string("mobile")])
                } else { request = try self.transcript.request(runID: runID, direction: self.transcript.page == nil ? "latest" : direction) }
                let settingsReadVersion = self.settingsRevision
                let decisionReadVersion = self.decisionRevision
                async let pageValue = transport.invoke("runs:getHistory", args: [request])
                async let runValue = transport.invoke("runs:getById", args: [.string(runID)])
                async let approvalValue = transport.invoke("runs:listPendingApprovals", args: [.string(runID)])
                let (pageJSON, runJSON, approvalJSON) = try await (pageValue, runValue, approvalValue)
                guard !Task.isCancelled, self.generation == current, self.viewingRunID == runID, self.transport === transport else { return false }
                if runJSON == .null {
                    self.conversations.removeAll { $0.id == runID }; self.histories.removeValue(forKey: runID)
                    self.transcript = Transcript(); self.historyError = "This conversation was deleted on your computer."
                    self.pendingApprovals = []; self.approvalExpiryTask?.cancel(); self.approvalExpiryTask = nil
                    self.saveCache(); return false
                }
                let page = try pageJSON.decode(HistoryPage.self)
                let run = try runJSON.decode(Conversation.self)
                self.upsert(self.keepingSettings(run, readVersion: settingsReadVersion))
                self.transcript.replace(page, direction: direction, pending: self.pendingMessage)
                self.initialHistoryCursor = nil
                let approvals = try approvalJSON.decode([PendingApproval].self)
                if self.decisionRevision == decisionReadVersion {
                    self.pendingApprovals = run.isReplica == true ? [] : approvals.filter { $0.runId == runID && $0.expiresAt > Date() }.map {
                        var bound = $0; bound.sessionOwner = self.pairingOwner; return bound
                    }
                    self.retireResolvedDecisions(runID: runID, page: page)
                    self.scheduleApprovalExpiry()
                } else { self.historyRefreshNeeded = true }
                if !run.isActive { self.transcript.settleTurn() }
                self.reconcilePending(page, runID: runID)
                self.histories[runID] = page
                self.historyOrder.removeAll { $0 == runID }; self.historyOrder.append(runID)
                while self.historyOrder.count > 4 { self.histories.removeValue(forKey: self.historyOrder.removeFirst()) }
                self.saveCache()
                return true
            } catch {
                if !Task.isCancelled, self.generation == current, self.viewingRunID == runID {
                    self.historyError = error.localizedDescription; self.historyRetryDirection = direction
                }
                return false
            }
        }
        historyTask = job
        let loaded = await job.value
        if historySequence == sequence {
            historyTask = nil
            if historyRefreshNeeded { historyRefreshNeeded = false; scheduleHistoryRefresh() }
        }
        return loaded
    }

    private func safeConversation(_ input: Conversation) -> Conversation {
        var run = input
        if case .object(let snapshot) = run.configSnapshot {
            var safe = snapshot.filter { ComposerSettings.allowedKeys.contains($0.key) }
            if let settingsJSON = snapshot["conversationSettings"], var settings = try? settingsJSON.decode(ComposerSettings.self) {
                settings.config = settings.config.filter { ComposerSettings.allowedKeys.contains($0.key) }
                safe["conversationSettings"] = try? .encode(settings)
            }
            run.configSnapshot = .object(safe)
        }
        return run
    }

    private func keepingSettings(_ input: Conversation, readVersion: Int) -> Conversation {
        guard (settingsVersions[input.id] ?? 0) > readVersion || savingConversationSettings.contains(input.id),
              let existing = conversations.first(where: { $0.id == input.id }) else { return input }
        var result = input
        result.configSnapshot = existing.configSnapshot
        return result
    }

    private func upsert(_ input: Conversation) {
        let run = safeConversation(input)
        conversations.removeAll { $0.id == run.id }
        if !run.isArchived { conversations.append(run) }
        conversations.sort { $0.updatedAt > $1.updatedAt }
        if conversations.count > 100 {
            let viewed = conversations.first { $0.id == viewingRunID }
            conversations = Array(conversations.prefix(100))
            if let viewed, !conversations.contains(where: { $0.id == viewed.id }) { conversations.append(viewed) }
        }
    }

    private func event(_ channel: String, _ payload: JSONValue) {
        let runID = payload["runId"].string
        if channel == "runs:queueChanged", runID == viewingRunID { scheduleRemoteQueueRead() }
        if channel == "runs:statusChanged", let runID, let status = payload["status"].string { runQueues.observe(runID, status: status) }
        if channel == "runs:toolApprovalResolved", let requestID = payload["requestId"].string {
            decisionRevision += 1
            pendingApprovals.removeAll {
                $0.requestId == requestID && (payload["approvalToken"].string == nil || $0.approvalToken == payload["approvalToken"].string)
            }
            scheduleApprovalExpiry()
        }
        if channel == "runs:ephemeralEvent" {
            if runID == viewingRunID { transcript.receive(payload) }
            return
        }
        if channel == "runs:statusChanged", runID == viewingRunID,
           ["succeeded", "failed", "canceled"].contains(payload["status"].string ?? "") { transcript.settleTurn() }
        if ["runs:statusChanged", "runs:updated", "runs:eventPersisted", "runs:diffUpdated", "runs:toolApprovalRequest", "runs:toolApprovalResolved"].contains(channel) {
            if runID == viewingRunID || channel == "runs:toolApprovalResolved" {
                // Throttle bursts without continually postponing durable acknowledgement.
                scheduleHistoryRefresh()
            }
            if channel != "runs:eventPersisted" { scheduleListRefresh() }
        }
        if ["space:changed", "workspace:created", "workspace:updated", "workspace:deleted", "workspace:gitStateChanged", "collections:changed", "projects:changed"].contains(channel) { scheduleListRefresh() }
        if channel == "providers:skillsUpdated", let providerID = payload["providerId"].string {
            contextRevisions[providerID, default: 0] += 1
        }
        if channel == "providers:modelsUpdated", let providerID = payload["providerId"].string {
            Task { await loadModels(providerID, force: true) }
        }
    }

    private func scheduleHistoryRefresh() {
        guard eventRefresh == nil else { return }
        let current = generation
        eventRefresh = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            guard let self, self.generation == current else { return }
            self.eventRefresh = nil
            await self.loadHistory(direction: "refresh")
        }
    }

    private func stopRemoteQueueWatch() {
        remoteQueueRead?.cancel(); remoteQueuePoll?.cancel()
        remoteQueueRead = nil; remoteQueuePoll = nil; remoteQueueReadID = nil; remoteQueueReadAgain = false; remoteQueues = []
    }
    private func startRemoteQueueWatch(_ runID: String) {
        stopRemoteQueueWatch()
        guard isConnected, viewingRunID == runID else { return }
        let owner = pairingOwner, current = generation
        remoteQueuePoll = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.pairingOwner == owner, self.generation == current, self.viewingRunID == runID, self.isConnected else { return }
                self.scheduleRemoteQueueRead()
                do { try await Task.sleep(for: .seconds(10)) } catch { return }
            }
        }
    }
    private func scheduleRemoteQueueRead() {
        guard let runID = viewingRunID, let transport, isConnected else { return }
        guard remoteQueueRead == nil else { remoteQueueReadAgain = true; return }
        let ticket = UUID(), owner = pairingOwner, current = generation
        remoteQueueReadID = ticket
        remoteQueueRead = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.remoteQueueReadID == ticket {
                    self.remoteQueueRead = nil; self.remoteQueueReadID = nil
                    if self.remoteQueueReadAgain { self.remoteQueueReadAgain = false; self.scheduleRemoteQueueRead() }
                }
            }
            do {
                let value = try await transport.invoke("runs:getQueue", args: [.string(runID)])
                let page = try value.decode(RemoteRunQueues.self)
                try Task.checkCancellation()
                guard owner == self.pairingOwner, current == self.generation, self.viewingRunID == runID else { return }
                guard page.queues.count <= 4, page.queues.allSatisfy({ $0.runId == runID && $0.messages.count <= 32 }) else { throw MainsError.invalidReply }
                self.remoteQueues = page.queues.filter(\.isCurrent)
            } catch {
                if !Task.isCancelled, owner == self.pairingOwner, current == self.generation, self.viewingRunID == runID {
                    self.remoteQueues = self.remoteQueues.filter(\.isCurrent)
                }
            }
        }
    }

    private func scheduleListRefresh() {
        guard listRefresh == nil else { return }
        let current = generation
        listRefresh = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
            guard let self, self.generation == current else { return }
            self.listRefresh = nil
            await self.refresh()
        }
    }

    public func hasConsent(providerID: String) -> Bool {
        _ = consentRevision
        if isDemo { return demoConsents.contains(providerID) }
        guard let id = pairing?.descriptor.backendId else { return false }
        return storage.hasConsent(backendID: id, providerID: providerID)
    }
    public func grantConsent(providerID: String, backendID: String) {
        guard pairing?.descriptor.backendId == backendID else { return }
        if isDemo { demoConsents.insert(providerID) }
        else { storage.grantConsent(backendID: backendID, providerID: providerID) }
        consentRevision += 1
    }
    public func revokeConsent(providerID: String, backendID: String) {
        guard pairing?.descriptor.backendId == backendID else { return }
        if isDemo { demoConsents.remove(providerID) }
        else { storage.revokeConsent(backendID: backendID, providerID: providerID) }
        consentRevision += 1
    }
    public func revokeAllConsents(backendID: String) {
        guard pairing?.descriptor.backendId == backendID else { return }
        if isDemo { demoConsents = [] }
        else { storage.revokeAllConsents(backendID: backendID) }
        consentRevision += 1
    }

    public func send(_ text: String, runID: String? = nil, spaceID: String? = nil, workspaceID: String? = nil,
                     collectionID: String? = nil, settings: ComposerSettings? = nil, attachments: [PromptAttachment] = [],
                     contextSkills: [ContextSkill] = [], contextScope: ContextScope? = nil, steering: Bool = false, queuedInputID: String? = nil) async throws -> String {
        guard pendingFork == nil else { throw MainsError.server("Wait for the fork, or check its delivery before sending.") }
        guard pendingMessage?.status != .uncertain else { throw MainsError.server("Check the unconfirmed message before sending another.") }
        if let runID, decisionDeliveries.contains(where: { $0.value.attempt?.runID == runID && [.sending, .uncertain].contains($0.value.phase) }) {
            throw MainsError.server("Wait for the pending answer, or check its delivery before sending another message.")
        }
        guard isConnected, !sending,
              let pairing, let accountID else { throw MainsError.disconnected }
        let attached = ContextMentions.attached(in: text, skills: contextSkills)
        let message = ContextMentions.goal(text, skills: attached)
        guard !message.isEmpty || !attachments.isEmpty else { throw MainsError.server("Write a message or attach a file first.") }
        let providerID: String
        let channel: String
        let actualWorkspaceID: String?
        var payload: [String: JSONValue] = ["accountId": .string(accountID)]
        if let runID {
            guard settingsChanges[runID] == nil else { throw MainsError.server("Confirm the conversation’s settings before sending.") }
            guard pendingMessage?.runID != runID || pendingMessage?.status != .accepted else {
                throw MainsError.server("Your previous message is still syncing.")
            }
            guard let run = conversations.first(where: { $0.id == runID }), run.isReplica != true else { throw MainsError.server("This conversation is read-only.") }
            if let message = run.archivedReplyError { throw MainsError.server(message) }
            if steering {
                guard run.supportsSteering else { throw MainsError.server("This provider does not support steering.") }
                guard run.canSteer else { throw MainsError.steerTurnEnded }
                payload["clientUserMessageId"] = .string(queuedInputID ?? UUID().uuidString)
            } else {
                guard !run.isActive else { throw MainsError.server("Wait for this reply to finish, or stop it before sending.") }
            }
            providerID = run.providerId; channel = steering ? "runs:steer" : "runs:continue"; actualWorkspaceID = run.workspaceId
            payload["runId"] = .string(runID); payload["message"] = .string(message)
            if !steering, let saved = settings ?? self.settings(forRunID: runID) { payload["conversationSettings"] = try .encode(saved) }
            if let queuedInputID { payload["clientUserMessageId"] = .string(queuedInputID) }
        } else {
            guard !steering else { throw MainsError.steerTurnEnded }
            guard let space = spaces.first(where: { $0.id == spaceID }) else { throw MainsError.server("Choose a space first.") }
            providerID = space.providerId; channel = "runs:execute"; actualWorkspaceID = space.mode == "developer" ? workspaceID : nil
            payload["spaceId"] = .string(space.id); payload["providerId"] = .string(space.providerId); payload["goal"] = .string(message)
            if let settings {
                payload["conversationSettings"] = try .encode(settings)
                if !settings.model.isEmpty { payload["model"] = .string(settings.model) }
            } else if let model = space.model, !model.isEmpty { payload["model"] = .string(model) }
            if space.mode == "developer" {
                guard let workspaceID, workspaces.contains(where: { $0.id == workspaceID && $0.isReplica != true }),
                      gitStates.first(where: { $0.workspaceId == workspaceID })?.pathExists != false else { throw MainsError.server("Choose a local workspace for this Code conversation.") }
                payload["workspaceId"] = .string(workspaceID)
            } else if let collectionID {
                guard collections.contains(where: { $0.id == collectionID }) else { throw MainsError.server("That project is no longer available.") }
                payload["collectionId"] = .string(collectionID)
            }
        }
        if !attached.isEmpty {
            guard contextScope == self.contextScope(providerID: providerID, workspaceID: actualWorkspaceID) else {
                throw MainsError.server("The context belongs to another provider or workspace. Choose it again before sending.")
            }
            payload["contextSkills"] = .array(attached.map(\.wire))
        }
        if !attachments.isEmpty { payload["attachments"] = try .encode(attachments) }
        guard hasConsent(providerID: providerID) else {
            throw MainsError.server(isDemo ? "Continue the on-device demo disclosure before sending." : "Allow data sharing with \(Provider.recipient(providerID)) before sending.")
        }
        let attempt = PendingMessage(runID: runID, text: message, date: Date(), status: .sending,
                                     commandID: UUID().uuidString, channel: channel, payload: .object(payload),
                                     backendID: pairing.descriptor.backendId, owner: pairingOwner,
                                     previousArtifactID: transcript.page?.artifacts.map(\.id).max() ?? 0, attachments: attachments, contextSkills: attached, queueInputID: queuedInputID)
        pendingMessage = attempt
        return try await deliver(attempt)
    }

    public func checkDelivery() async throws -> String {
        guard let pending = pendingMessage, pending.status == .uncertain, !sending else { throw MainsError.invalidReply }
        return try await deliver(pending) // The ORIGINAL identity and payload, never a new command.
    }

    public func canForkConversation(_ id: String) -> Bool {
        isConnected && pendingFork == nil && !sending && pendingMessage == nil && stoppingRunID == nil &&
        settingsChanges[id] == nil && conversations.first(where: { $0.id == id })?.canFork == true &&
        !decisionDeliveries.contains { $0.value.attempt?.runID == id && [.sending, .uncertain].contains($0.value.phase) }
    }

    public func forkConversation(_ id: String) async throws -> String {
        guard canForkConversation(id), pairing != nil, let accountID,
              let run = conversations.first(where: { $0.id == id }) else {
            throw MainsError.server("Fork a finished, local conversation while connected. Resolve any pending delivery first.")
        }
        guard hasConsent(providerID: run.providerId) else { throw MainsError.server("Allow data sharing with \(Provider.recipient(run.providerId)) before forking.") }
        let attempt = PendingFork(sourceRunID: id, status: .sending, commandID: UUID().uuidString,
                                  payload: .object(["sourceRunId": .string(id), "accountId": .string(accountID),
                                                    "message": .string("Continue from where this session left off.")]), owner: pairingOwner)
        return try await deliverFork(attempt)
    }

    public func checkForkDelivery() async throws -> String {
        guard let attempt = pendingFork, attempt.status == .uncertain, isConnected else { throw MainsError.disconnected }
        return try await deliverFork(attempt)
    }

    private func deliverFork(_ input: PendingFork) async throws -> String {
        var attempt = input; attempt.status = .sending; pendingFork = attempt
        do {
            let result = try await command("runs:fork", args: [attempt.payload], commandID: attempt.commandID, owner: attempt.owner)
            guard attempt.owner == pairingOwner else { throw MainsError.changedBackend }
            guard let id = result["runId"].string, !id.isEmpty, id != attempt.sourceRunID,
                  result["sourceRunId"].string == attempt.sourceRunID else { throw MainsError.invalidReply }
            pendingFork = nil; runQueues.kick()
            // Receipt acknowledgement completes the action; metadata loading may
            // finish later and must never turn an accepted fork into a new send.
            let current = generation
            Task { [weak self] in
                guard let self, self.pairingOwner == attempt.owner, self.generation == current else { return }
                _ = try? await self.readQueuedRun(id)
                guard self.pairingOwner == attempt.owner, self.generation == current else { return }
                await self.refresh()
            }
            return id
        } catch {
            if attempt.owner == pairingOwner {
                let failure = error as? MainsError
                let refused: Bool
                if case .server = failure { refused = failure?.isUnconfirmedCommand == false }
                else { refused = failure == .unauthorized || failure == .incompatible }
                if refused { pendingFork = nil; runQueues.kick() }
                else { attempt.status = .uncertain; pendingFork = attempt }
            }
            throw error
        }
    }

    private func deliver(_ attempt: PendingMessage) async throws -> String {
        sending = true
        defer { if attempt.owner == pairingOwner { sending = false } }
        do {
            let result = try await command(attempt.channel, args: [attempt.payload], commandID: attempt.commandID, owner: attempt.owner)
            guard attempt.owner == pairingOwner, let runID = result["runId"].string else { throw MainsError.changedBackend }
            guard attempt.runID == nil || attempt.runID == runID,
                  !attempt.isSteering || result["turnId"].string?.isEmpty == false else { throw MainsError.invalidReply }
            var accepted = attempt; accepted.runID = runID; accepted.status = .accepted
            // Steers have no optimistic row to hand off. The confirmed receipt
            // releases admission even while the reader stays on an older page.
            pendingMessage = attempt.isSteering || attempt.isQueueOwned ? nil : accepted
            // The acknowledgement owns send completion; projection refresh is independent.
            let current = generation
            Task { [weak self] in
                guard let self, self.pairingOwner == attempt.owner, self.generation == current else { return }
                if self.viewingRunID == runID { await self.loadHistory(direction: self.transcript.isFollowing ? "latest" : "refresh") }
                guard self.pairingOwner == attempt.owner, self.generation == current else { return }
                await self.refresh()
            }
            return runID
        } catch {
            if attempt.owner == pairingOwner {
                // A timeout/lost connection/cancellation can hide a successful command.
                let definiteRefusal: Bool
                if case .server = error as? MainsError {
                    definiteRefusal = !((error as? MainsError)?.isUnconfirmedCommand ?? true)
                } else { definiteRefusal = error as? MainsError == .unauthorized || error as? MainsError == .incompatible }
                if definiteRefusal { pendingMessage = nil }
                else { var uncertain = attempt; uncertain.status = .uncertain; pendingMessage = uncertain }
            }
            if attempt.isSteering, let failure = error as? MainsError, failure.isEndedSteer { throw MainsError.steerTurnEnded }
            throw error
        }
    }

    private func command(_ channel: String, args: [JSONValue], commandID: String = UUID().uuidString,
                         owner: Int? = nil, validate: (() throws -> Void)? = nil) async throws -> JSONValue {
        let owner = owner ?? pairingOwner
        let deadline = ContinuousClock.now + .seconds(60)
        while ContinuousClock.now < deadline {
            try Task.checkCancellation()
            guard pairingOwner == owner else { throw MainsError.changedBackend }
            try validate?()
            if connection == .unauthorized { throw MainsError.unauthorized }
            if connection == .incompatible { throw MainsError.incompatible }
            if isConnected, let transport {
                do {
                    let remaining = ContinuousClock.now.duration(to: deadline).components
                    let timeout = min(30, Double(remaining.seconds) + Double(remaining.attoseconds) / 1e18)
                    let result = try await transport.invoke(channel, args: args, commandId: commandID, timeout: timeout)
                    guard pairingOwner == owner else { throw MainsError.changedBackend }
                    return result
                } catch MainsError.disconnected { /* Only connection loss retries, within the original deadline. */ }
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw MainsError.timeout
    }

    public func stop(_ runID: String) async throws {
        guard stoppingRunID == nil, isConnected,
              let run = conversations.first(where: { $0.id == runID }), run.isReplica != true, run.isActive else { return }
        let owner = pairingOwner
        stoppingRunID = runID
        if let queue = runQueues.existing(runID), !queue.messages.isEmpty { queue.pause("Run stopped. Queued messages are paused.") }
        defer { if pairingOwner == owner { stoppingRunID = nil } }
        _ = try await command("runs:abort", args: [.string(runID)], owner: owner)
        if viewingRunID == runID { await loadHistory(direction: "refresh") }
        else { await refresh() }
    }

    private func reconcilePending(_ page: HistoryPage, runID: String) {
        guard let pending = pendingMessage, pending.runID == runID,
              !pending.isSteering, !pending.isQueueOwned,
              page.artifacts.contains(where: pending.matches) else { return }
        pendingMessage = nil
        runQueues.kick()
    }

    public func readContent(artifactID: Int, offset: Int = 0, source: String = "artifact") async throws -> JSONValue {
        guard let transport, let runID = viewingRunID, isConnected else { throw MainsError.disconnected }
        guard ["artifact", "tool-input", "tool-output"].contains(source), offset >= 0 else { throw MainsError.invalidReply }
        let current = generation
        let result = try await transport.invoke("runs:readHistoryContent", args: [.object([
            "runId": .string(runID), "source": .string(source), "id": .number(Double(artifactID)), "offset": .number(Double(offset)),
        ])])
        guard current == generation, viewingRunID == runID else { throw MainsError.changedBackend }
        return result
    }

    public func readFileDiff(runID: String, turnID: Int, file: TurnFileChange, owner: Int, cursor: FileDiffCursor? = nil) async throws -> FileDiffPage {
        guard owner == pairingOwner, viewingRunID == runID else { throw MainsError.changedBackend }
        guard let transport, isConnected else { throw MainsError.disconnected }
        guard turnID > 0, !file.path.isEmpty else { throw MainsError.invalidReply }
        let current = generation
        return try await TurnFileDiff.read(path: file.path, oldPath: file.oldPath, cursor: cursor) { offset in
            try Task.checkCancellation()
            guard self.pairingOwner == owner, self.generation == current, self.viewingRunID == runID else { throw MainsError.changedBackend }
            let result = try await transport.invoke("runs:readHistoryContent", args: [.object([
                "runId": .string(runID), "source": .string("turn-diff"), "id": .number(Double(turnID)), "offset": .number(Double(offset)),
            ])])
            guard self.pairingOwner == owner, self.generation == current, self.viewingRunID == runID else { throw MainsError.changedBackend }
            return try result.decode(HistoryContentPage.self)
        }
    }

    private func saveCache() {
        guard !isDemo, let pairing else { return }
        storage.saveSnapshot(CachedSnapshot(backendID: pairing.descriptor.backendId, conversations: conversations,
                                           spaces: spaces, workspaces: workspaces, histories: histories,
                                           collections: collections, projects: projects, gitStates: gitStates,
                                           selectedSpaceID: selectedSpaceID, homeTargets: homeTargets, composerSettings: composerSettings,
                                           lastSyncedAt: lastSyncedAt))
    }
}

extension BackendSession {
    public var pendingQuestions: PendingAsyncQuestions? {
        guard let runID = viewingRunID, let page = transcript.page, !page.hasNewer, !waitingForDecision,
              conversations.first(where: { $0.id == runID })?.isReplica != true else { return nil }
        var questions = PendingAsyncQuestions.latest(in: page.artifacts)
        questions?.sessionOwner = pairingOwner
        return questions
    }

    public func decisionState(for identity: DecisionIdentity) -> DecisionDelivery {
        if let state = decisionDeliveries[identity] { return state }
        if decisionDeliveries.count > 128 {
            decisionDeliveries = decisionDeliveries.filter { $0.value.attempt != nil }
        }
        let state = DecisionDelivery(); decisionDeliveries[identity] = state; return state
    }

    public func respondToApproval(_ approval: PendingApproval, approved: Bool, answer: String? = nil, checkOnly: Bool = false) async throws {
        guard approval.sessionOwner == pairingOwner else { throw MainsError.changedBackend }
        let state = decisionState(for: approval.id)
        try validateDecisionRun(approval.runId)
        if checkOnly {
            guard state.phase == .uncertain, let attempt = state.attempt else { throw MainsError.invalidReply }
            try await deliverDecision(attempt, checking: true)
            return
        }
        guard state.phase == .editing, let current = pendingApprovals.first(where: { $0.id == approval.id }),
              current.expiresAt > Date(), current.supported else { throw MainsError.server("This request is no longer waiting for an answer.") }
        if approved {
            if current.kind == "ask_user", (answer ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw MainsError.server("Choose an option or type an answer.") }
            if current.isForm {
                guard let answer, let bytes = answer.data(using: .utf8), let value = try? JSONDecoder().decode(JSONValue.self, from: bytes) else { throw MainsError.server("Complete the requested form.") }
                let errors = ElicitationForm(schema: current.requestedSchema).validate(value)
                if !errors.isEmpty { throw MainsError.server(errors.keys.sorted().compactMap { errors[$0] }.joined(separator: "\n")) }
            }
            if current.kind == "elicitation", !current.isForm, current.safeURL == nil { throw MainsError.server("This request has no supported web link. Complete it on your computer.") }
            if answer == "acceptForSession", current.kind == "tool_approval",
               (current.suppressAlwaysAllowRule == true || conversations.first(where: { $0.id == current.runId })?.providerId != "codex") {
                throw MainsError.server("Only this call can be approved.")
            }
        }
        guard (answer?.utf8.count ?? 0) <= 128 * 1024 else { throw MainsError.server("This answer is too large.") }
        var payload: [String: JSONValue] = ["requestId": .string(current.requestId), "approved": .bool(approved)]
        if let token = current.approvalToken { payload["approvalToken"] = .string(token) }
        if let answer { payload["answer"] = .string(answer) }
        let attempt = DecisionAttempt(identity: current.id, runID: current.runId, owner: pairingOwner,
            channel: "runs:toolApprovalResponse", payload: .object(payload), commandID: UUID().uuidString)
        try await deliverDecision(attempt)
    }

    public func answerQuestions(_ pending: PendingAsyncQuestions, answers: [String], checkOnly: Bool = false) async throws {
        guard pending.sessionOwner == pairingOwner else { throw MainsError.changedBackend }
        try validateDecisionRun(pending.runID)
        let state = decisionState(for: pending.id)
        if checkOnly {
            guard state.phase == .uncertain, let original = state.attempt, original.channel == "runs:answerAsyncQuestions" else { throw MainsError.invalidReply }
            // Check the question's accepted answer; never send an uncertain answer a second time.
            var payload = original.payload.objectValue
            payload["checkOnly"] = .bool(true)
            try await deliverDecision(DecisionAttempt(identity: original.identity, runID: original.runID, owner: original.owner,
                channel: original.channel, payload: .object(payload), commandID: UUID().uuidString), checking: true)
            return
        }
        guard state.phase == .editing, pendingQuestions == pending, let accountID,
              settingsChanges[pending.runID] == nil, !savingConversationSettings.contains(pending.runID),
              let provider = conversations.first(where: { $0.id == pending.runID })?.providerId, hasConsent(providerID: provider) else {
            throw MainsError.server("Confirm data sharing and conversation settings before answering.")
        }
        let answers = answers.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard answers.count == pending.questions.count, answers.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 32_000 }) else {
            throw MainsError.server("Answer every question before sending.")
        }
        let payload: JSONValue = .object(["runId": .string(pending.runID), "accountId": .string(accountID),
            "artifactId": .number(Double(pending.artifactID)), "answers": .array(answers.map(JSONValue.string))])
        try await deliverDecision(DecisionAttempt(identity: pending.id, runID: pending.runID, owner: pairingOwner,
            channel: "runs:answerAsyncQuestions", payload: payload, commandID: UUID().uuidString))
    }

    public func dismissQuestions(_ pending: PendingAsyncQuestions, checkOnly: Bool = false) async throws {
        guard pending.sessionOwner == pairingOwner else { throw MainsError.changedBackend }
        try validateDecisionRun(pending.runID)
        let state = decisionState(for: pending.id)
        if checkOnly {
            guard state.phase == .uncertain, let attempt = state.attempt, attempt.channel == "runs:dismissAsyncQuestions" else { throw MainsError.invalidReply }
            try await deliverDecision(attempt, checking: true); return
        }
        guard state.phase == .editing, pendingQuestions == pending, let accountID else { throw MainsError.server("These questions are no longer waiting for an answer.") }
        let payload: JSONValue = .object(["runId": .string(pending.runID), "accountId": .string(accountID), "artifactId": .number(Double(pending.artifactID))])
        try await deliverDecision(DecisionAttempt(identity: pending.id, runID: pending.runID, owner: pairingOwner,
            channel: "runs:dismissAsyncQuestions", payload: payload, commandID: UUID().uuidString))
    }

    public func checkQuestionDelivery(_ pending: PendingAsyncQuestions) async throws {
        if decisionState(for: pending.id).attempt?.channel == "runs:dismissAsyncQuestions" { try await dismissQuestions(pending, checkOnly: true) }
        else { try await answerQuestions(pending, answers: [], checkOnly: true) }
    }

    private func validateDecisionRun(_ runID: String) throws {
        guard viewingRunID == runID, let run = conversations.first(where: { $0.id == runID }), run.isReplica != true else { throw MainsError.changedBackend }
        guard isConnected else { throw MainsError.disconnected }
    }

    private func deliverDecision(_ attempt: DecisionAttempt, checking: Bool = false) async throws {
        let state = decisionState(for: attempt.identity)
        guard state.phase != .sending, attempt.owner == pairingOwner else { throw MainsError.changedBackend }
        if !checking { state.attempt = attempt }
        state.phase = .sending; state.error = nil
        do {
            let result = try await command(attempt.channel, args: [attempt.payload], commandID: attempt.commandID, owner: attempt.owner) {
                guard self.viewingRunID == attempt.runID,
                      self.conversations.first(where: { $0.id == attempt.runID })?.isReplica != true else { throw MainsError.changedBackend }
            }
            guard attempt.owner == pairingOwner else { throw MainsError.changedBackend }
            if attempt.channel == "runs:answerAsyncQuestions", result["accepted"] != .bool(true) {
                state.phase = .uncertain; state.error = "Delivery has not been confirmed yet. Check again."; return
            }
            state.phase = .done; state.attempt = nil
            decisionRevision += 1
            pendingApprovals.removeAll { $0.id == attempt.identity }
            if viewingRunID == attempt.runID {
                if attempt.channel == "runs:answerAsyncQuestions" { transcript.setFollowing(true) }
                await loadHistory(direction: "refresh")
            }
        } catch {
            guard attempt.owner == pairingOwner else { throw MainsError.changedBackend }
            if state.phase == .done { throw error }
            let knownRefusal: Bool
            if let error = error as? MainsError, case .server(let message) = error {
                knownRefusal = !error.isUnconfirmedCommand && !["delivery is unknown", "still being delivered", "timed out", "connection closed", "disposed"].contains { message.localizedCaseInsensitiveContains($0) }
            } else { knownRefusal = false }
            // A failed receipt lookup cannot make the original decision safe to resend.
            if knownRefusal && !checking { state.phase = .editing; state.attempt = nil }
            else { state.phase = .uncertain }
            state.error = state.phase == .uncertain ? "Delivery is unknown. Check delivery before answering again." : error.localizedDescription
            throw error
        }
    }

    private func scheduleApprovalExpiry() {
        approvalExpiryTask?.cancel(); approvalExpiryTask = nil
        guard let expiry = pendingApprovals.map(\.expiresAt).min(), let runID = viewingRunID else { return }
        let current = generation
        approvalExpiryTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(max(0, min(300, expiry.timeIntervalSinceNow)))) } catch { return }
            guard let self, self.generation == current, self.viewingRunID == runID else { return }
            self.pendingApprovals.removeAll { $0.expiresAt <= Date() }
            self.decisionRevision += 1; self.scheduleApprovalExpiry()
            await self.loadHistory(direction: "refresh")
        }
    }

    private func retireResolvedDecisions(runID: String, page: HistoryPage) {
        let currentQuestions = page.hasNewer ? nil : PendingAsyncQuestions.latest(in: page.artifacts)?.id
        for (identity, state) in decisionDeliveries {
            let retired: Bool
            switch identity {
            case .approval(let id, _, _): retired = id == runID && !pendingApprovals.contains { $0.id == identity }
            case .questions(let id, _): retired = id == runID && !page.hasNewer && currentQuestions != identity
            }
            if retired { state.phase = .done; state.attempt = nil; state.error = nil }
        }
    }
}
