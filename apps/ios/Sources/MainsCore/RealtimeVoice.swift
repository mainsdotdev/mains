import Foundation
import Observation

public struct RealtimeVoiceCatalog: Decodable, Sendable {
    public let voices: [String]
    public let defaultVoice: String
}

public enum RealtimeVoicePhase: String, Sendable {
    case idle, connecting, connected, ending, stopFailed, error
}

public struct PendingVoiceConversation: Sendable {
    public let spaceID: String
    public var uncertain = false
    let commandID: String
    let payload: JSONValue
    let owner: Int
}

public struct VoiceTaskLink: Equatable, Sendable {
    public let id: String
    public let title: String
    static func read(_ value: JSONValue) -> VoiceTaskLink? {
        guard let id = value["id"].string, !id.isEmpty, id.utf8.count <= 800,
              let title = value["title"].string, title.utf8.count <= 4096 else { return nil }
        return VoiceTaskLink(id: id, title: title)
    }
}

/// The app supplies a native WebRTC implementation. Core stays portable and testable.
@MainActor
public protocol RealtimeVoiceMedia: AnyObject {
    var onConnected: (() -> Void)? { get set }
    var onFailure: ((String) -> Void)? { get set }
    var onChannelOpen: (() -> Void)? { get set }
    var onLevels: ((Double, Double) -> Void)? { get set }
    func offer() async throws -> String
    func answer(_ sdp: String) async throws
    func send(_ event: JSONValue) throws -> Bool
    func setMuted(_ muted: Bool)
    func close()
}

@MainActor
public struct RealtimeVoiceSignaling {
    public let runID: String
    public let start: (String, String) async throws -> Void
    public let stop: (String) async throws -> Void
    public init(runID: String, start: @escaping (String, String) async throws -> Void,
                stop: @escaping (String) async throws -> Void) {
        self.runID = runID; self.start = start; self.stop = stop
    }
}

/// One call for the application, independent of screens and work-turn completion.
@MainActor @Observable
public final class RealtimeVoiceController {
    public private(set) var phase: RealtimeVoicePhase = .idle
    public private(set) var runID: String?
    public private(set) var label = ""
    public private(set) var muted = false
    public private(set) var error: String?
    public private(set) var inputLevel = 0.0
    public private(set) var outputLevel = 0.0
    public var ownsCall: Bool { [.connecting, .connected, .ending, .stopFailed].contains(phase) }
    public var keepsConnectionAlive: Bool { phase == .connecting || phase == .connected }
    @ObservationIgnored public var makeMedia: (() -> any RealtimeVoiceMedia)?
    @ObservationIgnored var onChange: (() -> Void)?
    @ObservationIgnored private var attempt: Attempt?
    private let timeout: Duration

    private final class Attempt {
        let id = UUID().uuidString
        var signaling: RealtimeVoiceSignaling?
        var media: (any RealtimeVoiceMedia)?
        var issued = false
        var serverReady = false
        var mediaReady = false
        var ending = false
        var startSettled = false
        var stop: Task<Void, Never>?
        var timer: Task<Void, Never>?
        var signals: Task<Void, Never>?
        var context: [JSONValue] = []
        var contextIDs: [String] = []
        var contextTask: Task<Void, Never>?
    }

    public init(timeout: Duration = .seconds(30)) { self.timeout = timeout }

    public func start(label: String, prepare: @escaping () async throws -> RealtimeVoiceSignaling) async {
        guard attempt == nil, let makeMedia else { return }
        let call = Attempt(); attempt = call
        self.label = label; error = nil; runID = nil; muted = false
        phase = .connecting; onChange?()
        call.timer = Task { [weak self, weak call] in
            do { try await Task.sleep(for: self?.timeout ?? .seconds(30)) } catch { return }
            guard let self, let call, self.current(call) else { return }
            await self.end(call, error: "Voice connection timed out. Try again.")
        }
        do {
            let media = makeMedia(); call.media = media
            media.onConnected = { [weak self, weak call] in
                guard let self, let call, self.current(call) else { return }
                call.mediaReady = true; self.connected(call)
            }
            media.onFailure = { [weak self, weak call] message in
                guard let self, let call, self.current(call) else { return }
                Task { await self.end(call, error: message) }
            }
            media.onChannelOpen = { [weak self, weak call] in
                if let self, let call, self.current(call) { self.flush(call) }
            }
            media.onLevels = { [weak self, weak call] input, output in
                guard let self, let call, self.current(call), self.phase == .connected else { return }
                self.inputLevel = self.muted ? 0 : min(1, max(0, input))
                self.outputLevel = min(1, max(0, output))
            }
            // Obtain mic permission before creating a new conversation.
            let offer = try await media.offer()
            guard current(call) else { return }
            let signaling = try await prepare()
            guard current(call) else { return }
            call.signaling = signaling; runID = signaling.runID
            call.issued = true
            try await signaling.start(offer, call.id)
            call.startSettled = true
            // Cancellation can race a still-pending native start. Its original
            // identity must close again after start settles, never a newer call.
            if attempt === call, call.ending { await confirm(call) }
        } catch {
            call.startSettled = true
            if current(call) { await end(call, error: error.localizedDescription) }
            else if attempt === call, call.ending { await confirm(call) }
        }
    }

