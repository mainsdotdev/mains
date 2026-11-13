import Foundation

@MainActor final class DemoAtlas {
    private var saved: [String: JSONValue] = [:]
    private var storedFiles: [String: DemoFile] = [:]
    private var sources: [String: String] = [:]

    func save(_ file: DemoFile, source: String, runID: String, collectionID: String?) throws -> JSONValue {
        if let id = sources[source], let row = saved[id] { return summary(row) }
        guard saved.count < 100, storedFiles.values.reduce(0, { $0 + $1.bytes.count }) + file.bytes.count <= 32 * 1024 * 1024 else { throw MainsError.server("Reopen Demo Mode to reset the sample library.") }
        let id = "demo-saved-" + UUID().uuidString.lowercased()
        let row: JSONValue = .object(["key": .string(id), "kind": .string(file.mime.hasPrefix("image/") ? "image" : "file"), "title": .string(file.name),
            "date": .string(ISO8601DateFormatter().string(from: .now)), "collectionId": collectionID.map(JSONValue.string) ?? .null,
            "isFavorite": .bool(false), "origin": .string("saved"), "sourceRunId": .string(runID), "file": .object(["itemId": .string(id)]),
            "pageId": .null, "icon": .null, "url": .null, "description": .null, "note": .null])
        saved[id] = row; storedFiles[id] = file; sources[source] = id
        return summary(row)
    }

    private func summary(_ row: JSONValue) -> JSONValue { .object(["id": row["key"], "title": row["title"], "kind": row["kind"]]) }

