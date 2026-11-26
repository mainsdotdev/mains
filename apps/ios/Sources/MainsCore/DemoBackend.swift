import Foundation
import CryptoKit

/// An on-device counterpart to the same channels used by a real computer.
/// Imported files, new runs, command receipts and replay progress are memory-only.
@MainActor
final class DemoBackend {
    static let backendID = "demo-mac"
    static let endpoint = URL(string: "demo://on-this-phone")!
    static let tourID = "demo-native-tour"
    static let activityApprovalRunID = "demo-activity-approval"
    static let activityQueueRunID = "demo-activity-queue"
    static let launchBriefRunID = "demo-work-launch-brief"
    static let mateID = "demo-release-mate"
    static let mateChatID = "demo-release-mate-chat"
    private static let mateTeamID = "demo-release-team"
    private static let mateAssignmentResult = "The sample assignment is complete. Open Chat to preview the Markdown report."
    static let decisionPrompt = "Walk me through approvals and questions"
    static let changesPrompt = "Show sample file changes and diffs"
    static let subagentsPrompt = "Review the sample workspace with subagents"
    static let pdfAttachmentID = String(repeating: "d", count: 64)
    static let imageAttachmentID = String(repeating: "e", count: 64)

    private var seed: JSONValue
    private var runs: [[String: JSONValue]]
    private var artifacts: [String: [[String: JSONValue]]]
    private var tools: [String: [[String: JSONValue]]]
    private var turns: [String: [[String: JSONValue]]]
    private var patches: [String: [Int: String]] = [:]
    private var goals: [String: MobileGoalSummary] = [:]
    private var spaces: [[String: JSONValue]]
    private var images: [Int: JSONValue] = [:]
    private var attachments: [String: DemoFile] = [:]
    private var outputs: [String: [Int: DemoFile]] = [DemoBackend.tourID: [-9001: .pdf, -9002: .notes]]
    private var mates: [DemoMate] = []
    private var assignments: [DemoAssignment] = []
    private let atlas: DemoAtlas
    private var attachmentBytes = 0
    private var nextID = 10_000_000
    private let stepDelay: Duration
    private let streamDelay: Duration
    private let decisionLifetime: TimeInterval
    private var approvals: [String: JSONValue] = [:]
    private var approvalTimers: [String: Task<Void, Never>] = [:]
    private var owner: UUID?
    private var emit: ((String, JSONValue) -> Void)?
    private var tasks: [String: Task<Void, Never>] = [:]
    private enum Step { case text(String), thinking(String), tool(String, JSONValue, JSONValue), approval(JSONValue), questions, changes, subagents(Int), finish }
    private enum ReplayWait { case approval, followUp }
    private struct Replay {
        let steps: [Step]
        var index = 0
        var count = 0
        var streamID = UUID().uuidString
        var waitingFor: ReplayWait?
        var activeToolID: Int?
        var agentBaseID: Int?
        var agentsStartedAt: Double?
    }
    private var replays: [String: Replay] = [:]
    private struct Receipt {
        let channel: String
        let fingerprint: Data
        let result: Result<JSONValue, MainsError>
    }
    private var receipts: [String: Receipt] = [:]

    private struct DemoAssignment {
        enum Status: String { case running, completed, canceled }

        let id: String
        let mateID: String
        let runID: String
        let title: String
        let brief: String
        var status = Status.running
    }

    private struct DemoMate {
        struct Setup {
            var answer: String?
            var draft: MateProfile?
        }

        let id: String
        let name: String
        let spaceID: String
        let spaceName: String
        let providerID: String
        let model: String
        let effort: String
        let teamID: String?
        let avatar: MateAvatar
        var profile: MateProfile?
        var setup: Setup?

        var question: String { "Hi, I’m \(name). What would you like me to help with?" }
        var welcomeRunID: String? { setup == nil ? nil : "welcome-\(id)" }

        func projection() throws -> JSONValue {
            var value: [String: JSONValue] = [
                "id": .string(id), "name": .string(name), "description": .string(profile?.description ?? ""),
                "avatar": try .encode(avatar), "teamId": teamID.map(JSONValue.string) ?? .null,
                "providerId": .string(providerID), "model": .string(model), "needsSetup": .bool(profile == nil),
                "details": .object(["spaceName": .string(spaceName), "effort": .string(effort),
                                    "instructions": .string(profile?.instructions ?? "")]),
            ]
            if let setup, let welcomeRunID {
                let turns: [JSONValue] = setup.answer.map { [.object(["question": .string(question), "answer": .string($0)])] } ?? []
                value["welcome"] = .object([
                    "runId": .string(welcomeRunID), "state": .string(profile == nil ? "ready" : "skipped"),
                    "question": .object(["question": .string(question), "options": .array([]),
                        "idleMessage": .string("Profile saved. What would you like me to do first?"),
                        "profileSetup": .object(["turns": .array(turns), "draft": try .encode(profile ?? setup.draft),
                                                 "saved": .bool(profile != nil)])]),
                ])
            }
            return .object(value)
        }
    }
    #if MAINS_GPT_LIVE || SWIFT_PACKAGE
    private static let sampleVoices = ["arbor", "breeze", "cove", "ember", "juniper", "maple", "sol", "spruce", "vale"]
#endif

    private let mutationChannels: Set<String> = ["assistants:create", "assistants:setupProfile", "assistants:send", "assistants:mobileManage",
        "runs:execute", "runs:continue", "runs:fork", "runs:archive", "runs:delete", "runs:moveToCollection", "runs:rename", "runs:setPinned", "workspace:mobileManage", "runs:steer", "runs:inputStatus", "runs:abort", "space:update", "runs:updateConversationSettings", "providers:changeMobileGoal",
        "runs:toolApprovalResponse", "runs:decidePlan", "runs:answerAsyncQuestions", "runs:dismissAsyncQuestions", "providers:updateRunSettings", "atlas:saveMobileFile", "atlas:saveMobileBookmark", "atlas:updateMobileItem", "atlas:editMobileBookmark", "atlas:setMobileTrash", "atlas:deleteMobileTrash", "atlas:setMobileTags"]

    var pairing: PairedBackend {
        PairedBackend(descriptor: BackendDescriptor(backendId: Self.backendID, name: "Demo Mac",
                      appVersion: "Demo", protocolVersion: Wire.protocolVersion, capabilities: ["runs","workspace","providers","space","projects","collections","mobileGoalSummary","mobileGoalControls","workspaceFileSearch","mobilePlanDecision","assistants","mobileChatOrganization","mobileWorkspaceManagement"],
                      serverTime: Date().ISO8601Format()),
                      endpoints: [Self.endpoint], deviceId: "native-demo-device", deviceToken: "on-device-demo", pairedAt: Date())
    }
    var defaultWorkspaceID: String? {
        seed["workspaces"].array.first { $0["name"].string == "mains" }?["id"].string
    }

    init(stepDelay: Duration = .milliseconds(450), streamDelay: Duration = .milliseconds(35), decisionLifetime: TimeInterval = 300) throws {
        atlas = try DemoAtlas()
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle.main
        #endif
        guard let url = bundle.url(forResource: "DemoSnapshot", withExtension: "json") else {
            throw MainsError.server("The demo sample data is missing.")
        }
        let source = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
        // Keep sample ages useful on every launch while preserving chronology.
        let fractional = ISO8601DateFormatter(), plain = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        plain.formatOptions = [.withInternetDateTime]
        func timestamp(_ value: JSONValue) -> Double? {
            if let number = value.number { return number / 1000 }
            guard let string = value.string ?? value["$date"].string,
                  let date = fractional.date(from: string) ?? plain.date(from: string) else { return nil }
            return date.timeIntervalSince1970
        }
        let latest = source["runs"].array.compactMap { timestamp($0["updatedAt"]) }.max() ?? Date().timeIntervalSince1970
        let delta = Date().timeIntervalSince1970 - latest - 3600
        func rebase(_ value: JSONValue) -> JSONValue {
            switch value {
            case .object(let row):
                return .object(row.reduce(into: [:]) { result, pair in
                    if ["createdAt","updatedAt","startedAt","endedAt"].contains(pair.key), let at = timestamp(pair.value) {
                        result[pair.key] = .number((at + delta) * 1000)
                    } else { result[pair.key] = rebase(pair.value) }
                })
            case .array(let list): return .array(list.map(rebase))
            default: return value
            }
        }
        let data = rebase(source)
        seed = data; runs = data["runs"].array.map(\.objectValue); spaces = data["spaces"].array.map(\.objectValue)
        artifacts = data["artifacts"].objectValue.mapValues { $0.array.map(\.objectValue) }
        tools = data["toolCalls"].objectValue.mapValues { $0.array.map(\.objectValue) }
        turns = data["turns"].objectValue.mapValues { $0.array.map(\.objectValue) }
        self.stepDelay = stepDelay; self.streamDelay = streamDelay; self.decisionLifetime = decisionLifetime
        for (id, image) in data["images"].objectValue { if let id = Int(id) { images[id] = image } }
        addTour()
        try addLaunchBrief()
        addSampleMate()
        addActivitySamples()
    }

    func attach(owner: UUID, emit: @escaping (String, JSONValue) -> Void) {
        for task in tasks.values { task.cancel() }
        tasks = [:]; self.owner = owner; self.emit = emit
        expireApprovals()
        for request in approvals.values { armExpiry(request) }
        for runID in replays.keys { resume(runID) }
    }
    func detach(owner: UUID) {
        guard self.owner == owner else { return }
        self.owner = nil; emit = nil
        for task in tasks.values { task.cancel() }
        for timer in approvalTimers.values { timer.cancel() }; approvalTimers = [:]
        tasks = [:] // Progress is retained; foreground resumes the same replay.
    }
    func shutdown() {
        for task in tasks.values { task.cancel() }
        tasks = [:]; replays = [:]; emit = nil; owner = nil; patches = [:]
        for timer in approvalTimers.values { timer.cancel() }; approvalTimers = [:]; approvals = [:]
        attachments = [:]; attachmentBytes = 0; mates = []; assignments = []
    }

    func didQueueFollowUp(_ runID: String) {
        guard replays[runID]?.waitingFor == .followUp else { return }
        replays[runID]?.waitingFor = nil
        resume(runID)
    }

    func invoke(_ channel: String, args: [JSONValue], commandID: String? = nil) throws -> JSONValue {
        if let commandID, mutationChannels.contains(channel) {
            let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
            let fingerprint = Data(SHA256.hash(data: try encoder.encode(JSONValue.array(args))))
            if let receipt = receipts[commandID] {
                guard receipt.channel == channel, receipt.fingerprint == fingerprint else { throw MainsError.server("This command belongs to another demo action.") }
                return try receipt.result.get()
            }
            guard receipts.count < 512 else { throw MainsError.server("Exit and reopen Demo Mode to start a fresh sample session.") }
            let result: Result<JSONValue, MainsError>
            do { result = .success(try answer(channel, args: args)) }
            catch let error as MainsError { result = .failure(error) }
            catch { result = .failure(.server(error.localizedDescription)) }
            receipts[commandID] = Receipt(channel: channel, fingerprint: fingerprint, result: result)
            return try result.get()
        }
        return try answer(channel, args: args)
    }

