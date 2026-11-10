import Foundation
import CryptoKit

extension JSONValue {
    var demoObject: [String: JSONValue] { if case .object(let row) = self { row } else { [:] } }
}

/// An on-device counterpart to the same channels used by a real computer.
/// Imported files, new runs, command receipts and replay progress are memory-only.
@MainActor
final class DemoBackend {
    static let backendID = "demo-mac"
    static let endpoint = URL(string: "demo://on-this-phone")!
    static let tourID = "demo-native-tour"
    static let pdfAttachmentID = String(repeating: "d", count: 64)
    static let imageAttachmentID = String(repeating: "e", count: 64)

    private var seed: JSONValue
    private var runs: [[String: JSONValue]]
    private var artifacts: [String: [[String: JSONValue]]]
    private var tools: [String: [[String: JSONValue]]]
    private var turns: [String: [[String: JSONValue]]]
    private var spaces: [[String: JSONValue]]
    private var images: [Int: JSONValue] = [:]
    private var attachments: [String: DemoFile] = [:]
    private var attachmentBytes = 0
    private var nextID = 10_000_000
    private let stepDelay: Duration
    private let streamDelay: Duration
    private var owner: UUID?
    private var emit: ((String, JSONValue) -> Void)?
    private var tasks: [String: Task<Void, Never>] = [:]
    private enum Step { case text(String), tool(String, JSONValue, JSONValue), finish }
    private struct Replay {
        let steps: [Step]
        var index = 0
        var count = 0
        var streamID = UUID().uuidString
    }
    private var replays: [String: Replay] = [:]
    private struct Receipt {
        let channel: String
        let fingerprint: Data
        let result: Result<JSONValue, MainsError>
    }
    private var receipts: [String: Receipt] = [:]
    private let mutationChannels: Set<String> = ["runs:execute", "runs:continue", "runs:abort", "space:update", "runs:updateConversationSettings"]

    var pairing: PairedBackend {
        PairedBackend(descriptor: BackendDescriptor(backendId: Self.backendID, name: "Demo Mac",
                      appVersion: "Demo", protocolVersion: Wire.protocolVersion, capabilities: ["runs","workspace","providers","space","projects","collections"],
                      serverTime: Date().ISO8601Format()),
                      endpoints: [Self.endpoint], deviceId: "native-demo-device", deviceToken: "on-device-demo", pairedAt: Date())
    }
    var defaultWorkspaceID: String? {
        seed["workspaces"].array.first { $0["name"].string == "mains" }?["id"].string
    }

    init(stepDelay: Duration = .milliseconds(450), streamDelay: Duration = .milliseconds(35)) throws {
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
        seed = data; runs = data["runs"].array.map(\.demoObject); spaces = data["spaces"].array.map(\.demoObject)
        artifacts = data["artifacts"].demoObject.mapValues { $0.array.map(\.demoObject) }
        tools = data["toolCalls"].demoObject.mapValues { $0.array.map(\.demoObject) }
        turns = data["turns"].demoObject.mapValues { $0.array.map(\.demoObject) }
        self.stepDelay = stepDelay; self.streamDelay = streamDelay
        for (id, image) in data["images"].demoObject { if let id = Int(id) { images[id] = image } }
        for runID in artifacts.keys {
            if let index = artifacts[runID]?.firstIndex(where: { $0["kind"]?.string == "user-prompt" }) {
                var metadata = artifacts[runID]![index]["metadata"]?.demoObject ?? [:]
                metadata["attachments"] = .array([attachmentMetadata(Self.pdfAttachmentID, file: .pdf)])
                artifacts[runID]![index]["metadata"] = .object(metadata)
            }
        }
        addTour()
    }

