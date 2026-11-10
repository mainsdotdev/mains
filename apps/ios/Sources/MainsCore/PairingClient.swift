import Foundation

public struct PairingClient: Sendable {
    public init() {}

    public func pair(_ link: PairingLink, deviceName: String, session: URLSession = .shared) async throws -> PairedBackend {
        struct Reply: Decodable {
            let deviceId: String
            let deviceToken: String
            let backend: BackendDescriptor
        }
        var lastError: any Error = MainsError.disconnected
        for endpoint in link.endpoints {
            try Task.checkCancellation()
            do {
                var request = URLRequest(url: endpoint.appendingPathComponent("pair"))
                request.httpMethod = "POST"
                request.timeoutInterval = 8
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONEncoder().encode(JSONValue.object([
                    "code": .string(link.code), "deviceName": .string(deviceName),
                    "platform": .string("ios"), "appVersion": .string("0.1.0"),
                ]))
                let (data, response) = try await session.data(for: request)
                try Task.checkCancellation()
                guard let response = response as? HTTPURLResponse else { throw MainsError.invalidReply }
                guard (200..<300).contains(response.statusCode) else {
                    let body = try? JSONDecoder().decode(JSONValue.self, from: data)
                    throw MainsError.server(body?["error"].string ?? "Pairing code expired or was refused. Generate a new code on your computer.")
                }
                let reply = try Wire.decoder().decode(Reply.self, from: data)
                guard !reply.deviceToken.isEmpty, !reply.deviceId.isEmpty, !reply.backend.backendId.isEmpty else { throw MainsError.invalidReply }
                guard reply.backend.protocolVersion == Wire.protocolVersion else { throw MainsError.incompatible }
                return PairedBackend(descriptor: reply.backend, endpoints: [endpoint] + link.endpoints.filter { $0 != endpoint },
                                     deviceId: reply.deviceId, deviceToken: reply.deviceToken, pairedAt: Date())
            } catch is CancellationError { throw CancellationError() }
            catch let error as MainsError { throw error } // Refusal/invalid protocol is final, on every address.
            catch { lastError = error }
        }
        throw lastError
    }
}