    func answer(_ channel: String, input: JSONValue, runID: String, collectionID: String?, image: JSONValue) throws -> JSONValue {
        let source = String(repeating: "a", count: 64)
        let imageFile = DemoFile(name: "sample-image.jpg", mime: image["mime"].string ?? "image/jpeg", preview: "image",
                                 bytes: Data(base64Encoded: image["base64"].string ?? "") ?? Data(), version: String(repeating: "3", count: 64))
        let files = ["demo-atlas-doc": DemoFile.pdf, "demo-atlas-image": imageFile, "demo-atlas-generated": DemoFile.notes]
        func entry(_ id: String, kind: String, title: String, favorite: Bool = false, generated: Bool = false) -> JSONValue {
            .object(["key": .string(id), "kind": .string(kind), "title": .string(title), "date": .string("2026-11-12T10:00:00.000Z"),
                     "collectionId": collectionID.map(JSONValue.string) ?? .null, "isFavorite": .bool(favorite),
                     "origin": .string(generated ? "generated" : "saved"), "sourceRunId": .string(runID),
                     "file": files[id] != nil ? generated ? .object(["runId": .string(runID), "sourceKey": .string(source)]) : .object(["itemId": .string(id)]) : .null,
                     "pageId": kind == "page" ? .string(id) : .null, "icon": kind == "page" ? .string("emoji:🗺️") : .null,
                     "url": kind == "bookmark" ? .string("https://example.com") : .null,
                     "description": kind == "bookmark" ? .string("A sample bookmark stored in your on-device demo library.") : .null,
                     "note": kind == "bookmark" ? .string("Save useful links alongside your pages and files.") : .null])
        }
        switch channel {
        case "atlas:saveMobileBookmark":
            guard let url = AtlasBookmarkURL.validate(input["url"].string ?? ""), var parts = URLComponents(string: url) else { throw MainsError.server("Enter a complete web link.") }
            parts.queryItems = parts.queryItems?.filter { !$0.name.lowercased().hasPrefix("utm_") && !["fbclid", "gclid"].contains($0.name.lowercased()) }
            if parts.queryItems?.isEmpty == true { parts.queryItems = nil }
            parts.host = parts.host?.lowercased()
            let key = "bookmark:" + (parts.string ?? url)
            if let id = sources[key], let row = saved[id] { return summary(row) }
            guard saved.count < 100 else { throw MainsError.server("Reopen Demo Mode to reset the sample library.") }
            let id = "demo-bookmark-" + UUID().uuidString.lowercased()
            let row: JSONValue = .object(["key": .string(id), "kind": .string("bookmark"), "title": .string(parts.host ?? url), "date": .string(ISO8601DateFormatter().string(from: .now)),
                "collectionId": input["collectionId"].string.map(JSONValue.string) ?? .null, "isFavorite": .bool(false), "origin": .string("saved"), "sourceRunId": .null,
                "file": .null, "pageId": .null, "icon": .null, "url": .string(url), "description": .null, "note": .null])
            saved[id] = row; sources[key] = id
            return summary(row)
        case "atlas:saveMobileFile":
            guard input["sourceKey"].string == source, input["runId"].string == runID, input["version"].string == DemoFile.notes.version else { throw MainsError.server("Demo Atlas source changed.") }
            return try save(.notes, source: "generated:" + runID, runID: runID, collectionID: collectionID)
        case "atlas:mobileLibrary":
            var rows = [entry("demo-atlas-page", kind: "page", title: "Explore Atlas", favorite: true),
                        entry("demo-atlas-doc", kind: "file", title: "Demo report", favorite: true),
                        entry("demo-atlas-image", kind: "image", title: "Sample image"),
                        entry("demo-atlas-bookmark", kind: "bookmark", title: "A useful link"),
                        entry("demo-atlas-generated", kind: "file", title: "Notes from a Work chat", generated: true)]
            if sources["generated:" + runID] != nil { rows.removeAll { $0["key"].string == "demo-atlas-generated" } }
            rows += saved.values.sorted { ($0["key"].string ?? "") < ($1["key"].string ?? "") }
            let type = input["type"].string ?? "all", scope = input["scope"].string ?? "all", query = (input["query"].string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            rows = rows.filter { row in
                (type == "all" || row["kind"].string == type)
                && (scope == "all" || scope == "favorites" && row["isFavorite"].bool == true || scope == "saved" && row["origin"].string == "saved" || scope == "generated" && row["origin"].string == "generated")
                && (input["collectionId"].string == nil || input["collectionId"].string == row["collectionId"].string)
                && (query.isEmpty || (row["title"].string ?? "").localizedCaseInsensitiveContains(query))
            }
            let page = max(1, min(Int(input["page"].number ?? 1), max(1, (rows.count + 49) / 50)))
            return .object(["items": .array(Array(rows.dropFirst((page - 1) * 50).prefix(50))), "page": .number(Double(page)), "hasNext": .bool(page * 50 < rows.count)])
        case "atlas:readMobilePage":
            guard input["id"].string == "demo-atlas-page", input["version"].number == nil || input["version"].number == 1 else { throw MainsError.server("This demo page is unavailable. Refresh it to read again.") }
            let markdown = "# Your library, on iPhone\n\nAtlas brings **Pages, documents, images and bookmarks** together.\n\n- Search your library\n- Filter by project or favorites\n- Preview and share a file\n\n[Open the sample report](atlas-file://demo-atlas-doc)\n\nEverything here is prepared sample data. No computer or AI service was contacted."
            guard input["offset"].number == nil || input["offset"].number == 0 else { throw MainsError.invalidReply }
            return .object(["id": .string("demo-atlas-page"), "title": .string("Explore Atlas"), "icon": .string("emoji:🗺️"), "version": .number(1),
                            "markdown": .string(markdown), "offset": .number(0), "nextOffset": .null, "sourceRunId": .string(runID)])
        case "atlas:describeMobileFile", "atlas:readMobileFile":
            let reference = input["reference"]
            let id = reference["itemId"].string ?? (reference["runId"].string == runID && reference["sourceKey"].string == source ? "demo-atlas-generated" : "")
            guard let file = files[id] ?? storedFiles[id] else { throw MainsError.server("Demo Atlas file not found.") }
            if channel == "atlas:readMobileFile" { return try file.chunk(input) }
            var row = file.descriptor(runID: runID).objectValue; row.removeValue(forKey: "runId"); row["reference"] = reference
            return .object(row)
        default: throw MainsError.invalidReply
        }
    }
}