    private func answer(_ channel: String, args: [JSONValue]) throws -> JSONValue {
        let first = args.first ?? .null
        let runID = first["runId"].string ?? first.string ?? ""
        switch channel {
        case "runs:rename", "runs:setPinned":
            guard let index = runs.firstIndex(where: { $0["id"]?.string == runID }),
                  runs[index]["isReplica"] != .bool(true), runs[index]["isArchived"] != .bool(true) else {
                throw MainsError.server("This demo chat is unavailable or read-only.")
            }
            if channel == "runs:rename" {
                guard let title = first["title"].string, !title.isEmpty, title.utf16.count <= 240 else { throw MainsError.invalidReply }
                runs[index]["title"] = .string(title)
            } else {
                guard ["work", "chat"].contains(runs[index]["mode"]?.string ?? ""),
                      runs[index]["assistantId"]?.string == nil, first["accountId"] == seed["account"]["id"],
                      case .bool(let pinned) = first["pinned"] else { throw MainsError.invalidReply }
                runs[index]["pinnedAt"] = pinned ? .number(Date().timeIntervalSince1970 * 1000) : .null
            }
            push("runs:updated", ["runId": .string(runID)])
            return .object(runs[index])
        case "runs:archive", "runs:delete", "runs:moveToCollection":
            guard let index = runs.firstIndex(where: { $0["id"]?.string == runID }), runs[index]["isReplica"] != .bool(true) else {
                throw MainsError.server("This demo chat is unavailable or read-only.")
            }
            if channel == "runs:moveToCollection" {
                guard ["work", "chat"].contains(runs[index]["mode"]?.string ?? ""),
                      first["accountId"].string == seed["account"]["id"].string,
                      runs[index]["isArchived"] != .bool(true) else { throw MainsError.server("This chat cannot move to a project.") }
                let projectID = first["collectionId"].string
                guard first["collectionId"] == .null || projectID.map({ id in seed["collections"].array.contains { $0["id"].string == id && $0["isArchived"] != .bool(true) } }) == true else {
                    throw MainsError.server("This project is unavailable.")
                }
                runs[index]["collectionId"] = projectID.map(JSONValue.string) ?? .null
            } else {
                guard !isRunning(runID), !["running", "queued"].contains(runs[index]["status"]?.string ?? "") else {
                    throw MainsError.server("Stop the active reply before archiving or deleting this chat.")
                }
                let isMateChat = runs[index]["assistantId"]?.string != nil
                if channel == "runs:delete" {
                    runs.remove(at: index); tasks.removeValue(forKey: runID)?.cancel(); replays[runID] = nil
                    artifacts[runID] = nil; tools[runID] = nil; turns[runID] = nil; patches[runID] = nil; goals[runID] = nil
                    outputs[runID] = nil
                    push("runs:updated", ["runId": .string(runID)])
                    if isMateChat { push("assistants:changed", [:]) }
                    return .null
                }
                runs[index]["isArchived"] = .bool(true)
                if isMateChat { push("assistants:changed", [:]) }
            }
            push("runs:updated", ["runId": .string(runID)])
            return .object(runs[index])
        case "atlas:saveMobileFile" where first["sourceKey"].string == nil && first["itemId"].string == nil,
             "atlas:readMobileSaveStatus" where first["sourceKey"].string == nil && first["itemId"].string == nil:
            guard first["accountId"].string == seed["account"]["id"].string else { throw MainsError.server("Atlas account not found.") }
            try requireRun(runID)
            let file: DemoFile, source: String
            if let attachmentID = first["attachmentId"].string {
                guard first["artifactId"].number == nil else { throw MainsError.invalidReply }
                file = try attachment(runID, id: attachmentID)
                source = "attachment:\(runID):\(attachmentID)"
            } else {
                let output = try outputFile(runID, artifactID: first["artifactId"].number)
                file = output.file
                source = "output:\(runID):\(output.id)"
            }
            guard first["version"].string == file.version else { throw MainsError.server("This demo file changed.") }
            if channel == "atlas:readMobileSaveStatus" { return .object(["saved": .bool(atlas.hasSavedCopy(source: source))]) }
            let result = try atlas.save(file, source: source, runID: runID, collectionID: runs.first(where: { $0["id"]?.string == runID })?["collectionId"]?.string)
            push("atlas:changed", [:]); return result
        case "atlas:readMobileSaveStatus", "atlas:mobileLibrary", "atlas:readMobilePage", "atlas:readMobilePageCover", "atlas:readMobilePageImage", "atlas:describeMobileFile", "atlas:readMobileFile", "atlas:readMobileImage", "atlas:saveMobileFile", "atlas:saveMobileBookmark", "atlas:updateMobileItem", "atlas:readMobileBookmark", "atlas:editMobileBookmark", "atlas:mobileTrash", "atlas:setMobileTrash", "atlas:deleteMobileTrash", "atlas:mobileTags", "atlas:readMobileTags", "atlas:setMobileTags":
            guard first["accountId"].string == seed["account"]["id"].string else { throw MainsError.server("Atlas account not found.") }
            if let project = first["collectionId"].string, !seed["collections"].array.contains(where: { $0["id"].string == project }) { throw MainsError.server("Project unavailable.") }
            let result = try atlas.answer(channel, input: first, runID: runs.first(where: { $0["mode"]?.string == "work" })?["id"]?.string ?? Self.tourID,
                                          collectionID: seed["collections"].array.first?["id"].string, image: seed["images"].objectValue.values.first ?? .null)
            if channel == "atlas:saveMobileFile" || channel == "atlas:saveMobileBookmark" || channel == "atlas:updateMobileItem" || channel == "atlas:editMobileBookmark" || channel == "atlas:setMobileTrash" || channel == "atlas:deleteMobileTrash" || channel == "atlas:setMobileTags" { push("atlas:changed", [:]) }
            return result
        case "backend:describe": return try .encode(pairing.descriptor)
        case "account:get": return seed["account"]
        case "assistants:mobileDirectory":
            guard first == seed["account"]["id"] else { throw MainsError.server("Demo account unavailable.") }
            let selected = args.dropFirst().first?.string
            let archived = args.dropFirst(2).first?.bool == true
            let profiles = try (archived ? [] : mates.filter { selected == nil || selected == $0.id }.map { try $0.projection() })
            let team = JSONValue.object(["id": .string(Self.mateTeamID), "name": .string("Release team")])
            return .object(["mates": .array(profiles), "teams": .array([team])])
        case "assistants:conversations":
            guard first == seed["account"]["id"], let id = args.dropFirst().first?.string, mates.contains(where: { $0.id == id }) else {
                throw MainsError.server("This demo Mate is unavailable.")
            }
            let chats = runs.filter { $0["assistantId"]?.string == id && $0["isArchived"] != .bool(true) }
                .sorted { time($0, "updatedAt") > time($1, "updatedAt") }
                .prefix(100)
                .map { JSONValue.object(["id": $0["id"] ?? .null, "title": $0["title"] ?? .null, "updatedAt": $0["updatedAt"] ?? .null]) }
            return .array(chats)
        case "assistants:create": return try createMate(first)
        case "assistants:setupProfile": return try setupMate(args)
        case "assistants:send": return try sendMate(first)
        case "assistants:mobileAssignments": return try readMateAssignments(args)
        case "assistants:mobileManage": return try manageMateAssignment(args)
        case "space:getAll": return .array(spaces.map(JSONValue.object))
        case "workspace:mobileManage": return try manageDemoWorkspace(runID, change: args.dropFirst().first ?? .null)
        case "workspace:list": return .array(seed["workspaces"].array.filter { !$0["isArchived"].bool })
        case "workspace:listGitStates", "collections:list", "projects:list":
            let key = ["workspace:listGitStates":"gitStates", "collections:list":"collections", "projects:list":"projects"][channel]!
            return seed[key]
        case "providers:getEnabled": return seed["providers"]
        #if MAINS_GPT_LIVE || SWIFT_PACKAGE
        case "providers:getRealtimeVoices":
            guard first.string == "codex" else { throw MainsError.server("Voice is available with Codex.") }
            return .object(["voices": .array(Self.sampleVoices.map(JSONValue.string)), "defaultVoice": .string("sol")])
        case "providers:updateRunSettings":
            guard first.string == "codex", let voice = args.dropFirst().first?["realtimeVoice"].string,
                  Self.sampleVoices.contains(voice) else { throw MainsError.server("Choose an available demo voice.") }
            var providers = seed["providers"].array
            guard let index = providers.firstIndex(where: { $0["id"].string == "codex" }) else { throw MainsError.invalidReply }
            var provider = providers[index].objectValue
            var config = provider["config"]?.objectValue ?? [:]
            config["realtimeVoice"] = .string(voice); provider["config"] = .object(config)
            providers[index] = .object(provider)
            var updated = seed.objectValue; updated["providers"] = .array(providers); seed = .object(updated)
            return .object(provider)
#endif

        case "providers:getModels": return seed["models"][first.string ?? ""]
        case "providers:getMobileGoalSummary":
            guard let id = first.string, let goal = goals[id] else { return .null }
            return try .encode(goal)
        case "providers:changeMobileGoal":
            guard let id = first.string, let current = goals[id],
                  runs.contains(where: { $0["id"]?.string == id && $0["isArchived"] != .bool(true) }),
                  let change = args.dropFirst().first, change["expectedRevision"].string == current.revision else {
                throw MainsError.server("Couldn’t change this goal. Check its current state and try again.")
            }
            switch change["action"].string {
            case "edit" where current.status != "complete":
                guard let objective = change["objective"].string, !objective.isEmpty, objective.unicodeScalars.count <= 2048 else { throw MainsError.invalidReply }
                setGoal(id, objective: objective, status: current.status)
            case "pause" where current.status == "active":
                setGoal(id, objective: current.objective, status: "paused", truncated: current.objectiveTruncated == true)
            case "resume" where current.status == "paused":
                setGoal(id, objective: current.objective, status: "active", truncated: current.objectiveTruncated == true)
            case "clear":
                goals[id] = nil
                push("providers:mobileGoalChanged", ["runId": .string(id)])
            default: throw MainsError.server("This goal cannot be changed right now.")
            }
            return .object(["applied": .bool(true)])
        case "providers:getSkills":
            guard seed["providers"].array.contains(where: { $0["id"].string == first.string }) else { throw MainsError.server("Choose a demo provider.") }
            return .object(["skills": .array(DemoContext.skills(workspace: args.dropFirst().first?.string != nil))])
        case "providers:getCommands": return .array(DemoContext.commands)
        case "providers:getCodexPermissions":
            return .object(["profilesSupported": .bool(false), "profiles": .array([]), "requiresNamedProfile": .bool(false),
                            "allowedSandboxModes": .array(["read-only","workspace-write","danger-full-access"].map(JSONValue.string))])
        case "runs:getAll":
            return .array(runs.filter { $0["isArchived"] != .bool(true) }
                .sorted { time($0, "updatedAt") > time($1, "updatedAt") }.prefix(100).map(JSONValue.object))
        case "runs:listPinned":
            return .array(runs.filter { $0["pinnedAt"]?.number != nil && $0["isArchived"] != .bool(true) }
                .sorted { time($0, "pinnedAt") > time($1, "pinnedAt") }.prefix(100).map(JSONValue.object))
        case "runs:listActive":
            return .array(runs.filter { ["running", "queued"].contains($0["status"]?.string ?? "") }.map(JSONValue.object))
        case "runs:getById": return runs.first { $0["id"]?.string == runID }.map(JSONValue.object) ?? .null
        case "runs:getQueue": return .object(["queues": .array([])])
        case "search:conversations": return searchConversations(first)
        case "search:workspaceFiles":
            guard let workspaceID = first["workspaceId"].string,
                  seed["workspaces"].array.contains(where: { $0["id"].string == workspaceID && !$0["isArchived"].bool }),
                  let query = first["query"].string, !query.isEmpty else { return .array([]) }
            return .array(DemoContext.workspaceFiles(query, includeDirectories: first["includeDirectories"].bool))
        case "runs:readTextFile":
            try requireRun(runID)
            guard runs.first(where: { $0["id"]?.string == runID })?["mode"]?.string != "developer",
                  let reference = RunFileReference(first["filePath"].string ?? ""), reference.name == DemoFile.notes.name else { throw MainsError.server("Demo Markdown file not found.") }
            return .object(["fileName": .string(DemoFile.notes.name), "relativePath": .string(DemoFile.notes.name), "content": .string(String(decoding: DemoFile.notes.bytes, as: UTF8.self))])
        case "runs:listPendingApprovals":
            expireApprovals()
            return .array(approvals.values.filter { runID.isEmpty || $0["runId"].string == runID }.sorted { ($0["timestamp"].number ?? 0) < ($1["timestamp"].number ?? 0) })
        case "runs:toolApprovalResponse": return try respondToApproval(first)
        case "runs:decidePlan": return try decidePlan(first)
        case "runs:answerAsyncQuestions": return try answerQuestions(first)
        case "runs:dismissAsyncQuestions":
            try requireRun(runID)
            guard let index = artifacts[runID]?.firstIndex(where: { $0["id"]?.number == first["artifactId"].number && $0["metadata"]?["source"].string == "codex_async_questions" }) else { throw MainsError.server("These demo questions are unavailable.") }
            var metadata = artifacts[runID]![index]["metadata"]?.objectValue ?? [:]
            metadata["asyncQuestionState"] = .object(["dismissed": .bool(true)])
            artifacts[runID]![index]["metadata"] = .object(metadata); push("runs:eventPersisted", ["runId": .string(runID)])
            return .null
        case "runs:getHistory": try requireRun(runID); return try history(first)
        case "runs:readHistoryContent": try requireRun(runID); return try content(first)
        case "space:update":
            guard let index = spaces.firstIndex(where: { $0["id"]?.string == first.string }), args.count > 1,
                  let provider = spaces[index]["providerId"]?.string, let mode = args[1]["mode"].string,
                  Experience.modes(for: provider).contains(mode) else { throw MainsError.server("This demo mode is unavailable.") }
            spaces[index]["mode"] = .string(mode); push("space:changed", ["spaceId": first])
            return .object(spaces[index])
        case "runs:updateConversationSettings":
            guard args.count > 1, let index = runs.firstIndex(where: { $0["id"]?.string == runID }) else { throw MainsError.invalidReply }
            let settings = try args[1].decode(ComposerSettings.self)
            var config = runs[index]["configSnapshot"]?.objectValue ?? [:]
            config["conversationSettings"] = try .encode(settings)
            runs[index]["configSnapshot"] = .object(config); runs[index]["model"] = .string(settings.model)
            push("runs:updated", ["runId": .string(runID)])
            return try .encode(settings)
        case "runs:execute": return try execute(first)
        case "runs:fork": return try fork(first)
        case "runs:continue":
            try requireRun(runID)
            guard !isRunning(runID) else { throw MainsError.server("Wait for the demo reply, or stop it first.") }
            try start(runID, prompt: first["message"].string ?? "", files: first["attachments"].array,
                      promptMetadata: ["skills": first["contextSkills"], "files": first["contextFiles"], "clientUserMessageId": first["clientUserMessageId"], "delivery": .string("queue")])
            return .object(["runId": .string(runID), "resumed": .bool(true)])
        case "runs:inputStatus":
            try requireRun(runID)
            guard let messageID = first["clientUserMessageId"].string, !messageID.isEmpty else { throw MainsError.invalidReply }
            return .object(["accepted": .bool(artifacts[runID]?.contains { $0["metadata"]?["clientUserMessageId"].string == messageID } == true)])
        case "runs:steer":
            try requireRun(runID)
            guard ["codex", "claude_code"].contains(runs.first { $0["id"]?.string == runID }?["providerId"]?.string ?? "") else {
                throw MainsError.server("This provider does not support steering.")
            }
            guard isRunning(runID), let turnID = turns[runID]?.last?["id"],
                  let messageID = first["clientUserMessageId"].string, !messageID.isEmpty else {
                throw MainsError.server("There is no active turn to steer. The message stays queued.")
            }
            try recordPrompt(runID, prompt: first["message"].string ?? "", files: first["attachments"].array,
                             promptMetadata: ["skills": first["contextSkills"], "files": first["contextFiles"], "clientUserMessageId": .string(messageID), "delivery": .string("steer"), "turnId": turnID])
            return .object(["runId": .string(runID), "turnId": .string("demo-turn-\(Int(turnID.number ?? 0))")])
        case "runs:abort":
            try requireRun(runID); finish(runID, status: "canceled")
            return .null
        case "runs:listOutputs":
            try requireRun(runID)
            let requested = first["artifactId"].number
            let items = (outputs[runID] ?? [:]).sorted { $0.key > $1.key }
                .filter { requested == nil || requested == Double($0.key) }
                .map { $0.value.descriptor(runID: runID, artifactID: $0.key) }
            return .object(["items": .array((first["offset"].number ?? 0) > 0 ? [] : items), "nextOffset": .null])
        case "runs:readOutputFile":
            try requireRun(runID)
            let output = try outputFile(runID, artifactID: first["artifactId"].number)
            return try output.file.chunk(first)
        case "runArtifacts:describeAttachmentFile", "runArtifacts:readAttachmentChunk", "runArtifacts:readAttachmentImage":
            try requireRun(runID)
            let id = first["attachmentId"].string ?? ""
            let file = try attachment(runID, id: id)
            if channel == "runArtifacts:describeAttachmentFile" { return file.descriptor(runID: runID, attachmentID: id) }
            if channel == "runArtifacts:readAttachmentChunk" { return try file.chunk(first) }
            guard file.mime.hasPrefix("image/") else { throw MainsError.server("This demo attachment is not an image.") }
            return .object(["mime": .string(file.mime), "base64": .string(file.bytes.base64EncodedString())])
        case "runArtifacts:readImage":
            try requireRun(runID)
            guard let id = first["artifactId"].number, id.isFinite, id >= 0, id < Double(Int.max), id.rounded() == id, let image = images[Int(id)],
                  artifacts[runID]?.contains(where: { $0["id"]?.number == id && $0["kind"]?.string == "image" }) == true else {
                throw MainsError.server("Demo image not found in this conversation.")
            }
            return image
        default: throw MainsError.server("This action is not available in Demo Mode.")
        }
    }

