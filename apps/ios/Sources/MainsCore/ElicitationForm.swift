import Foundation

/// Native port of packages/contracts/src/mcp-elicitation.ts's flat form subset.
public struct ElicitationField: Identifiable, Sendable {
    public enum Kind: String, Sendable { case string, number, boolean, enumeration, multiEnum }
    public var id: String { name }
    public let name: String
    public let label: String
    public let description: String?
    public let kind: Kind
    public let required: Bool
    public let secret: Bool
    public let choices: [String]
    public let choiceLabels: [String]
    public let schema: JSONValue
    public var defaultValue: JSONValue? {
        let value = schema["default"]
        switch value {
        case .number(let n) where n.isFinite: return .string(n.rounded() == n ? String(format: "%.0f", n) : String(n))
        case .string, .bool: return value
        case .array(let values) where values.allSatisfy({ $0.string != nil }): return value
        default: return nil
        }
    }
}

public struct ElicitationForm: Sendable {
    public let fields: [ElicitationField]
    public let unsupported: [String]

    public init(schema: JSONValue?) {
        guard let schema, case .object(let root) = schema, root["type"] == nil || root["type"] == .string("object") else {
            fields = []; unsupported = ["Form schema"]; return
        }
        var fields: [ElicitationField] = [], unsupported: [String] = []
        let required = Set(schema["required"].array.compactMap(\.string))
        let properties: [String: JSONValue]
        if case .object(let object) = schema["properties"] { properties = object }
        else { properties = [:]; if root["properties"] != nil { unsupported.append("Form fields") } }
        for name in properties.keys.sorted() {
            let node = properties[name]!
            guard case .object(let values) = node else { unsupported.append(name); continue }
            let label = node["title"].string.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } ?? name
            let type = node["type"].string
            let options = Self.choices(type == "array" ? node["items"] : node, titled: type == "array" ? "anyOf" : "oneOf")
            let kind: ElicitationField.Kind?
            switch type {
            case "array": kind = options == nil ? nil : .multiEnum
            case "string": kind = options == nil ? .string : .enumeration
            case "number", "integer": kind = .number
            case "boolean": kind = .boolean
            default: kind = nil
            }
            guard let kind, !((values["enum"] != nil || values["oneOf"] != nil) && options == nil) else { unsupported.append(label); continue }
            let secretName = name.range(of: "password|secret|token|api[-_]?key|credential", options: [.regularExpression, .caseInsensitive]) != nil
            fields.append(ElicitationField(name: name, label: label, description: node["description"].string, kind: kind,
                required: required.contains(name), secret: kind == .string && (node["format"].string == "password" || node["writeOnly"].bool || secretName),
                choices: options?.0 ?? [], choiceLabels: options?.1 ?? [], schema: node))
        }
        unsupported += required.filter { properties[$0] == nil }.sorted()
        self.fields = fields; self.unsupported = unsupported
    }

    public var defaults: [String: JSONValue] {
        fields.reduce(into: [:]) { values, field in if let value = field.defaultValue { values[field.name] = value } }
    }

    /// Numbers remain text while editing. No unsupported or extra field is silently sent.
    public func build(_ values: [String: JSONValue]) -> (content: JSONValue?, errors: [String: String]) {
        var content: [String: JSONValue] = [:]
        for field in fields {
            let raw = values[field.name]
            switch field.kind {
            case .boolean: content[field.name] = raw ?? .bool(false)
            case .multiEnum: content[field.name] = raw ?? .array([])
            case .number:
                if let text = raw?.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
                    content[field.name] = Double(text).filterFinite.map(JSONValue.number) ?? .string(text)
                } else if raw?.number != nil { content[field.name] = raw }
            case .string, .enumeration:
                let text = field.kind == .enumeration ? raw?.string : raw?.string?.trimmingCharacters(in: .whitespacesAndNewlines)
                if let text, !text.isEmpty { content[field.name] = .string(text) }
            }
        }
        let errors = validate(.object(content))
        return (errors.isEmpty ? .object(content) : nil, errors)
    }

    public func validate(_ content: JSONValue) -> [String: String] {
        guard unsupported.isEmpty else { return ["form": "Unsupported fields: \(unsupported.joined(separator: ", ")). Complete this form on your computer."] }
        guard case .object(let values) = content else { return ["form": "Invalid form response."] }
        var errors: [String: String] = [:]
        let names = Set(fields.map(\.name))
        if values.keys.contains(where: { !names.contains($0) }) { errors["form"] = "The response contains unrequested fields." }
        for field in fields { if let error = Self.error(field, value: values[field.name]) { errors[field.name] = error } }
        return errors
    }

    private static func choices(_ node: JSONValue, titled key: String) -> ([String], [String])? {
        let simple = node["enum"].array
        if !simple.isEmpty, simple.allSatisfy({ $0.string != nil }) {
            let values = simple.compactMap(\.string), labels = node["enumNames"].array
            return (values, values.enumerated().map { labels.indices.contains($0.offset) ? labels[$0.offset].string ?? $0.element : $0.element })
        }
        let options = node[key].array
        guard !options.isEmpty, options.allSatisfy({ $0["const"].string != nil }) else { return nil }
        return (options.compactMap { $0["const"].string }, options.compactMap { $0["title"].string ?? $0["const"].string })
    }

    private static func error(_ field: ElicitationField, value: JSONValue?) -> String? {
        guard let value else { return field.required ? "This field is required." : nil }
        let schema = field.schema
        switch field.kind {
        case .boolean:
            if case .bool = value { return nil }; return "Choose yes or no."
        case .number:
            guard let n = value.number, n.isFinite else { return "Enter a valid number." }
            if schema["type"].string == "integer", n.rounded() != n { return "Enter a whole number." }
            if let min = schema["minimum"].number, n < min { return "Minimum: \(min.formatted())." }
            if let max = schema["maximum"].number, n > max { return "Maximum: \(max.formatted())." }
        case .multiEnum:
            guard case .array(let options) = value, options.allSatisfy({ field.choices.contains($0.string ?? "") }) else { return "Choose from the listed options." }
            if Set(options.compactMap(\.string)).count != options.count { return "Choose each option only once." }
            if let min = schema["minItems"].number, Double(options.count) < min { return "Choose at least \(min.formatted()) options." }
            if let max = schema["maxItems"].number, Double(options.count) > max { return "Choose at most \(max.formatted()) options." }
        case .string, .enumeration:
            guard let text = value.string else { return "Enter text." }
            if field.required, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "This field is required." }
            if field.kind == .enumeration, !field.choices.contains(text) { return "Choose from the listed options." }
            if let min = schema["minLength"].number, Double(text.unicodeScalars.count) < min { return "Use at least \(min.formatted()) characters." }
            if let max = schema["maxLength"].number, Double(text.unicodeScalars.count) > max { return "Use at most \(max.formatted()) characters." }
            if let pattern = schema["pattern"].string {
                guard let regex = try? NSRegularExpression(pattern: pattern) else { return "This field uses an unsupported pattern." }
                if regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) == nil { return "Use the requested format." }
            }
            let format = schema["format"].string
            if format == "email", text.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) == nil { return "Enter a valid email address." }
            if format == "uri", URL(string: text)?.scheme == nil { return "Enter a valid URL." }
            if format == "date", !validDate(text) { return "Enter a valid date (YYYY-MM-DD)." }
            if format == "date-time" {
                let pattern = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$"
                let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                var date = formatter.date(from: text)
                formatter.formatOptions = [.withInternetDateTime]; date = date ?? formatter.date(from: text)
                if text.range(of: pattern, options: .regularExpression) == nil || !validDate(String(text.prefix(10))) || date == nil { return "Enter a date and time with a timezone." }
            }
        }
        return nil
    }

    private static func validDate(_ text: String) -> Bool {
        guard text.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil else { return false }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        guard let date = formatter.date(from: text) else { return false }
        return formatter.string(from: date) == text
    }
}

private extension Optional where Wrapped == Double {
    var filterFinite: Double? { flatMap { $0.isFinite ? $0 : nil } }
}
