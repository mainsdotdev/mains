import Foundation

/// A single socket owns all of its requests. Replacing it retires every waiter.
@MainActor
public final class WebSocketTransport {
    public var onEvent: ((String, JSONValue) -> Void)?
    public var onDisconnect: ((MainsError) -> Void)?
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var reader: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var sequence = 0
    private struct Pending {
        let continuation: CheckedContinuation<JSONValue, any Error>
        let timeout: Task<Void, Never>
    }
    private var pending: [Int: Pending] = [:]

    public init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        session = URLSession(configuration: configuration)
    }

    public func open(endpoint: URL, token: String) throws {
        close()
        let task = session.webSocketTask(with: try Wire.webSocketURL(endpoint), protocols: ["mains.v1", "mains.token." + token])
        task.maximumMessageSize = Wire.maxMessageBytes
        socket = task
        task.resume()
        reader = Task { [weak self] in
            do {
                while !Task.isCancelled {
                    let message = try await task.receive()
                    guard let self, self.socket === task else { return }
                    let data: Data
                    switch message {
                    case .string(let value): data = Data(value.utf8)
                    case .data(let value): data = value
                    @unknown default: continue
                    }
                    guard data.count <= Wire.maxMessageBytes else { throw MainsError.invalidReply }
                    self.receive(try JSONDecoder().decode(JSONValue.self, from: data))
                }
            } catch {
                guard let self, self.socket === task else { return }
                let status = (task.response as? HTTPURLResponse)?.statusCode
                self.fail(status == 401 || status == 403 ? .unauthorized : .disconnected)
            }
        }
        heartbeat = Task { [weak self] in
            do {
                while !Task.isCancelled {
                    try await Task.sleep(for: .seconds(15))
                    guard let self, self.socket === task else { return }
                    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                        task.sendPing { error in
                            if let error { continuation.resume(throwing: error) }
                            else { continuation.resume() }
                        }
                    }
                }
            } catch {
                guard let self, self.socket === task else { return }
                self.fail(.disconnected)
            }
        }
    }

    public func invoke(_ channel: String, args: [JSONValue] = [], commandId: String? = nil,
                       timeout: TimeInterval = 10) async throws -> JSONValue {
        try Task.checkCancellation()
        guard let socket else { throw MainsError.disconnected }
        sequence += 1
        let id = sequence
        var body: [String: JSONValue] = ["kind": .string("invoke"), "id": .number(Double(id)),
                                       "channel": .string(channel), "args": .array(args)]
        if let commandId { body["commandId"] = .string(commandId) }
        let data = try JSONEncoder().encode(JSONValue.object(body))
        guard data.count <= Wire.maxMessageBytes, let text = String(data: data, encoding: .utf8) else { throw MainsError.invalidReply }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let timer = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(timeout)) } catch { return }
                    self?.finish(id, .failure(MainsError.timeout))
                }
                pending[id] = Pending(continuation: continuation, timeout: timer)
                Task { [weak self] in
                    guard let self, self.pending[id] != nil, self.socket === socket, !Task.isCancelled else { return }
                    do { try await socket.send(.string(text)) }
                    catch {
                        guard self.socket === socket else { return }
                        let status = (socket.response as? HTTPURLResponse)?.statusCode
                        self.fail(status == 401 || status == 403 ? .unauthorized : .disconnected)
                    }
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.finish(id, .failure(CancellationError())) }
        }
    }

    public func close() {
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        reader?.cancel(); reader = nil
        heartbeat?.cancel(); heartbeat = nil
        for id in Array(pending.keys) { finish(id, .failure(MainsError.disconnected)) }
    }

    private func fail(_ error: MainsError) {
        for id in Array(pending.keys) { finish(id, .failure(error)) }
        close()
        onDisconnect?(error)
    }

    private func finish(_ id: Int, _ result: Result<JSONValue, any Error>) {
        guard let request = pending.removeValue(forKey: id) else { return }
        request.timeout.cancel()
        request.continuation.resume(with: result)
    }

    private func receive(_ message: JSONValue) {
        switch message["kind"].string {
        case "response":
            guard let rawID = message["id"].number, rawID.isFinite, rawID >= 0, rawID < Double(Int.max) else { return }
            let result = message["result"]
            if result["success"].bool { finish(Int(rawID), .success(result["data"])) }
            else { finish(Int(rawID), .failure(MainsError.server(result["error"].string ?? "Request refused"))) }
        case "event":
            if let channel = message["channel"].string { onEvent?(channel, message["payload"]) }
        default: break
        }
    }
}