    private func searchConversations(_ payload: JSONValue) -> JSONValue {
        let query = (payload["query"].string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return .object(["items": .array([]), "nextCursor": .null]) }
        let cursor = payload["cursor"]
        let rows = runs.compactMap { run -> (Int, Double, String, JSONValue)? in
            guard run["isArchived"] != .bool(true), run["accountId"] == payload["accountId"], let id = run["id"]?.string else { return nil }
            let title = run["title"]?.string ?? "Untitled chat"
            let message = artifacts[id]?.first { row in
                ["user-prompt", "report", "result"].contains(row["kind"]?.string ?? "") &&
                AgentActivity.foreground(row["metadata"] ?? .null) && !AgentActivity.thinking(kind: row["kind"]?.string ?? "", metadata: row["metadata"] ?? .null) &&
                row["content"]?.string?.localizedCaseInsensitiveContains(query) == true
            }
            let titleMatches = title.localizedCaseInsensitiveContains(query)
            guard titleMatches || message != nil else { return nil }
            let rank = titleMatches ? 2 : 4, created = time(run).rounded(.down)
            if let previousRank = cursor["rank"].number, let previousTime = cursor["createdAt"].number, let previousID = cursor["runId"].string {
                guard Double(rank) > previousRank || Double(rank) == previousRank && (created < previousTime || created == previousTime && id > previousID) else { return nil }
            }
            let workspace = seed["workspaces"].array.first { $0["id"] == run["workspaceId"] }
            let collection = seed["collections"].array.first { $0["id"] == run["collectionId"] }
            let anchor = message.map { JSONValue.object(["timestamp": .number(time($0).rounded(.down)), "source": .string("artifact"), "id": $0["id"] ?? .number(0)]) } ?? .null
            let hit: JSONValue = .object(["runId": .string(id), "title": .string(title), "providerId": run["providerId"] ?? .string("codex"),
                "mode": run["mode"] ?? .string("chat"), "context": workspace?["name"] ?? collection?["name"] ?? .null,
                "updatedAt": .number(time(run, "updatedAt").rounded(.down)), "snippet": message?["content"]?.string.map { .string(String($0.prefix(400))) } ?? .null, "messageCursor": anchor])
            return (rank, created, id, hit)
        }.sorted { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 != $1.1 ? $0.1 > $1.1 : $0.2 < $1.2 }
        let page = Array(rows.prefix(25)), last = page.last
        let next: JSONValue = rows.count > 25 && last != nil ? .object(["rank": .number(Double(last!.0)), "createdAt": .number(last!.1), "runId": .string(last!.2)]) : .null
        return .object(["items": .array(page.map { $0.3 }), "nextCursor": next])
    }

    private func createMate(_ input: JSONValue) throws -> JSONValue {
        guard input["accountId"] == seed["account"]["id"], input["profileSetup"].bool,
              let name = mateText(input["name"], limit: 100),
              let spaceID = input["spaceId"].string,
              let space = spaces.first(where: { $0["id"]?.string == spaceID }),
              let spaceName = space["name"]?.string, let provider = space["providerId"]?.string,
              ["codex", "claude_code"].contains(provider),
              let model = input["model"].string, seed["models"][provider].array.contains(where: { $0["id"].string == model }),
              let effort = input["effort"].string, effort.utf16.count <= 40,
              let avatar = try? input["avatar"].decode(MateAvatar.self),
              mateText(.string(avatar.shape), limit: 100) != nil, mateText(.string(avatar.color), limit: 100) != nil,
              input["teamId"] == .null || input["teamId"].string == Self.mateTeamID else {
            throw MainsError.server("Choose a name, a demo model and an avatar to create this Mate.")
        }
        guard mates.count < 200 else { throw MainsError.server("Exit and reopen Demo Mode to reset the sample Mates.") }
        let id = "demo-mate-" + UUID().uuidString.lowercased()
        mates.append(DemoMate(id: id, name: name, spaceID: spaceID, spaceName: spaceName, providerID: provider,
                              model: model, effort: effort, teamID: input["teamId"].string, avatar: avatar, setup: .init()))
        return .object(["id": .string(id)])
    }

    private func setupMate(_ args: [JSONValue]) throws -> JSONValue {
        guard args.count == 3, args[0] == seed["account"]["id"], let id = args[1].string,
              let index = mates.firstIndex(where: { $0.id == id }),
              var setup = mates[index].setup, mates[index].profile == nil else {
            throw MainsError.server("This demo profile setup is no longer active.")
        }
        let input = args[2]
        switch input["action"].string {
        case "answer":
            guard input["step"].number == 0, setup.answer == nil, let answer = mateText(input["answer"], limit: 24_000) else {
                throw MainsError.server("Enter an answer to the current setup question.")
            }
            let summary = answer.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            setup.answer = answer
            setup.draft = MateProfile(description: String(summary.unicodeScalars.prefix(180)),
                                      instructions: "Use this role when helping in Demo Mode:\n\n" + String(answer.unicodeScalars.prefix(4_000)))
            mates[index].setup = setup
        case "save":
            guard setup.draft != nil, let description = mateText(input["profile"]["description"], limit: 1_000),
                  let instructions = mateText(input["profile"]["instructions"], limit: 16_000) else {
                throw MainsError.server("Complete the profile description and instructions before saving.")
            }
            mates[index].profile = MateProfile(description: description, instructions: instructions)
            setup.draft = nil
            mates[index].setup = setup
        default:
            throw MainsError.server("This demo profile setup action is unavailable.")
        }
        return .null
    }

    private func mateText(_ value: JSONValue, limit: Int) -> String? {
        guard let text = value.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty, text.utf16.count <= limit else { return nil }
        return text
    }

    private func sendMate(_ input: JSONValue) throws -> JSONValue {
        guard input["accountId"] == seed["account"]["id"], let id = input["assistantId"].string,
              let index = mates.firstIndex(where: { $0.id == id }), mates[index].profile != nil,
              let message = input["message"].string else {
            throw MainsError.server("Finish setting up this demo Mate before sending a message.")
        }
        let mate = mates[index]
        if let requested = input["runId"].string {
            guard requested == mate.welcomeRunID, input["requestId"].string == requested else {
                throw MainsError.server("This demo Mate’s first chat has already started.")
            }
        }
        let result = try executeMate(mate, prompt: message, context: input["context"], runID: mate.welcomeRunID)
        mates[index].setup = nil
        push("assistants:changed", [:])
        return result
    }

