import SwiftUI

/// Shared presentation, with home drafts and durable conversation settings kept separate.
struct ComposerContext {
    let providerId: String
    let mode: String
    let name: String
    let spaceID: String?
    let runID: String?
    let workspaceID: String?
    init(space: Space, runID: String? = nil) {
        providerId = space.providerId; mode = space.mode; name = space.name
        spaceID = space.id; self.runID = runID; workspaceID = nil
    }
    init(run: Conversation) {
        providerId = run.providerId; mode = run.mode; name = Provider.name(run.providerId)
        spaceID = nil; runID = run.id; workspaceID = run.workspaceId
    }
    @MainActor func settings(_ session: BackendSession) -> ComposerSettings {
        if let runID, let editing = session.existingMessageQueue(for: runID)?.editingSettings { return editing }
        if let runID, let settings = session.settings(forRunID: runID) { return settings }
        if let space = session.spaces.first(where: { $0.id == spaceID }) { return session.settings(for: space) }
        return ComposerSettings()
    }
    @MainActor func model(_ session: BackendSession) -> ModelChoice? {
        let value = settings(session).model
        return session.models[providerId]?.first { $0.id == value || value.isEmpty && $0.isDefault == true }
    }
    @MainActor func modelsLoading(_ session: BackendSession) -> Bool {
        session.loadingModels.contains(providerId) ||
            session.isConnected && session.models[providerId] == nil && session.modelErrors[providerId] == nil
    }
    @MainActor func saving(_ session: BackendSession) -> Bool {
        if let runID, session.existingMessageQueue(for: runID)?.editingID != nil { return false }
        return runID.map { session.savingConversationSettings.contains($0) || session.uncertainConversationSettings.contains($0) } ?? false
    }
    @MainActor func save(_ settings: ComposerSettings, session: BackendSession) {
        if let runID, let queue = session.existingMessageQueue(for: runID), queue.editingID != nil { queue.editingSettings = settings; return }
        if let runID {
            let owner = session.ownership
            Task {
                guard owner == session.ownership else { return }
                do { try await session.updateConversationSettings(settings, runID: runID) }
                catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
            }
        } else if let spaceID { session.setSettings(settings, spaceID: spaceID) }
    }
    @MainActor func commit(_ settings: ComposerSettings, session: BackendSession) async throws {
        if let runID, let queue = session.existingMessageQueue(for: runID), queue.editingID != nil { queue.editingSettings = settings; return }
        if let runID { try await session.updateConversationSettings(settings, runID: runID) }
        else if let spaceID { session.setSettings(settings, spaceID: spaceID) }
    }
    @MainActor func contextScope(_ session: BackendSession) -> ContextScope {
        session.contextScope(providerID: providerId, workspaceID: runID != nil || mode == "developer" ? workspace(session) : nil)
    }
    @MainActor func workspace(_ session: BackendSession) -> String? {
        workspaceID ?? spaceID.flatMap { session.homeTargets[$0]?.workspaceID }
    }
}

struct ComposerModelLabel: View {
    let model: ModelChoice?
    let loading: Bool
    let providerID: String
    var body: some View {
        if let model {
            HStack(spacing: 5) {
                ComposerModelIcon(name: model.displayName, providerID: providerID)
                Text(model.label(for: providerID)).fontWeight(.semibold)
            }
        } else if loading {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini).accessibilityHidden(true)
                Text("Loading…")
            }
        } else {
            HStack(spacing: 5) {
                ComposerModelIcon(name: "", providerID: providerID)
                Text("Select model").fontWeight(.semibold)
            }
        }
    }
}

struct ComposerModelIcon: View {
    let name: String
    let providerID: String
    private var providerToken: String {
        switch providerID {
        case "codex": "codex"
        case "claude_code": "claude"
        case "copilot_cli": "copilot"
        case "cursor": "cursor"
        case "opencode": "opencode"
        default: "model-bot"
        }
    }
    private var token: String {
        let displayName = providerID == "opencode" ? OpenCodeModelDisplay.parts(name)?.name ?? name : name
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if name.contains("muse") { return "model-muse" }
        if name.contains("deepseek") { return "model-deepseek" }
        if name.contains("gpt") { return "model-gpt" }
        if name.contains("llama") { return "model-meta" }
        if ["opus", "sonnet", "haiku", "claude", "fable"].contains(where: { name.contains($0) }) { return "claude" }
        if name.contains("gemini") { return "model-gemini" }
        if name.contains("composer") { return "cursor" }
        if name.contains("auto") {
            if providerID == "copilot_cli" { return "copilot" }
            return ["cursor", "opencode"].contains(providerID) ? "cursor" : providerToken
        }
        if name.contains("codex") { return "model-gpt" }
        if name.contains("grok") { return "model-grok" }
        if name.contains("kimi") { return "model-kimi" }
        if name.contains("glm") { return "model-zai" }
        return providerToken
    }
    var body: some View {
        Group {
            if ["model-muse", "model-deepseek", "model-meta", "model-gemini"].contains(token) {
                Image("registry-" + token).renderingMode(.original).resizable().scaledToFit().frame(width: 14, height: 14)
            } else {
                RegistryIcon(token: "icon:" + token, fallback: "cpu", size: 14,
                             tint: token == "claude" ? Provider.accent("claude_code") : .primary, useStoredColor: false)
            }
        }.frame(width: 16, height: 16).accessibilityHidden(true)
    }
}

struct SettingsRecoveryNotice: View {
    let session: BackendSession
    let runID: String?
    var body: some View {
        if let runID, session.uncertainConversationSettings.contains(runID) {
            ChatNotice(title: "Settings save unconfirmed", message: "Check the original save before sending or changing settings.", symbol: "exclamationmark.circle", warning: true) {
                Button("Check settings") {
                    let owner = session.ownership
                    Task {
                        do { try await session.checkConversationSettings(runID) }
                        catch { if owner == session.ownership { session.actionError = error.localizedDescription } }
                    }
                }.disabled(!session.isConnected || session.savingConversationSettings.contains(runID)).accessibilityIdentifier("checkSettings")
            }.padding(.vertical, 8)
        }
    }
}
