import Foundation
import Observation

public struct CachedSnapshot: Codable, Sendable {
    public let backendID: String
    public let conversations: [Conversation]
    public let spaces: [Space]
    public let workspaces: [Workspace]
    public var collections: [ProjectCollection]? = nil
    public var projects: [CodeProject]? = nil
    public var gitStates: [WorkspaceGitState]? = nil
    public var selectedSpaceID: String? = nil
    public var homeTargets: [String: HomeTarget]? = nil
    public var composerSettings: [String: ComposerSettings]? = nil
    public var lastSyncedAt: Date? = nil
}

public enum CachedHistoryChange: Sendable {
    case replace(runID: String, page: HistoryPage)
    case remove(runID: String)
}

@MainActor
public protocol SessionStorage: AnyObject {
    var demoEnabled: Bool { get }
    func setDemoEnabled(_ enabled: Bool)
    func loadPairing() throws -> PairedBackend?
    func savePairing(_ pairing: PairedBackend) throws
    func removePairing() throws
    func loadSnapshot(backendID: String, deviceID: String) async -> CachedSnapshot?
    func loadHistory(backendID: String, deviceID: String, runID: String) async -> HistoryPage?
    func searchSavedMessages(_ query: String, backendID: String, deviceID: String) async -> [SavedMessageMatch]
    func offlineValues(_ key: String, prefix: Bool, backendID: String, deviceID: String) async -> [Data]
    func saveOfflineValue(_ data: Data, key: String, backendID: String, deviceID: String)
    func removeOfflineValues(_ prefix: String, backendID: String, deviceID: String)
    func offlineFiles(backendID: String, deviceID: String) async -> [OfflineFile]
    func offlineFileURL(_ file: OfflineFile, backendID: String, deviceID: String) async -> URL?
    func saveOfflineFile(_ file: OfflineFile, copying source: URL, backendID: String, deviceID: String) async throws
    func removeOfflineFile(_ file: OfflineFile, backendID: String, deviceID: String) async throws
    func saveSnapshot(_ snapshot: CachedSnapshot, deviceID: String, history: CachedHistoryChange?)
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
    public func loadHistory(backendID: String, deviceID: String, runID: String) async -> HistoryPage? { nil }
    public func searchSavedMessages(_ query: String, backendID: String, deviceID: String) async -> [SavedMessageMatch] { [] }
    public func offlineValues(_ key: String, prefix: Bool, backendID: String, deviceID: String) async -> [Data] { [] }
    public func saveOfflineValue(_ data: Data, key: String, backendID: String, deviceID: String) {}
    public func removeOfflineValues(_ prefix: String, backendID: String, deviceID: String) {}
    public func offlineFiles(backendID: String, deviceID: String) async -> [OfflineFile] { [] }
    public func offlineFileURL(_ file: OfflineFile, backendID: String, deviceID: String) async -> URL? { nil }
    public func saveOfflineFile(_ file: OfflineFile, copying source: URL, backendID: String, deviceID: String) async throws { throw MainsError.disconnected }
    public func removeOfflineFile(_ file: OfflineFile, backendID: String, deviceID: String) async throws { throw MainsError.disconnected }
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
    public func startsConversation(spaceID: String, workspaceID: String) -> Bool {
        channel == "runs:execute" && payload["spaceId"].string == spaceID && payload["workspaceId"].string == workspaceID
    }
    func matches(_ artifact: Artifact) -> Bool {
        guard let runID else { return false }
        guard artifact.runId == runID, artifact.kind == "user-prompt" else { return false }
        if isSteering { return artifact.metadata?["clientUserMessageId"].string == payload["clientUserMessageId"].string }
        if let promptID = payload["clientPromptId"].string { return artifact.metadata?["clientPromptId"].string == promptID }
        return artifact.id > previousArtifactID && artifact.content == text
    }
}

/// One paired computer. All async writers are fenced by connection and pairing ownership.
@MainActor @Observable
public final class BackendSession {
    public private(set) var atlasRevision = 0
    public private(set) var pendingAtlasSave: PendingAtlasSave?
    public private(set) var pendingConversationAction: PendingConversationAction?
    public private(set) var pendingWorkspaceAction: PendingWorkspaceAction?
    public private(set) var retiredWorkspace: RetiredWorkspace?
    public private(set) var pendingPlanDecision: PendingPlanDecision?
    private var confirmedPlanDecision: (runID: String, planID: Int, status: PlanProposal.Status)?
    private struct GoalChangeAttempt {
        let id: String
        let runID: String
        let owner: Int
        let args: [JSONValue]
        var uncertain = false
    }
    private var pendingGoalChange: GoalChangeAttempt?
    public private(set) var retiredConversation: RetiredConversation?
    @ObservationIgnored private var conversationActionRevision = 0
    @ObservationIgnored private var workspaceActionRevision = 0
    #if MAINS_GPT_LIVE || SWIFT_PACKAGE
    public let voice = RealtimeVoiceController()
    public private(set) var pendingVoiceConversation: PendingVoiceConversation?
    public private(set) var checkingVoiceConversation = false
    public private(set) var voiceSpaceID: String?
    public private(set) var voiceMate: Mate?
    public private(set) var realtimeVoices: RealtimeVoiceCatalog?
    public private(set) var selectedRealtimeVoice: String?
    public private(set) var loadingVoiceSettings = false
    public private(set) var savingVoiceSettings = false
    public private(set) var voiceSettingsError: String?
    public private(set) var uncertainVoiceSelection = false
    @ObservationIgnored private var voiceSettingsReadID: UUID?
    private struct VoiceSelectionChange { let id: String; let voice: String; let owner: Int }
    @ObservationIgnored private var voiceSelectionChange: VoiceSelectionChange?
#endif

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
    public private(set) var matesRevision = 0
    private var pendingMateCommand: PendingMateCommand?
    public var mateCommandPending: Bool { pendingMateCommand != nil }
    public var mateCommandUncertain: Bool { pendingMateCommand?.uncertain == true }
    var pendingMateTeamName: String? {
        guard let pendingMateCommand, pendingMateCommand.channel == "assistants:createTeam" else { return nil }
        return pendingMateCommand.args.first?["name"].string
    }
    public var supportsMates: Bool { connectedDescriptor?.capabilities.contains("assistants") == true }
    public var supportsMateInfo: Bool { supportsMates && connectedDescriptor?.capabilities.contains("mateInfo") == true }
    var supportsMateAssignments: Bool { supportsMateInfo || (isDemo && supportsMates) }
    public var supportsMateModelEditing: Bool { supportsMateInfo && connectedDescriptor?.capabilities.contains("mateModelEditing") == true }
    public var supportsMateRuntimeSettings: Bool { supportsMateInfo && connectedDescriptor?.capabilities.contains("mateRuntimeSettings") == true }
    public var supportsMatePinning: Bool { supportsMateInfo && connectedDescriptor?.capabilities.contains("matePinning") == true }
    public var supportsMobileGoalSummary: Bool { connectedDescriptor?.capabilities.contains("mobileGoalSummary") == true }
    public var supportsMobileGoalControls: Bool { connectedDescriptor?.capabilities.contains("mobileGoalControls") == true }
    public var supportsWorkspaceFileSearch: Bool { connectedDescriptor?.capabilities.contains("workspaceFileSearch") == true }
    public var supportsChatOrganization: Bool { connectedDescriptor?.capabilities.contains("mobileChatOrganization") == true }
    public var supportsWorkspaceManagement: Bool { connectedDescriptor?.capabilities.contains("mobileWorkspaceManagement") == true }
    public var supportsPlanDecisions: Bool { connectedDescriptor?.capabilities.contains("mobilePlanDecision") == true }
    public var supportsPluginIcons: Bool { connectedDescriptor?.capabilities.contains("mobilePluginIcons") == true }
    public var goalChangeNeedsCheck: Bool { pendingGoalChange?.uncertain == true }
    public private(set) var goalSummaryRevision = 0
    var supportsMateTeamCreation: Bool { supportsMates && connectedDescriptor?.capabilities.contains("mateTeamCreation") == true }
    public var mateSpaces: [Space] {
        spaces.filter { ($0.providerId == "codex" || $0.providerId == "claude_code") && providerConfigs[$0.providerId] != nil }
    }
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
    public private(set) var workInbox = WorkInboxSnapshot()
    public private(set) var workInboxLoading = false
    public private(set) var workInboxIsCurrent = false
    public private(set) var workInboxError: String?
    public var actionError: String?
    public private(set) var contextRevisions: [String: Int] = [:]
    @ObservationIgnored private var contextCatalogues: [ContextScope: ContextCatalogue] = [:]
    @ObservationIgnored private var contextRequests: [ContextScope: UUID] = [:]
    @ObservationIgnored private var contextOrder: [ContextScope] = []
    // A nil value is a completed lookup for a plugin with no usable artwork.
    private var toolPluginIcons: [String: ToolPluginIcon?] = [:]
    @ObservationIgnored private var toolPluginIconOrder: [String] = []
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
    @ObservationIgnored private var historySelection = UUID()
    @ObservationIgnored private var offlineAtlasFavoritesRead: (generation: Int, revision: Int)?
    @ObservationIgnored private var historyRefreshNeeded = false
    @ObservationIgnored private var snapshotRefreshNeeded = false
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var pairingOwner = 0
    @ObservationIgnored private var active = false
    @ObservationIgnored private var online = true
    @ObservationIgnored private var restored = false
    @ObservationIgnored private var restoringSnapshotOwner: Int?
    @ObservationIgnored private var accountID: String?
    @ObservationIgnored private var histories: [String: HistoryPage] = [:]
    @ObservationIgnored private var historyOrder: [String] = []
    @ObservationIgnored private var endpointIndex = 0
    @ObservationIgnored private var blocked: ConnectionState?
    @ObservationIgnored private var drafts: [String: ConversationDraft] = [:]
    private struct HomeDraftScope: Hashable {
        let spaceID: String
        let workspaceID: String?
    }
    @ObservationIgnored private var homeDrafts: [HomeDraftScope: ConversationDraft] = [:]
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
    private var decisionRevision = 0
    @ObservationIgnored private var workInboxVisible = false
    @ObservationIgnored private var workInboxPolling = false
    @ObservationIgnored private var workInboxRead: Task<Void, Never>?
    @ObservationIgnored private var workInboxPoll: Task<Void, Never>?
    @ObservationIgnored private var workInboxRefresh: Task<Void, Never>?
    @ObservationIgnored private var workInboxReadID: UUID?
    @ObservationIgnored private var workInboxRevision = 0
    @ObservationIgnored private var workInboxReadAgain = false