    func attach(owner: UUID, emit: @escaping (String, JSONValue) -> Void) {
        for task in tasks.values { task.cancel() }
        tasks = [:]; self.owner = owner; self.emit = emit
        for runID in replays.keys { resume(runID) }
    }
    func detach(owner: UUID) {
        guard self.owner == owner else { return }
        self.owner = nil; emit = nil
        for task in tasks.values { task.cancel() }
        tasks = [:] // Progress is retained; foreground resumes the same replay.
    }
    func shutdown() {
        for task in tasks.values { task.cancel() }
        tasks = [:]; replays = [:]; emit = nil; owner = nil
        attachments = [:]; attachmentBytes = 0
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
        case "backend:describe": return try .encode(pairing.descriptor)
        case "account:get": return seed["account"]
        case "space:getAll": return .array(spaces.map(JSONValue.object))
        case "workspace:list", "workspace:listGitStates", "collections:list", "projects:list":
            let key = ["workspace:list":"workspaces", "workspace:listGitStates":"gitStates", "collections:list":"collections", "projects:list":"projects"][channel]!
            return seed[key]
        case "providers:getEnabled": return seed["providers"]
        case "providers:getModels": return seed["models"][first.string ?? ""]
        case "providers:getCodexPermissions":
            return .object(["profilesSupported": .bool(false), "profiles": .array([]), "requiresNamedProfile": .bool(false),
                            "allowedSandboxModes": .array(["read-only","workspace-write","danger-full-access"].map(JSONValue.string))])
        case "runs:getAll":
            return .array(runs.sorted { time($0, "updatedAt") > time($1, "updatedAt") }.prefix(100).map(JSONValue.object))
        case "runs:getById": return runs.first { $0["id"]?.string == runID }.map(JSONValue.object) ?? .null
        case "runs:listPendingApprovals": return .array([]) // No unsupported approval/plugin flow is advertised.
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
            var config = runs[index]["configSnapshot"]?.demoObject ?? [:]
            config["conversationSettings"] = try .encode(settings)
            runs[index]["configSnapshot"] = .object(config); runs[index]["model"] = .string(settings.model)
            push("runs:updated", ["runId": .string(runID)])
            return try .encode(settings)
        case "runs:execute": return try execute(first)
        case "runs:continue":
            try requireRun(runID)
            guard !isRunning(runID) else { throw MainsError.server("Wait for the demo reply, or stop it first.") }
            try start(runID, prompt: first["message"].string ?? "", files: first["attachments"].array)
            return .object(["runId": .string(runID), "resumed": .bool(true)])
        case "runs:abort":
            try requireRun(runID); finish(runID, status: "canceled")
            return .null
        case "runs:listOutputs":
            try requireRun(runID)
            let items: [JSONValue] = [DemoFile.pdf.descriptor(runID: runID, artifactID: -9001), DemoFile.notes.descriptor(runID: runID, artifactID: -9002)]
            let requested = first["artifactId"].number
            return .object(["items": .array((first["offset"].number ?? 0) > 0 ? [] : items.filter { requested == nil || $0["artifactId"].number == requested }), "nextOffset": .null])
        case "runs:readOutputFile":
            try requireRun(runID)
            let file: DemoFile
            switch first["artifactId"].number { case -9001: file = .pdf; case -9002: file = .notes; default: throw MainsError.server("Demo output not found.") }
            return try file.chunk(first)
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

    private func execute(_ payload: JSONValue) throws -> JSONValue {
        guard runs.filter({ $0["status"]?.string == "running" }).count < 8 else {
            throw MainsError.server("Finish or stop a demo reply before starting another.")
        }
        guard let space = spaces.first(where: { $0["id"]?.string == payload["spaceId"].string }) else { throw MainsError.server("Choose a demo space.") }
        let id = "demo-run-" + UUID().uuidString.lowercased()
        let settings = payload["conversationSettings"] == .null
            ? JSONValue.object(["model": space["model"] ?? .string(""), "config": .object([:])]) : payload["conversationSettings"]
        let run: [String: JSONValue] = [
            "id": .string(id), "accountId": seed["account"]["id"], "providerId": space["providerId"] ?? .string("codex"),
            "spaceId": space["id"]!, "mode": space["mode"] ?? .string("chat"), "workspaceId": payload["workspaceId"],
            "collectionId": payload["collectionId"], "model": settings["model"], "configSnapshot": .object(["conversationSettings": settings]),
            "title": .string(String((payload["goal"].string ?? "Demo conversation").prefix(56))),
            "status": .string("succeeded"), "isArchived": .bool(false), "isReplica": .bool(false),
            "lastError": .null, "createdAt": Self.now, "updatedAt": Self.now,
        ]
        runs.append(run); artifacts[id] = []; tools[id] = []; turns[id] = []
        do { try start(id, prompt: payload["goal"].string ?? "", files: payload["attachments"].array) }
        catch { runs.removeAll { $0["id"]?.string == id }; artifacts[id] = nil; tools[id] = nil; turns[id] = nil; throw error }
        trimRuns()
        return .object(["runId": .string(id)])
    }

    private func start(_ runID: String, prompt: String, files: [JSONValue]) throws {
        guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, prompt.count <= 32_000 else {
            throw MainsError.server("Write a demo message under 32,000 characters.")
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
        append(runID, kind: "user-prompt", text: prompt, metadata: ["source": .string("user"), "attachments": .array(references)])
        if let index = runs.firstIndex(where: { $0["id"]?.string == runID }) {
            runs[index]["status"] = .string("running"); runs[index]["updatedAt"] = Self.now; runs[index]["endedAt"] = .null
            let count = turns[runID]?.count ?? 0
            turns[runID, default: []].append(["id": .number(Double(takeID())), "turnIndex": .number(Double(count + 1)),
                "status": .string("running"), "model": runs[index]["model"] ?? .null, "startedAt": Self.now])
        }
        replays[runID] = Replay(steps: scenario(prompt, hasAttachments: !uploaded.isEmpty))
        push("runs:statusChanged", ["runId": .string(runID), "status": .string("running")]); resume(runID)
    }

    private func scenario(_ prompt: String, hasAttachments: Bool) -> [Step] {
        let request = String(prompt.replacingOccurrences(of: "\n", with: " ").prefix(90))
        let issue = ["bug","error","crash","stuck","hata","sorun"].contains { prompt.localizedCaseInsensitiveContains($0) }
        return [
            .text("I’ll \(issue ? "trace the issue" : "review your request") using the bundled sample workspace. This is a simulated demo: your message and files stay on this iPhone."),
            .tool("Glob", .object(["pattern": .string("Sources/**/*.swift")]), .string("Sources/MainsApp/HomeView.swift\nSources/MainsCore/BackendSession.swift")),
            .tool("Read", .object(["file_path": .string("/Demo/mains/Sources/MainsCore/BackendSession.swift")]),
                  .string("The session connects the sidebar, composer, bounded history and live messages.")),
            .text("## Demo result\n\nFor **\(request)**, the sample workspace shows how Mains keeps conversations, model settings and tool activity together.\n\n- **\(issue ? "Investigation" : "Review"):** inspected bundled sample files.\n- **Privacy:** no computer, external account or AI service was contacted.\n\(hasAttachments ? "- **Attachments:** your files are available in this conversation for on-device preview.\n" : "")\nYou can continue this conversation, change providers, or open the sample image and PDF in **Explore Mains**. This is a prepared demonstration, not an AI-generated answer."),
            .finish,
        ]
    }

    private func resume(_ runID: String) {
        guard emit != nil, tasks[runID] == nil, replays[runID] != nil else { return }
        tasks[runID] = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, let replay = self.replays[runID], replay.index < replay.steps.count else { return }
                let delay: Duration
                if case .text = replay.steps[replay.index] { delay = self.streamDelay } else { delay = self.stepDelay }
                do { try await Task.sleep(for: delay) } catch { return }
                guard !Task.isCancelled, self.emit != nil, self.isRunning(runID) else { return }
                self.advance(runID)
            }
        }
    }
    private func advance(_ runID: String) {
        guard var replay = replays[runID], replay.index < replay.steps.count else { return }
        switch replay.steps[replay.index] {
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
            tools[runID, default: []].append(["id": .number(Double(takeID())), "runId": .string(runID),
                "toolName": .string(name), "status": .string("done"), "input": input, "output": output,
                "createdAt": Self.now, "startedAt": Self.now, "endedAt": Self.now, "error": .null])
            push("runs:eventPersisted", ["runId": .string(runID)]); replay.index += 1
        case .finish: finish(runID, status: "succeeded"); return
        }
        replays[runID] = replay
    }
    private func finish(_ runID: String, status: String) {
        tasks.removeValue(forKey: runID)?.cancel(); replays[runID] = nil
        if let index = runs.firstIndex(where: { $0["id"]?.string == runID }) {
            runs[index]["status"] = .string(status); runs[index]["updatedAt"] = Self.now; runs[index]["endedAt"] = Self.now
        }
        if let last = turns[runID]?.indices.last { turns[runID]![last]["status"] = .string(status == "succeeded" ? "completed" : "canceled") }
        push("runs:statusChanged", ["runId": .string(runID), "status": .string(status)])
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
            guard let index = runs.indices.filter({ runs[$0]["id"]?.string != Self.tourID && runs[$0]["status"]?.string != "running" })
                .min(by: { time(runs[$0], "updatedAt") < time(runs[$1], "updatedAt") }),
                  let id = runs[index]["id"]?.string else { return }
            runs.remove(at: index); artifacts[id] = nil; tools[id] = nil; turns[id] = nil
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
            ["id": .number(-9001), "runId": .string(Self.tourID), "kind": .string("document"), "content": .null, "createdAt": .number(at + 300),
             "metadata": .object(["fileName": .string(DemoFile.pdf.name), "outputSelected": .bool(true), "byteSize": .number(Double(DemoFile.pdf.bytes.count))])],
        ]
        if image != nil {
            artifacts[Self.tourID]!.append(["id": .number(9_000_003), "runId": .string(Self.tourID), "kind": .string("image"), "content": .null,
                                          "createdAt": .number(at + 200), "metadata": .object(["fileName": .string("demo-image.jpg")])])
        }
        tools[Self.tourID] = [["id": .number(9_000_002), "toolName": .string("Read"), "status": .string("done"), "createdAt": .number(at + 50),
            "input": .object(["file_path": .string("/Demo/mains/demo-notes.md")]), "output": .string(String(decoding: DemoFile.notes.bytes, as: UTF8.self))]]
        turns[Self.tourID] = [["id": .number(9_000_001), "status": .string("completed"), "model": .string("gpt-6.1-sol"), "turnIndex": .number(1)]]
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
        let keys = (rows.map { Key($0, source: "artifact") } + calls.map { Key($0, source: "tool") }).sorted()
        var anchors = rows.filter { $0["kind"]?.string == "user-prompt" }.map { Key($0, source: "artifact") }.sorted()
        if let first = keys.first, anchors.first.map({ first < $0 }) ?? true { anchors.insert(first, at: 0) }
        let cursor = Key(request["cursor"])
        let direction = request["direction"].string ?? "latest"
        var lower: Key?, upper: Key?
        switch direction {
        case "older":
            let eligible = anchors.filter { key in cursor.map { key < $0 } ?? true }
            lower = eligible.suffix(3).first; upper = cursor
        case "newer":
            let eligible = anchors.filter { key in cursor.map { key >= $0 } ?? true }
            lower = eligible.first; upper = eligible.count > 3 ? eligible[3] : nil
        case "refresh": lower = cursor ?? anchors.suffix(3).first; upper = Key(request["end"])
        default: lower = anchors.suffix(3).first
        }
        func contains(_ key: Key) -> Bool { (lower.map { key >= $0 } ?? false) && (upper.map { key < $0 } ?? true) }
        let selectedRows = rows.filter { contains(Key($0, source: "artifact")) }.map { row -> JSONValue in
            var item = row
            if let text = row["content"]?.string, text.count > 8000 {
                item["content"] = .string(String(text.prefix(4000)))
                var meta = item["metadata"]?.demoObject ?? [:]; meta["mobileContentDeferred"] = .bool(true); item["metadata"] = .object(meta)
            }
            return .object(item)
        }
        let selectedCalls = calls.filter { contains(Key($0, source: "tool")) }.map { row -> JSONValue in
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
        return .object(["artifacts": .array(selectedRows), "toolCalls": .array(selectedCalls),
            "turns": .array(selectedTurns.map(JSONValue.object)),
            "start": lower?.json ?? .null, "end": upper?.json ?? .null, "last": keys.last?.json ?? .null,
            "hasOlder": .bool(keys.first.map { first in lower.map { first < $0 } ?? false } ?? false),
            "hasNewer": .bool(keys.last.map { last in upper.map { last >= $0 } ?? false } ?? false)])
    }
    private func content(_ request: JSONValue) throws -> JSONValue {
        let runID = request["runId"].string ?? "", source = request["source"].string ?? ""
        guard let id = request["id"].number else { throw MainsError.invalidReply }
        let value: JSONValue
        if source == "artifact" { value = artifacts[runID]?.first { $0["id"]?.number == id }?["content"] ?? .null }
        else if ["tool-input","tool-output"].contains(source) {
            value = tools[runID]?.first { $0["id"]?.number == id }?[source == "tool-input" ? "input" : "output"] ?? .null
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
