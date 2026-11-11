import Foundation

/// Fixed, on-device examples. These describe a patch; no workspace files are changed.
enum DemoTurnChanges {
    static let patch = """
    diff --git a/Sources/Greeting.swift b/Sources/Greeting.swift
    --- a/Sources/Greeting.swift
    +++ b/Sources/Greeting.swift
    @@ -1,3 +1,4 @@
     struct Greeting {
    -    let title = "Hello"
    +    let title = "Hello from Mains"
    +    let subtitle = "Native iPhone demo"
     }
    diff --git a/Docs/Review.md b/Docs/Review.md
    new file mode 100644
    --- /dev/null
    +++ b/Docs/Review.md
    @@ -0,0 +1,205 @@
    """ + "\n" + (1...205).map { "+Sample review line \($0): café 👋 — kept only on this iPhone." }.joined(separator: "\n") + "\n" + """
    diff --git a/Docs/notes.md b/Docs/guide.md
    similarity index 100%
    rename from Docs/notes.md
    rename to Docs/guide.md
    diff --git a/Assets/sample.png b/Assets/sample.png
    Binary files a/Assets/sample.png and b/Assets/sample.png differ
    """ + "\n"

    static func summary(turnID: Int) -> JSONValue {
        func file(_ path: String, status: String, additions: Int = 0, deletions: Int = 0, oldPath: String? = nil, binary: Bool = false, shared: Bool = false) -> JSONValue {
            var item: [String: JSONValue] = ["path": .string(path), "status": .string(status), "additions": .number(Double(additions)),
                "deletions": .number(Double(deletions)), "binary": .bool(binary), "shared": .bool(shared)]
            if let oldPath { item["oldPath"] = .string(oldPath) }
            return .object(item)
        }
        return .object(["id": .string("demo-turn-\(turnID)"), "files": .array([
            file("Sources/Greeting.swift", status: "modified", additions: 2, deletions: 1, shared: true),
            file("Docs/Review.md", status: "added", additions: 205),
            file("Docs/guide.md", status: "renamed", oldPath: "Docs/notes.md"),
            file("Assets/sample.png", status: "modified", binary: true),
        ]), "fileCount": .number(4), "additions": .number(207), "deletions": .number(1), "truncated": .bool(false), "undoneAt": .null])
    }
}