    public convenience init(storage: any SessionStorage) {
        self.init(storage: storage, makeTransport: { demo in
            if let demo { DemoTransport(backend: demo) } else { WebSocketTransport() }
        })
    }
    init(storage: any SessionStorage, makeTransport: @escaping @MainActor (DemoBackend?) -> any BackendTransport) {
        self.storage = storage; self.makeTransport = makeTransport
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        voice.onChange = { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, !self.active, !self.voice.keepsConnectionAlive, self.transport != nil else { return }
                self.restart()
            }
        }
#endif

    }
    public var isConnected: Bool { connection == .connected }
    public var ownership: Int { pairingOwner }
    public var selectedSpace: Space? { spaces.first { $0.id == selectedSpaceID } }
    private var shouldMaintainConnection: Bool {
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        active || voice.keepsConnectionAlive
        #else
        active
        #endif
    }

    #if MAINS_GPT_LIVE || SWIFT_PACKAGE
    public func loadVoiceSettings() async {
        guard isConnected, let candidate = transport, !loadingVoiceSettings, voiceSelectionChange == nil else { return }
        let current = generation, readID = UUID()
        voiceSettingsReadID = readID; loadingVoiceSettings = true; voiceSettingsError = nil
        defer { if voiceSettingsReadID == readID { loadingVoiceSettings = false } }
        do {
            async let catalogRead = candidate.invoke("providers:getRealtimeVoices", args: [.string("codex")])
            async let providerRead = candidate.invoke("providers:getEnabled")
            let (catalogValue, providerValue) = try await (catalogRead, providerRead)
            let (catalog, providers) = try await Wire.decodeOffMain {
                try (catalogValue.decode(RealtimeVoiceCatalog.self), Self.list(providerValue, key: "providers", as: ProviderSummary.self))
            }
            guard generation == current, transport === candidate, voiceSettingsReadID == readID else { return }
            guard !catalog.voices.isEmpty, catalog.voices.count <= 256,
                  catalog.voices.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 128 }),
                  catalog.voices.contains(catalog.defaultVoice) else { throw MainsError.invalidReply }
            realtimeVoices = catalog
            let saved = providers.first { $0.id == "codex" }?.config?["realtimeVoice"]?.string
            selectedRealtimeVoice = saved?.isEmpty == false ? saved : catalog.defaultVoice
        } catch {
            if generation == current, transport === candidate, voiceSettingsReadID == readID {
                voiceSettingsError = error.localizedDescription
            }
        }
    }

    public func selectRealtimeVoice(_ value: String) async {
        guard isConnected, !loadingVoiceSettings, voiceSelectionChange == nil,
              realtimeVoices?.voices.contains(value) == true else { return }
        voiceSettingsReadID = nil
        let change = VoiceSelectionChange(id: UUID().uuidString, voice: value, owner: pairingOwner)
        voiceSelectionChange = change
        await saveVoiceSelection(change)
    }

    public func checkVoiceSelection() async {
        guard isConnected, !savingVoiceSettings, let change = voiceSelectionChange else { return }
        await saveVoiceSelection(change)
    }

    private func saveVoiceSelection(_ change: VoiceSelectionChange) async {
        guard change.owner == pairingOwner else { return }
        savingVoiceSettings = true; voiceSettingsError = nil
        defer { if change.owner == pairingOwner { savingVoiceSettings = false } }
        do {
            let result = try await command("providers:updateRunSettings", args: [.string("codex"), .object(["realtimeVoice": .string(change.voice)])],
                                           commandID: change.id, owner: change.owner)
            guard change.owner == pairingOwner else { return }
            guard result["config"]["realtimeVoice"].string == change.voice else {
                throw MainsError.server("Update Mains on your computer to save voice selections from this iPhone.")
            }
            selectedRealtimeVoice = change.voice
            voiceSelectionChange = nil; uncertainVoiceSelection = false
        } catch {
            guard change.owner == pairingOwner else { return }
            let failure = error as? MainsError
            let refused: Bool
            if case .server = failure { refused = !(failure?.isUnconfirmedCommand ?? true) }
            else { refused = failure == .unauthorized || failure == .incompatible }
            if refused { voiceSelectionChange = nil; uncertainVoiceSelection = false }
            else { uncertainVoiceSelection = true }
            voiceSettingsError = refused ? error.localizedDescription : "Voice selection could not be confirmed. Check the save before choosing another voice."
        }
    }

    enum VoiceStartAvailability {
        case unavailable, workspaceRequired, mateHostUpdateRequired, ready
    }

    func voiceStartAvailability(runID: String? = nil, spaceID: String? = nil, mate: Mate? = nil,
                                workspaceID: String? = nil) -> VoiceStartAvailability {
        guard isConnected, !isDemo, voice.makeMedia != nil, !voice.ownsCall, pendingVoiceConversation == nil,
              pendingFork == nil, pendingConversationAction == nil, pendingMessage == nil, voiceSelectionChange == nil, !sending, stoppingRunID == nil else { return .unavailable }
        if let runID {
            guard let run = conversations.first(where: { $0.id == runID }),
                  run.providerId == "codex", !run.isActive, !run.isArchived, run.isReplica != true,
                  run.archivedReplyError == nil, settingsChanges[runID] == nil,
                  !decisionDeliveries.contains(where: { $0.value.attempt?.runID == runID }) else { return .unavailable }
            return .ready
        }
        if let mate {
            guard mate.ready, mate.providerId == "codex", supportsMates else { return .unavailable }
            return connectedDescriptor?.capabilities.contains("mateRealtimeConversation") == true ? .ready : .mateHostUpdateRequired
        }
        guard let space = spaces.first(where: { $0.id == spaceID }), space.providerId == "codex", !changingMode,
              workspaceID == nil || space.mode == "developer" else { return .unavailable }
        if space.mode == "developer" {
            guard let workspaceID = workspaceID ?? homeTargets[space.id]?.workspaceID,
                  workspaces.contains(where: { $0.id == workspaceID && $0.isReplica != true }),
                  gitStates.first(where: { $0.workspaceId == workspaceID })?.pathExists != false else { return .workspaceRequired }
        }
        return .ready
    }

    public func canStartVoice(runID: String? = nil, spaceID: String? = nil, mate: Mate? = nil, workspaceID: String? = nil) -> Bool {
        voiceStartAvailability(runID: runID, spaceID: spaceID, mate: mate, workspaceID: workspaceID) == .ready
    }

    /// Creates an idle conversation only when the user explicitly starts voice.
    /// A new-chat draft and its attachments remain owned by the source composer.
    public func startVoice(runID: String? = nil, spaceID: String? = nil, mate: Mate? = nil, workspaceID: String? = nil) async {
        guard canStartVoice(runID: runID, spaceID: spaceID, mate: mate, workspaceID: workspaceID),
              let pairing, let accountID, let candidate = transport else { return }
        guard hasConsent(providerID: "codex") else { actionError = "Allow data sharing with OpenAI before starting voice chat."; return }
        let owner = pairingOwner, current = generation
        let newMate = runID == nil ? mate : nil
        let label = runID.flatMap { id in conversations.first { $0.id == id }?.displayTitle } ?? newMate?.name ?? "New conversation"
        let existingSettings = runID.flatMap { settings(forRunID: $0) }
        var creation: PendingVoiceConversation?
        if let newMate {
            creation = PendingVoiceConversation(commandID: UUID().uuidString,
                payload: .object(["accountId": .string(accountID), "assistantId": .string(newMate.id)]), owner: owner)
        } else if runID == nil, let space = spaces.first(where: { $0.id == spaceID }) {
            let target = homeTargets[space.id] ?? HomeTarget()
            var payload: [String: JSONValue] = ["accountId": .string(accountID), "spaceId": .string(space.id)]
            do { payload["conversationSettings"] = try .encode(settings(for: space)) }
            catch { actionError = error.localizedDescription; return }
            if space.mode == "developer", let workspaceID = workspaceID ?? target.workspaceID { payload["workspaceId"] = .string(workspaceID) }
            if space.mode != "developer", let collectionID = target.collectionID { payload["collectionId"] = .string(collectionID) }
            creation = PendingVoiceConversation(commandID: UUID().uuidString, payload: .object(payload), owner: owner)
        }
        voiceMate = newMate
        voiceSpaceID = newMate == nil ? runID.flatMap { id in conversations.first { $0.id == id }?.spaceId } ?? spaceID : nil
        let startID = UUID().uuidString
        var stopID = UUID().uuidString
        await voice.start(label: label) { [weak self] in
            guard let self, self.pairingOwner == owner, self.generation == current,
                  self.transport === candidate, self.isConnected, self.hasConsent(providerID: "codex") else { throw MainsError.changedBackend }
            var id = runID
            if id == nil, let pending = creation {
                self.pendingVoiceConversation = pending
                id = try await self.resolveVoiceConversation(pending)
            }
            guard let id, self.pairingOwner == owner, self.generation == current,
                  self.transport === candidate, self.isConnected, self.hasConsent(providerID: "codex") else { throw MainsError.changedBackend }
            return RealtimeVoiceSignaling(runID: id, start: { [weak self] sdp, connectionID in
                guard let self, self.pairingOwner == owner, self.generation == current,
                      self.transport === candidate, self.hasConsent(providerID: "codex") else { throw MainsError.changedBackend }
                var payload: [String: JSONValue] = ["runId": .string(id), "accountId": .string(accountID),
                    "connectionId": .string(connectionID), "sdp": .string(sdp)]
                // A newly created conversation already has these settings on the host.
                if let existingSettings { payload["conversationSettings"] = try .encode(existingSettings) }
                // An SDP offer belongs to this one live peer. Never replay it
                // on a replacement transport after the microphone has retired.
                _ = try await candidate.invoke("runs:startRealtime", args: [.object(payload)], commandId: startID, timeout: 30)
            }, stop: { [weak self] connectionID in
                guard let self, self.pairingOwner == owner, self.pairing?.descriptor.backendId == pairing.descriptor.backendId else { throw MainsError.changedBackend }
                do {
                    _ = try await self.command("runs:stopRealtime", args: [.object([
                        "runId": .string(id), "accountId": .string(accountID), "connectionId": .string(connectionID),
                    ])], commandID: stopID, owner: owner)
                    stopID = UUID().uuidString
                } catch {
                    if let failure = error as? MainsError, case .server = failure, !failure.isUnconfirmedCommand { stopID = UUID().uuidString }
                    throw error
                }
            })
        }
    }

    public func checkVoiceConversation() async throws -> String {
        guard let pending = pendingVoiceConversation, pending.uncertain, !checkingVoiceConversation else { throw MainsError.invalidReply }
        checkingVoiceConversation = true
        defer { if pending.owner == pairingOwner { checkingVoiceConversation = false } }
        let id = try await resolveVoiceConversation(pending)
        _ = try? await readQueuedRun(id)
        return id
    }

    private func resolveVoiceConversation(_ pending: PendingVoiceConversation) async throws -> String {
        guard pending.owner == pairingOwner else { throw MainsError.changedBackend }
        do {
            let result = try await command("runs:createRealtimeConversation", args: [pending.payload], commandID: pending.commandID, owner: pending.owner)
            guard let id = result["runId"].string, !id.isEmpty, id.utf8.count <= 800 else { throw MainsError.invalidReply }
            if let mateID = pending.payload["assistantId"].string, result["assistantId"].string != mateID { throw MainsError.invalidReply }
            if pairingOwner == pending.owner { pendingVoiceConversation = nil }
            return id
        } catch {
            if pairingOwner == pending.owner {
                if let failure = error as? MainsError, case .server = failure, !failure.isUnconfirmedCommand { pendingVoiceConversation = nil }
                else { pendingVoiceConversation?.uncertain = true }
            }
            throw error
        }
    }

