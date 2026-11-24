import FirebaseAppCheck
import FirebaseCore
import FirebaseRemoteConfig
import SwiftUI

@main
struct SyllabusTermApp: App {
  init() {
    #if targetEnvironment(simulator)
      // Simulator: App Check debug provider with a token registered in the Firebase console
      // (kept in the git-ignored Secrets.xcconfig, surfaced through Info.plist).
      if let token = Bundle.main.object(forInfoDictionaryKey: "AppCheckDebugToken") as? String, !token.isEmpty {
        setenv("FIRAAppCheckDebugToken", token, 1)
      }
      AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())
    #else
      AppCheck.setAppCheckProviderFactory(AppAttestFactory())
    #endif
    FirebaseApp.configure()
  }

  var body: some Scene { WindowGroup { ContentView() } }
}

final class AppAttestFactory: NSObject, AppCheckProviderFactory {
  func createProvider(with app: FirebaseApp) -> (any AppCheckProvider)? { AppAttestProvider(app: app) }
}

/// Remote Config switches shared with the web app (escalation kill switch).
enum Switches {
  static func escalationEnabled() async -> Bool {
    let rc = RemoteConfig.remoteConfig()
    rc.setDefaults(["escalation_enabled": true as NSObject])
    let settings = RemoteConfigSettings()
    settings.fetchTimeout = 2 // seconds; on failure the defaults apply
    settings.minimumFetchInterval = 600
    rc.configSettings = settings
    _ = try? await rc.fetchAndActivate()
    return rc.configValue(forKey: "escalation_enabled").boolValue
  }
}
