import Foundation

/// Mirrors packages/contracts/src/ws-protocol.ts. Keep tags intact in arbitrary JSON.
public enum JSONValue: Codable, Equatable, Sendable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null

    public init(from decoder: any Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let v = try? value.decode(Bool.self) { self = .bool(v) }
        else if let v = try? value.decode(Double.self) { self = .number(v) }
        else if let v = try? value.decode(String.self) { self = .string(v) }
        else if let v = try? value.decode([String: JSONValue].self) { self = .object(v) }
        else { self = .array(try value.decode([JSONValue].self)) }
    }

    public func encode(to encoder: any Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let v): try value.encode(v)
        case .array(let v): try value.encode(v)
        case .string(let v): try value.encode(v)
        case .number(let v): try value.encode(v)
        case .bool(let v): try value.encode(v)
        case .null: try value.encodeNil()
        }
    }

    public subscript(key: String) -> JSONValue { if case .object(let v) = self { v[key] ?? .null } else { .null } }
    public var string: String? { if case .string(let v) = self { v } else { nil } }
    public var bool: Bool { if case .bool(let v) = self { v } else { false } }
    public var number: Double? { if case .number(let v) = self { v } else { nil } }
    public var array: [JSONValue] { if case .array(let v) = self { v } else { [] } }
    var objectValue: [String: JSONValue] { if case .object(let value) = self { value } else { [:] } }
    public func decode<T: Decodable>(_ type: T.Type) throws -> T {
        try Wire.decoder().decode(type, from: JSONEncoder().encode(self))
    }
    public static func encode<T: Encodable>(_ value: T) throws -> Self {
        try JSONDecoder().decode(Self.self, from: Wire.encoder().encode(value))
    }
}

extension KeyedDecodingContainer {
    /// Treat the wire's undefined marker as absent only at a typed optional field.
    /// Arbitrary JSONValue payloads must retain the marker for transport/replay.
    func decodeWireIfPresent<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key), try !decodeNil(forKey: key) else { return nil }
        if let marker = try? decode([String: Bool].self, forKey: key), marker == ["$undefined": true] { return nil }
        return try decode(type, forKey: key)
    }
}

public enum Wire {
    public static let protocolVersion = 1
    public static let maxMessageBytes = 4 * 1024 * 1024
    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let milliseconds = try? container.decode(Double.self) { return Date(timeIntervalSince1970: milliseconds / 1000) }
            let text: String
            if let tagged = try? container.decode([String: String].self), let value = tagged["$date"] { text = value }
            else { text = try container.decode(String.self) }
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: text) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: text) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid wire date")
            }
            return date
        }
        return decoder
    }
    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var container = encoder.singleValueContainer()
            try container.encode(["$date": formatter.string(from: date)])
        }
        return encoder
    }
    public static func webSocketURL(_ endpoint: URL) throws -> URL {
        guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false),
              ["http", "https"].contains(components.scheme?.lowercased() ?? "") else { throw MainsError.invalidLink }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        guard let url = components.url else { throw MainsError.invalidLink }
        return url
    }
}

public enum MainsError: Error, LocalizedError, Equatable, Sendable {
    case invalidLink, disconnected, timeout, unauthorized, incompatible, server(String), invalidReply, changedBackend
    public static let steerTurnEnded = Self.server("The agent finished before your message reached it. Send it again to continue.")
    var isResponseBusy: Bool {
        guard case .server(let message) = self else { return false }
        return message.range(of: "already (?:has an active response|starting a response)", options: [.regularExpression, .caseInsensitive]) != nil
    }
    var isEndedSteer: Bool {
        guard case .server(let message) = self else { return false }
        return message.range(of: "no active (?:codex |claude )?turn to steer|active turn changed", options: .regularExpression.union(.caseInsensitive)) != nil
    }
    public var isUnconfirmedCommand: Bool {
        guard case .server(let message) = self else { return false }
        // packages/backend/src/ipc-kit/command-delivery.ts returns these receipt failures.
        return message.hasPrefix("Command outcome is unknown") || message.hasPrefix("Could not verify the previous command result")
            || message.localizedCaseInsensitiveContains("uncertain")
    }
    public var errorDescription: String? {
        switch self {
        case .invalidLink: "Use the complete pairing link from Mains on your computer."
        case .disconnected: "The connection to your computer was lost."
        case .timeout: "The request timed out."
        case .unauthorized: "This computer refused the device token. Pair this iPhone again."
        case .incompatible: "The computer and iPhone use different protocol versions. Update the older app."
        case .server(let message): message
        case .invalidReply: "Mains returned an unexpected response."
        case .changedBackend: "The paired computer changed. Open the conversation again."
        }
    }
}