#endif

    public func searchConversations(_ query: String, cursor: ConversationSearchCursor? = nil) async throws -> ConversationSearchPage {
        guard let transport, isConnected, let accountID else { throw MainsError.disconnected }
        let owner = pairingOwner, current = generation
        let trimmed = String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        guard !trimmed.isEmpty else { return ConversationSearchPage(items: [], nextCursor: nil) }
        var payload: [String: JSONValue] = ["accountId": .string(accountID), "query": .string(trimmed), "limit": .number(25)]
        if let cursor { payload["cursor"] = try .encode(cursor) }
        let value = try await transport.invoke("search:conversations", args: [.object(payload)])
        let page = try await value.decodeOffMain(ConversationSearchPage.self)
        guard owner == pairingOwner, current == generation, self.transport === transport else { throw MainsError.changedBackend }
        func validTimestamp(_ value: Double) -> Bool { value.isFinite && value.rounded() == value && (0...253402300799000).contains(value) }
        guard page.items.count <= 25, Set(page.items.map(\.runId)).count == page.items.count,
              page.items.allSatisfy({ !$0.runId.isEmpty && $0.title.utf8.count <= 2048 && ($0.snippet?.utf8.count ?? 0) <= 4096 && validTimestamp($0.updatedAt) &&
                  ($0.messageCursor.map { $0.source == "artifact" && $0.id > 0 && $0.id < Int.max && validTimestamp($0.timestamp) } ?? true) }),
              page.nextCursor.map({ (0...4).contains($0.rank) && validTimestamp($0.createdAt) && !$0.runId.isEmpty && $0.runId.utf8.count <= 800 }) ?? true,
              page.nextCursor == nil || page.nextCursor != cursor else { throw MainsError.invalidReply }
        return page
    }

    public func searchSavedConversations(_ query: String) async -> [ConversationSearchHit] {
        guard !isDemo, let pairing else { return [] }
        let owner = pairingOwner
        let matches = await storage.searchSavedMessages(String(query.prefix(200)), backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId)
        guard !Task.isCancelled, owner == pairingOwner else { return [] }
        return matches.compactMap { hit in
            guard let run = conversations.first(where: { $0.id == hit.runID && !$0.isArchived }) else { return nil }
            return ConversationSearchHit(runId: run.id, title: run.displayTitle, providerId: run.providerId, mode: run.mode,
                context: collections.first(where: { $0.id == run.collectionId })?.name,
                updatedAt: run.updatedAt.timeIntervalSince1970 * 1000, snippet: hit.snippet, messageCursor: hit.cursor)
        }
    }

    /// Activity paging has its own disposable page and never replaces the reader's transcript.
    public func readHistoryActivity(runID: String, range: HistoryActivityRange, direction: String = "refresh", cursor: HistoryCursor? = nil) async throws -> HistoryPage {
        guard let transport, isConnected, viewingRunID == runID else { throw MainsError.disconnected }
        let owner = pairingOwner, current = generation
        var payload: [String: JSONValue] = ["runId": .string(runID), "profile": .string("mobile"), "direction": .string(direction),
            "range": .object(["start": try .encode(range.start), "end": try .encode(range.end)])]
        payload["cursor"] = try .encode(cursor ?? range.start)
        if direction != "older" { payload["end"] = try .encode(range.end) }
        let value = try await transport.invoke("runs:getHistory", args: [.object(payload)])
        let page = try await value.decodeOffMain(HistoryPage.self)
        guard owner == pairingOwner, current == generation, self.transport === transport, viewingRunID == runID else { throw MainsError.changedBackend }
        func compare(_ a: HistoryCursor, _ b: HistoryCursor) -> Double {
            if a.timestamp != b.timestamp { return a.timestamp - b.timestamp }
            if a.source != b.source { return a.source == "artifact" ? -1 : 1 }
            return Double(a.id) - Double(b.id)
        }
        func contains(_ key: HistoryCursor) -> Bool { compare(key, range.start) >= 0 && compare(key, range.end) < 0 }
        // Older computers may ignore the additive range option. Keep their replies within this sheet's frozen scope.
        let artifacts = page.artifacts.filter { row in
            let time = row.metadata?["voiceStartedAt"].number ?? row.createdAt.timeIntervalSince1970 * 1000
            return row.runId == runID && contains(.init(timestamp: time, source: "artifact", id: row.id))
        }
        let calls = page.toolCalls.filter { contains(.init(timestamp: $0.createdAt.timeIntervalSince1970 * 1000, source: "tool", id: $0.id)) }
        return HistoryPage(artifacts: artifacts, toolCalls: calls, turns: page.turns, start: page.start, end: page.end, last: page.last,
            hasOlder: page.hasOlder && (page.start.map { compare($0, range.start) > 0 } ?? false),
            hasNewer: page.hasNewer && (page.end.map { compare($0, range.end) < 0 } ?? false))
    }

    public func draft(for runID: String) -> ConversationDraft {
        if let draft = drafts[runID] { return draft }
        let draft = makeDraft(owner: .conversation, id: runID)
        drafts[runID] = draft
        return draft
    }

    public func homeDraft(for spaceID: String, workspaceID: String? = nil) -> ConversationDraft {
        let scope = HomeDraftScope(spaceID: spaceID, workspaceID: workspaceID)
        if let draft = homeDrafts[scope] { return draft }
        let draft = if let workspaceID {
            makeDraft(owner: .workspace, id: "\(spaceID.utf8.count):\(spaceID)\(workspaceID)")
        } else {
            makeDraft(owner: .home, id: spaceID)
        }
        homeDrafts[scope] = draft
        return draft
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
    public func submitQueuedDraft(_ id: String) throws {
        try runQueues.submit(id, draft: draft(for: id))
        if let demoBackend, runQueues.existing(id)?.messages.isEmpty == false {
            demoBackend.didQueueFollowUp(id)
        }
    }
    public func editQueuedMessage(_ runID: String, id: String) { runQueues.edit(runID, id: id) }
    public func cancelQueuedEdit(_ runID: String) { runQueues.cancelEdit(runID) }
    public func removeQueuedMessage(_ runID: String, id: String) { runQueues.remove(runID, id: id) }
    public func steerQueuedMessage(_ runID: String, id: String) async { await runQueues.steer(runID, id: id) }
    public func resumeMessageQueue(_ id: String) async { await runQueues.resume(id) }

    func readQueuedRun(_ id: String) async throws -> Conversation? {
        guard let transport, isConnected else { throw MainsError.disconnected }
        let owner = pairingOwner, current = generation
        let settingsReadVersion = settingsRevision
        let actionRevision = conversationActionRevision
        let value = try await transport.invoke("runs:getById", args: [.string(id)])
        guard owner == pairingOwner, current == generation, actionRevision == conversationActionRevision else { throw MainsError.changedBackend }
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
        guard isConnected, !sending, pendingConversationAction == nil, pendingPlanDecision?.runID != runID,
              !savingConversationSettings.contains(runID), settingsChanges[runID] == nil,
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

    public func readGoalSummary(_ runID: String) async throws -> MobileGoalSummary? {
        guard isConnected, supportsMobileGoalSummary, viewingRunID == runID, let transport,
              let run = conversations.first(where: { $0.id == runID }), run.providerId == "codex", run.isReplica != true else { return nil }
        let owner = pairingOwner, current = generation
        let value = try await transport.invoke("providers:getMobileGoalSummary", args: [.string(runID)])
        try Task.checkCancellation()
        guard owner == pairingOwner, current == generation, self.transport === transport,
              isConnected, viewingRunID == runID else { throw MainsError.changedBackend }
        if value == .null { return nil }
        let summary = try value.decode(MobileGoalSummary.self)
        guard !summary.objective.isEmpty, summary.objective.unicodeScalars.count <= 2048,
              !summary.status.isEmpty, summary.status.utf16.count <= 64,
              (summary.tokensUsed ?? 0) >= 0, (summary.timeUsedSeconds ?? 0) >= 0,
              summary.revision.map({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }) != false else { throw MainsError.invalidReply }
        return summary
    }

    public func canChangeGoal(_ runID: String) -> Bool {
        isConnected && supportsMobileGoalControls && pendingGoalChange == nil && viewingRunID == runID
            && conversations.contains { $0.id == runID && $0.providerId == "codex" && $0.accountId == accountID && $0.isReplica != true && !$0.isArchived }
    }

    public func changeGoal(_ runID: String, revision: String, change: MobileGoalChange) async throws {
        guard canChangeGoal(runID), revision.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
            throw MainsError.server("This goal cannot be changed right now.")
        }
        var payload: [String: JSONValue] = ["expectedRevision": .string(revision)]
        switch change {
        case .edit(let text):
            let objective = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !objective.isEmpty, objective.unicodeScalars.count <= 2048 else {
                throw MainsError.server("Enter a goal objective of up to 2,048 characters.")
            }
            payload["action"] = .string("edit"); payload["objective"] = .string(objective)
        case .pause: payload["action"] = .string("pause")
        case .resume: payload["action"] = .string("resume")
        case .clear: payload["action"] = .string("clear")
        }
        let attempt = GoalChangeAttempt(id: UUID().uuidString, runID: runID, owner: pairingOwner, args: [.string(runID), .object(payload)])
        try await deliverGoalChange(attempt)
    }

    public func checkGoalChange() async throws {
        guard isConnected, supportsMobileGoalControls, let attempt = pendingGoalChange, attempt.uncertain else { throw MainsError.disconnected }
        try await deliverGoalChange(attempt)
    }

    private func deliverGoalChange(_ original: GoalChangeAttempt) async throws {
        var attempt = original
        attempt.uncertain = false; pendingGoalChange = attempt
        defer { if attempt.owner == pairingOwner, attempt.runID == viewingRunID { goalSummaryRevision += 1 } }
        do {
            let result = try await command("providers:changeMobileGoal", args: attempt.args, commandID: attempt.id, owner: attempt.owner)
            guard attempt.owner == pairingOwner else { throw MainsError.changedBackend }
            guard result["applied"].bool else { throw MainsError.invalidReply }
            // Receipt replay confirms delivery, but a later desktop change may already supersede it.
            pendingGoalChange = nil
        } catch {
            if attempt.owner == pairingOwner {
                let failure = error as? MainsError
                if case .server = failure, failure?.isUnconfirmedCommand == false { pendingGoalChange = nil }
                else if failure == .unauthorized || failure == .incompatible { pendingGoalChange = nil }
                else { attempt.uncertain = true; pendingGoalChange = attempt }
            }
            throw error
        }
    }

    public func listOutputs(_ runID: String, offset: Int = 0, artifactID: Int? = nil) async throws -> RunOutputsPage {
        guard let transport, isConnected else { throw MainsError.disconnected }
        let current = generation
        var payload: [String: JSONValue] = ["runId": .string(runID), "offset": .number(Double(offset))]
        if let artifactID { payload["artifactId"] = .number(Double(artifactID)) }
        let value = try await transport.invoke("runs:listOutputs", args: [.object(payload)])
        let result = try await value.decodeOffMain(RunOutputsPage.self)
        guard current == generation else { throw MainsError.disconnected }
        return result
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

    public func availableOutputs(_ runID: String, offset: Int = 0) async throws -> RunOutputsPage {
        let owner = pairingOwner, current = generation
        return try await RunOutputsPage.firstAvailable(runID: runID, offset: offset) { cursor in
            guard owner == self.pairingOwner, current == self.generation else { throw MainsError.changedBackend }
            let page = try await self.listOutputs(runID, offset: cursor)
            guard owner == self.pairingOwner, current == self.generation else { throw MainsError.changedBackend }
            return page
        }
    }

    public func readOutput(_ output: RunOutput, offset: Int) async throws -> RunOutputChunk {
        guard let transport, isConnected else { throw MainsError.disconnected }
        let current = generation
        let value = try await transport.invoke("runs:readOutputFile", args: [.object(["runId": .string(output.runId), "artifactId": .number(Double(output.artifactId)), "version": .string(output.version), "offset": .number(Double(offset))])])
        let result = try await value.decodeOffMain(RunOutputChunk.self)
        guard current == generation else { throw MainsError.disconnected }
        return result
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
                let document = try await value.decodeOffMain(RunLinkedMarkdown.self)
                guard owner == pairingOwner, current == generation, self.transport === transport else { throw MainsError.changedBackend }
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
        let image = try await value.decodeOffMain(ArtifactImage.self)
        guard current == generation, self.transport === transport else { throw MainsError.changedBackend }
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
        let chunk = try await value.decodeOffMain(RunOutputChunk.self)
        guard self.transport === transport, isConnected else { throw MainsError.changedBackend }
        return chunk
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

    private func atlasRead<T: Decodable & Sendable>(_ channel: String, fields: [String: JSONValue], as type: T.Type) async throws -> T {
        guard active, isConnected, let accountID, let candidate = transport else { throw MainsError.disconnected }
        let owner = pairingOwner, current = generation
        var input = fields; input["accountId"] = .string(accountID)
        let result: JSONValue
        do { result = try await candidate.invoke(channel, args: [.object(input)]) }
        catch {
            try Task.checkCancellation()
            guard owner == pairingOwner, current == generation, self.transport === candidate else { throw MainsError.changedBackend }
            if case MainsError.server(let message) = error, message.contains("not available to paired devices") || message.contains("Unknown channel") || message.contains("No handler") {
                throw MainsError.server("Update Mains on your computer to use Atlas on iPhone.")
            }
            throw error
        }
        let decoded = try await result.decodeOffMain(type)
        guard owner == pairingOwner, current == generation, self.transport === candidate, active, isConnected else { throw MainsError.changedBackend }
        return decoded
    }

    public func atlasLibrary(_ query: AtlasQuery) async throws -> AtlasLibraryPage {
        if !isConnected { return try await savedAtlasLibrary(query) }
        let revision = atlasRevision
        let result = try await atlasRead("atlas:mobileLibrary", fields: query.payload, as: AtlasLibraryPage.self)
        guard result.items.count <= 50, (1...100_000).contains(result.page), Set(result.items.map(\.key)).count == result.items.count,
              result.items.allSatisfy({ validAtlasTags($0.tags ?? [], limit: 60)
                  && ($0.preview?.unicodeScalars.count ?? 0) <= 240
                  && ($0.fileName?.utf16.count ?? 0) <= 240 && ($0.mimeType?.utf8.count ?? 0) <= 256
                  && ($0.byteSize == nil || $0.byteSize! >= 0) }) else { throw MainsError.invalidReply }
        if atlasRevision == revision && query.page == 1 && query.type == "all" && query.collectionID == nil &&
            query.tagID == nil && query.text.isEmpty {
            if query.scope == "favorites" {
                saveOfflineValue(result.items, key: "atlas:favorites")
                offlineAtlasFavoritesRead = (generation, revision)
            }
            else if query.scope == "all" { saveOfflineValue(result.items, key: "atlas:library") }
        }
        return result
    }

    public func prepareOfflineAtlasFavorites() async {
        guard !isDemo, isConnected,
              offlineAtlasFavoritesRead?.generation != generation || offlineAtlasFavoritesRead?.revision != atlasRevision else { return }
        var query = AtlasQuery()
        query.scope = "favorites"
        _ = try? await atlasLibrary(query)
    }

    private func savedAtlasLibrary(_ query: AtlasQuery) async throws -> AtlasLibraryPage {
        let owner = pairingOwner
        let library = await offlineValues([AtlasEntry].self, key: "atlas:library").first
        let favorites = await offlineValues([AtlasEntry].self, key: "atlas:favorites").first
        let visibleFavorites = favorites == nil && library == nil
            ? await offlineValues([AtlasEntry].self, key: "atlas:visible-favorites").first : nil
        let recent = await offlineValues(AtlasPageContent.self, key: "atlas:recent:", prefix: true).map(\.organizationEntry)
        try Task.checkCancellation()
        guard owner == pairingOwner, !isConnected else { throw MainsError.changedBackend }
        guard library != nil || !(favorites ?? visibleFavorites ?? []).isEmpty || !recent.isEmpty else { throw MainsError.disconnected }
        let list = library ?? []
        let favoriteItems = favorites ?? visibleFavorites ?? list.filter(\.isFavorite)
        let sourceRows = query.scope == "favorites" ? favoriteItems : list + favoriteItems + recent
        var seen: Set<String> = []
        let source = sourceRows.filter { seen.insert($0.pageId ?? $0.key).inserted }
        let items = source.filter { item in
            (query.type == "all" || item.kind == query.type) &&
            (query.scope == "all" || query.scope == "favorites" && item.isFavorite || query.scope == "saved" && item.origin == "saved" ||
             query.scope == "generated" && item.origin == "generated") &&
            (query.collectionID == nil || item.collectionId == query.collectionID) &&
            (query.tagID == nil || item.tags?.contains { $0.id == query.tagID } == true) &&
            (query.text.isEmpty || item.title.localizedCaseInsensitiveContains(query.text) ||
             item.tags?.contains { $0.name.localizedCaseInsensitiveContains(query.text) } == true)
        }
        let offset = min(max(query.page, 1), 100_000)
        return AtlasLibraryPage(items: Array(items.dropFirst((offset - 1) * 50).prefix(50)),
                                page: offset, hasNext: offset * 50 < items.count)
    }

    public var canSaveToAtlas: Bool { active && isConnected && pendingAtlasSave == nil }

    private func mateRead<T: Decodable & Sendable>(_ channel: String, args: [JSONValue], as type: T.Type) async throws -> T {
        guard isConnected, let transport, let accountID else { throw MainsError.disconnected }
        guard supportsMates else { throw MainsError.server("Update Mains on your computer to use Mates on iPhone.") }
        let owner = pairingOwner, current = generation
        let value = try await transport.invoke(channel, args: [.string(accountID)] + args).decodeOffMain(type)
        guard owner == pairingOwner, current == generation, self.transport === transport, isConnected else { throw MainsError.changedBackend }
        return value
    }

    public func loadMates(mateID: String? = nil, archived: Bool = false) async throws -> MateDirectory {
        let revision = matesRevision
        let args: [JSONValue] = archived ? [mateID.map(JSONValue.string) ?? .null, .bool(true)] : mateID.map { [.string($0)] } ?? []
        let directory = try await mateRead("assistants:mobileDirectory", args: args, as: MateDirectory.self)
        guard directory.mates.count <= 200, directory.teams.count <= 100 else { throw MainsError.invalidReply }
        if revision == matesRevision {
            if let mateID {
                if let mate = directory.mates.first(where: { $0.id == mateID }) {
                    saveOfflineValue(mate.offlineSummary, key: "mates:profile:\(mateID):summary")
                } else {
                    removeOfflineValues("mates:profile:\(mateID):")
                }
            } else {
                saveOfflineValue(directory.offlineSummary, key: archived ? "mates:archived" : "mates:directory")
            }
        }
        return directory
    }

    public func loadMateChats(_ mateID: String) async throws -> [MateChat] {
        let revision = matesRevision
        let chats = try await mateRead("assistants:conversations", args: [.string(mateID)], as: [MateChat].self)
        guard chats.count <= 100 else { throw MainsError.invalidReply }
        if revision == matesRevision { saveOfflineValue(chats, key: "mates:chats:\(mateID):list") }
        return chats
    }

    public func loadMateSkills(_ mateID: String, query: String = "", offset: Int = 0) async throws -> MateSkillPage {
        guard supportsMateRuntimeSettings, query.utf16.count <= 100, offset >= 0, offset <= Int.max - 50 else { throw MainsError.invalidReply }
        let page = try await mateRead("assistants:mobileSkills", args: [.string(mateID), .string(query), .number(Double(offset))], as: MateSkillPage.self)
        guard page.items.count <= 50, page.items.allSatisfy(\.isValid), Set(page.items.map(\.id)).count == page.items.count,
              page.unavailableIds.count <= 20, page.pluginSkillIds.count <= 20,
              page.nextOffset == nil || (page.items.count == 50 && page.nextOffset == offset + 50) else { throw MainsError.invalidReply }
        return page
    }

    public func generateMateSkill(_ mate: Mate, request: String) async throws -> MateSkillDraft {
        guard let accountID, let backendID = pairing?.descriptor.backendId, supportsMateRuntimeSettings, mate.ready else { throw MainsError.disconnected }
        guard hasConsent(providerID: mate.providerId) else {
            throw MateConsentRequired(owner: pairingOwner, backendID: backendID, providerID: mate.providerId)
        }
        let result = try await writeMate("assistants:mobileGenerateSkill", args: [.string(accountID), .string(mate.id), .string(request)])
        return try result.decode(MateSkillDraft.self)
    }

    public func saveMateSkill(_ mateID: String, draft: MateSkillDraft) async throws -> MateSkill {
        guard let accountID, supportsMateRuntimeSettings, draft.isValid else { throw MainsError.invalidReply }
        let result = try await writeMate("assistants:mobileSaveSkill", args: [.string(accountID), .string(mateID), try .encode(draft)])
        return try decodedMateSkill(result)
    }

    public func checkMateSkillGeneration(_ mateID: String) async throws -> MateSkillDraft {
        try await checkMateSkillCommand(mateID, channel: "assistants:mobileGenerateSkill").decode(MateSkillDraft.self)
    }

    public func checkMateSkillSave(_ mateID: String) async throws -> MateSkill {
        try await decodedMateSkill(checkMateSkillCommand(mateID, channel: "assistants:mobileSaveSkill"))
    }

    private func decodedMateSkill(_ result: JSONValue) throws -> MateSkill {
        let skill = try result.decode(MateSkill.self)
        guard skill.isValid else { throw MainsError.invalidReply }
        return skill
    }

    private func checkMateSkillCommand(_ mateID: String, channel: String) async throws -> JSONValue {
        guard let attempt = pendingMateCommand, attempt.uncertain, attempt.channel == channel,
              attempt.args.dropFirst().first?.string == mateID, isConnected else { throw MainsError.disconnected }
        return try await deliverMate(attempt)
    }

    public func savedMates(archived: Bool = false) async -> MateDirectory? {
        await offlineValues(MateDirectory.self, key: archived ? "mates:archived" : "mates:directory").first
    }

    public func savedMate(_ id: String) async -> Mate? {
        let owner = pairingOwner
        if let directory = await savedMates(), let mate = directory.mates.first(where: { $0.id == id }) { return mate }
        guard owner == pairingOwner, !Task.isCancelled else { return nil }
        if let directory = await savedMates(archived: true), let mate = directory.mates.first(where: { $0.id == id }) { return mate }
        guard owner == pairingOwner, !Task.isCancelled else { return nil }
        return await offlineValues(Mate.self, key: "mates:profile:\(id):summary").first.flatMap { $0.id == id ? $0 : nil }
    }

    public func savedMateChats(_ mateID: String) async -> [MateChat]? {
        let owner = pairingOwner
        if let saved = await offlineValues([MateChat].self, key: "mates:chats:\(mateID):list").first { return saved }
        guard !isDemo, pairing != nil, owner == pairingOwner, !Task.isCancelled else { return nil }
        let recent = conversations.filter { $0.assistantId == mateID && !$0.isArchived }
        return recent.isEmpty ? nil : recent.map { MateChat(id: $0.id, title: $0.title, updatedAt: $0.updatedAt) }
    }

    public func loadMateAssignment(_ id: String, runID: String) async throws -> MateAssignment {
        let assignment = try await mateRead("assistants:mobileAssignment", args: [.string(runID), .string(id)], as: MateAssignment.self)
        guard assignment.id == id, viewingRunID == runID else { throw MainsError.changedBackend }
        return assignment
    }

    private func mateInfoRead<T: Decodable & Sendable>(_ channel: String, mateID: String, selection: JSONValue? = nil, as type: T.Type) async throws -> T {
        let supported = channel == "assistants:mobileAssignments" ? supportsMateAssignments : supportsMateInfo
        guard supported else { throw MainsError.server("Update Mains on your computer to use this Mate tab.") }
        let args = [.string(mateID)] + (selection.map { [$0] } ?? [])
        return try await mateRead(channel, args: args, as: type)
    }

    public func loadMateMemory(_ mateID: String) async throws -> [MateMemoryNote] {
        let notes = try await mateInfoRead("assistants:mobileMemory", mateID: mateID, as: [MateMemoryNote].self)
        guard notes.count <= 200 else { throw MainsError.invalidReply }
        return notes
    }

    public func readMateMemory(_ id: String, mateID: String) async throws -> MateMemoryNote {
        let note = try await mateInfoRead("assistants:mobileMemory", mateID: mateID, selection: .string(id), as: MateMemoryNote.self)
        guard note.id == id, note.revision > 0, note.content.utf16.count <= 6000 else { throw MainsError.invalidReply }
        return note
    }

    public func loadMateTasks(_ mateID: String, offset: Int) async throws -> MateTasks {
        let tasks = try await mateInfoRead("assistants:mobileAssignments", mateID: mateID, selection: .number(Double(offset)), as: MateTasks.self)
        guard tasks.items.count <= 100, tasks.activeCount >= 0 else { throw MainsError.invalidReply }
        // Older hosts return team-wide pages. Keep their page boundaries and count this Mate's open tasks on page one.
        let ownTasks = tasks.items.filter { $0.assignee?.id == mateID }
        return MateTasks(items: ownTasks, activeCount: ownTasks.filter(\.isOpen).count, hasMore: tasks.hasMore)
    }

    public func readMateTask(_ id: String, mateID: String) async throws -> MateTask {
        let task = try await mateInfoRead("assistants:mobileAssignments", mateID: mateID, selection: .string(id), as: MateTask.self)
        guard task.id == id, task.brief.utf16.count <= 24_000, (task.result?.utf16.count ?? 0) <= 12_000,
              task.evidence.count <= 20 else { throw MainsError.invalidReply }
        return task
    }

    func readConversationMateTask(_ link: MateAssignmentLink) async throws -> (task: MateTask, managingMateID: String?) {
        let owner = pairingOwner, current = generation
        guard viewingRunID == link.runID else { throw MainsError.changedBackend }
        let summary = try await loadMateAssignment(link.id, runID: link.runID)
        guard supportsMateInfo, let assignee = summary.assignee else { return (MateTask(summary: summary), nil) }
        let task: MateTask
        do {
            task = try await readMateTask(link.id, mateID: assignee.id)
        } catch MainsError.server("Assignment is unavailable for this Mate") {
            // Historical requests remain linked to the source chat after a team move.
            guard owner == pairingOwner, current == generation, viewingRunID == link.runID else { throw MainsError.changedBackend }
            return (MateTask(summary: summary), nil)
        }
        guard task.assignee?.id == assignee.id, viewingRunID == link.runID else { throw MainsError.changedBackend }
        let mate = if task.hasManagementActions, task.assignee?.isArchived == false {
            try await loadMates(mateID: assignee.id).mates.first { $0.id == assignee.id }
        } else { nil as Mate? }
        guard owner == pairingOwner, current == generation, viewingRunID == link.runID else { throw MainsError.changedBackend }
        return (task, mate?.ready == true ? assignee.id : nil)
    }

    public func loadMateRoutines(_ mateID: String, offset: Int) async throws -> MateRoutines {
        let routines = try await mateInfoRead("assistants:mobileRoutines", mateID: mateID, selection: .number(Double(offset)), as: MateRoutines.self)
        guard routines.items.count <= 100, routines.nextOffset == nil || routines.nextOffset == offset + 100 else { throw MainsError.invalidReply }
        return routines
    }

    public func readMateRoutine(_ id: String, mateID: String) async throws -> MateRoutine {
        let routine = try await mateInfoRead("assistants:mobileRoutines", mateID: mateID, selection: .string(id), as: MateRoutine.self)
        guard routine.id == id, routine.schedule.prompt.utf16.count <= 24_000 else { throw MainsError.invalidReply }
        return routine
    }

    func supportsMateChange(_ change: MateChange) -> Bool {
        switch change {
        case .assign, .cancelTask: supportsMateAssignments
        default: supportsMateInfo
        }
    }

    public func manageMate(_ id: String, change: MateChange) async throws {
        guard let accountID, let backendID = pairing?.descriptor.backendId, isConnected, supportsMateChange(change) else { throw MainsError.disconnected }
        let owner = pairingOwner, current = generation
        let recipientMateID: String?
        switch change {
        case .updateProfile(_, _, _, _, .some, _, _) where !supportsMateModelEditing:
            throw MainsError.server("Update Mains on your computer to change the model and effort.")
        case let .updateProfile(_, _, _, _, _, skills, permissions) where (skills != nil || permissions != nil) && !supportsMateRuntimeSettings:
            throw MainsError.server("Update Mains on your computer to change skills and permissions.")
        case .setPinned where !supportsMatePinning:
            throw MainsError.server("Update Mains on your computer to pin Mates.")
        case .assign, .runRoutine:
            // Both commands target the Mate whose identity the backend validates.
            recipientMateID = id
        case .followup(let taskID, _):
            let task = try await readMateTask(taskID, mateID: id)
            guard let assignee = task.assignee, !assignee.id.isEmpty else {
                throw MainsError.server("The Mate assigned to this task is unavailable.")
            }
            recipientMateID = assignee.id
        default:
            recipientMateID = nil
        }
        if let recipientMateID {
            guard owner == pairingOwner, current == generation else { throw MainsError.changedBackend }
            let directory = try await loadMates(mateID: recipientMateID)
            guard owner == pairingOwner, current == generation else { throw MainsError.changedBackend }
            guard let recipient = directory.mates.first(where: { $0.id == recipientMateID }), !recipient.providerId.isEmpty else {
                throw MainsError.server("The Mate assigned to this task is unavailable.")
            }
            guard hasConsent(providerID: recipient.providerId) else {
                throw MateConsentRequired(owner: owner, backendID: backendID, providerID: recipient.providerId)
            }
        }
        try Task.checkCancellation()
        _ = try await writeMate("assistants:mobileManage", args: [.string(accountID), .string(id), try change.payload(), .string(UUID().uuidString)])
    }

    public func createMate(name: String, space: Space, model: String, effort: String, teamID: String?, avatar: MateAvatar) async throws -> String {
        guard let accountID else { throw MainsError.disconnected }
        let payload: JSONValue = .object([
            "accountId": .string(accountID), "name": .string(name), "spaceId": .string(space.id), "model": .string(model),
            "effort": .string(effort), "teamId": teamID.map(JSONValue.string) ?? .null,
            "avatar": try .encode(avatar), "profileSetup": .bool(true),
        ])
        let result = try await writeMate("assistants:create", args: [payload])
        guard let id = result["id"].string, !id.isEmpty else { throw MainsError.invalidReply }
        return id
    }

    func createMateTeam(name: String) async throws -> MateTeam {
        guard let accountID, isConnected, supportsMateTeamCreation else { throw MainsError.disconnected }
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.utf16.count <= 100 else { throw MainsError.server("Enter a team name of up to 100 characters.") }
        let result = try await writeMate("assistants:createTeam", args: [.object(["accountId": .string(accountID), "name": .string(name)])])
        return try result.decode(MateTeam.self)
    }

    func checkMateTeamCreation() async throws -> MateTeam {
        guard let attempt = pendingMateCommand, attempt.channel == "assistants:createTeam",
              attempt.uncertain, isConnected else { throw MainsError.disconnected }
        return try await deliverMate(attempt).decode(MateTeam.self)
    }

    public func answerMateSetup(_ id: String, step: Int, answer: String) async throws {
        try await mateSetup(id, action: .object(["action": .string("answer"), "step": .number(Double(step)), "answer": .string(answer)]))
    }

    public func saveMateSetup(_ id: String, profile: MateProfile) async throws {
        try await mateSetup(id, action: .object(["action": .string("save"), "profile": try .encode(profile)]))
    }

    private func mateSetup(_ id: String, action: JSONValue) async throws {
        guard let accountID else { throw MainsError.disconnected }
        _ = try await writeMate("assistants:setupProfile", args: [.string(accountID), .string(id), action])
    }

    public func retryMateWelcome(_ id: String) async throws {
        guard let accountID else { throw MainsError.disconnected }
        _ = try await writeMate("assistants:prepareWelcome", args: [.string(accountID), .string(id)])
    }

    public func skipMateWelcome(_ id: String) async throws {
        guard let accountID else { throw MainsError.disconnected }
        _ = try await writeMate("assistants:respondWelcome", args: [.string(accountID), .string(id), .null])
    }

    @discardableResult public func checkMateCommand() async throws -> String? {
        guard let attempt = pendingMateCommand, attempt.uncertain, isConnected else { throw MainsError.disconnected }
        let result = try await deliverMate(attempt)
        return attempt.channel == "assistants:create" ? result["id"].string : nil
    }

    private func writeMate(_ channel: String, args: [JSONValue]) async throws -> JSONValue {
        guard isConnected, supportsMates else { throw MainsError.disconnected }
        guard pendingMateCommand == nil else { throw MainsError.server("Check the pending Mate change before trying again.") }
        return try await deliverMate(PendingMateCommand(channel: channel, args: args, owner: pairingOwner))
    }

    private func deliverMate(_ attempt: PendingMateCommand) async throws -> JSONValue {
        var pending = attempt
        pending.uncertain = false
        pendingMateCommand = pending
        do {
            let timeout = attempt.channel == "assistants:mobileGenerateSkill" ? 100 : 30
            let result = try await command(attempt.channel, args: attempt.args, commandID: attempt.id, owner: attempt.owner, attemptTimeout: timeout)
            guard attempt.owner == pairingOwner else { throw MainsError.changedBackend }
            if attempt.channel == "assistants:create", result["id"].string?.isEmpty != false { throw MainsError.invalidReply }
            if attempt.channel == "assistants:createTeam" {
                let team = try result.decode(MateTeam.self)
                guard !team.id.isEmpty, team.id.utf16.count <= 200, !team.name.isEmpty, team.name.utf16.count <= 100 else {
                    throw MainsError.invalidReply
                }
            }
            if attempt.channel == "assistants:mobileManage", !result["accepted"].bool { throw MainsError.invalidReply }
            pendingMateCommand = nil
            if attempt.channel != "assistants:mobileGenerateSkill" { matesRevision += 1 }
            return result
        } catch {
            if attempt.owner == pairingOwner {
                let failure = error as? MainsError
                let refused: Bool
                if case .server = failure { refused = failure?.isUnconfirmedCommand == false }
                else { refused = failure == .unauthorized || failure == .incompatible }
                pending.uncertain = !refused
                pendingMateCommand = refused ? nil : pending
            }
            throw error
        }
    }

    private func validAtlasTags(_ tags: [AtlasTag], limit: Int) -> Bool {
        tags.count <= limit && Set(tags.map(\.id)).count == tags.count && tags.allSatisfy {
            !$0.id.isEmpty && $0.id.utf8.count <= 256 && !$0.name.isEmpty && $0.name.utf16.count <= 256
        }
    }

    public func atlasTags(query: String = "", page: Int = 1) async throws -> AtlasTagPage {
        guard (1...100_000).contains(page), query.utf16.count <= 64 else { throw MainsError.invalidReply }
        let result = try await atlasRead("atlas:mobileTags", fields: ["query": .string(query), "page": .number(Double(page))], as: AtlasTagPage.self)
        guard result.page == page, validAtlasTags(result.items, limit: 50) else { throw MainsError.invalidReply }
        return result
    }

    public func readAtlasTags(_ id: String) async throws -> AtlasItemTags {
        let result = try await atlasRead("atlas:readMobileTags", fields: ["id": .string(id)], as: AtlasItemTags.self)
        guard result.id == id, result.requestedId == id, result.title.utf8.count <= 4096,
              ["page", "file", "image", "bookmark"].contains(result.kind), validAtlasTags(result.tags, limit: 60),
              result.revision.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw MainsError.invalidReply }
        return result
    }

    public func setAtlasTags(_ original: AtlasItemTags, tags: [AtlasTag], owner: Int) async throws -> AtlasSavedItem {
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        guard validAtlasTags(tags, limit: 30), tags.allSatisfy({ $0.id.utf16.count <= 64 }) else { throw MainsError.server("Use up to 30 tags, each 64 characters or fewer.") }
        return try await beginAtlasSave("atlas:setMobileTags", fields: ["id": .string(original.id), "expectedRevision": .string(original.revision),
            "tags": .array(tags.map { .string($0.id) })], label: original.title)
    }

    public func atlasTrash(page: Int = 1) async throws -> AtlasTrashPage {
        guard (1...100_000).contains(page) else { throw MainsError.invalidReply }
        let result = try await atlasRead("atlas:mobileTrash", fields: ["page": .number(Double(page))], as: AtlasTrashPage.self)
        guard result.page == page, result.items.count <= 50, Set(result.items.map(\.id)).count == result.items.count,
              result.items.allSatisfy({ !$0.id.isEmpty && $0.id.utf8.count <= 256 && $0.title.utf8.count <= 4096 && ["page", "file", "image", "bookmark"].contains($0.kind) && $0.trashedAt.utf8.count <= 64 }) else { throw MainsError.invalidReply }
        return result
    }

    public func trashAtlasItem(_ entry: AtlasEntry, owner: Int) async throws -> AtlasSavedItem {
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        var fields: [String: JSONValue] = ["trashed": .bool(true)]
        if let id = entry.savedIdentity {
            fields["id"] = .string(id)
        } else if let runID = entry.file?.runId, let sourceKey = entry.file?.sourceKey {
            fields["id"] = .string(sourceKey)
            fields["runId"] = .string(runID)
        } else { throw MainsError.server("Atlas item not found.") }
        return try await beginAtlasSave("atlas:setMobileTrash", fields: fields, label: entry.title)
    }

    public func restoreAtlasItem(_ item: AtlasTrashItem, owner: Int) async throws -> AtlasSavedItem {
        try await restoreAtlasItem(id: item.id, title: item.title, owner: owner)
    }

    public func restoreAtlasItem(id: String, title: String, owner: Int) async throws -> AtlasSavedItem {
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        return try await beginAtlasSave("atlas:setMobileTrash", fields: ["id": .string(id), "trashed": .bool(false)], label: title)
    }

    public func deleteAtlasTrashItem(_ item: AtlasTrashItem, owner: Int) async throws -> AtlasSavedItem {
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        return try await beginAtlasSave("atlas:deleteMobileTrash", fields: ["id": .string(item.id), "expectedTrashedAt": .string(item.trashedAt)], label: item.title)
    }

    public func readAtlasBookmark(_ id: String) async throws -> AtlasBookmarkDocument {
        let item = try await atlasRead("atlas:readMobileBookmark", fields: ["id": .string(id)], as: AtlasBookmarkDocument.self)
        guard item.requestedId == id, !item.id.isEmpty, item.id.utf8.count <= 256, item.kind == "bookmark",
              item.title.utf16.count <= 240, item.url.utf16.count <= 4096, item.description.utf16.count <= 2000, item.note.utf16.count <= 10000,
              item.collectionId.map({ !$0.isEmpty && $0.utf8.count <= 256 }) ?? true,
              item.tags.map({ validAtlasTags($0, limit: 60) }) ?? true,
              item.revision.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw MainsError.invalidReply }
        return item
    }

    public func editAtlasBookmark(_ original: AtlasBookmarkDocument, draft: AtlasBookmarkDraft, owner: Int) async throws -> AtlasSavedItem {
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        if let error = draft.validationError { throw MainsError.server(error) }
        var fields = draft.changes(from: original)
        guard !fields.isEmpty else { throw MainsError.server("Make a change before saving.") }
        fields["id"] = .string(original.id); fields["expectedRevision"] = .string(original.revision)
        return try await beginAtlasSave("atlas:editMobileBookmark", fields: fields, label: original.title)
    }

    public func setAtlasFavorite(_ entry: AtlasEntry, to value: Bool, owner: Int) async throws -> AtlasSavedItem {
        try await updateAtlasItem(entry, patch: ["isFavorite": .bool(value)], owner: owner)
    }

    public func moveAtlasItem(_ entry: AtlasEntry, to collectionID: String?, owner: Int) async throws -> AtlasSavedItem {
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        if let collectionID, !collections.contains(where: { $0.id == collectionID }) { throw MainsError.server("This project is no longer available.") }
        return try await updateAtlasItem(entry, patch: ["collectionId": collectionID.map(JSONValue.string) ?? .null], owner: owner)
    }

    private func updateAtlasItem(_ entry: AtlasEntry, patch: [String: JSONValue], owner: Int) async throws -> AtlasSavedItem {
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        guard let id = entry.savedIdentity else { throw MainsError.server("Save this item to Atlas before organizing it.") }
        var fields = patch; fields["id"] = .string(id)
        return try await beginAtlasSave("atlas:updateMobileItem", fields: fields, label: entry.title)
    }

    public func saveAtlasFile(_ source: AtlasSaveSource, owner: Int) async throws -> AtlasSavedItem {
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        if conversations.first(where: { $0.id == source.runId })?.isReplica == true { throw MainsError.server("Save this file to Atlas from its source computer.") }
        return try await beginAtlasSave("atlas:saveMobileFile", fields: try JSONValue.encode(source).objectValue, label: "the file")
    }

    public func atlasSaveStatus(_ source: AtlasSaveSource, owner: Int) async throws -> Bool? {
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        do {
            let value = try await atlasRead("atlas:readMobileSaveStatus", fields: try JSONValue.encode(source).objectValue, as: JSONValue.self)
            guard case .bool(let saved) = value["saved"] else { throw MainsError.invalidReply }
            return saved
        } catch MainsError.server(let message) where message.contains("Update Mains on your computer") {
            return nil // Older computers can still accept the existing explicit save command.
        }
    }

    public func saveAtlasBookmark(_ url: String, collectionID: String?, owner: Int) async throws -> AtlasSavedItem {
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        guard let url = AtlasBookmarkURL.validate(url) else { throw MainsError.server("Enter a complete http:// or https:// link.") }
        var fields: [String: JSONValue] = ["url": .string(url)]
        if let collectionID {
            guard collections.contains(where: { $0.id == collectionID }) else { throw MainsError.server("This project is no longer available.") }
            fields["collectionId"] = .string(collectionID)
        }
        return try await beginAtlasSave("atlas:saveMobileBookmark", fields: fields, label: URL(string: url)?.host ?? "Bookmark")
    }

    private func beginAtlasSave(_ channel: String, fields: [String: JSONValue], label: String) async throws -> AtlasSavedItem {
        guard canSaveToAtlas, let accountID else { throw MainsError.server("Connect to your computer and resolve any pending Atlas save first.") }
        var fields = fields; fields["accountId"] = .string(accountID)
        return try await deliverAtlasSave(PendingAtlasSave(status: .sending, label: label, commandID: UUID().uuidString,
            channel: channel, payload: .object(fields), owner: pairingOwner, createdAt: .now))
    }

    public func checkAtlasSaveDelivery() async throws -> AtlasSavedItem {
        guard let pending = pendingAtlasSave, pending.status == .uncertain, active, isConnected else { throw MainsError.disconnected }
        guard Date().timeIntervalSince(pending.createdAt) < 7 * 86_400 else { throw MainsError.server("This save is too old to check. Look for the item in Atlas on your computer.") }
        return try await deliverAtlasSave(pending)
    }

    private func deliverAtlasSave(_ input: PendingAtlasSave) async throws -> AtlasSavedItem {
        var attempt = input; attempt.status = .sending; pendingAtlasSave = attempt
        do {
            let value = try await command(attempt.channel, args: [attempt.payload], commandID: attempt.commandID, owner: attempt.owner)
            guard attempt.owner == pairingOwner, pendingAtlasSave?.id == attempt.id else { throw MainsError.changedBackend }
            let item = try value.decode(AtlasSavedItem.self)
            let validKind = attempt.isUpdate ? ["page", "file", "image", "bookmark"].contains(item.kind)
                : attempt.channel == "atlas:saveMobileBookmark" ? item.kind == "bookmark" : ["file", "image"].contains(item.kind)
            guard !item.id.isEmpty, item.id.utf8.count <= 256,
                  validKind,
                  item.title.utf8.count <= 4096 else { throw MainsError.invalidReply }
            if attempt.isBookmarkEdit || attempt.isTagsChange {
                guard (!attempt.isBookmarkEdit || item.kind == "bookmark"), value["requestedId"] == attempt.payload["id"],
                      value["revision"].string?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw MainsError.invalidReply }
            } else if attempt.isTrashChange {
                guard value["requestedId"] == attempt.payload["id"], value["trashed"] == attempt.payload["trashed"] else { throw MainsError.invalidReply }
            } else if attempt.isTrashDeletion {
                guard value["requestedId"] == attempt.payload["id"], value["id"] == attempt.payload["id"] else { throw MainsError.invalidReply }
            } else if attempt.isUpdate {
                guard value["requestedId"] == attempt.payload["id"],
                      attempt.payload.objectValue["isFavorite"].map({ value["isFavorite"] == $0 }) ?? true,
                      attempt.payload.objectValue["collectionId"].map({ value.objectValue["collectionId"] == $0 }) ?? true else { throw MainsError.invalidReply }
            }
            pendingAtlasSave = nil
            if let id = attempt.payload["id"].string, attempt.isTrashDeletion || attempt.isTrashChange && attempt.payload["trashed"].bool == true {
                removeSavedAtlasPage(id)
            }
            if attempt.isTrashChange || attempt.isTrashDeletion || attempt.payload.objectValue["isFavorite"] != nil {
                removeSavedAtlasFavorites()
            }
            atlasChanged()
            return item
        } catch {
            if attempt.owner == pairingOwner, pendingAtlasSave?.id == attempt.id {
                let failure = error as? MainsError
                let refused: Bool
                if case .server = failure { refused = failure?.isUnconfirmedCommand == false }
                else { refused = failure == .unauthorized || failure == .incompatible }
                if refused { pendingAtlasSave = nil }
                else { attempt.status = .uncertain; pendingAtlasSave = attempt }
                if refused, case .server(let message) = failure,
                   message.contains("not available to paired devices") || message.contains("No handler") || message.contains("Unknown channel") {
                    if attempt.isTrashDeletion { throw MainsError.server("Update Mains on your computer to permanently delete Atlas items.") }
                    throw MainsError.server(attempt.isUpdate ? "Update Mains on your computer to organize Atlas items." : "Update Mains on your computer to save items to Atlas.")
                }
            }
            throw error
        }
    }

    public func atlasPage(_ id: String, offset: Int = 0, version: Int? = nil) async throws -> AtlasPageContent {
        let cacheKey = offset == 0 ? "atlas:recent:\(id):page" : "atlas:page:\(id):\(offset)"
        if !isConnected {
            guard let copy = await offlineValues(AtlasPageContent.self, key: cacheKey).first,
                  copy.id == id, copy.offset == offset, version == nil || version == copy.version else {
                throw MainsError.server("This part isn’t saved on this iPhone. Connect to your computer to read it.")
            }
            return copy
        }
        let revision = atlasRevision
        var fields: [String: JSONValue] = ["id": .string(id), "offset": .number(Double(offset))]
        if let version { fields["version"] = .number(Double(version)) }
        let page: AtlasPageContent
        do { page = try await atlasRead("atlas:readMobilePage", fields: fields, as: AtlasPageContent.self) }
        catch {
            if case MainsError.server(let message) = error, ["Atlas page not found", "Atlas page not found or in Trash"].contains(message) {
                removeSavedAtlasPage(id)
            }
            throw error
        }
        let length = page.markdown.unicodeScalars.count
        guard page.id == id, page.offset == offset, page.version > 0, version == nil || version == page.version,
              length <= 16_384, page.nextOffset == nil || page.nextOffset == offset + length && length > 0 else { throw MainsError.invalidReply }
        if atlasRevision == revision {
            saveOfflineValue(page, key: cacheKey)
        }
        return page
    }

    public func exportAtlasPageMarkdown(_ page: AtlasPageContent, owner: Int, to url: URL) async throws {
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        let current = generation
        try await AtlasPageMarkdownExport.save(id: page.id, version: page.version, to: url, validate: {
            guard owner == self.pairingOwner, current == self.generation, self.active, self.isConnected else { throw MainsError.changedBackend }
        }, read: { offset in
            try await self.atlasPage(page.id, offset: offset, version: page.version)
        })
    }

    public func describeAtlasFile(_ reference: AtlasFileReference) async throws -> AtlasFile {
        let file = try await atlasRead("atlas:describeMobileFile", fields: ["reference": try .encode(reference)], as: AtlasFile.self)
        guard file.reference == reference, (0...RunFilePolicy.maxBytes).contains(file.byteSize), !file.version.isEmpty else { throw MainsError.invalidReply }
        return file
    }

    public func readAtlasPageCover(_ pageID: String, coverFileID: String) async throws -> AtlasPageCoverImage {
        let image = try await atlasRead("atlas:readMobilePageCover", fields: ["id": .string(pageID), "coverFileId": .string(coverFileID)], as: AtlasPageCoverImage.self)
        guard image.pageId == pageID, image.coverFileId == coverFileID, image.data != nil else { throw MainsError.invalidReply }
        return image
    }

    public func readAtlasPageImage(_ pageID: String, fileID: String, version: Int) async throws -> AtlasPageEmbeddedImage {
        let image = try await atlasRead("atlas:readMobilePageImage", fields: ["id": .string(pageID), "fileId": .string(fileID), "version": .number(Double(version))], as: AtlasPageEmbeddedImage.self)
        guard image.pageId == pageID, image.fileId == fileID, image.pageVersion == version, image.data != nil else { throw MainsError.invalidReply }
        return image
    }

    public func readAtlasImage(_ reference: AtlasFileReference) async throws -> AtlasImage {
        let image = try await atlasRead("atlas:readMobileImage", fields: ["reference": try .encode(reference)], as: AtlasImage.self)
        guard image.reference == reference, image.data != nil else { throw MainsError.invalidReply }
        return image
    }

    public func downloadAtlasFile(_ file: AtlasFile, owner: Int, to url: URL, progress: (Double) -> Void = { _ in }) async throws {
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        let current = generation
        try await RunFileTransfer.save(to: url) { write in
            try await RunFileTransfer.receive(byteSize: file.byteSize, version: file.version, validate: {
                guard owner == self.pairingOwner, current == self.generation, self.active, self.isConnected else { throw MainsError.changedBackend }
            }, read: { offset in
                try await self.atlasRead("atlas:readMobileFile", fields: ["reference": try .encode(file.reference), "version": .string(file.version), "offset": .number(Double(offset))], as: RunOutputChunk.self)
            }, write: write, progress: progress)
        }
    }

    public func loadModels(_ providerID: String, force: Bool = false) async {
        let cacheKey = "models:\(providerID)"
        if !isConnected {
            if models[providerID] == nil, let saved = await offlineValues([ModelChoice].self, key: cacheKey).first,
               models[providerID] == nil { models[providerID] = saved }
            return
        }
        guard let transport, isConnected, !loadingModels.contains(providerID), force || models[providerID] == nil else { return }
        let current = generation
        loadingModels.insert(providerID); modelErrors[providerID] = nil
        defer { if current == generation { loadingModels.remove(providerID) } }
        do {
            let value = try await transport.invoke("providers:getModels", args: [.string(providerID)])
            let choices = try await Wire.decodeOffMain {
                try Self.list(value, key: "models", as: ModelChoice.self)
            }
            guard current == generation, self.transport === transport else { return }
            models[providerID] = choices
            saveOfflineValue(choices, key: cacheKey)
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

    public func restore() async {
        guard !restored else { return }
        restored = true
        do {
            pairing = try storage.loadPairing()
            if pairing == nil, storage.demoEnabled { try startDemo(); return }
            if let pairing {
                storage.setDemoEnabled(false)
                let owner = pairingOwner
                restoringSnapshotOwner = owner
                defer { restoringSnapshotOwner = nil }
                restart()
                let cached = await storage.loadSnapshot(backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId)
                guard owner == pairingOwner else { return }
                if let cached, cached.backendID == pairing.descriptor.backendId {
                    let safeRuns = await Task.detached(priority: .userInitiated) {
                        cached.conversations.map(Self.safeConversation)
                    }.value
                    guard owner == pairingOwner else { return }
                    conversations = safeRuns; spaces = cached.spaces; workspaces = cached.workspaces
                    collections = cached.collections ?? []; projects = cached.projects ?? []; gitStates = cached.gitStates ?? []
                    selectedSpaceID = cached.selectedSpaceID
                    homeTargets = cached.homeTargets ?? [:]; composerSettings = cached.composerSettings ?? [:]
                    lastSyncedAt = cached.lastSyncedAt
                }
            }
            restart()
        } catch { actionError = "Could not read the saved pairing: \(error.localizedDescription)" }
    }

    public func setActive(_ value: Bool) {
        guard active != value else { return }; active = value
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        if voice.keepsConnectionAlive {
            if !value {
                stopWorkInboxWatch()
                runQueues.pauseAll("Queued messages are paused while Mains is in the background.")
            } else if workInboxVisible { startWorkInboxWatch() }
            return
        }
#endif

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
        pendingConversationAction = nil; retiredConversation = nil; conversationActionRevision = 0
        pendingWorkspaceAction = nil; retiredWorkspace = nil; workspaceActionRevision = 0
        pendingPlanDecision = nil; confirmedPlanDecision = nil
        pendingGoalChange = nil
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        voice.retire(); pendingVoiceConversation = nil; checkingVoiceConversation = false; voiceSpaceID = nil; voiceMate = nil
        realtimeVoices = nil; selectedRealtimeVoice = nil; voiceSettingsReadID = nil; voiceSelectionChange = nil
        loadingVoiceSettings = false; savingVoiceSettings = false; voiceSettingsError = nil; uncertainVoiceSelection = false
#endif

        stopRemoteQueueWatch()
        stopWorkInboxWatch()
        workInbox = WorkInboxSnapshot()
        runQueues.clear()
        initialHistoryCursor = nil
        activeEndpoint = nil; connectedDescriptor = nil; lastSyncedAt = nil
        consentRevision += 1
        conversations = []; spaces = []; workspaces = []; histories = [:]; historyOrder = []; offlineAtlasFavoritesRead = nil
        transcript = Transcript(); viewingRunID = nil; pendingMessage = nil; pendingFork = nil; pendingAtlasSave = nil; pendingMateCommand = nil; matesRevision += 1; accountID = nil
        sending = false; stoppingRunID = nil; drafts = [:]
        homeDrafts = [:]; collections = []; projects = []; gitStates = []
        selectedSpaceID = nil; homeTargets = [:]; composerSettings = [:]; providerConfigs = [:]
        models = [:]; modelErrors = [:]; loadingModels = []; changingMode = false
        savingConversationSettings = []; uncertainConversationSettings = []; settingsChanges = [:]
        settingsRevision = 0; settingsVersions = [:]
        contextCatalogues = [:]; contextRequests = [:]; contextRevisions = [:]; contextOrder = []
        clearToolPluginIcons()
        actionError = nil; historyError = nil; pendingApprovals = []
        approvalExpiryTask?.cancel(); approvalExpiryTask = nil
        decisionDeliveries = [:]; decisionRevision += 1
    }

    private func restart() {
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        voice.connectionLost()
        #endif
        stopRemoteQueueWatch()
        stopWorkInboxWatch()
        runQueues.pauseAll("Backend disconnected. Queued messages are paused.")
        generation += 1
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        voiceSettingsReadID = nil; loadingVoiceSettings = false
        #endif
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
        guard shouldMaintainConnection else { connection = .suspended; return }
        guard online || isDemo else { connection = .offline; return }
        if connection == .unauthorized || connection == .incompatible { return }
        let current = generation
        connection = conversations.isEmpty ? .connecting : .reconnecting
        guard restoringSnapshotOwner != pairingOwner else { return }
        connectionTask = Task { [weak self] in await self?.connect(pairing, generation: current) }
    }

    private func connect(_ pairing: PairedBackend, generation current: Int) async {
        var recoveryEnd = ContinuousClock.now + .seconds(30)
        var quiet = false
        while !Task.isCancelled && generation == current && shouldMaintainConnection && (online || isDemo) {
            let candidate = makeTransport(demoBackend)
            let remaining = ContinuousClock.now.duration(to: recoveryEnd).components
            let seconds = Double(remaining.seconds) + Double(remaining.attoseconds) / 1e18
            let attemptLimit = quiet ? 20 : max(0.1, min(20, seconds))
            var attemptTimedOut = false
            let attemptTimer = Task { [weak candidate] in
                do { try await Task.sleep(for: .seconds(attemptLimit)) } catch { return }
                attemptTimedOut = true
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
                guard !attemptTimedOut else { throw MainsError.timeout }
                attemptTimer.cancel()
                clearToolPluginIcons()
                connection = .connected
                if snapshotRefreshNeeded {
                    snapshotRefreshNeeded = false
                    scheduleListRefresh()
                }
                if workInboxVisible { startWorkInboxWatch() }
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

    public func toolPluginIcon(_ vendorID: String?) -> ToolPluginIcon? {
        guard let vendorID else { return nil }
        return toolPluginIcons[vendorID] ?? nil
    }

    public func loadToolPluginIcons(_ vendors: [String], runID: String) async {
        guard supportsPluginIcons, isConnected, viewingRunID == runID, let candidate = transport else { return }
        let owner = pairingOwner, current = generation, revision = contextRevisions["codex"]
        let missing = vendors.prefix(64).filter { !toolPluginIcons.keys.contains($0) }
        for start in stride(from: 0, to: missing.count, by: 8) {
            let batch = missing.dropFirst(start).prefix(8).filter { !toolPluginIcons.keys.contains($0) }
            if batch.isEmpty { continue }
            let args: [JSONValue] = [.array(batch.map(JSONValue.string))]
            guard let response = try? await candidate.invoke("providers:getMobilePluginIcons", args: args, timeout: 30),
                  !Task.isCancelled, owner == pairingOwner, current == generation, transport === candidate,
                  contextRevisions["codex"] == revision, viewingRunID == runID,
                  let icons = try? response.decode([ToolPluginIcon].self), icons.count <= batch.count else { return }
            let byVendor = Dictionary(icons.map { ($0.vendorID, $0) }, uniquingKeysWith: { first, _ in first })
            var updated = toolPluginIcons
            for vendor in batch where !updated.keys.contains(vendor) {
                updated.updateValue(byVendor[vendor], forKey: vendor)
                toolPluginIconOrder.append(vendor)
            }
            while toolPluginIconOrder.count > 128 { updated.removeValue(forKey: toolPluginIconOrder.removeFirst()) }
            toolPluginIcons = updated
        }
    }

    private func clearToolPluginIcons() {
        toolPluginIcons = [:]
        toolPluginIconOrder = []
    }

    public func searchWorkspaceFiles(_ query: String, scope: ContextScope) async throws -> [WorkspaceFileMatch] {
        guard supportsWorkspaceFileSearch, isConnected, let candidate = transport else { throw MainsError.disconnected }
        guard let workspaceID = scope.workspaceID, scope.workspacePath != nil,
              scope == contextScope(providerID: scope.providerID, workspaceID: workspaceID) else { throw MainsError.changedBackend }
        let owner = pairingOwner, current = generation
        let input: JSONValue = .object(["workspaceId": .string(workspaceID), "query": .string(query), "includeDirectories": .bool(true)])
        let result = try await candidate.invoke("search:workspaceFiles", args: [input])
        try Task.checkCancellation()
        guard owner == pairingOwner, current == generation, isConnected, transport === candidate,
              scope == contextScope(providerID: scope.providerID, workspaceID: workspaceID) else { throw MainsError.changedBackend }
        guard case .array(let rows) = result else { throw MainsError.invalidReply }
        var paths: Set<String> = []
        return rows.prefix(50).compactMap { row in
            guard let file = WorkspaceFileMatch.read(row), paths.insert(file.path).inserted else { return nil }
            return file
        }
    }

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

    nonisolated private static func list<T: Decodable>(_ value: JSONValue, key: String, as type: T.Type) throws -> [T] {
        if case .array = value { return try value.decode([T].self) }
        return try value[key].decode([T].self)
    }

    private func syncSnapshot(_ candidate: any BackendTransport, generation current: Int) async throws {
        let settingsReadVersion = settingsRevision
        let actionRevision = conversationActionRevision
        let workspaceRevision = workspaceActionRevision
        async let runResult = candidate.invoke("runs:getAll", args: [.number(100)])
        async let pinnedResult = supportsChatOrganization ? candidate.invoke("runs:listPinned") : .array([])
        async let spaceResult = candidate.invoke("space:getAll")
        async let workspaceResult = candidate.invoke("workspace:list")
        async let accountResult = candidate.invoke("account:get")
        let (runValue, pinnedValue, spaceValue, workspaceValue, accountValue) = try await (runResult, pinnedResult, spaceResult, workspaceResult, accountResult)
        guard let id = accountValue["id"].string else { throw MainsError.invalidReply }
        async let collectionResult = candidate.invoke("collections:list", args: [.object(["accountId": .string(id)])])
        async let projectResult = candidate.invoke("projects:list")
        async let gitResult = candidate.invoke("workspace:listGitStates")
        async let providerResult = candidate.invoke("providers:getEnabled")
        let (collectionValue, projectValue, gitValue, providerValue) = try await (collectionResult, projectResult, gitResult, providerResult)
        let (runs, pins, newSpaces, newWorkspaces, newCollections, newProjects, newGitStates, providers) = try await Wire.decodeOffMain {
            try (Self.list(runValue, key: "runs", as: Conversation.self).map(Self.safeConversation),
                 Self.list(pinnedValue, key: "runs", as: Conversation.self).filter { $0.accountId == id && $0.isPinnableChat && $0.pinnedAt != nil }.map(Self.safeConversation),
                 Self.list(spaceValue, key: "spaces", as: Space.self),
                 Self.list(workspaceValue, key: "workspaces", as: Workspace.self),
                 Self.list(collectionValue, key: "collections", as: ProjectCollection.self),
                 Self.list(projectValue, key: "projects", as: CodeProject.self),
                 Self.list(gitValue, key: "states", as: WorkspaceGitState.self),
                 Self.list(providerValue, key: "providers", as: ProviderSummary.self))
        }
        guard generation == current, transport === candidate else { return }
        guard actionRevision == conversationActionRevision, workspaceRevision == workspaceActionRevision else {
            snapshotRefreshNeeded = true
            return
        }
        accountID = id
        let viewed = conversations.first { $0.id == viewingRunID && !$0.isArchived }
        let recentIDs = Set(runs.map(\.id))
        storeConversationList((runs + pins.filter { !recentIDs.contains($0.id) })
            .map { keepingSettings($0, readVersion: settingsReadVersion) }, keeping: viewed)
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
        let selection = UUID(), owner = pairingOwner
        historySelection = selection
        viewingRunID = id
        initialHistoryCursor = cursor
        startRemoteQueueWatch(id)
        transcript = Transcript()
        historyError = nil
        pendingApprovals = []; approvalExpiryTask?.cancel(); approvalExpiryTask = nil
        if cursor != nil { transcript.setFollowing(false) }
        if (cursor == nil || !isConnected), let page = histories[id] {
            transcript.replace(page)
        } else if (cursor == nil || !isConnected), !isDemo, let pairing {
            let page = await storage.loadHistory(backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId, runID: id)
            guard !Task.isCancelled, pairingOwner == owner, historySelection == selection, viewingRunID == id else { return }
            if let page, transcript.page == nil { transcript.replace(page) }
        }
        if isConnected && !conversations.contains(where: { $0.id == id }) {
            let current = generation
            _ = try? await readQueuedRun(id)
            guard owner == pairingOwner, current == generation, historySelection == selection, viewingRunID == id, !Task.isCancelled else { return }
        }
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
                    request = .object(["runId": .string(runID), "direction": .string("newer"), "cursor": try .encode(initialCursor), "profile": .string("mobile"), "conversationWindow": .bool(true)])
                } else { request = try self.transcript.request(runID: runID, direction: self.transcript.page == nil ? "latest" : direction) }
                let settingsReadVersion = self.settingsRevision
                let decisionReadVersion = self.decisionRevision
                let actionRevision = self.conversationActionRevision
                async let pageValue = transport.invoke("runs:getHistory", args: [request])
                async let runValue = transport.invoke("runs:getById", args: [.string(runID)])
                async let approvalValue = transport.invoke("runs:listPendingApprovals", args: [.string(runID)])
                let (pageJSON, runJSON, approvalJSON) = try await (pageValue, runValue, approvalValue)
                guard !Task.isCancelled, self.generation == current, self.viewingRunID == runID, self.transport === transport,
                      actionRevision == self.conversationActionRevision else { return false }
                if runJSON == .null {
                    self.historySelection = UUID()
                    self.conversations.removeAll { $0.id == runID }; self.histories.removeValue(forKey: runID)
                    self.historyOrder.removeAll { $0 == runID }
                    self.transcript = Transcript(); self.historyError = "This conversation was deleted on your computer."
                    self.pendingApprovals = []; self.approvalExpiryTask?.cancel(); self.approvalExpiryTask = nil
                    self.saveCache(history: .remove(runID: runID)); return false
                }
                let (page, run, approvals) = try await Wire.decodeOffMain {
                    try (pageJSON.decode(HistoryPage.self), runJSON.decode(Conversation.self), approvalJSON.decode([PendingApproval].self))
                }
                guard self.generation == current, self.viewingRunID == runID, self.transport === transport,
                      actionRevision == self.conversationActionRevision else { return false }
                self.upsert(self.keepingSettings(run, readVersion: settingsReadVersion))
                self.transcript.replace(page, direction: direction, pending: self.pendingMessage)
                self.initialHistoryCursor = nil
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
                self.saveCache(history: .replace(runID: runID, page: page))
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

    nonisolated private static func safeConversation(_ input: Conversation) -> Conversation {
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
        let run = Self.safeConversation(input)
        conversations.removeAll { $0.id == run.id }
        let updated = run.isArchived ? conversations : conversations + [run]
        storeConversationList(updated, keeping: updated.first { $0.id == viewingRunID })
    }

    private func storeConversationList(_ rows: [Conversation], keeping viewed: Conversation?) {
        let available = rows.filter { !$0.isArchived }.sorted { $0.updatedAt > $1.updatedAt }
        let recent = Array(available.prefix(100))
        let recentIDs = Set(recent.map(\.id))
        let extraPins = available.filter { $0.isPinnableChat && $0.pinnedAt != nil && !recentIDs.contains($0.id) }
            .sorted { ($0.pinnedAt ?? .distantPast) > ($1.pinnedAt ?? .distantPast) }
        conversations = (recent + extraPins.prefix(100)).sorted { $0.updatedAt > $1.updatedAt }
        if let viewed, !conversations.contains(where: { $0.id == viewed.id }) { conversations.append(viewed) }
    }

    private func event(_ channel: String, _ payload: JSONValue) {
        if channel == "atlas:changed" { atlasChanged(); return }
        if channel == "assistants:changed" { matesRevision += 1; return }
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        if channel == "runs:realtimeEvent" {
            voice.receive(payload)
            if payload["type"].string == "closed", payload["runId"].string == viewingRunID,
               let id = payload["connectionId"].string { transcript.closeVoice(id) }
            return
        }
        #endif
        let runID = payload["runId"].string
        if channel == "providers:mobileGoalChanged" {
            if let runID, runID == viewingRunID { goalSummaryRevision += 1 }
            return
        }

        if ["runs:statusChanged", "runs:updated", "runs:toolApprovalRequest", "runs:toolApprovalResolved"].contains(channel) {
            workInboxRevision += 1
            if channel == "runs:toolApprovalResolved", let id = payload["requestId"].string {
                workInbox.requests.removeAll {
                    $0.requestId == id && (payload["approvalToken"].string == nil || $0.approvalToken == payload["approvalToken"].string)
                }
            }
            scheduleWorkInboxRefresh()
        }

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
        if ["space:changed", "workspace:changed", "workspace:created", "workspace:updated", "workspace:deleted", "workspace:gitStateChanged", "collections:changed", "projects:changed"].contains(channel) { scheduleListRefresh() }
        if channel == "providers:skillsUpdated", let providerID = payload["providerId"].string {
            contextRevisions[providerID, default: 0] += 1
            if providerID == "codex" { clearToolPluginIcons() }
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
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        if providerID == "codex" { Task { await voice.stop() } }
        #endif
    }
    public func revokeAllConsents(backendID: String) {
        guard pairing?.descriptor.backendId == backendID else { return }
        if isDemo { demoConsents = [] }
        else { storage.revokeAllConsents(backendID: backendID) }
        consentRevision += 1
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        Task { await voice.stop() }
        #endif
    }

    public func send(_ text: String, runID: String? = nil, spaceID: String? = nil, workspaceID: String? = nil,
                     collectionID: String? = nil, settings: ComposerSettings? = nil, attachments: [PromptAttachment] = [],
                     contextSkills: [ContextSkill] = [], contextScope: ContextScope? = nil, steering: Bool = false, queuedInputID: String? = nil,
                     mate: Mate? = nil, useMateWelcome: Bool = false) async throws -> String {
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        guard pendingVoiceConversation == nil else { throw MainsError.server("Check the unconfirmed voice conversation before sending.") }
        guard voice.runID != runID || !voice.ownsCall || voice.phase == .connected && conversations.first(where: { $0.id == runID })?.isActive == true else {
            throw MainsError.server("End voice chat before sending a written reply to this conversation.")
        }
#endif

        guard pendingConversationAction == nil else { throw MainsError.server("Check the pending chat change before sending.") }
        if let runID, pendingPlanDecision?.runID == runID { throw MainsError.server("Check the plan decision before sending another message.") }
        guard pendingFork == nil else { throw MainsError.server("Wait for the fork, or check its delivery before sending.") }
        guard pendingMessage?.status != .uncertain else { throw MainsError.server("Check the unconfirmed message before sending another.") }
        if let runID, decisionDeliveries.contains(where: { $0.value.attempt?.runID == runID && [.sending, .uncertain].contains($0.value.phase) }) {
            throw MainsError.server("Wait for the pending answer, or check its delivery before sending another message.")
        }
        guard isConnected, !sending,
              let pairing, let accountID else { throw MainsError.disconnected }
        let attached = ContextMentions.attached(in: text, skills: contextSkills)
        let mateMentions = attached.compactMap(\.mateContext)
        if steering && !mateMentions.isEmpty { throw MainsError.server("Send a Mate request in the next turn.") }
        let commandID = UUID().uuidString
        let goal = ContextMentions.goal(text, skills: attached)
        guard !goal.isEmpty || !attachments.isEmpty else { throw MainsError.server("Write a message or attach a file first.") }
        let message = goal.isEmpty && mate != nil ? "Use the attached context." : goal
        let providerID: String
        let channel: String
        let actualWorkspaceID: String?
        var payload: [String: JSONValue] = ["accountId": .string(accountID)]
        if let mate {
            guard supportsMates, mate.ready, runID == nil, !message.isEmpty else {
                throw MainsError.server("Finish setting up this Mate and enter a message before sending.")
            }
            providerID = mate.providerId; channel = "assistants:send"; actualWorkspaceID = nil
            payload["assistantId"] = .string(mate.id)
            payload["message"] = .string(message)
            payload["requestId"] = .string(commandID)
            if useMateWelcome, let welcome = mate.welcome, ["ready", "skipped", "starting"].contains(welcome.state) {
                payload["requestId"] = .string("welcome-" + mate.id)
                payload["runId"] = .string(welcome.runId)
            }
        } else if let runID {
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
        if !mateMentions.isEmpty {
            let source = runID.flatMap { id in conversations.first { $0.id == id } }
            let mode = source?.mode ?? spaces.first { $0.id == spaceID }?.mode
            let hasLocalWorkspace = workspaces.contains { $0.id == actualWorkspaceID && $0.isReplica != true }
            guard Experience.allowsMateMentions(mode, isMateConversation: mate != nil || source?.assistantId != nil,
                                                 hasLocalWorkspace: hasLocalWorkspace) else {
                throw MainsError.server("Call Mates from a standard Code or Work conversation.")
            }
            if let provider = attached.compactMap(\.mateProviderID).first(where: { !hasConsent(providerID: $0) }) {
                throw MainsError.server("Allow data sharing with \(Provider.recipient(provider)) before calling this Mate.")
            }
            payload[runID == nil ? "initialContext" : "additionalContext"] = .array(mateMentions)
            payload["clientPromptId"] = .string(queuedInputID ?? commandID)
        }
        var context: [String: JSONValue] = [:]
        if !attached.isEmpty {
            guard contextScope == self.contextScope(providerID: providerID, workspaceID: actualWorkspaceID) else {
                throw MainsError.server("The context belongs to another provider or workspace. Choose it again before sending.")
            }
            let skills = attached.filter { $0.mateID == nil && $0.workspaceFile == nil }
            if !skills.isEmpty { context["contextSkills"] = .array(skills.map(\.wire)) }
            let files = attached.compactMap(\.workspaceFile)
            if !files.isEmpty {
                guard contextScope?.workspacePath != nil, files.allSatisfy({ WorkspaceFileMatch(path: $0.path, kind: $0.kind) != nil }) else {
                    throw MainsError.server("Choose the file references again in your local workspace.")
                }
                context["contextFiles"] = .array(files.map(\.wire))
            }
        }
        if !attachments.isEmpty { context["attachments"] = try .encode(attachments) }
        if mate != nil { payload["context"] = .object(context) }
        else { payload.merge(context) { _, value in value } }
        guard hasConsent(providerID: providerID) else {
            throw MainsError.server(isDemo ? "Continue the on-device demo disclosure before sending." : "Allow data sharing with \(Provider.recipient(providerID)) before sending.")
        }
        let attempt = PendingMessage(runID: runID, text: message, date: Date(), status: .sending,
                                     commandID: commandID, channel: channel, payload: .object(payload),
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
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        guard pendingVoiceConversation == nil, !(voice.ownsCall && voice.runID == id) else { return false }
        #endif
        return isConnected && pendingConversationAction == nil && pendingPlanDecision?.runID != id && pendingFork == nil && !sending && pendingMessage == nil && stoppingRunID == nil &&
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

    public func canManageConversation(_ id: String, action: ConversationAction) -> Bool {
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        guard pendingVoiceConversation == nil, !(voice.ownsCall && voice.runID == id) else { return false }
        #endif
        guard isConnected, pendingConversationAction == nil, pendingPlanDecision?.runID != id, pendingFork == nil, pendingMessage == nil, !sending,
              stoppingRunID == nil, settingsChanges[id] == nil,
              let run = conversations.first(where: { $0.id == id }), run.accountId == accountID,
              run.isReplica != true, !run.isArchived,
              !decisionDeliveries.contains(where: { $0.value.attempt?.runID == id && [.sending, .uncertain].contains($0.value.phase) }) else { return false }
        let queue = runQueues.existing(id)
        guard queue?.busy != true, queue?.hasUnknown != true, queue?.editingID == nil else { return false }
        switch action {
        case .archive, .delete: return !run.isActive
        case .moveToProject: return ["work", "chat"].contains(run.mode)
        case .rename: return supportsChatOrganization
        case .setPinned: return supportsChatOrganization && run.isPinnableChat
        }
    }

    public func manageConversation(_ id: String, action: ConversationAction) async throws {
        guard canManageConversation(id, action: action), let accountID,
              let run = conversations.first(where: { $0.id == id }) else {
            throw MainsError.server("This chat cannot be changed right now. Stop active replies and resolve pending changes first.")
        }
        let args: [JSONValue]
        let requested: ConversationAction
        switch action {
        case .rename(let title):
            let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty && name.utf16.count <= 240 else {
                throw MainsError.server("Enter a chat title up to 240 characters.")
            }
            if run.title == name { return }
            requested = .rename(name)
            args = [.object(["runId": .string(id), "title": .string(name)])]
        case .setPinned(let pinned):
            if (run.pinnedAt != nil) == pinned { return }
            requested = action
            args = [.object(["runId": .string(id), "accountId": .string(accountID), "pinned": .bool(pinned)])]
        case .moveToProject(let projectID):
            guard projectID == nil || collections.contains(where: { $0.id == projectID && !$0.isArchived }) else {
                throw MainsError.server("This project is no longer available.")
            }
            if run.collectionId == projectID { return }
            requested = action
            args = [.object(["runId": .string(id), "accountId": .string(accountID), "collectionId": projectID.map(JSONValue.string) ?? .null])]
        case .archive, .delete:
            requested = action
            args = [.string(id)]
        }
        if action.retiresConversation { runQueues.existing(id)?.pause("Chat change pending. Queued messages are paused.") }
        let attempt = PendingConversationAction(runID: id, action: requested, status: .sending, commandID: UUID().uuidString,
                                                accountID: accountID, args: args, owner: pairingOwner)
        try await deliverConversationAction(attempt)
    }

    public func checkConversationAction() async throws {
        guard let attempt = pendingConversationAction, attempt.status == .uncertain, isConnected else { throw MainsError.disconnected }
        try await deliverConversationAction(attempt)
    }

    private func deliverConversationAction(_ original: PendingConversationAction) async throws {
        var attempt = original; attempt.status = .sending; pendingConversationAction = attempt
        do {
            let result = try await command(attempt.action.channel, args: attempt.args, commandID: attempt.commandID, owner: attempt.owner)
            guard attempt.owner == pairingOwner else { throw MainsError.changedBackend }
            try attempt.validate(result)
            pendingConversationAction = nil
            conversationActionRevision += 1
            if attempt.action.retiresConversation {
                leaveConversation(attempt.runID)
                conversations.removeAll { $0.id == attempt.runID }
                histories[attempt.runID] = nil; historyOrder.removeAll { $0 == attempt.runID }
                stopWorkInboxWatch()
                workInbox = WorkInboxSnapshot(saved: workInbox.runs.filter { $0.id != attempt.runID })
                if workInboxVisible { startWorkInboxWatch() }
                if attempt.action == .delete {
                    runQueues.retire(attempt.runID)
                    drafts.removeValue(forKey: attempt.runID)?.textChanged = nil
                    if !isDemo, let pairing {
                        let key = TextDraftKey(backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId, owner: .conversation, ownerID: attempt.runID)
                        do { try storage.saveDraftText("", for: key) }
                        catch { actionError = "Chat deleted, but its saved draft could not be cleared on this iPhone." }
                    }
                }
                retiredConversation = RetiredConversation(id: attempt.commandID, runID: attempt.runID)
                saveCache(history: .remove(runID: attempt.runID))
            }
            // A replayed receipt may predate another device's project change.
            // Read current metadata instead of applying that old row locally.
            let current = generation
            Task { [weak self] in
                guard let self, self.pairingOwner == attempt.owner, self.generation == current else { return }
                if !attempt.action.retiresConversation { _ = try? await self.readQueuedRun(attempt.runID) }
                guard self.pairingOwner == attempt.owner, self.generation == current else { return }
                await self.refresh()
            }
            runQueues.kick()
        } catch {
            if pairingOwner == attempt.owner {
                let failure = error as? MainsError
                let refused: Bool
                if case .server = failure { refused = failure?.isUnconfirmedCommand == false }
                else { refused = failure == .unauthorized || failure == .incompatible }
                if refused { pendingConversationAction = nil; runQueues.kick() }
                else { attempt.status = .uncertain; pendingConversationAction = attempt }
            }
            throw error
        }
    }

    public func canManageWorkspace(_ id: String, action: WorkspaceAction) -> Bool {
        guard isConnected, supportsWorkspaceManagement, pendingWorkspaceAction == nil,
              let workspace = workspaces.first(where: { $0.id == id && $0.isReplica != true && !$0.isArchived }) else { return false }
        switch action {
        case .archive, .delete:
            return !sending && !conversations.contains { $0.workspaceId == id && $0.isActive }
        case .renameBranch(let expected, _):
            guard let state = gitStates.first(where: { $0.workspaceId == id }), state.pathExists,
                  state.branch == expected, expected != "HEAD", !expected.isEmpty else { return false }
            return expected != workspace.baseBranch && expected != projects.first { $0.id == workspace.projectId }?.defaultBranch
        case .newWorktree:
            return projects.contains { $0.id == workspace.projectId && $0.isArchived != true }
        case .setPinned: return true
        }
    }

    public func manageWorkspace(_ id: String, action: WorkspaceAction) async throws {
        guard canManageWorkspace(id, action: action) else {
            throw MainsError.server("This workspace change is unavailable right now.")
        }
        try await deliverWorkspaceAction(.init(id: UUID().uuidString, workspaceID: id, action: action, status: .sending, owner: pairingOwner))
    }

    public func checkWorkspaceAction() async throws {
        guard let attempt = pendingWorkspaceAction, attempt.status == .uncertain, isConnected else { throw MainsError.disconnected }
        try await deliverWorkspaceAction(attempt)
    }

    private func deliverWorkspaceAction(_ original: PendingWorkspaceAction) async throws {
        var attempt = original
        attempt.status = .sending
        pendingWorkspaceAction = attempt
        do {
            let response = try await command("workspace:mobileManage", args: [.string(attempt.workspaceID), attempt.action.wire],
                                             commandID: attempt.id, owner: attempt.owner)
            guard attempt.owner == pairingOwner else { throw MainsError.changedBackend }
            guard response["workspaceId"].string == attempt.workspaceID,
                  response["action"].string == attempt.action.wireName else { throw MainsError.invalidReply }
            pendingWorkspaceAction = nil
            workspaceActionRevision += 1
            if attempt.action.retiresWorkspace {
                workspaces.removeAll { $0.id == attempt.workspaceID }
                gitStates.removeAll { $0.workspaceId == attempt.workspaceID }
                for spaceID in Array(homeTargets.keys) where homeTargets[spaceID]?.workspaceID == attempt.workspaceID {
                    homeTargets[spaceID]?.workspaceID = nil
                }
                retiredWorkspace = .init(id: attempt.id, workspaceID: attempt.workspaceID)
                saveCache()
            }
            await refresh()
        } catch {
            if attempt.owner == pairingOwner {
                let failure = error as? MainsError
                if case .server = failure, failure?.isUnconfirmedCommand == false {
                    pendingWorkspaceAction = nil
                } else if failure == .unauthorized || failure == .incompatible {
                    pendingWorkspaceAction = nil
                } else {
                    attempt.status = .uncertain
                    pendingWorkspaceAction = attempt
                }
            }
            throw error
        }
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
                         owner: Int? = nil, attemptTimeout: Int = 30, validate: (() throws -> Void)? = nil) async throws -> JSONValue {
        let owner = owner ?? pairingOwner
        let deadline = ContinuousClock.now + .seconds(max(60, attemptTimeout + 15))
        while ContinuousClock.now < deadline {
            try Task.checkCancellation()
            guard pairingOwner == owner else { throw MainsError.changedBackend }
            try validate?()
            if connection == .unauthorized { throw MainsError.unauthorized }
            if connection == .incompatible { throw MainsError.incompatible }
            if isConnected, let transport {
                do {
                    let remaining = ContinuousClock.now.duration(to: deadline).components
                    let timeout = min(Double(attemptTimeout), Double(remaining.seconds) + Double(remaining.attoseconds) / 1e18)
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
              let run = (workInboxIsCurrent ? workInbox.runs.first(where: { $0.id == runID }) : nil) ?? conversations.first(where: { $0.id == runID }),
              run.isReplica != true, run.isActive else { return }
        let owner = pairingOwner
        stoppingRunID = runID
        if let queue = runQueues.existing(runID), !queue.messages.isEmpty { queue.pause("Run stopped. Queued messages are paused.") }
        defer { if pairingOwner == owner { stoppingRunID = nil } }
        _ = try await command("runs:abort", args: [.string(runID)], owner: owner)
        if viewingRunID == runID { await loadHistory(direction: "refresh") }
        else { await refresh() }
        if workInboxVisible { await refreshWorkInbox() }
    }

    private func reconcilePending(_ page: HistoryPage, runID: String) {
        guard let pending = pendingMessage, pending.runID == runID,
              !pending.isSteering, !pending.isQueueOwned,
              page.artifacts.contains(where: pending.matches) else { return }
        pendingMessage = nil
        runQueues.kick()
    }

    public func readContent(artifactID: Int, offset: Int = 0, source: String = "artifact", expectedRunID: String? = nil) async throws -> JSONValue {
        guard let transport, let runID = viewingRunID, isConnected else { throw MainsError.disconnected }
        guard expectedRunID == nil || expectedRunID == runID else { throw MainsError.changedBackend }
        guard ["artifact", "tool-input", "tool-output", "plan"].contains(source), offset >= 0 else { throw MainsError.invalidReply }
        let current = generation, owner = pairingOwner
        let result = try await transport.invoke("runs:readHistoryContent", args: [.object([
            "runId": .string(runID), "source": .string(source), "id": .number(Double(artifactID)), "offset": .number(Double(offset)),
        ])])
        guard current == generation, owner == pairingOwner, self.transport === transport, viewingRunID == runID else { throw MainsError.changedBackend }
        return result
    }

    public func readFullMessage(artifactID: Int, runID: String, owner: Int) async throws -> String {
        let current = generation
        var offset = 0
        var totalChars: Int?
        var text = ""
        while true {
            try Task.checkCancellation()
            guard owner == pairingOwner, current == generation, viewingRunID == runID else { throw MainsError.changedBackend }
            let result = try await readContent(artifactID: artifactID, offset: offset, expectedRunID: runID)
            let page = try await result.decodeOffMain(HistoryContentPage.self)
            guard owner == pairingOwner, current == generation, viewingRunID == runID else { throw MainsError.changedBackend }
            let count = page.text.unicodeScalars.count
            guard page.offset == offset, page.totalChars >= offset, count <= page.totalChars - offset,
                  totalChars == nil || totalChars == page.totalChars else { throw MainsError.invalidReply }
            let end = offset + count
            if end == page.totalChars {
                guard page.nextOffset == nil else { throw MainsError.invalidReply }
                text.append(page.text)
                return text
            }
            guard count > 0, page.nextOffset == end else { throw MainsError.invalidReply }
            text.append(page.text)
            offset = end
            totalChars = page.totalChars
        }
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
            let page = try await result.decodeOffMain(HistoryContentPage.self)
            guard self.pairingOwner == owner, self.generation == current, self.viewingRunID == runID else { throw MainsError.changedBackend }
            return page
        }
    }

    private func saveCache(history: CachedHistoryChange? = nil) {
        guard !isDemo, let pairing else { return }
        storage.saveSnapshot(CachedSnapshot(backendID: pairing.descriptor.backendId, conversations: conversations,
                                           spaces: spaces, workspaces: workspaces,
                                           collections: collections, projects: projects, gitStates: gitStates,
                                           selectedSpaceID: selectedSpaceID, homeTargets: homeTargets, composerSettings: composerSettings,
                                           lastSyncedAt: lastSyncedAt), deviceID: pairing.deviceId, history: history)
    }

    private func saveOfflineValue<Value: Encodable>(_ value: Value, key: String) {
        guard !isDemo, let pairing, let data = try? JSONEncoder().encode(value) else { return }
        storage.saveOfflineValue(data, key: key, backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId)
    }

    private func offlineValues<Value: Decodable & Sendable>(_ type: Value.Type, key: String, prefix: Bool = false) async -> [Value] {
        guard !isDemo, let pairing else { return [] }
        let owner = pairingOwner
        let values = await storage.offlineValues(key, prefix: prefix, backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId)
        guard owner == pairingOwner, !Task.isCancelled else { return [] }
        let decoded = try? await Wire.decodeOffMain {
            let decoder = JSONDecoder()
            return values.compactMap { try? decoder.decode(type, from: $0) }
        }
        guard owner == pairingOwner, !Task.isCancelled else { return [] }
        return decoded ?? []
    }

    private func atlasChanged() {
        atlasRevision += 1
    }

    private func removeSavedAtlasFavorites() {
        for prefix in ["atlas:favorites", "atlas:visible-favorites", "atlas:library"] { removeOfflineValues(prefix) }
    }

    private func removeOfflineValues(_ prefix: String) {
        guard !isDemo, let pairing else { return }
        storage.removeOfflineValues(prefix, backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId)
    }

    private func removeSavedAtlasPage(_ id: String) {
        for prefix in ["atlas:recent:\(id):", "atlas:page:\(id):"] {
            removeOfflineValues(prefix)
        }
    }

    public var canKeepFilesOffline: Bool { pairing != nil && !isDemo }

    public func savedOfflineFiles() async -> [OfflineFile] {
        guard canKeepFilesOffline, let pairing else { return [] }
        let owner = pairingOwner
        let files = await storage.offlineFiles(backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId)
        return owner == pairingOwner && !Task.isCancelled ? files : []
    }

    public func savedOfflineOutputs(_ runID: String) async -> [OfflineFile] {
        await savedOfflineFiles().filter { file in
            if case .output(let id, _) = file.key { return id == runID }
            return false
        }
    }

    func offlineFilePreview(_ file: OfflineFile, owner: Int) async throws -> PreviewExportFile {
        guard owner == pairingOwner, canKeepFilesOffline, let pairing else { throw MainsError.changedBackend }
        guard let url = await storage.offlineFileURL(file, backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId) else {
            throw MainsError.server("This file isn’t saved on this iPhone.")
        }
        try Task.checkCancellation()
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        let reader = try await Task.detached(priority: .userInitiated) { try PreviewExportFile(copying: url) }.value
        try Task.checkCancellation()
        guard owner == pairingOwner else { throw MainsError.changedBackend }
        return reader
    }

    public func keepOffline(_ file: OfflineFile, copying url: URL, owner: Int) async throws {
        guard owner == pairingOwner, canKeepFilesOffline, let pairing else { throw MainsError.changedBackend }
        try await storage.saveOfflineFile(file, copying: url, backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId)
        guard owner == pairingOwner else { throw MainsError.changedBackend }
    }

    public func removeOffline(_ file: OfflineFile, owner: Int) async throws {
        guard owner == pairingOwner, canKeepFilesOffline, let pairing else { throw MainsError.changedBackend }
        try await storage.removeOfflineFile(file, backendID: pairing.descriptor.backendId, deviceID: pairing.deviceId)
        guard owner == pairingOwner else { throw MainsError.changedBackend }
    }
}

extension BackendSession {
    public var displayedWorkInbox: WorkInboxSnapshot {
        workInbox.updatedAt == nil && workInbox.runs.isEmpty ? WorkInboxSnapshot(saved: conversations) : workInbox
    }

    /// The sidebar and inbox poll. The Mate directory shares the reader when
    /// visible and refreshes on events without starting its own poll.
    public func setWorkInboxVisible(_ visible: Bool, poll: Bool = true) {
        let polling = visible && poll
        guard visible != workInboxVisible || polling != workInboxPolling else { return }
        workInboxVisible = visible
        workInboxPolling = polling
        if !polling { workInboxPoll?.cancel(); workInboxPoll = nil }
        if visible { startWorkInboxWatch() } else { stopWorkInboxWatch() }
    }

    public func refreshWorkInbox() async {
        if let workInboxRead { await workInboxRead.value; return }
        guard active, isConnected, let candidate = transport, let accountID else { return }
        let ticket = UUID(), owner = pairingOwner, current = generation, revision = workInboxRevision
        workInboxReadID = ticket; workInboxLoading = true
        let task = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.workInboxReadID == ticket {
                    self.workInboxRead = nil; self.workInboxReadID = nil; self.workInboxLoading = false
                    if self.workInboxReadAgain { self.workInboxReadAgain = false; self.scheduleWorkInboxRefresh() }
                }
            }
            do {
                let snapshot = try await WorkInboxSnapshot.read(accountID: accountID) { channel, args in
                    try Task.checkCancellation()
                    guard self.pairingOwner == owner, self.generation == current, self.transport === candidate,
                          self.workInboxReadID == ticket else { throw MainsError.changedBackend }
                    return try await candidate.invoke(channel, args: args)
                }
                try Task.checkCancellation()
                guard self.pairingOwner == owner, self.generation == current, self.transport === candidate,
                      self.workInboxReadID == ticket else { return }
                // A decision resolved or a run changed while these reads were
                // in flight. Refresh again instead of resurrecting its old row.
                guard self.workInboxRevision == revision else { self.workInboxReadAgain = true; return }
                self.workInbox = snapshot; self.workInboxIsCurrent = true; self.workInboxError = nil
            } catch {
                guard !Task.isCancelled, self.pairingOwner == owner, self.generation == current, self.workInboxReadID == ticket else { return }
                self.workInboxIsCurrent = false; self.workInbox.requests = []
                self.workInboxError = "Couldn't update activity. " + error.localizedDescription
            }
        }
        workInboxRead = task
        await task.value
    }

    public func canStopInboxRun(_ id: String) -> Bool {
        isConnected && workInboxIsCurrent && stoppingRunID == nil && workInbox.activeIDs.contains(id) &&
            workInbox.runs.contains { $0.id == id && $0.isActive && $0.isReplica != true }
    }

    private func startWorkInboxWatch() {
        guard active, workInboxVisible, isConnected, workInboxPoll == nil else { return }
        guard workInboxPolling else { scheduleWorkInboxRefresh(); return }
        let owner = pairingOwner, current = generation
        workInboxPoll = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.active, self.workInboxVisible, self.isConnected, self.pairingOwner == owner, self.generation == current else { return }
                await self.refreshWorkInbox()
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
            }
        }
    }

    private func stopWorkInboxWatch() {
        workInboxPoll?.cancel(); workInboxRefresh?.cancel(); workInboxRead?.cancel()
        workInboxPoll = nil; workInboxRefresh = nil; workInboxRead = nil; workInboxReadID = nil
        workInboxLoading = false; workInboxReadAgain = false; workInboxIsCurrent = false
        workInbox.requests = []; workInboxError = nil; workInboxRevision += 1
    }

    private func scheduleWorkInboxRefresh() {
        guard active, workInboxVisible, isConnected else { return }
        if workInboxRead != nil { workInboxReadAgain = true; return }
        guard workInboxRefresh == nil else { return }
        let current = generation
        workInboxRefresh = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            guard let self, self.generation == current else { return }
            self.workInboxRefresh = nil
            await self.refreshWorkInbox()
        }
    }
}

extension BackendSession {
    public var pendingQuestions: PendingAsyncQuestions? {
        _ = decisionRevision
        guard let runID = viewingRunID, let page = transcript.page, !page.hasNewer, !waitingForDecision,
              conversations.first(where: { $0.id == runID })?.isReplica != true else { return nil }
        var questions = PendingAsyncQuestions.latest(in: page.artifacts)
        // A confirmed answer or dismissal wins over an older in-flight history response.
        if let questions, decisionDeliveries[questions.id]?.phase == .done { return nil }
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

    private func currentPlan(runID: String) -> PlanProposal? {
        guard viewingRunID == runID, let page = transcript.page, !page.hasNewer, !transcript.isHistorical else { return nil }
        return page.toolCalls.sorted { $0.id > $1.id }.lazy.compactMap(PlanProposal.init).first
    }

    private func livePlanApproval(runID: String) -> PendingApproval? {
        pendingApprovals.first { $0.runId == runID && $0.isExitPlan && $0.approvalToken != nil && $0.expiresAt > Date() }
    }

    public func showsPlanApprovalInline(_ approval: PendingApproval) -> Bool {
        guard supportsPlanDecisions, approval.isExitPlan, livePlanApproval(runID: approval.runId)?.id == approval.id,
              let plan = currentPlan(runID: approval.runId), plan.isExitPlan,
              conversations.contains(where: { $0.id == approval.runId && $0.assistantId == nil && $0.providerId == "claude_code" && $0.isActive }) else { return false }
        return planStatus(plan, runID: approval.runId) == .pending
    }

    public func planStatus(_ plan: PlanProposal, runID: String) -> PlanProposal.Status {
        if plan.status == .pending, let confirmed = confirmedPlanDecision, confirmed.runID == runID, confirmed.planID == plan.id {
            return confirmed.status
        }
        return plan.status
    }

    public func offersPlanDecision(_ plan: PlanProposal, runID: String) -> Bool {
        guard supportsPlanDecisions, currentPlan(runID: runID)?.id == plan.id, planStatus(plan, runID: runID) == .pending,
              let run = conversations.first(where: { $0.id == runID }), run.accountId == accountID, run.isReplica != true, !run.isArchived else { return false }
        if run.providerId == "claude_code", plan.isExitPlan { return run.isActive && livePlanApproval(runID: runID) != nil }
        return !run.isActive
    }

    public func canDecidePlan(_ plan: PlanProposal, runID: String) -> Bool {
        let queue = runQueues.existing(runID)
        return offersPlanDecision(plan, runID: runID) && isConnected && pendingPlanDecision == nil && pendingMessage == nil &&
            pendingConversationAction == nil && pendingFork == nil && stoppingRunID != runID && settingsChanges[runID] == nil &&
            !savingConversationSettings.contains(runID) && queue?.busy != true && queue?.hasUnknown != true && queue?.editingID == nil &&
            !decisionDeliveries.contains { $0.value.attempt?.runID == runID }
    }

    public func decidePlan(_ plan: PlanProposal, runID: String, decision: PlanProposal.Decision) async throws {
        guard canDecidePlan(plan, runID: runID), let accountID, let run = conversations.first(where: { $0.id == runID }) else {
            throw MainsError.server("This plan is no longer ready for a decision.")
        }
        if decision == .apply, !hasConsent(providerID: run.providerId) {
            throw MainsError.server("Allow data sharing with \(Provider.recipient(run.providerId)) before applying the plan.")
        }
        var payload: [String: JSONValue] = ["runId": .string(runID), "accountId": .string(accountID),
            "toolCallId": .number(Double(plan.id)), "decision": .string(decision.rawValue)]
        if run.providerId == "claude_code", plan.isExitPlan, let approval = livePlanApproval(runID: runID), let token = approval.approvalToken {
            payload["approvalRequestId"] = .string(approval.requestId); payload["approvalToken"] = .string(token)
        }
        if decision == .apply, let queue = runQueues.existing(runID), !queue.messages.isEmpty {
            queue.pause("Plan is being applied. Resume queued messages when ready.")
        }
        let attempt = PendingPlanDecision(runID: runID, planID: plan.id, decision: decision, checking: false, uncertain: false,
                                          commandID: UUID().uuidString, owner: pairingOwner, payload: .object(payload))
        try await deliverPlanDecision(attempt, checking: false)
    }

    public func checkPlanDecision() async throws {
        guard let pending = pendingPlanDecision, pending.uncertain, !pending.checking, isConnected else { throw MainsError.disconnected }
        try await deliverPlanDecision(pending, checking: true)
    }

    private func deliverPlanDecision(_ original: PendingPlanDecision, checking: Bool) async throws {
        var attempt = original
        attempt.checking = checking
        pendingPlanDecision = attempt
        var payload = attempt.payload.objectValue
        if checking { payload["checkOnly"] = .bool(true) }
        do {
            let result = try await command("runs:decidePlan", args: [.object(payload)],
                commandID: checking ? UUID().uuidString : attempt.commandID, owner: attempt.owner) {
                if !checking, self.viewingRunID != attempt.runID { throw MainsError.changedBackend }
            }
            guard pairingOwner == attempt.owner else { throw MainsError.changedBackend }
            guard let status = result["status"].string.flatMap(PlanProposal.Status.init),
                  status == attempt.decision.status || checking && (status == .applied || status == .dismissed) else { throw MainsError.invalidReply }
            confirmedPlanDecision = (attempt.runID, attempt.planID, status)
            if let requestID = payload["approvalRequestId"]?.string, let token = payload["approvalToken"]?.string {
                decisionRevision += 1
                pendingApprovals.removeAll { $0.id == .approval(runID: attempt.runID, requestID: requestID, token: token) }
            }
            await refresh()
            guard pairingOwner == attempt.owner else { return }
            if viewingRunID == attempt.runID { await loadHistory(direction: "refresh") }
            guard pairingOwner == attempt.owner else { return }
            pendingPlanDecision = nil; runQueues.kick()
        } catch {
            guard pairingOwner == attempt.owner else { throw MainsError.changedBackend }
            if let canonical = transcript.page?.toolCalls.first(where: { viewingRunID == attempt.runID && $0.id == attempt.planID }).flatMap(PlanProposal.init),
               canonical.status != .pending {
                pendingPlanDecision = nil; runQueues.kick(); return
            }
            let refusal: Bool
            if let failure = error as? MainsError, case .server(let message) = failure {
                refusal = !checking && !failure.isUnconfirmedCommand && !["delivery is unknown", "still being delivered", "saving its status failed"].contains { message.localizedCaseInsensitiveContains($0) }
            } else { refusal = false }
            if refusal { pendingPlanDecision = nil; runQueues.kick() }
            else { attempt.checking = false; attempt.uncertain = true; pendingPlanDecision = attempt }
            throw error
        }
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
