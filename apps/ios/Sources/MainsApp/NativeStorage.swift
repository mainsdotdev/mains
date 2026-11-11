import Foundation
import Security

@MainActor
final class NativeStorage: SessionStorage {
    private let service = (Bundle.main.bundleIdentifier ?? "dev.mains.ios") + ".pairing"
    private let account = "paired-backend"
    private let defaults = UserDefaults.standard
    var demoEnabled: Bool { defaults.bool(forKey: "native-demo-enabled-v1") }
    func setDemoEnabled(_ enabled: Bool) { defaults.set(enabled, forKey: "native-demo-enabled-v1") }
    private var cacheURL: URL {
        URL.cachesDirectory.appendingPathComponent("mains-native-snapshot.json")
    }
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

    func loadSnapshot() -> CachedSnapshot? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: cacheURL.path),
              (attributes[.size] as? Int ?? Int.max) <= 8 * 1024 * 1024,
              let data = try? Data(contentsOf: cacheURL) else { return nil }
        return try? Wire.decoder().decode(CachedSnapshot.self, from: data)
    }
    func saveSnapshot(_ snapshot: CachedSnapshot) {
        guard let data = try? Wire.encoder().encode(snapshot), data.count <= 8 * 1024 * 1024 else { return }
        try? data.write(to: cacheURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func removeSnapshot() { try? FileManager.default.removeItem(at: cacheURL) }
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
