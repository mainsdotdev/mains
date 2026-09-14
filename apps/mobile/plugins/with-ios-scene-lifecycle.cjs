const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const SCENE_DELEGATE_CLASS = "MainsSceneDelegate";
const SCENE_DELEGATE_SOURCE = `

// Xcode 27 requires apps built with the iOS 27 SDK to adopt UIScene.
// Keep this generated through the Expo config plugin; ios/ is CNG output.
class ${SCENE_DELEGATE_CLASS}: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate
    else {
      return
    }

    let sceneWindow: UIWindow
    if let existingWindow = appDelegate.window {
      sceneWindow = existingWindow
    } else {
      let newWindow = UIWindow(windowScene: windowScene)
      appDelegate.window = newWindow
      appDelegate.reactNativeFactory?.startReactNative(
        withModuleName: "main",
        in: newWindow,
        launchOptions: nil)
      sceneWindow = newWindow
    }

    window = sceneWindow
    sceneWindow.windowScene = windowScene
    sceneWindow.makeKeyAndVisible()

    if let url = connectionOptions.urlContexts.first?.url {
      _ = appDelegate.application(UIApplication.shared, open: url, options: [:])
    }

    if let userActivity = connectionOptions.userActivities.first {
      _ = appDelegate.application(
        UIApplication.shared,
        continue: userActivity,
        restorationHandler: { _ in })
    }
  }

  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    guard
      let url = contexts.first?.url,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate
    else {
      return
    }

    _ = appDelegate.application(UIApplication.shared, open: url, options: [:])
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
      return
    }

    _ = appDelegate.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in })
  }
}`;

module.exports = function withIosSceneLifecycle(config) {
  const configWithManifest = withInfoPlist(config, (nextConfig) => {
    nextConfig.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: `$(PRODUCT_MODULE_NAME).${SCENE_DELEGATE_CLASS}`,
          },
        ],
      },
    };

    return nextConfig;
  });

  return withAppDelegate(configWithManifest, (nextConfig) => {
    if (nextConfig.modResults.language !== "swift") {
      throw new Error("The iOS scene lifecycle plugin requires a Swift AppDelegate.");
    }

    if (!nextConfig.modResults.contents.includes(`class ${SCENE_DELEGATE_CLASS}:`)) {
      nextConfig.modResults.contents += SCENE_DELEGATE_SOURCE;
    }

    return nextConfig;
  });
};
