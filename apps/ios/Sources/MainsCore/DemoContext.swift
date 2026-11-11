import Foundation

/// Prepared catalogue only. Demo context is never loaded from the computer or executed.
enum DemoContext {
    static func skills(workspace: Bool) -> [JSONValue] {
        var items: [JSONValue] = [
            .object(["name": .string("demo-planning"), "displayName": .string("Planning"), "scope": .string("plugin"),
                     "description": .string("Plan a small change using bundled sample guidance."), "brandColor": .string("#8b5cf6"),
                     "path": .string("/Demo/plugins/planning/SKILL.md"), "userInvokable": .bool(true)]),
            .object(["name": .string("demo-writing"), "displayName": .string("Clear writing"), "scope": .string("user"),
                     "shortDescription": .string("Make the sample response clear and concise."), "userInvokable": .bool(true)]),
        ]
        if workspace {
            items.append(.object(["name": .string("demo-review"), "displayName": .string("Workspace review"), "scope": .string("project"),
                                  "description": .string("Review the bundled workspace conventions."), "path": .string("/Demo/workspace/.agents/skills/review/SKILL.md")]))
        }
        return items
    }
    static let commands: [JSONValue] = [
        .object(["name": .string("review"), "description": .string("Try a prepared workspace review."), "argumentHint": .string("[focus]"), "userFacing": .bool(true)]),
        .object(["name": .string("help"), "description": .string("Explore sample commands."), "userFacing": .bool(true)]),
    ]
}