    private func executeMate(_ mate: DemoMate, title: String? = nil, prompt: String, context: JSONValue = .null,
                             runID: String?) throws -> JSONValue {
        var settings = ComposerSettings.defaults(provider: mate.providerID, model: mate.model, config: [:])
        settings.setEffort(mate.effort, provider: mate.providerID)
        let payload: JSONValue = .object(["spaceId": .string(mate.spaceID), "goal": .string(prompt),
            "title": title.map(JSONValue.string) ?? .null, "conversationSettings": try .encode(settings),
            "attachments": context["attachments"], "contextSkills": context["contextSkills"]])
        return try execute(payload, mateID: mate.id, reservedRunID: runID)
    }

    private func readMateAssignments(_ args: [JSONValue]) throws -> JSONValue {
        guard args.count == 3, args[0] == seed["account"]["id"], let mate = mates.first(where: { $0.id == args[1].string }) else {
            throw MainsError.server("This demo Mate is unavailable.")
        }
        let tasks = assignments.filter { $0.mateID == mate.id }
        let assignee = JSONValue.object(["id": .string(mate.id), "name": .string(mate.name),
                                        "avatar": try .encode(mate.avatar), "isArchived": .bool(false)])
        func projection(_ assignment: DemoAssignment, detailed: Bool) -> JSONValue {
            let runIsAvailable = runs.contains { $0["id"]?.string == assignment.runID && $0["isArchived"] != .bool(true) }
            let brief = detailed ? assignment.brief : String(assignment.brief.unicodeScalars.prefix(240))
            return .object(["id": .string(assignment.id), "title": .string(assignment.title), "brief": .string(brief),
                            "status": .string(assignment.status.rawValue), "assignee": assignee, "evidence": .array([]),
                            "workerRunId": runIsAvailable ? .string(assignment.runID) : .null,
                            "result": assignment.status == .completed ? .string(Self.mateAssignmentResult) : .null])
        }
        if let id = args[2].string {
            guard let task = tasks.first(where: { $0.id == id }) else { throw MainsError.server("Demo assignment not found.") }
            return projection(task, detailed: true)
        }
        guard let number = args[2].number, let offset = Int(exactly: number), offset >= 0 else { throw MainsError.invalidReply }
        let remaining = tasks.dropFirst(min(offset, tasks.count))
        return .object(["items": .array(remaining.prefix(100).map { projection($0, detailed: false) }),
                        "activeCount": .number(Double(tasks.filter { $0.status == .running }.count)),
                        "hasMore": .bool(remaining.count > 100)])
    }

    private func manageMateAssignment(_ args: [JSONValue]) throws -> JSONValue {
        guard args.count == 4, args[0] == seed["account"]["id"],
              let mate = mates.first(where: { $0.id == args[1].string && $0.profile != nil }) else {
            throw MainsError.server("Finish setting up this demo Mate before assigning work.")
        }
        let change = args[2]
        switch change["action"].string {
        case "assign":
            guard let title = mateText(change["title"], limit: 200), let brief = mateText(change["prompt"], limit: 24_000) else {
                throw MainsError.server("Enter a title and a brief for the demo assignment.")
            }
            guard assignments.count < 100 else { throw MainsError.server("Exit and reopen Demo Mode to reset assignments.") }
            let assignment = DemoAssignment(id: "demo-assignment-" + UUID().uuidString.lowercased(), mateID: mate.id,
                                            runID: "demo-run-" + UUID().uuidString.lowercased(), title: title, brief: brief)
            assignments.insert(assignment, at: 0)
            do { _ = try executeMate(mate, title: title, prompt: brief, runID: assignment.runID) }
            catch { assignments.removeFirst(); throw error }
        case "cancelTask":
            guard let assignment = assignments.first(where: { $0.id == change["id"].string && $0.mateID == mate.id }),
                  assignment.status != .completed else { throw MainsError.server("This demo assignment can no longer be canceled.") }
            if assignment.status == .running { finish(assignment.runID, status: "canceled") }
        default:
            throw MainsError.server("This action is unavailable in demo assignments.")
        }
        return .object(["accepted": .bool(true)])
    }

    private func execute(_ payload: JSONValue, mateID: String? = nil, reservedRunID: String? = nil) throws -> JSONValue {
        guard runs.filter({ $0["status"]?.string == "running" }).count < 8 else {
            throw MainsError.server("Finish or stop a demo reply before starting another.")
        }
        guard let space = spaces.first(where: { $0["id"]?.string == payload["spaceId"].string }) else { throw MainsError.server("Choose a demo space.") }
        let id = reservedRunID ?? "demo-run-" + UUID().uuidString.lowercased()
        let settings = payload["conversationSettings"] == .null
            ? JSONValue.object(["model": space["model"] ?? .string(""), "config": .object([:])]) : payload["conversationSettings"]
        let run: [String: JSONValue] = [
            "id": .string(id), "accountId": seed["account"]["id"], "providerId": space["providerId"] ?? .string("codex"),
            "spaceId": space["id"]!, "mode": mateID == nil ? space["mode"] ?? .string("chat") : .string("work"), "workspaceId": payload["workspaceId"],
            "assistantId": mateID.map(JSONValue.string) ?? .null,
            "collectionId": payload["collectionId"], "model": settings["model"], "configSnapshot": .object(["conversationSettings": settings]),
            "title": .string(String((payload["title"].string ?? payload["goal"].string ?? "Demo conversation").prefix(56))),
            "status": .string("succeeded"), "isArchived": .bool(false), "isReplica": .bool(false),
            "lastError": .null, "createdAt": Self.now, "updatedAt": Self.now,
        ]
        runs.append(run); artifacts[id] = []; tools[id] = []; turns[id] = []
        do { try start(id, prompt: payload["goal"].string ?? "", files: payload["attachments"].array, promptMetadata: ["skills": payload["contextSkills"], "files": payload["contextFiles"]]) }
        catch { runs.removeAll { $0["id"]?.string == id }; artifacts[id] = nil; tools[id] = nil; turns[id] = nil; throw error }
        trimRuns()
        return .object(["runId": .string(id)])
    }

    private func fork(_ payload: JSONValue) throws -> JSONValue {
        guard let sourceID = payload["sourceRunId"].string,
              var source = runs.first(where: { $0["id"]?.string == sourceID }), source["accountId"] == payload["accountId"],
              source["isReplica"] != .bool(true), source["isArchived"] != .bool(true), !isRunning(sourceID) else {
            throw MainsError.server("Fork a finished, local demo conversation.")
        }
        guard runs.filter({ $0["status"]?.string == "running" }).count < 8 else { throw MainsError.server("Finish a demo reply before starting another.") }
        let id = "demo-run-" + UUID().uuidString.lowercased()
        source["id"] = .string(id); source["status"] = .string("succeeded")
        source["title"] = .string("Fork of " + (source["title"]?.string ?? "conversation"))
        source["createdAt"] = Self.now; source["updatedAt"] = Self.now; source["endedAt"] = .null; source["lastError"] = .null
        runs.append(source); artifacts[id] = []; tools[id] = []; turns[id] = []
        do { try start(id, prompt: payload["message"].string ?? "", files: []) }
        catch { runs.removeAll { $0["id"]?.string == id }; artifacts[id] = nil; tools[id] = nil; turns[id] = nil; throw error }
        trimRuns()
        return .object(["runId": .string(id), "sourceRunId": .string(sourceID)])
    }

    private func recordPrompt(_ runID: String, prompt: String, files: [JSONValue], promptMetadata: [String: JSONValue]) throws {
        guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !files.isEmpty, prompt.count <= 32_000 else {
            throw MainsError.server("Write a demo message under 32,000 characters or attach a file.")
        }
        guard (artifacts[runID]?.count ?? 0) < 200, files.count <= 5 else { throw MainsError.server("Start a new demo conversation to continue.") }
        let uploaded = try files.map { file -> DemoFile in
            guard let data = file["data"].string, data.utf8.count <= 2_800_000, let bytes = Data(base64Encoded: data), bytes.count <= 2 * 1024 * 1024 else {
                throw MainsError.server("Demo attachments must total 2 MB or less.")
            }
            let mime = file["mimeType"].string ?? "application/octet-stream"
            let preview = mime.hasPrefix("image/") ? "image" : mime == "application/pdf" ? "pdf" : mime.contains("markdown") ? "markdown" : mime.hasPrefix("text/") ? "text" : "unsupported"
            return DemoFile(name: TranscriptMedia.fileName(file["name"].string ?? "Attachment"), mime: mime, preview: preview,
                            bytes: bytes, version: UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased() + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())
        }
        let bytes = uploaded.reduce(0) { $0 + $1.bytes.count }
        guard bytes <= 2 * 1024 * 1024, attachmentBytes + bytes <= 8 * 1024 * 1024 else {
            throw MainsError.server("The demo attachment budget is full. Exit and reopen Demo Mode to reset it.")
        }
        var references: [JSONValue] = []
        for file in uploaded {
            attachments[runID + ":" + file.version] = file; references.append(attachmentMetadata(file.version, file: file))
        }
        attachmentBytes += bytes
        append(runID, kind: "user-prompt", text: prompt, metadata: promptMetadata.merging(["source": .string("user"), "attachments": .array(references)]) { existing, _ in existing })
    }

    private func start(_ runID: String, prompt: String, files: [JSONValue], promptMetadata: [String: JSONValue] = [:]) throws {
        try recordPrompt(runID, prompt: prompt, files: files, promptMetadata: promptMetadata)
        if let index = runs.firstIndex(where: { $0["id"]?.string == runID }) {
            runs[index]["status"] = .string("running"); runs[index]["updatedAt"] = Self.now; runs[index]["endedAt"] = .null
            let run = JSONValue.object(runs[index])
            let objective = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
            if run["providerId"].string == "codex", run["mode"].string != "chat",
               run["configSnapshot"]["conversationSettings"]["config"]["goalMode"].bool, !objective.isEmpty,
               goals[runID] == nil || goals[runID]?.status == "complete" {
                setGoal(runID, objective: objective, status: "active")
            }
            let count = turns[runID]?.count ?? 0
            turns[runID, default: []].append(["id": .number(Double(takeID())), "turnIndex": .number(Double(count)),
                "status": .string("active"), "model": runs[index]["model"] ?? .null, "startedAt": Self.now, "createdAt": Self.now])
        }
        let contextNames = promptMetadata["skills"]?.array.compactMap { $0["displayName"].string ?? $0["name"].string } ?? []
        let steps: [Step]
        if let run = runs.first(where: { $0["id"]?.string == runID }), run["providerId"]?.string == "codex",
           run["configSnapshot"]?["conversationSettings"]["config"]["planMode"].bool == true {
            steps = [.tool("Read", .object(["file_path": .string("Sources/MainsApp/HomeView.swift")]), .string("Read bundled demo source.")),
                .tool("Plan", .object(["plan": .string("## Review the sample workspace\n\n1. Inspect `HomeView.swift`.\n2. Review the shared composer.\n3. Verify the conversation flow.")]),
                      .object(["planStatus": .string("pending")])), .finish]
        } else if assignments.contains(where: { $0.runID == runID && $0.status == .running }) {
            steps = [
                .thinking("Reviewing the assignment brief"),
                .tool("Read", .object(["file_path": .string("/Demo/mains/demo-notes.md")]), .string("Reviewed bundled sample notes.")),
                .thinking("Preparing the sample report"),
                .tool("Write", .object(["file_path": .string("/Demo/mains/mate-assignment-report.md")]), .string("Prepared the sample Markdown report.")),
                .text("The demo assignment is complete. Open **mate-assignment-report.md** below to see the sample output."),
                .finish,
            ]
        } else if !contextNames.isEmpty || prompt.hasPrefix("/review") {
            steps = [.text("## Demo context received\n\n" + (contextNames.isEmpty ? "The /review command is included in your message." : "Selected context: **" + contextNames.joined(separator: ", ") + "**.") + "\n\nThe composer sent the canonical skill names and their metadata with this request. This is a prepared on-device demonstration; no plugin, command or AI service was executed."), .finish]
        } else {
            let run = runs.first { $0["id"]?.string == runID }
            if let mateID = run?["assistantId"]?.string, let mate = mates.first(where: { $0.id == mateID }) {
                let reply: String
                if mateID == Self.mateID {
                    reply = "## Sample release review\n\nBefore sharing the iPhone build, verify pairing, open an example file, and confirm that approvals appear in Activity. This is a prepared Demo Mode reply."
                } else {
                    reply = "## Sample Mate reply\n\nI received your request. This demo conversation uses the role you approved:\n\n\(mate.profile?.description ?? "")\n\nThis is a prepared reply on your iPhone."
                }
                steps = [.text(reply), .finish]
            } else {
                steps = scenario(prompt, hasAttachments: !files.isEmpty, mode: run?["mode"]?.string ?? "chat")
            }
        }
        replays[runID] = Replay(steps: steps)
        push("runs:statusChanged", ["runId": .string(runID), "status": .string("running")]); resume(runID)
    }

