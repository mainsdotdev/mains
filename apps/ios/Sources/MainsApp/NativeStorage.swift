import Foundation
import Security

@MainActor
final class NativeStorage: SessionStorage {
    private let service = (Bundle.main.bundleIdentifier ?? "dev.mains.ios") + ".pairing"
    private let account = "paired-backend"
    private let defaults = UserDefaults.standard
    private let cache = SQLiteConversationCache(directory: URL.cachesDirectory.appendingPathComponent("MainsConversations", isDirectory: true))
    private let draftStore = TextDraftFileStore(root: URL.applicationSupportDirectory.appendingPathComponent("MainsDrafts-v1", isDirectory: true))
    func loadDraftText(_ key: TextDraftKey) throws -> String? { try draftStore.load(key) }
    func saveDraftText(_ text: String, for key: TextDraftKey) throws { try draftStore.save(text, for: key) }
    func removeDraftTexts(backendID: String, deviceID: String) throws { try draftStore.remove(backendID: backendID, deviceID: deviceID) }
    var demoEnabled: Bool { defaults.bool(forKey: "native-demo-enabled-v1") }
    func setDemoEnabled(_ enabled: Bool) { defaults.set(enabled, forKey: "native-demo-enabled-v1") }
    private let legacySnapshot = URL.cachesDirectory.appendingPathComponent("mains-native-snapshot.json")
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    func loadPairing() throws -> PairedBackend? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        try check(status)
        guard let data = result as? Data else { throw MainsError.invalidReply }
        return try Wire.decoder().decode(PairedBackend.self, from: data)
    }

    func savePairing(_ pairing: PairedBackend) throws {
        let data = try Wire.encoder().encode(pairing)
        let attributes: [String: Any] = [kSecValueData as String: data,
                                       kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound { try check(SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)) }
        else { try check(status) }
    }

    func removePairing() throws {
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecItemNotFound { try check(status) }
        defaults.removeObject(forKey: "ai-data-consents-v1")
    }

    func loadSnapshot(backendID: String, deviceID: String) async -> CachedSnapshot? {
        await cache.loadSnapshot(backendID: backendID, deviceID: deviceID)
    }
    func loadHistory(backendID: String, deviceID: String, runID: String) async -> HistoryPage? {
        await cache.loadHistory(backendID: backendID, deviceID: deviceID, runID: runID)
    }
    func searchSavedMessages(_ query: String, backendID: String, deviceID: String) async -> [SavedMessageMatch] {
        await cache.searchSavedMessages(query, backendID: backendID, deviceID: deviceID)
    }
    func offlineValues(_ key: String, prefix: Bool, backendID: String, deviceID: String) async -> [Data] {
        await cache.offlineValues(key, prefix: prefix, backendID: backendID, deviceID: deviceID)
    }
    func saveOfflineValue(_ data: Data, key: String, backendID: String, deviceID: String) {
        cache.saveOfflineValue(data, key: key, backendID: backendID, deviceID: deviceID)
    }
    func removeOfflineValues(_ prefix: String, backendID: String, deviceID: String) {
        cache.removeOfflineValues(prefix, backendID: backendID, deviceID: deviceID)
    }
    func offlineFiles(backendID: String, deviceID: String) async -> [OfflineFile] {
        await cache.offlineFiles(backendID: backendID, deviceID: deviceID)
    }
    func offlineFileURL(_ file: OfflineFile, backendID: String, deviceID: String) async -> URL? {
        await cache.offlineFileURL(file, backendID: backendID, deviceID: deviceID)
    }
    func saveOfflineFile(_ file: OfflineFile, copying source: URL, backendID: String, deviceID: String) async throws {
        try await cache.saveOfflineFile(file, copying: source, backendID: backendID, deviceID: deviceID)
    }
    func removeOfflineFile(_ file: OfflineFile, backendID: String, deviceID: String) async throws {
        try await cache.removeOfflineFile(file, backendID: backendID, deviceID: deviceID)
    }
    func saveSnapshot(_ snapshot: CachedSnapshot, deviceID: String, history: CachedHistoryChange?) {
        cache.save(snapshot, deviceID: deviceID, history: history)
    }
    func removeSnapshot() {
        cache.removeAll()
        try? FileManager.default.removeItem(at: legacySnapshot)
    }
    private func consentKey(_ backendID: String, _ providerID: String) -> String {
        // Encode a tuple rather than joining user-controlled identities with a delimiter.
        let data = try? JSONEncoder().encode([backendID, providerID])
        return data?.base64EncodedString() ?? ""
    }
    func hasConsent(backendID: String, providerID: String) -> Bool {
        (defaults.stringArray(forKey: "ai-data-consents-v1") ?? []).contains(consentKey(backendID, providerID))
    }
    func grantConsent(backendID: String, providerID: String) {
        var values = Set(defaults.stringArray(forKey: "ai-data-consents-v1") ?? [])
        values.insert(consentKey(backendID, providerID))
        defaults.set(Array(values), forKey: "ai-data-consents-v1")
    }
    func revokeConsent(backendID: String, providerID: String) {
        let key = consentKey(backendID, providerID)
        let values = (defaults.stringArray(forKey: "ai-data-consents-v1") ?? []).filter { $0 != key }
        defaults.set(values, forKey: "ai-data-consents-v1")
    }
    func revokeAllConsents(backendID: String) {
        let values = (defaults.stringArray(forKey: "ai-data-consents-v1") ?? []).filter { key in
            guard let data = Data(base64Encoded: key), let tuple = try? JSONDecoder().decode([String].self, from: data) else { return true }
            return tuple.first != backendID
        }
        defaults.set(values, forKey: "ai-data-consents-v1")
    }
    private func check(_ status: OSStatus) throws {
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [
                NSLocalizedDescriptionKey: SecCopyErrorMessageString(status, nil) as String? ?? "Keychain unavailable",
            ])
        }
    }
}
