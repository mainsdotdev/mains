import Foundation

enum DemoAtlas {
    static func answer(_ channel: String, input: JSONValue, runID: String, collectionID: String?, image: JSONValue) throws -> JSONValue {
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
        case "atlas:mobileLibrary":
            var rows = [entry("demo-atlas-page", kind: "page", title: "Explore Atlas", favorite: true),
                        entry("demo-atlas-doc", kind: "file", title: "Demo report", favorite: true),
                        entry("demo-atlas-image", kind: "image", title: "Sample image"),
                        entry("demo-atlas-bookmark", kind: "bookmark", title: "A useful link"),
                        entry("demo-atlas-generated", kind: "file", title: "Notes from a Work chat", generated: true)]
            let type = input["type"].string ?? "all", scope = input["scope"].string ?? "all", query = (input["query"].string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            rows = rows.filter { row in
                (type == "all" || row["kind"].string == type)
                && (scope == "all" || scope == "favorites" && row["isFavorite"].bool == true || scope == "saved" && row["origin"].string == "saved" || scope == "generated" && row["origin"].string == "generated")
                && (input["collectionId"].string == nil || input["collectionId"].string == collectionID)
                && (query.isEmpty || (row["title"].string ?? "").localizedCaseInsensitiveContains(query))
            }
            return .object(["items": .array(rows), "page": .number(1), "hasNext": .bool(false)])
        case "atlas:readMobilePage":
            guard input["id"].string == "demo-atlas-page", input["version"].number == nil || input["version"].number == 1 else { throw MainsError.server("This demo page is unavailable. Refresh it to read again.") }
            let markdown = "# Your library, on iPhone\n\nAtlas brings **Pages, documents, images and bookmarks** together.\n\n- Search your library\n- Filter by project or favorites\n- Preview and share a file\n\n[Open the sample report](atlas-file://demo-atlas-doc)\n\nEverything here is prepared sample data. No computer or AI service was contacted."
            guard input["offset"].number == nil || input["offset"].number == 0 else { throw MainsError.invalidReply }
            return .object(["id": .string("demo-atlas-page"), "title": .string("Explore Atlas"), "icon": .string("emoji:🗺️"), "version": .number(1),
                            "markdown": .string(markdown), "offset": .number(0), "nextOffset": .null, "sourceRunId": .string(runID)])
        case "atlas:describeMobileFile", "atlas:readMobileFile":
            let reference = input["reference"]
            let id = reference["itemId"].string ?? (reference["runId"].string == runID && reference["sourceKey"].string == source ? "demo-atlas-generated" : "")
            guard let file = files[id] else { throw MainsError.server("Demo Atlas file not found.") }
            if channel == "atlas:readMobileFile" { return try file.chunk(input) }
            var row = file.descriptor(runID: runID).objectValue; row.removeValue(forKey: "runId"); row["reference"] = reference
            return .object(row)
        default: throw MainsError.invalidReply
        }
    }
}