    private func scenario(_ prompt: String, hasAttachments: Bool, mode: String) -> [Step] {
        if prompt.localizedCaseInsensitiveContains("subagent") || prompt.localizedCaseInsensitiveContains("alt ajan") {
            return [.text("I’ll review the bundled sample with two simulated agents: Security and Tests. Open the agents button above the composer to inspect their activity."),
                .subagents(0), .subagents(1), .subagents(2),
                .text("## Sample reviews complete\n\n**Security:** check credential ownership and memory-only previews.\n\n**Tests:** cover reconnection, receipt deduplication and bounded history.\n\nBoth prepared reports are available in **2 agents**. No provider or external service was contacted."), .finish]
        }
        if prompt.localizedCaseInsensitiveContains("Markdown formatting") {
            return [.text("""
            ## Markdown formatting

            This **prepared demo** includes *emphasis*, ~~removed text~~, `inline code` and a [link](https://mains.dev).

            | Time | From | Email |
            |:---|:---|:---|
            | 08:22 | Google Play | [Terms of Service updates](https://example.com/terms) |
            | 08:03 | Reflect Studio | **Extra 11% discount** at checkout. |

            - [x] Completed task
            - [ ] Next task

            > A multi-line quote
            > with **formatted text**.

            ```swift
            let demo = "On this iPhone"
            ```
            """), .finish]
        }
        if mode != "chat", prompt.localizedCaseInsensitiveContains("file changes") || prompt.localizedCaseInsensitiveContains("dosya değişiklik") {
            return [
                .text("I’ll show a prepared patch with modified, added, renamed and binary files. No files on your computer or phone are changed."),
                .tool("Edit", .object(["file_path": .string("/Demo/mains/Sources/Greeting.swift"), "old_string": .string("Hello"), "new_string": .string("Hello from Mains")]), .string("Sample edit prepared.")),
                .changes,
                .text("## Sample changes ready\n\nOpen a file in **Edited 4 files** below. **Review.md** has multiple diff pages, **guide.md** was renamed, and **sample.png** shows the binary-file notice. These are bundled examples, not real file changes."),
                .finish,
            ]
        }
        if prompt.localizedCaseInsensitiveContains("approvals and questions") || prompt.localizedCaseInsensitiveContains("onay ve soru") {
            return decisionScenario()
        }
        let request = String(prompt.replacingOccurrences(of: "\n", with: " ").prefix(90))
        let issue = ["bug","error","crash","stuck","hata","sorun"].contains { prompt.localizedCaseInsensitiveContains($0) }
        return [
            .thinking("Reviewing the sample workspace"),
            .text("I’ll \(issue ? "trace the issue" : "review your request") using the bundled sample workspace. This is a simulated demo: your message and files stay on this iPhone."),
            .tool("Glob", .object(["pattern": .string("Sources/**/*.swift")]), .string("Sources/MainsApp/HomeView.swift\nSources/MainsCore/BackendSession.swift")),
            .tool("Read", .object(["file_path": .string("/Demo/mains/Sources/MainsCore/BackendSession.swift")]),
                  .string("The session connects the sidebar, composer, bounded history and live messages.")),
            .thinking("Preparing the sample result"),
            .text("## Demo result\n\nFor **\(request)**, the sample workspace shows how Mains keeps conversations, model settings and tool activity together.\n\n- **\(issue ? "Investigation" : "Review"):** inspected bundled sample files.\n- **Privacy:** no computer, external account or AI service was contacted.\n\(hasAttachments ? "- **Attachments:** your files are available in this conversation for on-device preview.\n" : "")\nYou can continue this conversation, change providers, or open the sample image and PDF in **Explore Mains**. This is a prepared demonstration, not an AI-generated answer."),
            .finish,
        ]
    }

    private func decidePlan(_ request: JSONValue) throws -> JSONValue {
        guard let runID = request["runId"].string, let runIndex = runs.firstIndex(where: { $0["id"]?.string == runID }),
              runs[runIndex]["accountId"] == request["accountId"], let decision = request["decision"].string.flatMap(PlanProposal.Decision.init),
              let planIndex = tools[runID]?.lastIndex(where: { $0["toolName"]?.string == "Plan" }),
              tools[runID]?[planIndex]["id"] == request["toolCallId"] else { throw MainsError.invalidReply }
        var metadata = tools[runID]?[planIndex]["metadata"]?.objectValue ?? [:]
        let status = decision.status.rawValue
        if metadata["planStatus"]?.string == status { return .object(["status": .string(status)]) }
        guard !request["checkOnly"].bool else { throw MainsError.server("Plan delivery has not been confirmed yet.") }
        guard metadata["planStatus"] == nil, !isRunning(runID) else { throw MainsError.server("This demo plan is no longer pending.") }
        if decision == .apply {
            let before = runs[runIndex]["configSnapshot"]
            var snapshot = before?.objectValue ?? [:]
            var settings = snapshot["conversationSettings"]?.objectValue ?? [:]
            var config = settings["config"]?.objectValue ?? [:]
            config["planMode"] = .bool(false); settings["config"] = .object(config)
            snapshot["conversationSettings"] = .object(settings); runs[runIndex]["configSnapshot"] = .object(snapshot)
            do { try start(runID, prompt: "Execute the plan above.", files: []) }
            catch { runs[runIndex]["configSnapshot"] = before; throw error }
        }
        metadata["planStatus"] = .string(status); tools[runID]![planIndex]["metadata"] = .object(metadata)
        push("runs:eventPersisted", ["runId": .string(runID)])
        return .object(["status": .string(status)])
    }

