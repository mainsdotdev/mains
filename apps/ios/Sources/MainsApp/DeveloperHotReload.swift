#if DEBUG && targetEnvironment(simulator)
import SwiftUI
import Combine

/// InjectionIII's documented notification invalidates views without replacing
/// their identity, session, navigation or draft state. Xcode's Debug opaque-type
/// erasure handles changes to the view body's concrete type.
@MainActor
private final class HotReloadObserver: ObservableObject {
    static let shared = HotReloadObserver()
    @Published private(set) var revision = 0
    private var notification: AnyCancellable?

    private init() {
        let environment = ProcessInfo.processInfo.environment
        guard environment["MAINS_HOT_RELOAD"] != "0",
              environment["XCTestConfigurationFilePath"] == nil,
              environment["XCTestBundlePath"] == nil else { return }

        notification = NotificationCenter.default.publisher(for: Notification.Name("INJECTION_BUNDLE_NOTIFICATION"))
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                MainActor.assumeIsolated { self?.revision &+= 1 }
            }

        let path = "/Applications/InjectionIII.app/Contents/Resources/iOSInjection.bundle"
        guard let bundle = Bundle(path: path), bundle.load() else {
            print("[Mains Hot Reload] Run npm run dev:hot-reload in apps/ios, then run the Debug simulator build again.")
            return
        }
        print("[Mains Hot Reload] Enabled for the Debug simulator build.")
    }
}

/// Add this only to SwiftUI views/modifiers, inside the same compilation guard.
/// Observation causes an ordinary body update; never use .id(revision) here.
@propertyWrapper @MainActor
struct ObserveHotReload: DynamicProperty {
    @ObservedObject private var observer = HotReloadObserver.shared
    var wrappedValue: Int { observer.revision }
}
#endif
