import Foundation
import CryptoKit

@MainActor final class DemoAtlas {
    private var saved: [String: JSONValue] = [:]
    private var storedFiles: [String: DemoFile] = [:]
    private var sources: [String: String] = [:]
    private var edits: [String: [String: JSONValue]] = [:]
    private var tagNames = ["demo-tag-research": "Research", "demo-tag-work": "Work"]

    private func tagsDocument(_ row: JSONValue, account: JSONValue) throws -> JSONValue {
        let tags = row["tags"].array.sorted { ($0["id"].string ?? "") < ($1["id"].string ?? "") }
        let content: JSONValue = .array([account, row["key"], .array(tags.map { .array([$0["id"], $0["name"], $0["source"]]) })])
        let revision = SHA256.hash(data: try JSONEncoder().encode(content)).map { String(format: "%02x", $0) }.joined()
        return .object(["id": row["key"], "requestedId": row["key"], "title": row["title"], "kind": row["kind"], "tags": .array(tags), "revision": .string(revision)])
    }

    func save(_ file: DemoFile, source: String, runID: String, collectionID: String?) throws -> JSONValue {
        if let id = sources[source], let row = saved[id] { edits[id, default: [:]]["trashedAt"] = .null; return summary(row) }
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

    private func bookmark(_ row: JSONValue, account: JSONValue, requestedID: String) throws -> JSONValue {
        guard row["kind"].string == "bookmark", let id = row["savedItemId"].string, let url = row["url"].string else { throw MainsError.server("Bookmark not found or in Trash") }
        let description = row["description"].string ?? "", note = row["note"].string ?? ""
        let content: JSONValue = .array([account, .string(id), .string(url), row["title"], .string(description), .string(note)])
        let revision = SHA256.hash(data: try JSONEncoder().encode(content)).map { String(format: "%02x", $0) }.joined()
        return .object(["id": .string(id), "requestedId": .string(requestedID), "kind": .string("bookmark"), "title": row["title"],
                        "url": .string(url), "description": .string(description), "note": .string(note), "revision": .string(revision)])
    }

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
        func libraryRows() -> [JSONValue] {
            var rows = [entry("demo-atlas-page", kind: "page", title: "Explore Atlas", favorite: true),
                        entry("demo-atlas-doc", kind: "file", title: "Demo report", favorite: true),
                        entry("demo-atlas-image", kind: "image", title: "Sample image"),
                        entry("demo-atlas-bookmark", kind: "bookmark", title: "A useful link"),
                        entry("demo-atlas-generated", kind: "file", title: "Notes from a Work chat", generated: true)]
            if sources["generated:" + runID] != nil { rows.removeAll { $0["key"].string == "demo-atlas-generated" } }
            rows += saved.values.sorted { ($0["key"].string ?? "") < ($1["key"].string ?? "") }
            return rows.map { row in
                var value = row.objectValue
                let id = row["key"].string ?? ""
                if let patch = edits[id] { value.merge(patch) { _, new in new } }
                if value["tags"] == nil {
                    let tagID = ["demo-atlas-page", "demo-atlas-bookmark"].contains(id) ? "demo-tag-research" : id == "demo-atlas-doc" ? "demo-tag-work" : nil
                    value["tags"] = .array(tagID.map { [.object(["id": .string($0), "name": .string(tagNames[$0]!), "source": .string("user")])] } ?? [])
                }
                value["savedItemId"] = row["origin"].string == "saved" ? .string(id) : .null
                value["savedCollectionId"] = row["origin"].string == "saved" ? value["collectionId"] ?? .null : .null
                return .object(value)
            }
        }
        switch channel {
        case "atlas:mobileTags":
            let requested = input["page"].number ?? 1
            guard requested.isFinite, requested.rounded() == requested, (1...100_000).contains(requested) else { throw MainsError.invalidReply }
            let search = (input["query"].string ?? "").precomposedStringWithCompatibilityMapping.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            let rows = tagNames.filter { search.isEmpty || $0.value.lowercased().contains(search) }.sorted { $0.value.lowercased() < $1.value.lowercased() }
            let page = Int(requested)
            let items = rows.dropFirst((page - 1) * 50).prefix(50).map { tag in
                JSONValue.object(["id": .string(tag.key), "name": .string(tag.value), "count": .number(Double(libraryRows().filter { $0["trashedAt"].string == nil && $0["tags"].array.contains { $0["id"].string == tag.key } }.count))])
            }
            return .object(["items": .array(items), "page": .number(requested), "hasNext": .bool(page * 50 < rows.count)])
        case "atlas:readMobileTags", "atlas:setMobileTags":
            guard let id = input["id"].string, let row = libraryRows().first(where: { $0["savedItemId"].string == id }), row["trashedAt"].string == nil else { throw MainsError.server("Atlas item not found or in Trash") }
            let current = try tagsDocument(row, account: input["accountId"])
            if channel == "atlas:readMobileTags" { return current }
            guard input["expectedRevision"].string == current["revision"].string else { throw MainsError.server("These tags changed elsewhere. Reload them before saving your edits.") }
            guard case .array(let values) = input["tags"], values.count <= 30, values.allSatisfy({ $0.string.flatMap(AtlasTagNames.normalized) != nil }) else { throw MainsError.server("Use up to 30 tags, each 64 characters or fewer.") }
            var known = tagNames, tags: [JSONValue] = [], seen = Set<String>()
            for value in values {
                let text = value.string!, name = AtlasTagNames.normalized(text)!
                let tagID = known[text] != nil ? text : known.first(where: { $0.value.precomposedStringWithCompatibilityMapping.lowercased() == name.lowercased() })?.key ?? UUID().uuidString.lowercased()
                if known[tagID] == nil { known[tagID] = name }
                if seen.insert(tagID).inserted { tags.append(.object(["id": .string(tagID), "name": .string(known[tagID]!), "source": row["tags"].array.first(where: { $0["id"].string == tagID })?["source"] ?? .string("user")])) }
            }
            tagNames = known; edits[id, default: [:]]["tags"] = .array(tags)
            guard let updated = libraryRows().first(where: { $0["key"].string == id }) else { throw MainsError.invalidReply }
            var result = try tagsDocument(updated, account: input["accountId"]).objectValue; result.removeValue(forKey: "tags")
            return .object(result)
        case "atlas:mobileTrash":
            let requested = input["page"].number ?? 1
            guard requested.isFinite, requested.rounded() == requested, (1...100_000).contains(requested) else { throw MainsError.invalidReply }
            let page = Int(requested)
            let rows = libraryRows().filter { $0["savedItemId"].string != nil && $0["trashedAt"].string != nil }.sorted {
                let left = $0["trashedAt"].string ?? "", right = $1["trashedAt"].string ?? ""
                return left == right ? ($0["key"].string ?? "") > ($1["key"].string ?? "") : left > right
            }
            let items = rows.dropFirst((page - 1) * 50).prefix(50).map { row in
                JSONValue.object(["id": row["key"], "title": row["title"], "kind": row["kind"], "collectionId": row["collectionId"], "trashedAt": row["trashedAt"]])
            }
            return .object(["items": .array(items), "page": .number(requested), "hasNext": .bool(page * 50 < rows.count)])
        case "atlas:setMobileTrash":
            guard let id = input["id"].string, let row = libraryRows().first(where: { $0["savedItemId"].string == id }),
                  case .bool(let trashed) = input["trashed"] else { throw MainsError.server("Atlas item not found") }
            if (row["trashedAt"].string != nil) != trashed {
                edits[id, default: [:]]["trashedAt"] = trashed ? .string(ISO8601DateFormatter().string(from: .now)) : .null
            }
            return .object(["id": .string(id), "requestedId": .string(id), "title": row["title"], "kind": row["kind"], "trashed": .bool(trashed)])
        case "atlas:readMobileBookmark", "atlas:editMobileBookmark":
            guard let id = input["id"].string, let row = libraryRows().first(where: { $0["savedItemId"].string == id }), row["trashedAt"].string == nil else { throw MainsError.server("Bookmark not found or in Trash") }
            let current = try bookmark(row, account: input["accountId"], requestedID: id)
            if channel == "atlas:readMobileBookmark" { return current }
            guard input["expectedRevision"].string == current["revision"].string else { throw MainsError.server("This bookmark changed elsewhere. Reload it before saving your edits.") }
            var patch = edits[id] ?? [:]
            var changed = false
            for field in ["title", "description", "note"] {
                if let value = input.objectValue[field] {
                    guard let text = value.string else { throw MainsError.invalidReply }
                    patch[field] = .string(text.trimmingCharacters(in: .whitespacesAndNewlines)); changed = true
                }
            }
            let draft = AtlasBookmarkDraft(title: patch["title"]?.string ?? current["title"].string ?? "",
                                           description: patch["description"]?.string ?? current["description"].string ?? "", note: patch["note"]?.string ?? current["note"].string ?? "")
            guard changed, draft.validationError == nil else { throw MainsError.server(draft.validationError ?? "Make a change before saving.") }
            edits[id] = patch
            guard let updatedRow = libraryRows().first(where: { $0["savedItemId"].string == id }) else { throw MainsError.invalidReply }
            let updated = try bookmark(updatedRow, account: input["accountId"], requestedID: id)
            return .object(["id": updated["id"], "requestedId": .string(id), "kind": .string("bookmark"), "title": updated["title"], "revision": updated["revision"]])
        case "atlas:updateMobileItem":
            guard let id = input["id"].string, let row = libraryRows().first(where: { $0["savedItemId"].string == id }), row["trashedAt"].string == nil else { throw MainsError.server("Atlas item not found or in Trash") }
            var patch = edits[id] ?? [:]
            if let favorite = input.objectValue["isFavorite"] {
                guard case .bool = favorite else { throw MainsError.invalidReply }
                patch["isFavorite"] = favorite
            }
            if input.objectValue.keys.contains("collectionId") { patch["collectionId"] = input["collectionId"] }
            edits[id] = patch
            return .object(["id": .string(id), "requestedId": .string(id), "title": row["title"], "kind": row["kind"],
                            "isFavorite": patch["isFavorite"] ?? row["isFavorite"], "collectionId": patch["collectionId"] ?? row["collectionId"]])
        case "atlas:saveMobileBookmark":
            guard let url = AtlasBookmarkURL.validate(input["url"].string ?? ""), var parts = URLComponents(string: url) else { throw MainsError.server("Enter a complete web link.") }
            parts.queryItems = parts.queryItems?.filter { !$0.name.lowercased().hasPrefix("utm_") && !["fbclid", "gclid"].contains($0.name.lowercased()) }
            if parts.queryItems?.isEmpty == true { parts.queryItems = nil }
            parts.host = parts.host?.lowercased()
            let key = "bookmark:" + (parts.string ?? url)
            if let id = sources[key], let row = saved[id] { edits[id, default: [:]]["trashedAt"] = .null; return summary(row) }
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
            var rows = libraryRows().filter { $0["trashedAt"].string == nil }
            let type = input["type"].string ?? "all", scope = input["scope"].string ?? "all", query = (input["query"].string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            rows = rows.filter { row in
                (type == "all" || row["kind"].string == type)
                && (scope == "all" || scope == "favorites" && row["isFavorite"].bool == true || scope == "saved" && row["origin"].string == "saved" || scope == "generated" && row["origin"].string == "generated")
                && (input["collectionId"].string == nil || input["collectionId"].string == row["collectionId"].string)
                && (input["tagId"].string == nil || row["tags"].array.contains { $0["id"].string == input["tagId"].string })
                && (query.isEmpty || ((row["title"].string ?? "") + " " + row["tags"].array.compactMap { $0["name"].string }.joined(separator: " ")).localizedCaseInsensitiveContains(query))
            }
            let page = max(1, min(Int(input["page"].number ?? 1), max(1, (rows.count + 49) / 50)))
            return .object(["items": .array(Array(rows.dropFirst((page - 1) * 50).prefix(50))), "page": .number(Double(page)), "hasNext": .bool(page * 50 < rows.count)])
        case "atlas:readMobilePage":
            guard edits["demo-atlas-page"]?["trashedAt"]?.string == nil else { throw MainsError.server("Atlas page not found or in Trash") }
            guard input["id"].string == "demo-atlas-page", input["version"].number == nil || input["version"].number == 1 else { throw MainsError.server("This demo page is unavailable. Refresh it to read again.") }
            let markdown = "# Your library, on iPhone\n\nAtlas brings **Pages, documents, images and bookmarks** together.\n\n- Search your library\n- Filter by project or favorites\n- Preview and share a file\n\n[Open the sample report](atlas-file://demo-atlas-doc)\n\nEverything here is prepared sample data. No computer or AI service was contacted."
            guard input["offset"].number == nil || input["offset"].number == 0 else { throw MainsError.invalidReply }
            return .object(["id": .string("demo-atlas-page"), "title": .string("Explore Atlas"), "icon": .string("emoji:🗺️"), "version": .number(1),
                            "markdown": .string(markdown), "offset": .number(0), "nextOffset": .null, "sourceRunId": .string(runID)])
        case "atlas:describeMobileFile", "atlas:readMobileFile":
            let reference = input["reference"]
            let id = reference["itemId"].string ?? (reference["runId"].string == runID && reference["sourceKey"].string == source ? "demo-atlas-generated" : "")
            guard edits[id]?["trashedAt"]?.string == nil else { throw MainsError.server("Atlas file not found or in Trash") }
            guard let file = files[id] ?? storedFiles[id] else { throw MainsError.server("Demo Atlas file not found.") }
            if channel == "atlas:readMobileFile" { return try file.chunk(input) }
            var row = file.descriptor(runID: runID).objectValue; row.removeValue(forKey: "runId"); row["reference"] = reference
            return .object(row)
        default: throw MainsError.invalidReply
        }
    }
}
