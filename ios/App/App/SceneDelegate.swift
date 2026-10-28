import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // Register cold-start callbacks before the bridge's first appearance.
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

        // UIKit supplies the Main storyboard window. Only create a fallback when
        // no storyboard window was provided, preserving the custom bridge setup.
        if window == nil {
            window = UIWindow(windowScene: windowScene)
            window?.rootViewController = TripCashBridgeViewController()
        }
        window?.makeKeyAndVisible()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
