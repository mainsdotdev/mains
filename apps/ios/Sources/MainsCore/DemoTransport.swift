import Foundation

/// A local endpoint, deliberately independent of URLSession and reachability.
@MainActor
final class DemoTransport: BackendTransport {
    var onEvent: ((String, JSONValue) -> Void)?
    var onDisconnect: ((MainsError) -> Void)?
    private let backend: DemoBackend
    private let owner = UUID()
    private var opened = false

    init(backend: DemoBackend) { self.backend = backend }
    func open(endpoint: URL, token: String) throws {
        guard endpoint == DemoBackend.endpoint else { throw MainsError.invalidLink }
        opened = true
        backend.attach(owner: owner) { [weak self] channel, payload in
            guard let self, self.opened else { return }
            self.onEvent?(channel, payload)
        }
    }
    func perform(_ channel: String, args: [JSONValue], commandId: String?, timeout: TimeInterval) async throws -> JSONValue {
        try Task.checkCancellation()
        guard opened else { throw MainsError.disconnected }
        return try backend.invoke(channel, args: args, commandID: commandId)
    }
    func close() {
        opened = false; backend.detach(owner: owner)
    }
}