    public func receive(_ event: JSONValue) {
        guard let call = attempt, event["connectionId"].string == call.id,
              event["runId"].string == call.signaling?.runID else { return }
        let type = event["type"].string
        if type == "closed" { complete(call); return }
        guard current(call) else { return }
        switch type {
        case "started": call.serverReady = true; connected(call)
        case "sdp":
            guard let sdp = event["sdp"].string, sdp.utf8.count <= 262_144, sdp.hasPrefix("v=0") else { return }
            let previous = call.signals
            call.signals = Task { [weak self, weak call] in
                await previous?.value
                guard let self, let call, self.current(call) else { return }
                do { try await call.media?.answer(sdp) }
                catch { if self.current(call) { await self.end(call, error: error.localizedDescription) } }
            }
        case "context":
            guard let id = event["eventId"].string, !call.contextIDs.contains(id),
                  let text = event["content"].string, text.utf8.count <= 128_000 else { return }
            call.contextIDs.append(id); call.contextIDs = Array(call.contextIDs.suffix(256))
            call.context += Self.contextEvents(text, announce: event["announce"].bool)
            // Retain whole updates only within a bounded call-local queue.
            if call.context.count > 512 { Task { await end(call, error: "Voice context could not be delivered. Start voice again.") }; return }
            flush(call)
        case "ending": Task { await end(call) }
        case "error": Task { await end(call, error: event["message"].string ?? "Voice chat failed.") }
        default: break // Transcript persistence uses the existing artifact stream.
        }
    }

    public func stop() async {
        guard let call = attempt else { error = nil; phase = .idle; return }
        if call.ending { error = nil; phase = .ending; await confirm(call) }
        else { await end(call) }
    }
    public func connectionLost() {
        guard let call = attempt, !call.ending else { return }
        // Synchronous release: neither network teardown nor an RPC owns the mic.
        release(call); call.ending = true; phase = .ending
        error = "Voice connection was lost. Start voice chat again."
        Task { await confirm(call) }
        onChange?()
    }
    public func toggleMute() {
        guard let call = attempt, phase == .connected else { return }
        muted.toggle(); call.media?.setMuted(muted)
        if muted { inputLevel = 0 }
    }
    func retire() {
        if let call = attempt { release(call) }
        attempt = nil; runID = nil; error = nil; phase = .idle
    }
    private func current(_ call: Attempt) -> Bool { attempt === call && !call.ending }
    private func connected(_ call: Attempt) {
        guard current(call), call.serverReady, call.mediaReady else { return }
        call.timer?.cancel(); phase = .connected; onChange?()
    }
    private func end(_ call: Attempt, error: String? = nil) async {
        guard current(call) else { return }
        call.ending = true; self.error = error
        release(call); phase = .ending; onChange?()
        await confirm(call)
    }
    private func release(_ call: Attempt) {
        call.timer?.cancel(); call.signals?.cancel(); call.contextTask?.cancel()
        call.media?.close(); call.media = nil; call.context = []; call.contextIDs = []
        inputLevel = 0; outputLevel = 0; muted = false
    }
    private func confirm(_ call: Attempt) async {
        guard attempt === call else { return }
        if let stop = call.stop { await stop.value; return }
        guard call.issued, let signaling = call.signaling else { complete(call); return }
        let task = Task { [weak self, weak call] in
            guard let self, let call else { return }
            do {
                try await signaling.stop(call.id)
                // A successful stop before start settles is only a cancellation
                // request. Keep ownership until start can no longer create media.
                if call.startSettled { self.complete(call) }
            } catch {
                guard self.attempt === call else { return }
                self.phase = .stopFailed
                self.error = "The microphone is off. Ending voice chat could not be confirmed. Retry ending the call. " + error.localizedDescription
                self.onChange?()
            }
            call.stop = nil
        }
        call.stop = task
        await task.value
    }
    private func complete(_ call: Attempt) {
        guard attempt === call else { return }
        release(call); attempt = nil; runID = nil
        phase = error == nil ? .idle : .error; onChange?()
    }
    private func flush(_ call: Attempt) {
        guard current(call), call.contextTask == nil else { return }
        call.contextTask = Task { [weak self, weak call] in
            guard let self, let call else { return }
            defer { call.contextTask = nil }
            do {
                while self.current(call), let event = call.context.first {
                    guard try call.media?.send(event) == true else {
                        try await Task.sleep(for: .milliseconds(100)); continue
                    }
                    call.context.removeFirst()
                }
            } catch is CancellationError { }
            catch { if self.current(call) { await self.end(call, error: error.localizedDescription) } }
        }
    }

    /// Codex native v3 uses context.append, distinct from the public Live API.
    static func contextEvents(_ text: String, announce: Bool) -> [JSONValue] {
        var parts: [String] = [], part = "", bytes = 0
        for scalar in text.unicodeScalars {
            let value = String(scalar), count = value.utf8.count
            if bytes + count > 500 { parts.append(part); part = ""; bytes = 0 }
            part += value; bytes += count
        }
        if !part.isEmpty { parts.append(part) }
        return parts.map { text in
            var value: [String: JSONValue] = ["type": .string("session.context.append"),
                "content": .array([.object(["type": .string("input_text"), "text": .string(text)])])]
            if announce { value["channel"] = .string("commentary") }
            return .object(value)
        }
    }
}