    private func resume(_ runID: String) {
        guard emit != nil, tasks[runID] == nil, let replay = replays[runID], replay.waitingFor == nil else { return }
        tasks[runID] = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, let replay = self.replays[runID], replay.index < replay.steps.count else { return }
                let delay: Duration
                if case .text = replay.steps[replay.index] { delay = self.streamDelay }
                else { delay = replay.activeToolID != nil || replay.count > 0 ? self.stepDelay * 2 : self.stepDelay }
                do { try await Task.sleep(for: delay) } catch { return }
                guard !Task.isCancelled, self.emit != nil, self.isRunning(runID) else { return }
                self.advance(runID)
            }
        }
    }
    private func advance(_ runID: String) {
        guard var replay = replays[runID], replay.index < replay.steps.count else { return }
        switch replay.steps[replay.index] {
        case .thinking(let text):
            let provider = runs.first { $0["id"]?.string == runID }?["providerId"]?.string
            push("runs:ephemeralEvent", ["runId": .string(runID), "event": .object([
                "type": .string("artifact"), "kind": .string(provider == "claude_code" ? "report" : "thinking"),
                "streamId": .string("demo-thinking-" + replay.streamID), "content": .string(replay.count == 0 ? text : ""),
                "metadata": .object(["source": .string(provider == "copilot_cli" ? "assistant.reasoning_delta" : "agent_thinking_streaming")]),
            ])])
            if replay.count == 0 { replay.count = 1 }
            else { replay.count = 0; replay.index += 1; replay.streamID = UUID().uuidString }
        case .text(let text):
            replay.count = min(text.count, replay.count + 24)
            let final = replay.count == text.count
            push("runs:ephemeralEvent", ["runId": .string(runID), "event": .object([
                "type": .string("artifact"), "kind": .string("report"), "streamId": .string(replay.streamID),
                "content": .string(String(text.prefix(replay.count))),
                "metadata": .object(["source": .string("agent_message_streaming"), "streaming": .bool(!final)]),
            ])])
            if final {
                append(runID, kind: "report", text: text, metadata: ["source": .string("assistant.message"), "streamId": .string(replay.streamID)])
                replay.index += 1; replay.count = 0; replay.streamID = UUID().uuidString
            }
        case .tool(let name, let input, let output):
            if let id = replay.activeToolID, let index = tools[runID]?.firstIndex(where: { $0["id"]?.number == Double(id) }) {
                tools[runID]![index]["status"] = .string("done"); tools[runID]![index]["output"] = output; tools[runID]![index]["endedAt"] = Self.now
                replay.activeToolID = nil; replay.index += 1
            } else {
                let id = takeID(); replay.activeToolID = id
                tools[runID, default: []].append(["id": .number(Double(id)), "runId": .string(runID),
                    "toolName": .string(name), "status": .string("running"), "input": input, "output": .null,
                    "createdAt": Self.now, "startedAt": Self.now, "endedAt": .null, "error": .null])
            }
            push("runs:eventPersisted", ["runId": .string(runID)])
        case .approval(let template):
            replay.waitingFor = .approval; replay.index += 1
            replays[runID] = replay; tasks.removeValue(forKey: runID)?.cancel()
            requestApproval(template, runID: runID, expiresAt: Date().addingTimeInterval(decisionLifetime))
            return
        case .questions:
            append(runID, kind: "report", text: "Choose the next step in the question card below.", metadata: [
                "source": .string("codex_async_questions"), "questions": .array([
                    .object(["title": .string("What should we focus on next?"), "options": .array([.string("Interface"), .string("Functionality")])]),
                    .object(["title": .string("Any details to keep in mind?"), "options": .null]),
                ]),
            ])
            finish(runID, status: "succeeded"); return
        case .changes:
            if let turnID = turns[runID]?.last?["id"]?.number { installChanges(runID, turnID: Int(turnID)) }
            replay.index += 1
        case .subagents(let stage):
            if replay.count == 0 {
                if replay.agentBaseID == nil {
                    replay.agentBaseID = takeID(); for _ in 0..<5 { _ = takeID() }
                    replay.agentsStartedAt = Date().timeIntervalSince1970 * 1000
                }
                if let base = replay.agentBaseID, let at = replay.agentsStartedAt {
                    installSubagents(runID, baseID: base, at: at, stage: stage)
                }
            }
            replay.count += 1
            if replay.count >= 4 { replay.count = 0; replay.index += 1 }
        case .finish: finish(runID, status: "succeeded"); return
        }
        replays[runID] = replay
    }
    private func finish(_ runID: String, status: String) {
        tasks.removeValue(forKey: runID)?.cancel(); replays[runID] = nil
        for index in tools[runID]?.indices ?? 0..<0 where ["running", "queued"].contains(tools[runID]![index]["status"]?.string ?? "") {
            tools[runID]![index]["status"] = .string(status == "succeeded" ? "done" : "canceled")
            tools[runID]![index]["endedAt"] = Self.now
        }
        for request in approvals.values.filter({ $0["runId"].string == runID }) {
            if let id = request["requestId"].string {
                approvals[id] = nil; approvalTimers.removeValue(forKey: id)?.cancel()
                push("runs:toolApprovalResolved", ["requestId": .string(id), "approvalToken": request["approvalToken"]])
            }
        }
        if let index = runs.firstIndex(where: { $0["id"]?.string == runID }) {
            runs[index]["status"] = .string(status); runs[index]["updatedAt"] = Self.now; runs[index]["endedAt"] = Self.now
        }
        if let last = turns[runID]?.indices.last {
            turns[runID]![last]["status"] = .string(status == "succeeded" ? "completed" : "canceled")
            turns[runID]![last]["endedAt"] = Self.now
        }
        if status == "succeeded", let goal = goals[runID], goal.status == "active" {
            setGoal(runID, objective: goal.objective, status: "complete", truncated: goal.objectiveTruncated == true)
        }
        finishMateAssignment(runID, succeeded: status == "succeeded")
        push("runs:statusChanged", ["runId": .string(runID), "status": .string(status)])
    }

    private func finishMateAssignment(_ runID: String, succeeded: Bool) {
        guard let index = assignments.firstIndex(where: { $0.runID == runID && $0.status == .running }) else { return }
        if succeeded {
            let assignment = assignments[index]
            let file = DemoFile.assignmentReport(title: assignment.title, brief: assignment.brief)
            let id = takeID()
            outputs[runID, default: [:]][id] = file
            artifacts[runID, default: []].append(documentArtifact(id: id, runID: runID, file: file, at: Self.now))
        }
        assignments[index].status = succeeded ? .completed : .canceled
        push("assistants:changed", [:])
    }

    private func setGoal(_ runID: String, objective: String, status: String, truncated: Bool = false) {
        let revision = SHA256.hash(data: Data(UUID().uuidString.utf8)).map { String(format: "%02x", $0) }.joined()
        let text = String(objective.unicodeScalars.prefix(2048))
        goals[runID] = MobileGoalSummary(objective: text, status: status, tokensUsed: nil, timeUsedSeconds: nil,
                                         revision: revision, objectiveTruncated: truncated || text != objective)
        push("providers:mobileGoalChanged", ["runId": .string(runID)])
    }

    private func decisionScenario() -> [Step] {
        [
            .text("This walkthrough uses the same approval and question cards as a paired computer. Nothing leaves this iPhone, and no command or external service is used."),
            .approval(sampleCheckApproval(message: "Allow this sample workspace check?")),
            .approval(.object(["kind": .string("ask_user"), "toolName": .string("AskUserQuestion"), "header": .string("Choose a review style"),
                "question": .string("Which sample result would you like?"), "multiSelect": .bool(true), "isOther": .bool(true),
                "options": .array([.object(["label": .string("Review only"), "description": .string("Inspect the bundled sample.")]),
                                   .object(["label": .string("Make a plan"), "description": .string("Show suggested next steps.")])])])),
            .approval(.object(["kind": .string("elicitation"), "toolName": .string("Demo form"), "header": .string("Sample project details"),
                "elicitationMode": .string("form"), "requestedSchema": .object([
                    "type": .string("object"), "required": .array([.string("project")]), "properties": .object([
                        "project": .object(["type": .string("string"), "title": .string("Project name"), "minLength": .number(2)]),
                        "notifications": .object(["type": .string("boolean"), "title": .string("Send sample notifications"), "default": .bool(false)]),
                        "priority": .object(["type": .string("string"), "title": .string("Priority"), "enum": .array([.string("normal"), .string("high")]), "default": .string("normal")]),
                    ]),
                ])])),
            .approval(.object(["kind": .string("elicitation"), "toolName": .string("Demo connection"), "header": .string("Connect a sample service"),
                "elicitationMode": .string("url"), "url": .string("https://example.com/demo-connect"),
                "description": .string("In Demo Mode this opens an on-device explanation instead of a browser.")])),
            .questions,
        ]
    }

    private func sampleCheckApproval(message: String) -> JSONValue {
        .object(["kind": .string("tool_approval"), "toolName": .string("Bash"), "toolInput": .object([
            "message": .string(message), "command": .string("/bin/zsh -lc \"swift test\""),
            "cwd": .string("/Demo/mains"), "environmentId": .string("local"),
            "commandActions": .array([.object(["command": .string("swift test"), "type": .string("unknown")])]),
            "_meta": .object(["subtitle": .string("A simulated command; no process will start."), "riskLevel": .string("low")]),
        ])])
    }

    private func requestApproval(_ template: JSONValue, runID: String, expiresAt: Date) {
        let id = UUID().uuidString
        let request = JSONValue.object(template.objectValue.merging([
            "requestId": .string(id), "approvalToken": .string(UUID().uuidString), "runId": .string(runID),
            "timestamp": Self.now, "expiresAt": .number(expiresAt.timeIntervalSince1970 * 1000),
        ]) { _, next in next })
        approvals[id] = request
        armExpiry(request)
        push("runs:toolApprovalRequest", request.objectValue)
    }

    private func respondToApproval(_ payload: JSONValue) throws -> JSONValue {
        guard let id = payload["requestId"].string, let request = approvals[id], request["approvalToken"] == payload["approvalToken"],
              let runID = request["runId"].string, (request["expiresAt"].number ?? 0) > Date().timeIntervalSince1970 * 1000,
              isRunning(runID) else { throw MainsError.server("This demo request expired or has already been answered.") }
        let approval = try request.decode(PendingApproval.self)
        if payload["approved"].bool {
            if approval.kind == "ask_user", (payload["answer"].string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw MainsError.server("Choose an answer first.") }
            if approval.isForm {
                guard let text = payload["answer"].string, let bytes = text.data(using: .utf8), let content = try? JSONDecoder().decode(JSONValue.self, from: bytes),
                      ElicitationForm(schema: approval.requestedSchema).validate(content).isEmpty else { throw MainsError.server("Complete the sample form.") }
            }
        }
        resolveApproval(request, message: payload["approved"].bool
            ? (approval.kind == "tool_approval" ? "Sample command approved. No command was executed." : approval.isForm ? "Sample form submitted on this iPhone." : "Your sample answer was received.")
            : "Sample request declined. No action was taken.")
        return .null
    }

    private func resolveApproval(_ request: JSONValue, message: String) {
        guard let id = request["requestId"].string, let runID = request["runId"].string else { return }
        approvals[id] = nil; approvalTimers.removeValue(forKey: id)?.cancel()
        push("runs:toolApprovalResolved", ["requestId": .string(id), "approvalToken": request["approvalToken"]])
        append(runID, kind: "report", text: message, metadata: [:])
        if replays[runID]?.waitingFor == .approval {
            replays[runID]?.waitingFor = nil
            resume(runID)
        }
    }

    private func armExpiry(_ request: JSONValue) {
        guard let id = request["requestId"].string, let expiry = request["expiresAt"].number,
              expiry < Date.distantFuture.timeIntervalSince1970 * 1000 else { return }
        approvalTimers[id]?.cancel()
        approvalTimers[id] = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(max(0, expiry / 1000 - Date().timeIntervalSince1970))) } catch { return }
            self?.expireApprovals()
        }
    }
    private func expireApprovals() {
        for request in approvals.values.filter({ ($0["expiresAt"].number ?? 0) <= Date().timeIntervalSince1970 * 1000 }) {
            resolveApproval(request, message: "The sample request expired without an answer. No action was taken.")
        }
    }

    private func answerQuestions(_ payload: JSONValue) throws -> JSONValue {
        let runID = payload["runId"].string ?? ""
        try requireRun(runID)
        guard let index = artifacts[runID]?.firstIndex(where: { $0["id"]?.number == payload["artifactId"].number && $0["metadata"]?["source"].string == "codex_async_questions" }) else {
            throw MainsError.server("These sample questions are unavailable.")
        }
        var metadata = artifacts[runID]![index]["metadata"]?.objectValue ?? [:]
        if let answer = metadata["asyncQuestionAnswer"] { return .object(["accepted": .bool(true), "answer": answer]) }
        if payload["checkOnly"].bool { return .object(["accepted": .bool(false)]) }
        let allArtifacts = try JSONValue.array((artifacts[runID] ?? []).map(JSONValue.object)).decode([Artifact].self)
        guard let pending = PendingAsyncQuestions.latest(in: allArtifacts), Double(pending.artifactID) == payload["artifactId"].number,
              !isRunning(runID) else { throw MainsError.server("These sample questions have already moved on.") }
        let answers = payload["answers"].array.compactMap(\.string).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard answers.count == pending.questions.count, answers.allSatisfy({ !$0.isEmpty }) else { throw MainsError.server("Answer every sample question.") }
        let reply: JSONValue = .object(["artifactId": .number(Double(pending.artifactID)), "answers": .array(answers.map(JSONValue.string))])
        let messageID = "codex-async-answer-\(pending.artifactID)"
        var answer = reply.objectValue; answer["clientUserMessageId"] = .string(messageID)
        let prompt = zip(pending.questions, answers).map { "\($0.0.title)\n\n\($0.1)" }.joined(separator: "\n\n---\n\n")
        try start(runID, prompt: prompt, files: [], promptMetadata: ["clientUserMessageId": .string(messageID), "asyncQuestionReply": reply])
        metadata["asyncQuestionAnswer"] = .object(answer); artifacts[runID]![index]["metadata"] = .object(metadata)
        push("runs:eventPersisted", ["runId": .string(runID)])
        return .object(["accepted": .bool(true), "answer": .object(answer)])
    }

    private func append(_ runID: String, kind: String, text: String, metadata: [String: JSONValue]) {
        artifacts[runID, default: []].append(["id": .number(Double(takeID())), "runId": .string(runID), "kind": .string(kind),
                                            "content": .string(text), "metadata": .object(metadata), "createdAt": Self.now, "path": .null])
        if let index = runs.firstIndex(where: { $0["id"]?.string == runID }) { runs[index]["updatedAt"] = Self.now }
        push("runs:eventPersisted", ["runId": .string(runID)])
    }
    private func attachmentMetadata(_ id: String, file: DemoFile) -> JSONValue {
        .object(["attachmentId": .string(id), "name": .string(file.name), "type": .string(file.mime.hasPrefix("image/") ? "image" : "document"),
                 "mimeType": .string(file.mime), "byteSize": .number(Double(file.bytes.count))])
    }
    private func outputFile(_ runID: String, artifactID: Double?) throws -> (id: Int, file: DemoFile) {
        guard let artifactID, let id = Int(exactly: artifactID), let file = outputs[runID]?[id] else {
            throw MainsError.server("Demo output not found.")
        }
        return (id, file)
    }
    private func attachment(_ runID: String, id: String) throws -> DemoFile {
        guard artifacts[runID]?.contains(where: { ($0["metadata"]?["attachments"].array ?? []).contains { $0["attachmentId"].string == id } }) == true else {
            throw MainsError.server("Demo attachment not found in this conversation.")
        }
        if id == Self.pdfAttachmentID { return .pdf }
        if id == Self.imageAttachmentID, let image = images[9_000_003], let bytes = Data(base64Encoded: image["base64"].string ?? "") {
            return DemoFile(name: "demo-image.jpg", mime: image["mime"].string ?? "image/jpeg", preview: "image", bytes: bytes, version: id)
        }
        guard let file = attachments[runID + ":" + id] else { throw MainsError.server("Demo attachment not found.") }
        return file
    }
    private func manageDemoWorkspace(_ id: String, change: JSONValue) throws -> JSONValue {
        var workspaces = seed["workspaces"].array.map(\.objectValue)
        var states = seed["gitStates"].array.map(\.objectValue)
        guard let index = workspaces.firstIndex(where: { $0["id"] == .string(id) }),
              workspaces[index]["isArchived"] != .bool(true), workspaces[index]["isReplica"] != .bool(true),
              let action = change["action"].string else { throw MainsError.server("This demo workspace is unavailable.") }
        let project = seed["projects"].array.first { $0["id"].string == workspaces[index]["projectId"]?.string }
        let now = JSONValue.number(Date().timeIntervalSince1970 * 1000)
        switch action {
        case "setPinned":
            guard case .bool(let pinned) = change["pinned"] else { throw MainsError.invalidReply }
            workspaces[index]["pinnedAt"] = pinned ? now : .null
        case "archive", "delete":
            guard !runs.contains(where: { $0["workspaceId"]?.string == id && ["running", "queued"].contains($0["status"]?.string ?? "") }) else {
                throw MainsError.server("Stop active replies before changing this workspace.")
            }
            if action == "archive" { workspaces[index]["isArchived"] = .bool(true) }
            else { workspaces.remove(at: index) }
            states.removeAll { $0["workspaceId"]?.string == id }
        case "renameBranch":
            guard let stateIndex = states.firstIndex(where: { $0["workspaceId"]?.string == id }),
                  let expected = change["expectedBranch"].string, states[stateIndex]["branch"]?.string == expected,
                  let name = change["branch"].string, !name.isEmpty else {
                throw MainsError.server("The checked-out branch changed.")
            }
            states[stateIndex]["branch"] = .string(name)
        case "newWorktree":
            guard let project, let projectID = project["id"].string else { throw MainsError.server("Project is unavailable.") }
            let newID = UUID().uuidString
            let branch = "worktree-" + newID.prefix(6).lowercased()
            workspaces.append(["id": .string(newID), "projectId": .string(projectID), "name": project["name"],
                "rootPath": .string("/demo/worktrees/" + newID), "baseBranch": .string(project["defaultBranch"].string ?? "main"),
                "status": .string("todo"), "isArchived": .bool(false), "updatedAt": now])
            states.append(["workspaceId": .string(newID), "branch": .string(branch), "pathExists": .bool(true)])
        default: throw MainsError.invalidReply
        }
        var updated = seed.objectValue
        updated["workspaces"] = .array(workspaces.map(JSONValue.object))
        updated["gitStates"] = .array(states.map(JSONValue.object))
        seed = .object(updated)
        push("workspace:changed", ["workspaceId": .string(id)])
        return .object(["workspaceId": .string(id), "action": .string(action)])
    }

    private func requireRun(_ id: String) throws {
        guard runs.contains(where: { $0["id"]?.string == id }) else { throw MainsError.server("Demo conversation not found.") }
    }
    private func isRunning(_ id: String) -> Bool { runs.first { $0["id"]?.string == id }?["status"]?.string == "running" }
    private func time(_ row: [String: JSONValue], _ key: String = "createdAt") -> Double { row[key]?.number ?? 0 }
    private static var now: JSONValue { .number(Date().timeIntervalSince1970 * 1000) }
    private func takeID() -> Int { nextID += 1; return nextID }
    private func push(_ channel: String, _ payload: [String: JSONValue]) {
        emit?(channel, .object(payload.merging(["ts": Self.now]) { existing, _ in existing }))
    }
    private func trimRuns() {
        while runs.count > 100 {
            guard let index = runs.indices.filter({ index in
                let id = runs[index]["id"]?.string
                return id != Self.tourID && id != Self.mateChatID && runs[index]["status"]?.string != "running"
            })
                .min(by: { time(runs[$0], "updatedAt") < time(runs[$1], "updatedAt") }),
                  let id = runs[index]["id"]?.string else { return }
            runs.remove(at: index); artifacts[id] = nil; tools[id] = nil; turns[id] = nil; patches[id] = nil; goals[id] = nil
            outputs[id] = nil
            let keys = attachments.keys.filter { $0.hasPrefix(id + ":") }
            for key in keys { if let file = attachments.removeValue(forKey: key) { attachmentBytes -= file.bytes.count } }
        }
    }

    private func addTour() {
        let at = Date().timeIntervalSince1970 * 1000 - 60_000
        let image = images.values.first
        if let image { images[9_000_003] = image }
        runs.append(["id": .string(Self.tourID), "accountId": seed["account"]["id"], "spaceId": .string("codex"), "providerId": .string("codex"),
            "mode": .string("developer"), "workspaceId": defaultWorkspaceID.map(JSONValue.string) ?? .null,
            "model": .string("gpt-6.1-sol"), "title": .string("Explore Mains"), "status": .string("succeeded"), "isArchived": .bool(false),
            "isReplica": .bool(false), "lastError": .null, "createdAt": .number(at), "updatedAt": .number(at),
            "configSnapshot": .object(["conversationSettings": .object(["model": .string("gpt-6.1-sol"), "config": .object(["sandboxMode": .string("workspace-write"), "modelReasoningEffort": .string("medium")])])])])
        var files = [attachmentMetadata(Self.pdfAttachmentID, file: .pdf)]
        if let image, let bytes = Data(base64Encoded: image["base64"].string ?? "") {
            files.append(attachmentMetadata(Self.imageAttachmentID, file: DemoFile(name: "demo-image.jpg", mime: image["mime"].string ?? "image/jpeg", preview: "image", bytes: bytes, version: Self.imageAttachmentID)))
        }
        artifacts[Self.tourID] = [
            ["id": .number(9_000_000), "runId": .string(Self.tourID), "kind": .string("user-prompt"), "content": .string("Show me the sample image and PDF."),
             "createdAt": .number(at), "metadata": .object(["source": .string("user"), "attachments": .array(files)])],
            ["id": .number(9_000_001), "runId": .string(Self.tourID), "kind": .string("report"),
             "content": .string("## Welcome to Mains\n\nExplore workspaces, switch between Code, Work and Chat, or send a message to try a simulated reply.\n\nThe image and PDF below are bundled samples. **Demo Mode stays on this iPhone.**"),
             "createdAt": .number(at + 100), "metadata": .object([:])],
            documentArtifact(id: -9001, runID: Self.tourID, file: .pdf, at: .number(at + 300)),
        ]
        if image != nil {
            artifacts[Self.tourID]!.append(["id": .number(9_000_003), "runId": .string(Self.tourID), "kind": .string("image"), "content": .null,
                                          "createdAt": .number(at + 200), "metadata": .object(["fileName": .string("demo-image.jpg")])])
        }
        tools[Self.tourID] = [["id": .number(9_000_002), "toolName": .string("Read"), "status": .string("done"), "createdAt": .number(at + 50),
            "input": .object(["file_path": .string("/Demo/mains/demo-notes.md")]), "output": .string(String(decoding: DemoFile.notes.bytes, as: UTF8.self))]]
        turns[Self.tourID] = [["id": .number(9_000_001), "status": .string("completed"), "model": .string("gpt-6.1-sol"), "turnIndex": .number(0),
                              "startedAt": .number(at), "createdAt": .number(at), "endedAt": .number(at + 300)]]
        installChanges(Self.tourID, turnID: 9_000_001)
        installSubagents(Self.tourID, baseID: 9_100_000, at: at + 50, stage: 2)
    }

    private func addLaunchBrief() throws {
        guard let collectionID = seed["collections"].array.first(where: { $0["name"].string == "Work" })?["id"].string else {
            throw MainsError.server("The demo Work project is missing.")
        }
        addCompletedFileSample(Self.launchBriefRunID, title: "iPhone launch brief",
                               prompt: "Prepare a one-page launch brief for the iPhone app.",
                               reply: "The launch brief is ready. Open the PDF and choose **Keep in Atlas** from File options to save it to the Work project.",
                               file: try DemoFile.launchBrief(), artifactID: -9003, collectionID: collectionID)
    }

    private func addSampleMate() {
        mates.append(DemoMate(id: Self.mateID, name: "Release Reviewer", spaceID: "codex", spaceName: "Codex", providerID: "codex",
                              model: seed["models"]["codex"].array.first?["id"].string ?? "", effort: "medium", teamID: Self.mateTeamID,
                              avatar: MateAvatar(shape: "terminal-amber", color: "amber"),
                              profile: MateProfile(description: "Reviews iPhone releases and prepares checklists.",
                                                   instructions: "Check release readiness, flag missing validation, and provide a short checklist.")))
        addCompletedFileSample(Self.mateChatID, title: "Release readiness review",
                               prompt: "Put together a checklist for testing the iPhone release.",
                               reply: "I prepared a release checklist with checks for pairing, Activity, and file previews. Open the checklist below before sharing the build.",
                               file: .releaseChecklist, artifactID: -9004, mateID: Self.mateID)
    }

    private func addCompletedFileSample(_ runID: String, title: String, prompt: String, reply: String, file: DemoFile,
                                        artifactID: Int, collectionID: String? = nil, mateID: String? = nil) {
        let model = seed["models"]["codex"].array.first?["id"] ?? .null
        let completionTime = Date().timeIntervalSince1970 * 1000
        let startedAt = JSONValue.number(completionTime - 30_000)
        let completedAt = JSONValue.number(completionTime)

        runs.append(["id": .string(runID), "accountId": seed["account"]["id"], "spaceId": .string("codex"), "providerId": .string("codex"),
                     "mode": .string("work"), "model": model, "collectionId": collectionID.map(JSONValue.string) ?? .null,
                     "assistantId": mateID.map(JSONValue.string) ?? .null, "title": .string(title),
                     "status": .string("succeeded"), "isArchived": .bool(false), "isReplica": .bool(false),
                     "createdAt": startedAt, "updatedAt": completedAt, "endedAt": completedAt])
        artifacts[runID] = [
            ["id": .number(Double(takeID())), "runId": .string(runID), "kind": .string("user-prompt"), "createdAt": startedAt,
             "content": .string(prompt), "metadata": .object(["source": .string("user")])],
            ["id": .number(Double(takeID())), "runId": .string(runID), "kind": .string("report"), "createdAt": .number(completionTime - 1000),
             "content": .string(reply),
             "metadata": .object(["source": .string("assistant.message")])],
            documentArtifact(id: artifactID, runID: runID, file: file, at: completedAt),
        ]
        turns[runID] = [["id": .number(Double(takeID())), "turnIndex": .number(0), "status": .string("completed"), "model": model,
                         "createdAt": startedAt, "startedAt": startedAt, "endedAt": completedAt]]
        outputs[runID] = [artifactID: file]
    }

    private func documentArtifact(id: Int, runID: String, file: DemoFile, at: JSONValue) -> [String: JSONValue] {
        ["id": .number(Double(id)), "runId": .string(runID), "kind": .string("document"), "content": .null, "createdAt": at,
         "metadata": .object(["fileName": .string(file.name), "outputSelected": .bool(true), "byteSize": .number(Double(file.bytes.count))])]
    }

    private func addActivitySamples() {
        addActivityRun(Self.activityApprovalRunID, title: "Review release checks",
                       prompt: "Run the release checks after I approve them.",
                       message: "The sample release checks are ready for your review.", waitFor: .approval, steps: [.finish])
        // Keep the prepared request available until the user reviews or stops the sample.
        requestApproval(sampleCheckApproval(message: "Run the sample release checks?"),
                        runID: Self.activityApprovalRunID, expiresAt: .distantFuture)

        addActivityRun(Self.activityQueueRunID, title: "Draft release notes",
                       prompt: "Draft a short set of release notes for the iPhone app.",
                       message: "I’m drafting the sample release notes. Send a follow-up to queue it. This sample finishes after you add one.",
                       waitFor: .followUp,
                       steps: [
                        .tool("Read", .object(["file_path": .string("/Demo/mains/release-notes.md")]), .string("Sample release highlights: Activity, Atlas and file previews.")),
                        .text("## Sample release notes\n\n- Review approvals from Activity.\n- Keep useful files and links in Atlas."),
                        .finish,
                       ])
    }

    private func addActivityRun(_ runID: String, title: String, prompt: String, message: String, waitFor: ReplayWait, steps: [Step]) {
        let at = Self.now
        let model = seed["models"]["codex"].array.first?["id"] ?? .null
        runs.append(["id": .string(runID), "accountId": seed["account"]["id"], "spaceId": .string("codex"), "providerId": .string("codex"),
                     "mode": .string("work"), "model": model, "title": .string(title), "status": .string("running"),
                     "isArchived": .bool(false), "isReplica": .bool(false), "createdAt": at, "updatedAt": at])
        append(runID, kind: "user-prompt", text: prompt, metadata: ["source": .string("user")])
        turns[runID] = [["id": .number(Double(takeID())), "turnIndex": .number(0), "status": .string("active"),
                         "model": model, "startedAt": at, "createdAt": at]]
        append(runID, kind: "report", text: message, metadata: ["source": .string("assistant.message")])
        replays[runID] = Replay(steps: steps, waitingFor: waitFor)
    }

    private func installSubagents(_ runID: String, baseID: Int, at: Double, stage: Int) {
        guard let turn = turns[runID]?.last?["id"]?.number else { return }
        let snapshot = DemoSubagents.snapshot(runID: runID, baseID: baseID, at: at, stage: stage, turnID: Int(turn))
        let callIDs = Set(snapshot.calls.compactMap { $0["id"].number })
        tools[runID, default: []].removeAll { callIDs.contains($0["id"]?.number ?? 0) }
        tools[runID, default: []].append(contentsOf: snapshot.calls.map(\.objectValue))
        let existing = Set((artifacts[runID] ?? []).compactMap { $0["id"]?.number })
        artifacts[runID, default: []].append(contentsOf: snapshot.artifacts.filter { !existing.contains($0["id"].number ?? 0) }.map(\.objectValue))
        if stage < 2 {
            // Exercise the child preview path before the durable report arrives.
            let anchor = "demo-agent-\(baseID + stage)"
            push("runs:ephemeralEvent", ["runId": .string(runID), "event": .object([
                "type": .string("artifact"), "kind": .string("report"), "streamId": .string(anchor + "-report"),
                "content": .string(stage == 0 ? "Reviewing credential storage and backend ownership…" : "Reviewing reconnection and receipt tests…"),
                "metadata": .object(["parentToolUseId": .string(anchor), "isFromSubagent": .bool(true), "streaming": .bool(true)]),
            ])])
        }
        push("runs:eventPersisted", ["runId": .string(runID)])
    }

    private func installChanges(_ runID: String, turnID: Int) {
        guard let index = turns[runID]?.firstIndex(where: { $0["id"]?.number == Double(turnID) }) else { return }
        turns[runID]![index]["changes"] = DemoTurnChanges.summary(turnID: turnID)
        patches[runID, default: [:]][turnID] = DemoTurnChanges.patch
        push("runs:diffUpdated", ["runId": .string(runID)])
    }

    private struct Key: Comparable {
        let time: Double; let source: String; let id: Int
        var json: JSONValue { .object(["timestamp": .number(time), "source": .string(source), "id": .number(Double(id))]) }
        init(_ row: [String: JSONValue], source: String) { time = row["createdAt"]?.number ?? 0; self.source = source; id = Int(row["id"]?.number ?? 0) }
        init?(_ value: JSONValue) {
            guard let t = value["timestamp"].number, let s = value["source"].string, let id = value["id"].number,
                  t.isFinite, id.isFinite, id >= Double(Int.min), id < Double(Int.max) else { return nil }
            time = t; source = s; self.id = Int(id)
        }
        static func < (a: Self, b: Self) -> Bool { a.time != b.time ? a.time < b.time : a.source != b.source ? a.source < b.source : a.id < b.id }
    }
    private func history(_ request: JSONValue) throws -> JSONValue {
        let id = request["runId"].string ?? ""
        let rows = artifacts[id] ?? [], calls = tools[id] ?? []
        let allKeys = (rows.map { Key($0, source: "artifact") } + calls.map { Key($0, source: "tool") }).sorted()
        let rangeStart = Key(request["range"]["start"]), rangeEnd = Key(request["range"]["end"])
        let keys = allKeys.filter { key in (rangeStart.map { key >= $0 } ?? true) && (rangeEnd.map { key < $0 } ?? true) }
        var anchors = rows.filter { $0["kind"]?.string == "user-prompt" }.map { Key($0, source: "artifact") }.sorted()
        if let first = keys.first, anchors.first.map({ first < $0 }) ?? true { anchors.insert(first, at: 0) }
        let cursor = Key(request["cursor"])
        let direction = request["direction"].string ?? "latest"
        let conversation = request["conversationWindow"].bool
        let pageSize = conversation ? 20 : 3, windowSize = conversation ? 60 : 9
        var lower: Key?, upper: Key?
        if rangeStart != nil {
            let eligible = keys.filter { key in
                if direction == "older", let cursor { return key < cursor }
                if direction == "newer", let cursor { return key >= cursor }
                return true
            }
            let selected = direction == "newer" ? Array(eligible.prefix(200)) : Array(eligible.suffix(200))
            lower = selected.first
            if let last = selected.last, keys.last.map({ last < $0 }) == true {
                var end = last.json.objectValue; end["id"] = .number(Double(last.id + 1)); upper = Key(.object(end))
            } else { upper = rangeEnd }
        } else { switch direction {
        case "older":
            let seek = cursor.flatMap { cursor in anchors.firstIndex { $0 >= cursor } } ?? anchors.count
            let start = max(0, seek - pageSize), end = min(anchors.count, start + windowSize)
            lower = anchors.indices.contains(start) ? anchors[start] : nil
            upper = anchors.indices.contains(end) ? anchors[end] : nil
        case "newer":
            let seek = cursor.flatMap { cursor in anchors.firstIndex { $0 >= cursor } } ?? anchors.count
            let end = min(anchors.count, seek + pageSize), start = max(0, end - windowSize)
            lower = anchors.indices.contains(start) ? anchors[start] : nil
            upper = anchors.indices.contains(end) ? anchors[end] : nil
        case "refresh": lower = cursor ?? anchors.suffix(pageSize).first; upper = Key(request["end"])
        default: lower = anchors.suffix(pageSize).first
        } }
        func contains(_ key: Key) -> Bool { (lower.map { key >= $0 } ?? false) && (upper.map { key < $0 } ?? true) }
        var selectedRows = rows.filter { contains(Key($0, source: "artifact")) }.map { row -> JSONValue in
            var item = row
            if let text = row["content"]?.string, text.count > 8000 {
                item["content"] = .string(String(text.prefix(4000)))
                var meta = item["metadata"]?.objectValue ?? [:]; meta["mobileContentDeferred"] = .bool(true); item["metadata"] = .object(meta)
            }
            return .object(item)
        }
        var selectedCalls = calls.filter { contains(Key($0, source: "tool")) }.map { row -> JSONValue in
            var item = row
            for (key, type) in [("input","mains/deferred-tool-input"),("output","mains/deferred-tool-output")] {
                let text = Self.text(row[key] ?? .null)
                if text.count > 4000 { item[key] = .object(["type": .string(type), "preview": .string(String(text.prefix(1000))), "chars": .number(Double(text.unicodeScalars.count))]) }
            }
            return .object(item)
        }
        let allTurns = (turns[id] ?? []).sorted { time($0, "startedAt") < time($1, "startedAt") }
        let preceding = allTurns.last { turn in lower.map { time(turn, "startedAt") <= $0.time } ?? false }?["id"]
        let selectedTurns = allTurns.filter { turn in
            let at = time(turn, "startedAt")
            return ((lower.map { at >= $0.time } ?? false) || turn["id"] == preceding) && (upper.map { at <= $0.time } ?? true)
        }
        var activity: JSONValue = .null
        if conversation {
            let newestRows = selectedRows.sorted { Key($0.objectValue, source: "artifact") > Key($1.objectValue, source: "artifact") }
            let messages = newestRows.filter {
                ["user-prompt", "report", "result", "command_result"].contains($0["kind"].string ?? "") &&
                    AgentActivity.foreground($0["metadata"]) && !AgentActivity.thinking(kind: $0["kind"].string ?? "", metadata: $0["metadata"])
            }
            var priority: [JSONValue] = []
            if let cursor, let row = selectedRows.first(where: { Key($0.objectValue, source: "artifact").id == cursor.id && cursor.source == "artifact" }) { priority.append(row) }
            if let prompt = messages.first(where: { $0["kind"].string == "user-prompt" }) { priority.append(prompt) }
            priority += messages + newestRows
            let originalCount = selectedRows.count + selectedCalls.count
            var retainedRows: [JSONValue] = [], retainedCalls: [JSONValue] = [], seen = Set<String>()
            var bytes = try JSONEncoder().encode(selectedTurns.map(JSONValue.object)).count
            for (source, values) in [("artifact", priority), ("tool", Array(selectedCalls.reversed()))] {
                for row in values {
                    let id = source + ":" + String(row["id"].number ?? 0)
                    guard !seen.contains(id), seen.count < 400 else { continue }
                    let count = try JSONEncoder().encode(row).count
                    guard bytes + count < 2 * 1024 * 1024 - 16 * 1024 else { continue }
                    seen.insert(id); bytes += count
                    if source == "artifact" { retainedRows.append(row) } else { retainedCalls.append(row) }
                }
            }
            selectedRows = retainedRows.sorted { Key($0.objectValue, source: "artifact") < Key($1.objectValue, source: "artifact") }
            selectedCalls = retainedCalls.sorted { Key($0.objectValue, source: "tool") < Key($1.objectValue, source: "tool") }
            if originalCount > seen.count, let lower, let last = keys.last {
                var ending = last.json.objectValue; ending["id"] = .number(Double(last.id + 1))
                activity = .object(["start": lower.json, "end": upper?.json ?? .object(ending), "omittedCount": .number(Double(originalCount - seen.count))])
            }
        }
        var result: [String: JSONValue] = ["artifacts": .array(selectedRows), "toolCalls": .array(selectedCalls),
            "turns": .array(selectedTurns.map(JSONValue.object)),
            "start": lower?.json ?? .null, "end": upper?.json ?? .null, "last": keys.last?.json ?? .null,
            "hasOlder": .bool(keys.first.map { first in lower.map { first < $0 } ?? false } ?? false),
            "hasNewer": .bool(keys.last.map { last in upper.map { last >= $0 } ?? false } ?? false)]
        if activity != .null { result["activity"] = activity }
        return .object(result)
    }
    private func content(_ request: JSONValue) throws -> JSONValue {
        let runID = request["runId"].string ?? "", source = request["source"].string ?? ""
        guard let id = request["id"].number else { throw MainsError.invalidReply }
        let value: JSONValue
        if source == "turn-diff", id > 0, id < Double(Int.max), id.rounded() == id {
            value = patches[runID]?[Int(id)].map(JSONValue.string) ?? .null
        }
        else if source == "artifact" { value = artifacts[runID]?.first { $0["id"]?.number == id }?["content"] ?? .null }
        else if ["tool-input","tool-output", "plan"].contains(source) {
            let tool = tools[runID]?.first { $0["id"]?.number == id }
            value = source == "plan" ? tool?["input"]?["plan"] ?? .null : tool?[source == "tool-input" ? "input" : "output"] ?? .null
        } else { throw MainsError.invalidReply }
        guard value != .null else { throw MainsError.server("Demo content not found in this conversation.") }
        let chars = Array(Self.text(value).unicodeScalars)
        let offset = request["offset"].number ?? 0
        guard offset.isFinite, offset.rounded() == offset, offset >= 0, offset <= Double(chars.count) else { throw MainsError.invalidReply }
        let start = Int(offset), end = min(chars.count, start + 8192)
        return .object(["text": .string(String(String.UnicodeScalarView(chars[start..<end]))), "offset": .number(offset),
                        "nextOffset": end < chars.count ? .number(Double(end)) : .null, "totalChars": .number(Double(chars.count))])
    }
    private static func text(_ value: JSONValue) -> String {
        if case .string(let text) = value { return text }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? encoder.encode(value)).map { String(decoding: $0, as: UTF8.self) } ?? ""
    }
}
